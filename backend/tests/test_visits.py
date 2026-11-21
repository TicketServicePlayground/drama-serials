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


async def test_stats_count_rows_and_browsers_not_ips(client):
    before = await today(client)
    view = {"path": "/", "ip": "10.0.0.1", "ua": IPHONE}
    # Two browsers behind one IP, same phone model: two browsers, three page views.
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12})
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12, "path": "/vip"})
    await client.post("/api/v1/visits", json={**view, "cid": "d2" * 12})
    # One more view without a browser id (storage blocked): a row, not a person.
    await client.post("/api/v1/visits", json=view)
    # A click is not a page view; a bot is not written.
    await client.post("/api/v1/visits", json={**view, "cid": "d1" * 12, "event": "cover", "target": "x"})
    await client.post("/api/v1/visits", json={**view, "ua": "Googlebot/2.1", "cid": "d3" * 12})

    after = await today(client)
    assert after["views"] - before["views"] == 4
    assert after["browsers"] - before["browsers"] == 2
    assert after["views_no_id"] - before["views_no_id"] == 1
    assert (await client.get(STATS)).status_code == 404


async def test_funnel_counts_browsers_and_rows(client):
    land = {"path": "/", "ip": "10.0.0.2", "ua": IPHONE, "utm_source": "rowtest"}
    for cid in ("e1" * 12, "e2" * 12):
        await client.post("/api/v1/visits", json={**land, "cid": cid})
    # Clicks carry no utm: they count for the source of their browser.
    plain = {"path": "/", "ip": "10.0.0.9", "ua": MAC}
    for _ in range(2):
        await client.post("/api/v1/visits", json={**plain, "cid": "e1" * 12, "event": "cover", "target": "x"})
    await client.post("/api/v1/visits", json={**plain, "cid": "e2" * 12, "event": "cover", "target": "x"})
    # A landing without a browser id: one row of its own source.
    await client.post("/api/v1/visits", json=land)

    data = await funnel_today(client)
    row = next(r for r in data["by_source"] if r["source"] == "rowtest")
    assert (row["visit"], row["visit_rows"], row["visit_no_id"]) == (2, 3, 1)
    assert (row["cover"], row["cover_rows"]) == (2, 3)
    assert data["steps"][0] == "visit" and data["total"]["visit_rows"] >= 3
    assert (await client.get(FUNNEL, params={"key": "wrong"})).status_code == 404


async def test_a_payment_counts_for_the_browser_it_was_made_from(client, gateways):
    from tests.test_flow import ref_of
    from app.models import Provider

    cid = "f1" * 12
    await client.post("/api/v1/visits", json={"path": "/series/x", "ip": "10.0.0.3", "ua": IPHONE, "cid": cid, "country": "CO",
                                              "utm_source": "meta", "utm_campaign": "pay-camp", "utm_content": "ad-1"})
    # A guest account at the paywall, straight to the QR code: no signed-in page view at all.
    token = (await client.post("/api/v1/auth/guest")).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    body = {"method": "QRIS", "product": "series_day", "slug": "x", "cid": cid}
    payment = (await client.post("/api/v1/payments", json=body, headers=headers)).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=12800)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)

    data = await funnel_today(client)
    row = next(r for r in data["by_campaign"] if r["campaign"] == "pay-camp")
    assert (row["content"], row["visit"], row["signup"], row["checkout"], row["paid"], row["revenue"]) == ("ad-1", 1, 1, 1, 1, 12800)
    assert next(r for r in data["by_country"] if r["country"] == "CO")["paid"] >= 1
    only_co = (await client.get(FUNNEL, params={"key": "stats-key", "period": "today", "country": "CO"})).json()
    assert {r["country"] for r in only_co["by_country"]} == {"CO"}


async def test_ab_groups_in_the_funnel(client):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    for group, cid in (("paywall", "a7" * 12), ("email", "b7" * 12)):
        headers = await signup(client)
        base = {"ua": IPHONE, "ip": "10.0.0.4", "ab": group, "cid": cid}
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show"}, headers=headers)
        event = "paywall" if group == "paywall" else "email_gate"
        await client.post("/api/v1/visits", json={**base, "path": "/series/ab-show", "event": event, "target": "ab-show/8"}, headers=headers)
    await client.post("/api/v1/visits", json={"ua": IPHONE, "ip": "10.0.0.5", "ab": "junk", "path": "/"})
    async with SessionLocal() as session:
        groups = {u.ab for u in (await session.scalars(select(User).where(User.ab != ""))).all()}
    assert {"paywall", "email"} <= groups and "junk" not in groups
    rows = {r["ab"]: r for r in (await funnel_today(client))["by_ab"]}
    assert rows["paywall"]["paywall"] >= 1 and rows["email"]["email_gate"] >= 1 and "junk" not in rows
    assert rows["email"]["signup"] >= 1 and "emails" in rows["email"]
    series = next(r for r in (await funnel_today(client))["by_series"] if r["slug"] == "ab-show")
    assert series["series"] == 2 and series["paywall"] == 1
