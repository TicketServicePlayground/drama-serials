IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1"
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/157.0 Safari/537.36"


async def test_visits_are_counted_and_summarised(client):
    view = {"path": "/?lang=ru", "lang": "ru", "ip": "1.2.3.4", "ua": IPHONE}
    assert (await client.post("/api/v1/visits", json={**view, "referrer": "https://www.instagram.com/x", "utm_source": "IG"})).status_code == 204
    await client.post("/api/v1/visits", json={**view, "path": "/series/after-divorce-hotel-is-mine", "referrer": "http://localhost:3000/"})
    await client.post("/api/v1/visits", json={"path": "/", "ip": "5.6.7.8", "ua": MAC})
    # Bots and junk are dropped.
    await client.post("/api/v1/visits", json={"path": "/", "ip": "9.9.9.9", "ua": "Mozilla/5.0 (compatible; YandexBot/3.0)"})
    await client.post("/api/v1/visits", json={"path": "https://evil/", "ip": "9.9.9.9", "ua": MAC})

    assert (await client.get("/api/v1/stats")).status_code == 404
    assert (await client.get("/api/v1/stats", params={"key": "wrong"})).status_code == 404
    response = await client.get("/api/v1/stats", params={"key": "stats-key"})
    assert response.status_code == 200
    data = response.json()
    assert data["today"]["views"] == 3
    assert data["today"]["visitors"] == 2
    assert data["week"]["visitors"] == 2
    assert data["yesterday"]["views"] == 0
    assert data["by_day"][0]["views"] == 3 and len(data["by_day"]) == 14
    assert {r["name"]: r["visitors"] for r in data["referrers"]} == {"instagram.com": 1}
    assert data["utm"][0]["name"] == "ig"
    assert {r["name"] for r in data["devices"]} == {"mobile", "desktop"}
    assert data["recent"][0]["path"] == "/"
    assert {r["name"] for r in data["pages"]} == {"/", "/series/after-divorce-hotel-is-mine"}


from tests.test_flow import gateways, signup  # noqa: E402,F401  (fixture reused)


async def test_funnel_follows_a_visitor_from_cover_to_payment(client, gateways):
    base = {"ip": "7.7.7.7", "ua": IPHONE, "utm_source": "funneltest"}
    await client.post("/api/v1/visits", json={**base, "path": "/"})
    await client.post("/api/v1/visits", json={**base, "path": "/", "event": "cover", "target": "after-divorce-hotel-is-mine"})
    await client.post("/api/v1/visits", json={**base, "path": "/", "event": "auth_open", "target": "watch"})
    headers = await signup(client)
    signed = {**base, "utm_source": ""}
    await client.post("/api/v1/visits", json={**signed, "path": "/series/after-divorce-hotel-is-mine"}, headers=headers)
    await client.post("/api/v1/visits", json={**signed, "path": "/series/after-divorce-hotel-is-mine", "event": "episode", "target": "after-divorce-hotel-is-mine/2"}, headers=headers)
    await client.post("/api/v1/visits", json={**signed, "path": "/series/after-divorce-hotel-is-mine", "event": "paywall", "target": "after-divorce-hotel-is-mine"}, headers=headers)
    assert (await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)).status_code == 200
    # Someone else from the same campaign who only looked; and an unknown event is dropped.
    await client.post("/api/v1/visits", json={"path": "/", "ip": "8.8.8.8", "ua": MAC, "utm_source": "funneltest"})
    await client.post("/api/v1/visits", json={"path": "/", "ip": "8.8.8.8", "ua": MAC, "event": "hack'; --"})

    assert (await client.get("/api/v1/funnel", params={"key": "wrong"})).status_code == 404
    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    source = next(row for row in data["by_source"] if row["source"] == "funneltest")
    assert {step: source[step] for step in data["steps"]} == {
        "visit": 2, "cover": 1, "auth_open": 1, "signup": 1, "series": 1,
        "episode": 1, "paywall": 1, "checkout": 1, "paid": 0,
    }
    series = next(row for row in data["by_series"] if row["slug"] == "after-divorce-hotel-is-mine")
    assert series["cover"] >= 1 and series["episode"] >= 1 and series["paywall"] >= 1
    assert data["server"]["checkouts"] >= 1
    # Clicks are not page views.
    stats = (await client.get("/api/v1/stats", params={"key": "stats-key"})).json()
    assert all(r["name"] != "funneltest" or r["views"] == 2 for r in stats["utm"])


async def test_campaign_country_and_team_in_the_funnel(client, gateways, monkeypatch):
    from tests.test_flow import ref_of
    from app.config import settings
    from app.models import Provider

    ad = {"ip": "9.1.1.1", "ua": IPHONE, "utm_source": "meta", "utm_medium": "paid",
          "utm_campaign": "launch-id", "utm_content": "ad-hotel", "fbclid": True, "country": "ID"}
    await client.post("/api/v1/visits", json={**ad, "path": "/series/x"})
    headers = await signup(client)
    plain = {"ip": "9.1.1.1", "ua": IPHONE, "country": "ID"}
    # Back from the payment page: not a new source.
    await client.post("/api/v1/visits", json={**plain, "path": "/", "referrer": "https://checkout.doku.com/x"}, headers=headers)
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers)).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=9900)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)

    # A team member from Russia, flagged by email.
    monkeypatch.setattr(settings, "test_emails", "team-member@example.com")
    team = await signup(client, "team-member@example.com")
    await client.post("/api/v1/visits", json={"path": "/", "ip": "9.9.9.1", "ua": MAC, "country": "RU", "utm_campaign": "launch-id"}, headers=team)

    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    campaign = next(r for r in data["by_campaign"] if r["campaign"] == "launch-id" and r["content"] == "ad-hotel")
    assert campaign["visit"] == 1 and campaign["paid"] == 1 and campaign["revenue"] == 9900
    assert campaign["paid_by_source"] == 1 and campaign["revenue_by_source"] == 9900
    assert "RU" not in {r["country"] for r in data["by_country"]}
    assert next(r for r in data["by_country"] if r["country"] == "ID")["paid"] >= 1
    assert all(r["source"] != "checkout.doku.com" for r in data["by_source"])
    only_id = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today", "country": "ID"})).json()
    assert {r["country"] for r in only_id["by_country"]} == {"ID"}
    with_tests = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today", "tests": "true"})).json()
    assert "RU" in {r["country"] for r in with_tests["by_country"]}


async def test_series_views_count_real_plays(client):
    for n in (1, 1, 2):
        await client.post("/api/v1/visits", json={"path": "/series/real-views", "ip": "8.1.1.1", "ua": IPHONE,
                                                  "event": "episode", "target": f"real-views/{n}"})
    views = (await client.get("/api/v1/series-views")).json()
    assert views["series"]["real-views"] == 3 and views["episodes"]["real-views~1"] == 2
