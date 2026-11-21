IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1"
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/157.0 Safari/537.36"

from tests.test_flow import gateways, signup  # noqa: E402,F401  (fixture reused)

RAW = "/api/v1/raw"


async def raw_rows(client, table: str, **params) -> list[dict]:
    data = (await client.get(RAW, params={"key": "stats-key", "table": table, **params})).json()
    return [dict(zip(data["columns"], row)) for row in data["rows"]]


async def test_visits_are_written_as_they_came(client):
    view = {"path": "/?lang=ru", "lang": "ru", "ip": "1.2.3.4", "ua": IPHONE, "utm_source": "RawTest",
            "referrer": "https://www.instagram.com/x", "cid": "ab" * 12, "country": "id", "ab": "email"}
    assert (await client.post("/api/v1/visits", json=view)).status_code == 204
    await client.post("/api/v1/visits", json={**view, "path": "/series/x", "event": "episode", "target": "x/2"})
    # Bots, junk and unknown events are not written.
    await client.post("/api/v1/visits", json={**view, "ua": "Mozilla/5.0 (compatible; YandexBot/3.0)", "utm_source": "rawbot"})
    await client.post("/api/v1/visits", json={**view, "path": "https://evil/", "utm_source": "rawjunk"})
    await client.post("/api/v1/visits", json={**view, "event": "hack'; --", "utm_source": "rawjunk"})

    rows = [r for r in await raw_rows(client, "visits") if r["utm_source"] in ("rawtest", "rawbot", "rawjunk")]
    assert [(r["path"], r["event"], r["target"]) for r in rows] == [("/series/x", "episode", "x/2"), ("/", "", "")]
    first = rows[-1]
    assert (first["referrer"], first["country"], first["lang"], first["device"], first["ab"]) == ("instagram.com", "ID", "ru", "mobile", "email")
    assert first["client_id"] == "ab" * 12 and len(first["visitor"]) == 16 and first["user_id"] is None
    assert first["at"].endswith("+08:00")


async def test_raw_needs_the_key_and_a_known_table(client):
    assert (await client.get(RAW)).status_code == 404
    assert (await client.get(RAW, params={"key": "wrong"})).status_code == 404
    assert (await client.get(RAW, params={"key": "stats-key", "table": "alembic_version"})).status_code == 400
    data = (await client.get(RAW, params={"key": "stats-key"})).json()
    assert data["table"] == "visits" and set(data["tables"]) == {"visits", "users", "payments", "access_grants", "episode_unlocks"}
    assert data["page"] == 1 and data["page_size"] == 500 and data["total"] >= len(data["rows"])


async def test_users_and_payments_come_whole_but_the_password(client, gateways):
    headers = await signup(client, "raw-payer@example.com")
    await client.post("/api/v1/visits", json={"path": "/vip", "ip": "2.2.2.2", "ua": MAC}, headers=headers)
    assert (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers)).status_code == 200

    users = await raw_rows(client, "users")
    user = next(u for u in users if u["email"] == "raw-payer@example.com")
    assert "password_hash" not in user and {"is_test", "src_source", "ab", "email_gate_at"} <= set(user)
    payments = [p for p in await raw_rows(client, "payments") if p["user_id"] == user["id"]]
    assert len(payments) == 1 and payments[0]["status"] == "pending" and payments[0]["product"] == "week"
    visits = await raw_rows(client, "visits")
    assert any(v["user_id"] == user["id"] and v["path"] == "/vip" for v in visits)


async def test_raw_csv_is_the_whole_period(client):
    await client.post("/api/v1/visits", json={"path": "/csv-check", "ip": "3.3.3.3", "ua": MAC})
    response = await client.get(RAW, params={"key": "stats-key", "table": "visits", "format": "csv"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    lines = response.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("id,at,visitor,") and any("/csv-check" in line for line in lines[1:])
    # Days outside the period are not there.
    empty = await client.get(RAW, params={"key": "stats-key", "table": "visits", "format": "csv", "from": "2020-01-01", "to": "2020-01-02"})
    assert len(empty.text.lstrip("﻿").splitlines()) == 1


async def test_series_views_count_real_plays(client):
    for n in (1, 1, 2):
        await client.post("/api/v1/visits", json={"path": "/series/real-views", "ip": "8.1.1.1", "ua": IPHONE,
                                                  "event": "episode", "target": f"real-views/{n}"})
    views = (await client.get("/api/v1/series-views")).json()
    assert views["series"]["real-views"] == 3 and views["episodes"]["real-views~1"] == 2


STATS = "/api/v1/stats"
FUNNEL = "/api/v1/funnel"


async def today(client) -> dict:
    return (await client.get(STATS, params={"key": "stats-key"})).json()["today"]


async def funnel_today(client) -> dict:
    return (await client.get(FUNNEL, params={"key": "stats-key", "period": "today"})).json()


def label_headers(country="", **label) -> dict:
    import json
    from urllib.parse import quote

    return {"X-Label": quote(json.dumps(label)), **({"X-Country": country} if country else {})}


async def test_stats_are_plain_counts_of_rows(client):
    before = await today(client)
    view = {"path": "/", "ip": "10.0.0.1", "ua": IPHONE}
    # Same IP, same phone, with an id, another id, none: four page views, nothing merged.
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12})
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12, "path": "/vip"})
    await client.post("/api/v1/visits", json={**view, "cid": "d2" * 12})
    await client.post("/api/v1/visits", json=view)
    # A click is not a page view; a bot is not written.
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12, "event": "cover", "target": "x"})
    await client.post("/api/v1/visits", json={**view, "ua": "Googlebot/2.1"})

    # The browser's cookie flags: a new session, and one of a browser seen before.
    await client.post("/api/v1/visits", json={**view, "new_session": True})
    await client.post("/api/v1/visits", json={**view, "new_session": True, "returning": True})
    # "returning" without a new session is not a return visit.
    await client.post("/api/v1/visits", json={**view, "returning": True})

    after = await today(client)
    assert after["views"] - before["views"] == 7
    assert (after["sessions"] - before["sessions"], after["returns"] - before["returns"]) == (2, 1)
    assert (await client.get(STATS)).status_code == 404


async def test_funnel_counts_rows_by_their_own_labels(client):
    ad = {"ip": "10.0.0.2", "ua": IPHONE, "utm_source": "rowtest", "utm_campaign": "row-camp", "utm_content": "ad-9", "country": "CO"}
    # The browser sends its label with every visit, the clicks too.
    await client.post("/api/v1/visits", json={**ad, "path": "/", "cid": "e1" * 12})
    await client.post("/api/v1/visits", json={**ad, "path": "/"})
    for _ in range(3):
        await client.post("/api/v1/visits", json={**ad, "path": "/", "event": "cover", "target": "x"})
    # Without a label: no source of this campaign.
    await client.post("/api/v1/visits", json={"ip": "10.0.0.2", "ua": IPHONE, "path": "/", "event": "cover", "target": "x"})

    data = await funnel_today(client)
    row = next(r for r in data["by_source"] if r["source"] == "rowtest")
    assert (row["visit"], row["cover"]) == (2, 3)
    campaign = next(r for r in data["by_campaign"] if r["campaign"] == "row-camp")
    assert (campaign["content"], campaign["visit"], campaign["cover"]) == ("ad-9", 2, 3)
    assert data["steps"][0] == "visit" and data["total"]["cover"] >= 4
    assert (await client.get(FUNNEL, params={"key": "wrong"})).status_code == 404


async def test_sign_ups_and_payments_keep_the_label_they_were_made_with(client, gateways):
    from sqlalchemy import select

    from tests.test_flow import ref_of
    from app.db import SessionLocal
    from app.models import Payment, Provider, User

    headers = label_headers("CO", utm_source="meta", utm_campaign="pay-camp", utm_content="ad-1", ab="email", cid="f1" * 12)
    token = (await client.post("/api/v1/auth/guest", headers=headers)).json()["token"]
    auth = {**headers, "Authorization": f"Bearer {token}"}
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "series_day", "slug": "x"}, headers=auth)).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=12800)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=auth)

    async with SessionLocal() as session:
        user = (await session.scalars(select(User).where(User.src_campaign == "pay-camp"))).one()
        assert (user.src_source, user.src_content, user.src_country, user.ab) == ("meta", "ad-1", "CO", "email")
        paid = (await session.scalars(select(Payment).where(Payment.user_id == user.id))).one()
        assert (paid.utm_source, paid.utm_campaign, paid.utm_content, paid.country, paid.ab, paid.client_id) == (
            "meta", "pay-camp", "ad-1", "CO", "email", "f1" * 12)

    data = await funnel_today(client)
    row = next(r for r in data["by_campaign"] if r["campaign"] == "pay-camp")
    assert (row["signup"], row["checkout"], row["paid"], row["revenue"]) == (1, 1, 1, 12800)
    assert next(r for r in data["by_country"] if r["country"] == "CO")["paid"] >= 1
    assert next(r for r in data["by_ab"] if r["ab"] == "email")["paid"] >= 1
    only_co = (await client.get(FUNNEL, params={"key": "stats-key", "period": "today", "country": "CO"})).json()
    assert {r["country"] for r in only_co["by_country"]} == {"CO"}
    # A junk label is dropped, not stored.
    bad = await client.post("/api/v1/auth/guest", headers={"X-Label": "%7Bnot json", "X-Country": "ZZZ"})
    assert bad.status_code == 200


async def test_ab_groups_and_series_in_the_funnel(client):
    for group in ("paywall", "email"):
        base = {"ua": IPHONE, "ip": "10.0.0.4", "ab": group}
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show"})
        event = "paywall" if group == "paywall" else "email_gate"
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show", "event": event, "target": "ab-show/8"})
    await client.post("/api/v1/visits", json={"ua": IPHONE, "ip": "10.0.0.5", "ab": "junk", "path": "/"})
    data = await funnel_today(client)
    rows = {r["ab"]: r for r in data["by_ab"]}
    assert rows["paywall"]["paywall"] >= 1 and rows["email"]["email_gate"] >= 1 and "junk" not in rows
    series = next(r for r in data["by_series"] if r["slug"] == "ab-show")
    assert series["series"] == 2 and series["paywall"] == 1
