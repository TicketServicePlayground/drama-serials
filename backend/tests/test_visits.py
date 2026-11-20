IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1"
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/157.0 Safari/537.36"


async def test_visits_are_counted_and_summarised(client):
    # Other tests' visits count too (nothing is filtered out): compare with what was there.
    before = (await client.get("/api/v1/stats", params={"key": "stats-key"})).json()
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
    assert data["today"]["views"] == before["today"]["views"] + 3
    assert data["today"]["visitors"] == before["today"]["visitors"] + 2
    assert data["week"]["visitors"] == before["week"]["visitors"] + 2
    assert data["yesterday"]["views"] == 0
    assert data["by_day"][0]["views"] == before["by_day"][0]["views"] + 3 and len(data["by_day"]) == 14
    assert {r["name"]: r["visitors"] for r in data["referrers"]}["instagram.com"] == 1
    assert "ig" in {r["name"] for r in data["utm"]}
    assert {r["name"] for r in data["devices"]} >= {"mobile", "desktop"}
    assert data["recent"][0]["path"] == "/"
    assert {r["name"] for r in data["pages"]} >= {"/", "/series/after-divorce-hotel-is-mine"}


from tests.test_flow import gateways, signup  # noqa: E402,F401  (fixture reused)


async def test_return_visits_are_counted(client):
    from sqlalchemy import text

    from app.db import SessionLocal

    before = (await client.get("/api/v1/stats", params={"key": "stats-key"})).json()["today"]
    cid = "ab" * 12
    # Two page views in a row are one session; the same browser from another IP is still the same person.
    await client.post("/api/v1/visits", json={"path": "/", "ip": "6.1.1.1", "ua": IPHONE, "cid": cid})
    await client.post("/api/v1/visits", json={"path": "/vip", "ip": "6.1.1.2", "ua": IPHONE, "cid": cid})
    after = (await client.get("/api/v1/stats", params={"key": "stats-key"})).json()["today"]
    assert (after["sessions"] - before["sessions"], after["returns"] - before["returns"]) == (1, 0)
    # The earlier views were an hour ago: the latest one is a return visit.
    async with SessionLocal() as session:
        await session.execute(text("UPDATE visits SET at = at - interval '1 hour' WHERE client_id = :cid AND path = '/'"),
                              {"cid": cid})
        await session.commit()
    data = (await client.get("/api/v1/stats", params={"key": "stats-key"})).json()
    assert (data["today"]["sessions"] - before["sessions"], data["today"]["returns"] - before["returns"]) == (2, 1)
    assert data["recent"][0]["path"] == "/vip" and data["recent"][0]["returned"] is True
    assert data["by_day"][0]["returns"] >= 1


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
        "episode": 1, "email_gate": 0, "paywall": 1, "checkout": 1, "paid": 0,
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

    # A team member from Russia, in TEST_EMAILS: counted like everyone else, the stats are raw.
    monkeypatch.setattr(settings, "test_emails", "team-member@example.com")
    team = await signup(client, "team-member@example.com")
    await client.post("/api/v1/visits", json={"path": "/", "ip": "9.9.9.1", "ua": MAC, "country": "RU", "utm_campaign": "launch-id"}, headers=team)

    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    campaign = next(r for r in data["by_campaign"] if r["campaign"] == "launch-id" and r["content"] == "ad-hotel")
    assert campaign["visit"] == 1 and campaign["paid"] == 1 and campaign["revenue"] == 9900
    assert campaign["paid_by_source"] == 1 and campaign["revenue_by_source"] == 9900
    assert "RU" in {r["country"] for r in data["by_country"]}
    assert next(r for r in data["by_country"] if r["country"] == "ID")["paid"] >= 1
    assert all(r["source"] != "checkout.doku.com" for r in data["by_source"])
    only_id = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today", "country": "ID"})).json()
    assert {r["country"] for r in only_id["by_country"]} == {"ID"}


async def test_a_payment_counts_once_when_the_payer_changes_ip(client, gateways):
    from tests.test_flow import ref_of
    from app.models import Provider

    ad = {"ua": IPHONE, "utm_source": "meta", "utm_campaign": "ip-hop", "country": "ID"}
    await client.post("/api/v1/visits", json={**ad, "ip": "9.2.2.1", "path": "/series/x"})
    headers = await signup(client)
    await client.post("/api/v1/visits", json={"ua": IPHONE, "ip": "9.2.2.1", "country": "ID", "path": "/"}, headers=headers)
    # The same person on a VPN a minute later: another visitor-day.
    await client.post("/api/v1/visits", json={"ua": IPHONE, "ip": "9.2.2.2", "country": "US", "path": "/"}, headers=headers)
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "series_day", "slug": "x"}, headers=headers)).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=12800)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)

    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    rows = [r for r in data["by_campaign"] if r["campaign"] == "ip-hop"]
    assert sum(r["paid"] for r in rows) == 1 and sum(r["revenue"] for r in rows) == 12800
    assert sum(r["checkout"] for r in rows) == 1 and sum(r["signup"] for r in rows) == 1
    assert next(r for r in data["by_country"] if r["country"] == "ID")["paid"] >= 1
    assert all(r["paid"] == 0 for r in data["by_country"] if r["country"] == "US")


async def test_signing_up_at_paying_keeps_the_landing_source(client, gateways):
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select

    # Lands from an ad, makes a guest account at the paywall and goes straight to the QR code.
    await client.post("/api/v1/visits", json={"ua": IPHONE, "ip": "9.3.3.3", "country": "CO", "path": "/series/x",
                                              "utm_source": "meta", "utm_campaign": "guest-camp", "utm_content": "ad-1"})
    token = (await client.post("/api/v1/auth/guest")).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    body = {"method": "QRIS", "product": "series_day", "slug": "x", "ad": {"ua": IPHONE}}
    assert (await client.post("/api/v1/payments", json=body, headers={**headers, "X-Forwarded-For": "9.3.3.3"})).status_code == 200

    async with SessionLocal() as session:
        user = (await session.scalars(select(User).where(User.src_campaign == "guest-camp"))).one()
        assert (user.src_content, user.src_country, user.src_source) == ("ad-1", "CO", "meta")
    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    row = next(r for r in data["by_campaign"] if r["campaign"] == "guest-camp")
    assert row["visit"] == 1 and row["signup"] == 1 and row["checkout"] == 1


async def test_series_views_count_real_plays(client):
    for n in (1, 1, 2):
        await client.post("/api/v1/visits", json={"path": "/series/real-views", "ip": "8.1.1.1", "ua": IPHONE,
                                                  "event": "episode", "target": f"real-views/{n}"})
    views = (await client.get("/api/v1/series-views")).json()
    assert views["series"]["real-views"] == 3 and views["episodes"]["real-views~1"] == 2


async def test_ab_groups_split_the_funnel_and_the_later_payments(client, gateways):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AB-test"
    for group, ip in (("paywall", "198.51.100.71"), ("email", "198.51.100.72")):
        headers = await signup(client)
        base = {"ua": ua, "ip": ip, "ab": group, "cid": f"{'a' if group == 'paywall' else 'b'}" * 24}
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show"}, headers=headers)
        event = "paywall" if group == "paywall" else "email_gate"
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show", "event": event, "target": "ab-show/8"}, headers=headers)
    # A junk group is not kept.
    await client.post("/api/v1/visits", json={"ua": ua, "ip": "198.51.100.73", "ab": "junk", "path": "/"})
    async with SessionLocal() as session:
        groups = {u.ab for u in (await session.scalars(select(User).where(User.ab != ""))).all()}
    assert {"paywall", "email"} <= groups
    data = (await client.get("/api/v1/funnel", params={"key": "stats-key", "period": "today"})).json()
    rows = {r["ab"]: r for r in data["by_ab"]}
    assert rows["paywall"]["paywall"] >= 1 and rows["email"]["email_gate"] >= 1
    assert "junk" not in rows and "paid_by_group" in rows["email"]

