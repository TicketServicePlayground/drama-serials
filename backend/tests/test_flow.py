import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app import providers as providers_module
from app.config import settings
from app.models import Payment, PaymentStatus, Provider
from app.providers.base import Checkout, ProviderError, Snapshot
from app.reconciler import reconcile_once
from app.security import verify_password

# Produced by Node's crypto.scrypt with default parameters, as the first site version did.
NODE_HASH = (
    "cb55f874b9862c7f56db69bc2dbf1a62:"
    "41973a838ded82228aca08ba648577a77996e4400a62db7de5461c410686208db413454a5695c63b07c0792f46988c5f300540e78971a4871f6116c473d270b1"
)


def test_node_scrypt_hash_still_verifies():
    assert verify_password("secret1", NODE_HASH)
    assert not verify_password("secret2", NODE_HASH)


class FakeProvider:
    """Stands in for a provider API: payments live in a dict, status set by the test."""

    def __init__(self, real):
        self.real = real
        self.state: dict[str, Snapshot] = {}
        self.opened: list[dict] = []
        self.fetches = 0

    def reference(self, payment):
        return self.real.reference(payment)

    async def open(self, payment, *, payer_email, return_url):
        self.opened.append({"method": payment.method.value, "return_url": return_url})
        self.state[payment.provider_ref] = Snapshot(
            payment.provider_ref, PaymentStatus.PENDING, payment.amount, "IDR", None
        )
        return Checkout(
            url=f"https://pay.example/{payment.provider_ref}",
            provider_payment_id=f"inv-{payment.provider_ref}",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )

    async def fetch(self, payment):
        self.fetches += 1
        # Payments left pending by earlier tests stay pending.
        return self.state.get(
            payment.provider_ref,
            Snapshot(payment.provider_ref, PaymentStatus.PENDING, payment.amount, "IDR", None),
        )

    def settle(self, ref, amount=9900, channel="QRIS"):
        self.state[ref] = Snapshot(ref, PaymentStatus.PAID, amount, "IDR", channel)


@pytest.fixture
def gateways(monkeypatch):
    fakes = {name: FakeProvider(real) for name, real in providers_module._providers.items()}
    monkeypatch.setattr(providers_module, "_providers", fakes)
    return fakes


async def signup(client, email=None):
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    response = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "secret1", "accept_terms": True}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def ref_of(payment_id: str) -> str:
    from app.db import SessionLocal

    async with SessionLocal() as session:
        return (await session.get(Payment, uuid.UUID(payment_id))).provider_ref


async def test_auth_errors(client):
    email = f"dup-{uuid.uuid4().hex[:6]}@Example.com"
    bad = await client.post("/api/v1/auth/register", json={"email": "bad", "password": "secret1"})
    assert bad.json() == {"error": "invalid_email"}
    short = await client.post("/api/v1/auth/register", json={"email": email, "password": "123"})
    assert short.json() == {"error": "short_password"}
    no_terms = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "secret1"}
    )
    assert no_terms.json() == {"error": "terms_required"}
    await signup(client, email)
    again = await client.post(
        "/api/v1/auth/register",
        json={"email": email.lower(), "password": "secret1", "accept_terms": True},
    )
    assert again.status_code == 409
    wrong = await client.post("/api/v1/auth/login", json={"email": email, "password": "nope123"})
    assert wrong.status_code == 401
    ok = await client.post(
        "/api/v1/auth/login", json={"email": email.upper(), "password": "secret1"}
    )
    assert ok.status_code == 200 and ok.json()["user"]["has_access"] is False
    assert (await client.get("/api/v1/me")).status_code == 401


async def test_qris_goes_to_xendit_card_to_doku(client, gateways):
    headers = await signup(client)
    qris = (await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)).json()
    card = (
        await client.post("/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers)
    ).json()
    assert len(gateways[Provider.XENDIT].opened) == 1 and len(gateways[Provider.DOKU].opened) == 1
    assert (await ref_of(qris["id"])).startswith("AN-")
    doku_ref = await ref_of(card["id"])
    # Card acquirer limit; Eventstripe's own numbers start with "ES".
    assert doku_ref.startswith("AN") and len(doku_ref) <= 30


async def test_pay_then_access_then_extend(client, gateways):
    xendit = gateways[Provider.XENDIT]
    headers = await signup(client)

    created = await client.post(
        "/api/v1/payments",
        json={"method": "QRIS", "locale": "id", "next": "contract-bride"},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    payment = created.json()
    assert payment["status"] == "pending" and payment["invoice_url"].startswith("https://pay")
    assert "lang=id" in xendit.opened[0]["return_url"]
    assert "next=contract-bride" in xendit.opened[0]["return_url"]

    # A second tap on the same method reuses the open page.
    again = await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)
    assert again.json()["id"] == payment["id"] and len(xendit.opened) == 1

    pending = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert pending["status"] == "pending" and pending["account"]["has_access"] is False

    xendit.settle(await ref_of(payment["id"]))
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert paid["status"] == "paid" and paid["invoice_url"] is None
    until = datetime.fromisoformat(paid["account"]["access_until"])
    assert abs(until - (datetime.now(UTC) + timedelta(days=7))) < timedelta(minutes=1)

    # Reading it again (as the reconciler would) grants nothing more.
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)
    me = (await client.get("/api/v1/me", headers=headers)).json()
    assert me["access_until"] == paid["account"]["access_until"]

    # A second pass while the first is running starts where the first ends.
    second = (
        await client.post("/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers)
    ).json()
    gateways[Provider.DOKU].settle(await ref_of(second["id"]), channel="CREDIT_CARD")
    after = (await client.get(f"/api/v1/payments/{second['id']}", headers=headers)).json()
    extended = datetime.fromisoformat(after["account"]["access_until"])
    assert abs(extended - until - timedelta(days=7)) < timedelta(seconds=5)


async def test_underpaid_payment_grants_nothing(client, gateways):
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)
    ).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=100)
    result = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert result["status"] == "failed" and result["account"]["has_access"] is False


async def test_other_users_payment_is_hidden(client, gateways):
    owner = await signup(client)
    stranger = await signup(client)
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=owner)).json()
    hidden = await client.get(f"/api/v1/payments/{payment['id']}", headers=stranger)
    assert hidden.status_code == 404


async def test_provider_down_fails_cleanly(client, gateways, monkeypatch):
    async def refuse(*args, **kwargs):
        raise ProviderError("down")

    monkeypatch.setattr(gateways[Provider.DOKU], "open", refuse)
    headers = await signup(client)
    response = await client.post(
        "/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers
    )
    assert response.status_code == 502 and response.json() == {"error": "payment_unavailable"}


async def test_disabled_method_is_refused(client, gateways, monkeypatch):
    monkeypatch.setattr(settings, "payment_methods", "QRIS")
    headers = await signup(client)
    refused = await client.post("/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers)
    assert refused.json() == {"error": "method_unavailable"}
    assert (await client.get("/api/v1/config")).json()["methods"] == ["QRIS"]


async def test_doku_notification_in_eventstripe_db_settles(
    client, gateways, eventstripe_db, monkeypatch
):
    # Without the notification the API would not be asked again for a minute.
    monkeypatch.setattr(settings, "api_poll_seconds", 3600)
    doku = gateways[Provider.DOKU]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])

    await reconcile_once()  # first look: polls the API once, still pending
    fetches = doku.fetches
    await reconcile_once()
    assert doku.fetches == fetches  # nothing new, no API call

    doku.settle(ref, channel="CREDIT_CARD")
    # Eventstripe rejected a forged one (bad signature) and logged an accepted one.
    await eventstripe_db.execute(
        "INSERT INTO albus.payment_events (provider, direction, operation, invoice_number, "
        "outcome, "
        "provider_status) VALUES ('doku','IN','WEBHOOK',$1,'REJECTED','SUCCESS'), "
        "('doku','IN','WEBHOOK',$1,'FAILED','SUCCESS')",
        ref,
    )
    await reconcile_once()
    assert doku.fetches == fetches + 1
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is True


async def test_rejected_notification_alone_is_ignored(
    client, gateways, eventstripe_db, monkeypatch
):
    monkeypatch.setattr(settings, "api_poll_seconds", 3600)
    doku = gateways[Provider.DOKU]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "CREDIT_CARD"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])
    await reconcile_once()
    fetches = doku.fetches
    await eventstripe_db.execute(
        "INSERT INTO albus.payment_events (provider, direction, operation, invoice_number, "
        "outcome, "
        "provider_status) VALUES ('doku','IN','WEBHOOK',$1,'REJECTED','SUCCESS')",
        ref,
    )
    await reconcile_once()
    assert doku.fetches == fetches


async def test_xendit_log_in_eventstripe_db_settles(client, gateways, eventstripe_db, monkeypatch):
    monkeypatch.setattr(settings, "api_poll_seconds", 3600)
    xendit = gateways[Provider.XENDIT]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])
    await reconcile_once()
    xendit.settle(ref)
    await eventstripe_db.execute(
        "INSERT INTO albus.xendit_webhook_logs (webhook_id, webhook_type, payload) "
        "VALUES ($1, $2, $3)",
        f"wh-{ref}",
        "invoices-paid",
        json.dumps({"external_id": ref, "status": "PAID"}),
    )
    await reconcile_once()
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is True


async def test_direct_xendit_callback(client, gateways):
    xendit = gateways[Provider.XENDIT]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])
    body = {"external_id": ref, "status": "PAID"}
    assert (await client.post("/api/v1/webhooks/xendit", json=body)).status_code == 403
    token = {"x-callback-token": "callback-token"}
    # The body's own status is ignored; the API still says pending.
    await client.post("/api/v1/webhooks/xendit", json=body, headers=token)
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is False
    xendit.settle(ref)
    assert (
        await client.post("/api/v1/webhooks/xendit", json=body, headers=token)
    ).status_code == 200
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is True
    foreign = await client.post(
        "/api/v1/webhooks/xendit", json={"external_id": "order-42"}, headers=token
    )
    assert foreign.status_code == 200


async def test_xendit_event_in_payment_events_settles(
    client, gateways, eventstripe_db, monkeypatch
):
    monkeypatch.setattr(settings, "api_poll_seconds", 3600)
    xendit = gateways[Provider.XENDIT]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "QRIS"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])
    await reconcile_once()
    fetches = xendit.fetches
    xendit.settle(ref)
    # What Eventstripe now records for our invoices: acknowledged as IGNORED.
    await eventstripe_db.execute(
        "INSERT INTO albus.payment_events (provider, direction, operation, invoice_number, "
        "outcome, provider_status) VALUES ('xendit','IN','WEBHOOK',$1,'IGNORED','PAID')",
        ref,
    )
    await reconcile_once()
    assert xendit.fetches == fetches + 1
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is True


async def test_launch_prices_until_the_end_date_regular_after(client, gateways, monkeypatch):
    headers = await signup(client)
    config = (await client.get("/api/v1/config")).json()
    prices = {p["id"]: (p["price"], p["regular_price"]) for p in config["products"]}
    assert prices == {
        "series_day": (12800, 12800), "week": (9900, 19800), "month": (29900, 59800),
        "year": (199000, 398000), "episode": (5000, 5000),
    }
    assert list(prices)[0] == "series_day"  # first row of the paywall
    assert config["launch"] == {"active": True, "ends_at": "2099-01-01T00:00:00+07:00", "discount_percent": 77}
    assert (await client.post("/api/v1/offer", headers=headers)).json()["products"] == config["products"]

    month = (
        await client.post("/api/v1/payments", json={"method": "QRIS", "product": "month"}, headers=headers)
    ).json()
    from app.db import SessionLocal

    async with SessionLocal() as session:
        row = await session.get(Payment, uuid.UUID(month["id"]))
        assert (row.amount, row.list_amount) == (29900, 59800)

    # After the end date the regular prices are charged and no launch price is shown.
    monkeypatch.setattr(settings, "launch_ends_at", (datetime.now(UTC) - timedelta(seconds=1)).isoformat())
    late = (
        await client.post("/api/v1/payments", json={"method": "CREDIT_CARD", "product": "week"}, headers=headers)
    ).json()
    async with SessionLocal() as session:
        assert (await session.get(Payment, uuid.UUID(late["id"]))).amount == 19800
    offer = (await client.post("/api/v1/offer", headers=headers)).json()
    assert offer["launch"]["active"] is False
    assert {p["id"]: p["price"] for p in offer["products"]}["week"] == 19800


async def test_series_day_opens_one_series_for_24_hours(client, gateways, monkeypatch):
    from tests.test_points import media_ready

    await media_ready(monkeypatch, slug="day-pass-show", episodes=(9,))
    await media_ready(monkeypatch, slug="other-show", episodes=(9,))
    headers = await signup(client)
    assert (await client.post(
        "/api/v1/payments", json={"method": "QRIS", "product": "series_day"}, headers=headers
    )).json() == {"error": "series_required"}
    payment = (
        await client.post(
            "/api/v1/payments", json={"method": "QRIS", "product": "series_day", "slug": "day-pass-show"}, headers=headers
        )
    ).json()
    assert payment["amount"] == 12800
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=12800)
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert paid["status"] == "paid"
    account = paid["account"]
    assert account["has_access"] is False and account["access_until"] is None
    (pass_,) = account["series_passes"]
    assert pass_["slug"] == "day-pass-show"
    assert abs(datetime.fromisoformat(pass_["until"]) - datetime.now(UTC) - timedelta(hours=24)) < timedelta(minutes=1)
    assert (await client.get("/api/v1/episodes/day-pass-show/9/play", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/episodes/day-pass-show/9/play?vip_only=true", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/episodes/other-show/9/play", headers=headers)).status_code == 402

    # 24 hours later the series closes again.
    from app.db import SessionLocal
    from app.models import AccessGrant

    async with SessionLocal() as session:
        grant = await session.scalar(select(AccessGrant).where(AccessGrant.payment_id == uuid.UUID(payment["id"])))
        grant.ends_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
    assert (await client.get("/api/v1/episodes/day-pass-show/9/play", headers=headers)).status_code == 402
    assert (await client.get("/api/v1/me", headers=headers)).json()["series_passes"] == []


async def test_free_episodes_play_without_paying_or_signing_in(client, monkeypatch):
    from tests.test_points import media_ready

    await media_ready(monkeypatch, slug="free-show", episodes=(1, 7, 8))
    monkeypatch.setattr(settings, "free_episodes", 7)
    assert (await client.get("/api/v1/config")).json()["free_episodes"] == 7
    assert (await client.get("/api/v1/episodes/free-show/1/play")).status_code == 200
    assert (await client.get("/api/v1/episodes/free-show/7/play?vip_only=true")).status_code == 200
    assert (await client.get("/api/v1/episodes/free-show/8/play")).status_code == 401
    headers = await signup(client)
    assert (await client.get("/api/v1/episodes/free-show/8/play", headers=headers)).status_code == 402
    monkeypatch.setattr(settings, "free_episodes", 5)
    assert (await client.get("/api/v1/episodes/free-show/7/play", headers=headers)).status_code == 402


async def test_month_pass_gives_thirty_days(client, gateways):
    headers = await signup(client)
    payment = (
        await client.post(
            "/api/v1/payments", json={"method": "QRIS", "product": "month"}, headers=headers
        )
    ).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=29900)
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    until = datetime.fromisoformat(paid["account"]["access_until"])
    assert abs(until - datetime.now(UTC) - timedelta(days=30)) < timedelta(minutes=1)


async def test_year_pass_gives_365_days(client, gateways):
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "QRIS", "product": "year"}, headers=headers)
    ).json()
    charged = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()["amount"]
    assert charged in (199000, 398000)
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=charged)
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert paid["status"] == "paid"
    until = datetime.fromisoformat(paid["account"]["access_until"])
    assert abs(until - datetime.now(UTC) - timedelta(days=365)) < timedelta(minutes=1)


async def test_single_episode_unlock_and_play(client, gateways, monkeypatch):
    from app import media as media_module
    from app.db import SessionLocal
    from app.models import EpisodeMedia

    headers = await signup(client)
    assert (
        await client.get("/api/v1/episodes/contract-bride/2/play", headers=headers)
    ).status_code == 402
    missing = await client.post(
        "/api/v1/payments", json={"method": "QRIS", "product": "episode"}, headers=headers
    )
    assert missing.json() == {"error": "episode_required"}

    payment = (
        await client.post(
            "/api/v1/payments",
            json={
                "method": "QRIS",
                "product": "episode",
                "slug": "contract-bride",
                "episode": 2,
                "next": "contract-bride",
            },
            headers=headers,
        )
    ).json()
    assert "play=2" in gateways[Provider.XENDIT].opened[-1]["return_url"]
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=5000)
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert paid["status"] == "paid" and paid["account"]["has_access"] is False
    assert paid["account"]["episodes"] == [{"slug": "contract-bride", "episode": 2}]

    # Bought, but no video uploaded yet.
    assert (await client.get("/api/v1/episodes/contract-bride/2/play", headers=headers)).json() == {
        "error": "video_not_ready"
    }
    # Only the episode that was bought.
    assert (
        await client.get("/api/v1/episodes/contract-bride/3/play", headers=headers)
    ).status_code == 402
    again = await client.post(
        "/api/v1/payments",
        json={"method": "QRIS", "product": "episode", "slug": "contract-bride", "episode": 2},
        headers=headers,
    )
    assert again.json() == {"error": "already_unlocked"}

    async with SessionLocal() as session:
        session.add(
            EpisodeMedia(
                slug="contract-bride",
                episode=2,
                object_key="video/contract-bride/2.mp4",
                etag="e",
                size_bytes=1,
                duration_seconds=95,
            )
        )
        await session.commit()
    monkeypatch.setattr(settings, "media_bucket", "media")
    monkeypatch.setattr(settings, "media_r2_account_id", "acc")
    monkeypatch.setattr(settings, "media_r2_access_key_id", "key")
    monkeypatch.setattr(settings, "media_r2_secret_access_key", "secret")
    monkeypatch.setattr(media_module, "signed_url", lambda key, ttl=None: f"https://signed/{key}")
    play = (await client.get("/api/v1/episodes/contract-bride/2/play", headers=headers)).json()
    assert play == {
        "url": "https://signed/video/contract-bride/2.mp4",
        "duration": 95,
        "expires_in": settings.play_url_ttl_seconds,
        "points_awarded": 0,  # a bought episode is not VIP
    }
    listed = (await client.get("/api/v1/media")).json()
    assert {"slug": "contract-bride", "episode": 2, "lang": "", "duration": 95} in listed

    # Dubbed cuts: the viewer's language first, the language-neutral file otherwise.
    async with SessionLocal() as session:
        session.add(
            EpisodeMedia(
                slug="contract-bride",
                episode=2,
                lang="ru",
                object_key="video/contract-bride/ru/2.mp4",
                etag="r",
                size_bytes=1,
                duration_seconds=95,
            )
        )
        await session.commit()
    url = lambda q: client.get(f"/api/v1/episodes/contract-bride/2/play{q}", headers=headers)  # noqa: E731
    assert (await url("?lang=ru")).json()["url"] == "https://signed/video/contract-bride/ru/2.mp4"
    assert (await url("?lang=es")).json()["url"] == "https://signed/video/contract-bride/2.mp4"


async def test_media_scan_reads_new_videos_once(monkeypatch):
    from sqlalchemy import select

    from app import media as media_module
    from app.db import SessionLocal
    from app.models import EpisodeMedia

    for key, value in {
        "media_bucket": "m",
        "media_r2_account_id": "a",
        "media_r2_access_key_id": "k",
        "media_r2_secret_access_key": "s",
    }.items():
        monkeypatch.setattr(settings, key, value)
    objects = [
        {"Key": "video/the-girl-upstairs/1.mp4", "ETag": '"aaa"', "Size": 10},
        {"Key": "video/the-girl-upstairs/notes.txt", "ETag": '"bbb"', "Size": 1},
        {"Key": "video/the-girl-upstairs/id/2.mp4", "ETag": '"ddd"', "Size": 10},
    ]
    probes = []

    async def probe(key):
        probes.append(key)
        return 101

    monkeypatch.setattr(media_module, "_list_videos", lambda: objects)
    monkeypatch.setattr(media_module, "probe_duration", probe)
    assert await media_module.scan_once() == 2
    assert await media_module.scan_once() == 0  # unchanged etag: not probed again
    objects[0]["ETag"] = '"ccc"'
    assert await media_module.scan_once() == 1
    assert probes == [
        "video/the-girl-upstairs/1.mp4",
        "video/the-girl-upstairs/id/2.mp4",
        "video/the-girl-upstairs/1.mp4",
    ]
    async with SessionLocal() as session:
        dubbed = await session.scalar(select(EpisodeMedia).where(EpisodeMedia.episode == 2))
        assert dubbed.lang == "id" and dubbed.slug == "the-girl-upstairs"
    async with SessionLocal() as session:
        row = await session.scalar(
            select(EpisodeMedia).where(
                EpisodeMedia.slug == "the-girl-upstairs", EpisodeMedia.episode == 1
            )
        )
        assert row.duration_seconds == 101 and row.etag == "ccc"
    objects.clear()
    await media_module.scan_once()
    async with SessionLocal() as session:
        assert (
            await session.scalars(
                select(EpisodeMedia).where(EpisodeMedia.slug == "the-girl-upstairs")
            )
        ).all() == []


async def test_purchase_history(client, gateways):
    headers = await signup(client)
    week = (
        await client.post(
            "/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers
        )
    ).json()
    gateways[Provider.XENDIT].settle(await ref_of(week["id"]))
    await client.get(f"/api/v1/payments/{week['id']}", headers=headers)
    await client.post(
        "/api/v1/payments",
        json={
            "method": "CREDIT_CARD",
            "product": "episode",
            "slug": "contract-bride",
            "episode": 4,
        },
        headers=headers,
    )
    history = (await client.get("/api/v1/me/purchases", headers=headers)).json()
    assert [h["product"] for h in history] == ["episode", "week"]
    assert (
        history[0]["status"] == "pending"
        and history[0]["episode"] == 4
        and history[0]["ends_at"] is None
    )
    paid = history[1]
    assert paid["status"] == "paid" and paid["amount"] == 9900 and paid["list_amount"] == 19800
    span = datetime.fromisoformat(paid["ends_at"]) - datetime.fromisoformat(paid["starts_at"])
    assert span == timedelta(days=7)
    assert (await client.get("/api/v1/me/purchases")).status_code == 401


async def test_audit_log_has_the_visitors_ip(client, caplog):
    import logging

    caplog.set_level(logging.INFO, logger="app.api")
    email = f"audit-{uuid.uuid4().hex[:8]}@example.com"
    forwarded = {"X-Forwarded-For": "203.0.113.7"}
    await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "secret1", "accept_terms": True}, headers=forwarded
    )
    await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-one"}, headers=forwarded)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("audit")]
    assert any(line.startswith("audit register ") and "ip=203.0.113.7" in line for line in lines)
    assert any(line.startswith("audit login-failed ") and "ip=203.0.113.7" in line for line in lines)


async def test_sbp_goes_to_ixpay_and_settles_in_rupiah(client, gateways):
    from app.models import Payment as PaymentRow
    from app.providers import ixpay

    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "SBP", "product": "week"}, headers=headers)
    ).json()
    assert payment["method"] == "SBP" and len(gateways[Provider.IXPAY].opened) == 1
    assert (await ref_of(payment["id"])).startswith("AN-")
    gateways[Provider.IXPAY].settle(await ref_of(payment["id"]), amount=9900, channel="SBP")
    paid = (await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)).json()
    assert paid["status"] == "paid" and paid["account"]["has_access"] is True

    # What IXPAY answers: the IDR credited decides, not the rubles paid.
    row = PaymentRow(provider_ref="AN-x", provider_payment_id="dep-1")
    deposit = {
        "id": "dep-1",
        "status": "confirmed",
        "currency_code": "IDR",
        "deposit_detail": {"credited_amount_converted": "12800.00000000", "paid_amount_rub": "66.78"},
    }
    snap = ixpay.snapshot(row, deposit)
    assert (snap.status, snap.amount, snap.currency, snap.ref) == (PaymentStatus.PAID, 12800, "IDR", "AN-x")
    assert ixpay.snapshot(row, {**deposit, "status": "pending"}).status == PaymentStatus.PENDING
    assert ixpay.snapshot(row, {**deposit, "status": "expired"}).status == PaymentStatus.EXPIRED
    with pytest.raises(ProviderError):
        ixpay.snapshot(row, {**deposit, "id": "someone-else"})


async def test_ixpay_webhook_seen_by_eventstripe_settles(client, gateways, eventstripe_db, monkeypatch):
    # IXPAY's webhooks reach Eventstripe, which records ours as IGNORED with the deposit id.
    monkeypatch.setattr(settings, "api_poll_seconds", 3600)
    ixpay = gateways[Provider.IXPAY]
    headers = await signup(client)
    payment = (
        await client.post("/api/v1/payments", json={"method": "SBP", "product": "week"}, headers=headers)
    ).json()
    ref = await ref_of(payment["id"])
    await reconcile_once()
    fetches = ixpay.fetches
    ixpay.settle(ref, channel="SBP")
    await eventstripe_db.execute(
        "INSERT INTO albus.payment_events (provider, direction, operation, invoice_number, "
        "outcome, provider_status) VALUES ('ixpay','IN','WEBHOOK',$1,'IGNORED','confirmed')",
        f"inv-{ref}",  # the deposit id (FakeProvider's provider_payment_id)
    )
    await reconcile_once()
    assert ixpay.fetches == fetches + 1
    assert (await client.get("/api/v1/me", headers=headers)).json()["has_access"] is True
