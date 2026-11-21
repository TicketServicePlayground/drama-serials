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
    assert first["at"].endswith("+00:00")


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


async def test_signing_up_at_paying_keeps_the_landing_source(client, gateways):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

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
    visits = await raw_rows(client, "visits")
    assert any(v["user_id"] == str(user.id) and v["utm_campaign"] == "guest-camp" for v in visits)


async def test_series_views_count_real_plays(client):
    for n in (1, 1, 2):
        await client.post("/api/v1/visits", json={"path": "/series/real-views", "ip": "8.1.1.1", "ua": IPHONE,
                                                  "event": "episode", "target": f"real-views/{n}"})
    views = (await client.get("/api/v1/series-views")).json()
    assert views["series"]["real-views"] == 3 and views["episodes"]["real-views~1"] == 2


async def test_the_ab_group_is_kept_on_the_user(client):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AB-test"
    for group, ip in (("paywall", "198.51.100.71"), ("email", "198.51.100.72")):
        headers = await signup(client)
        await client.post("/api/v1/visits", json={"ua": ua, "ip": ip, "ab": group, "path": "/series/ab-show"}, headers=headers)
    # A junk group is not kept.
    await client.post("/api/v1/visits", json={"ua": ua, "ip": "198.51.100.73", "ab": "junk", "path": "/"})
    async with SessionLocal() as session:
        groups = {u.ab for u in (await session.scalars(select(User).where(User.ab != ""))).all()}
    assert {"paywall", "email"} <= groups and "junk" not in groups
