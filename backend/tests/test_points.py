from datetime import UTC, datetime, timedelta

from app.config import settings
from app.models import Provider
from tests.test_flow import gateways, ref_of, signup  # noqa: F401  (fixture reused)


async def media_ready(monkeypatch, slug="vip-points-show", episodes=(1, 2)):
    from app import media as media_module
    from app.db import SessionLocal
    from app.models import EpisodeMedia

    async with SessionLocal() as session:
        for n in episodes:
            session.add(EpisodeMedia(slug=slug, episode=n, object_key=f"video/{slug}/{n}.mp4", etag="e", size_bytes=1, duration_seconds=60))
        await session.commit()
    monkeypatch.setattr(settings, "media_bucket", "media")
    monkeypatch.setattr(settings, "media_r2_account_id", "acc")
    monkeypatch.setattr(settings, "media_r2_access_key_id", "key")
    monkeypatch.setattr(settings, "media_r2_secret_access_key", "secret")
    monkeypatch.setattr(media_module, "signed_url", lambda key, ttl=None: f"https://signed/{key}")


async def buy_week(client, gateways, headers):
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers)).json()
    charged = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()["amount"]
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=charged)
    return (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()["account"]


async def test_vip_gets_daily_points_once_and_exchanges_them(client, gateways, monkeypatch):
    await media_ready(monkeypatch)
    headers = await signup(client)
    assert (await client.get("/api/v1/me/points", headers=headers)).json()["balance"] == 0
    until = datetime.fromisoformat((await buy_week(client, gateways, headers))["access_until"])

    first = (await client.get("/api/v1/episodes/vip-points-show/1/play", headers=headers)).json()
    second = (await client.get("/api/v1/episodes/vip-points-show/2/play", headers=headers)).json()
    assert first["points_awarded"] == settings.points_daily and second["points_awarded"] == 0
    mine = (await client.get("/api/v1/me/points", headers=headers)).json()
    assert mine["balance"] == settings.points_daily and mine["earned_today"] is True
    assert mine["history"][0]["reason"] == "daily_watch"

    assert (await client.post("/api/v1/points/redeem", json={"days": 1}, headers=headers)).json() == {
        "error": "not_enough_points"
    }
    monkeypatch.setattr(settings, "points_per_vip_day", 25)
    redeemed = (await client.post("/api/v1/points/redeem", json={"days": 2}, headers=headers)).json()
    assert redeemed["balance"] == 0
    # Two days added after the week already bought.
    assert datetime.fromisoformat(redeemed["account"]["access_until"]) - until == timedelta(days=2)
    # The purchase history lists payments only.
    assert len((await client.get("/api/v1/me/purchases", headers=headers)).json()) == 1


async def test_vip_series_needs_a_pass(client, gateways, monkeypatch):
    await media_ready(monkeypatch, slug="vip-only-show", episodes=(1,))
    headers = await signup(client)
    payment = (
        await client.post(
            "/api/v1/payments",
            json={"method": "QRIS", "product": "episode", "slug": "vip-only-show", "episode": 1},
            headers=headers,
        )
    ).json()
    charged = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()["amount"]
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=charged)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)
    # The bought episode plays as an ordinary series, not as a VIP one; no points without a pass.
    plain = (await client.get("/api/v1/episodes/vip-only-show/1/play", headers=headers)).json()
    assert plain["points_awarded"] == 0
    vip = await client.get("/api/v1/episodes/vip-only-show/1/play?vip_only=true", headers=headers)
    assert vip.status_code == 402
    await buy_week(client, gateways, headers)
    assert (await client.get("/api/v1/episodes/vip-only-show/1/play?vip_only=true", headers=headers)).status_code == 200


async def test_points_need_sign_in(client):
    assert (await client.get("/api/v1/me/points")).status_code == 401
    assert (await client.post("/api/v1/points/redeem", json={"days": 1})).status_code == 401
