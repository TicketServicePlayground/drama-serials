import uuid

import pytest

from app import meta_capi
from app.config import settings
from app.models import Provider

from .test_flow import gateways, ref_of, signup  # noqa: F401 — fixtures and helpers


@pytest.fixture
def capi(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(settings, "meta_pixel_id", "1234567890")
    monkeypatch.setattr(settings, "meta_capi_token", "token")
    monkeypatch.setattr(meta_capi, "send", sent.append)
    return sent


async def test_paid_payment_sends_one_server_purchase(client, gateways, capi):  # noqa: F811
    headers = await signup(client, f"capi-{uuid.uuid4().hex[:6]}@example.com")
    headers = {**headers, "X-Forwarded-For": "203.0.113.7"}
    paid = (
        await client.post(
            "/api/v1/payments",
            json={
                "method": "QRIS",
                "product": "week",
                "ad": {
                    "ua": "Mozilla/5.0 test",
                    "fbp": "fb.1.1700000000000.123",
                    "fbc": "fb.1.1700000000000.abc",
                },
            },
            headers=headers,
        )
    ).json()
    assert capi == []  # opening a payment is not a purchase

    gateways[Provider.XENDIT].settle(await ref_of(paid["id"]))
    await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)
    await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)  # read again: no repeat

    assert len(capi) == 1
    event = capi[0]["data"][0]
    assert event["event_name"] == "Purchase"
    assert event["event_id"] == paid["id"]  # same id as the browser pixel's eventID
    assert event["custom_data"] == {"value": 9900, "currency": "IDR", "content_name": "week"}
    assert event["user_data"]["client_ip_address"] == "203.0.113.7"
    assert event["user_data"]["fbp"] == "fb.1.1700000000000.123"
    assert event["user_data"]["fbc"] == "fb.1.1700000000000.abc"
    assert "em" not in event["user_data"]  # no email, as the privacy policy promises


async def test_off_without_token(client, gateways, monkeypatch):  # noqa: F811
    sent: list[dict] = []
    monkeypatch.setattr(meta_capi, "send", sent.append)
    monkeypatch.setattr(settings, "meta_capi_token", "")
    headers = await signup(client, f"capi-off-{uuid.uuid4().hex[:6]}@example.com")
    paid = (
        await client.post(
            "/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers
        )
    ).json()
    gateways[Provider.XENDIT].settle(await ref_of(paid["id"]))
    await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)
    assert sent == []


async def test_team_purchases_stay_out_of_meta(client, gateways, capi, monkeypatch):  # noqa: F811
    email = f"capi-team-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setattr(settings, "test_emails", email)
    headers = await signup(client, email)
    # The test flag is set on the account's first counted visit.
    await client.post("/api/v1/visits", json={"path": "/", "ip": "1.1.1.1", "ua": "Mozilla/5.0 (iPhone) Mobile"}, headers=headers)
    paid = (
        await client.post("/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers)
    ).json()
    gateways[Provider.XENDIT].settle(await ref_of(paid["id"]))
    paid_state = (await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)).json()
    assert paid_state["status"] == "paid" and capi == []
