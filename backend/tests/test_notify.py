import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from app import notify
from app.db import SessionLocal
from app.models import Payment, PaymentStatus, Provider
from app.reconciler import reconcile_once

from .test_flow import gateways, ref_of, signup  # noqa: F401 — fixtures and helpers


@pytest.fixture
def sent(monkeypatch):
    messages: list[str] = []
    monkeypatch.setattr(notify, "send", messages.append)
    return messages


async def test_signup_attempt_paid_and_expired_are_reported(client, gateways, sent):  # noqa: F811
    email = f"tg-{uuid.uuid4().hex[:6]}@example.com"
    headers = await signup(client, email)
    assert sent[-1].startswith("🆕 Регистрация") and email in sent[-1]

    paid = (
        await client.post(
            "/api/v1/payments", json={"method": "QRIS", "product": "week"}, headers=headers
        )
    ).json()
    assert sent[-1].startswith("🛒 Открыл оплату")
    assert "Rp 9.900 (цена запуска, обычно Rp 19.800)" in sent[-1] and "QRIS" in sent[-1]

    gateways[Provider.XENDIT].settle(await ref_of(paid["id"]))
    await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)
    assert sent[-1].startswith("✅ Оплачено") and "доступ до" in sent[-1]
    count = len(sent)
    # Reading a settled payment again reports nothing new.
    await client.get(f"/api/v1/payments/{paid['id']}", headers=headers)
    assert len(sent) == count

    card = (
        await client.post(
            "/api/v1/payments",
            json={
                "method": "CREDIT_CARD",
                "product": "episode",
                "slug": "the-girl-upstairs",
                "episode": 3,
            },
            headers=headers,
        )
    ).json()
    assert "серия 3 · the-girl-upstairs" in sent[-1] and "карта (DOKU)" in sent[-1]
    async with SessionLocal() as session:
        await session.execute(
            update(Payment)
            .where(Payment.id == uuid.UUID(card["id"]))
            .values(created_at=datetime.now(UTC) - timedelta(hours=3))
        )
        await session.commit()
    await reconcile_once()
    assert sent[-1].startswith("⌛ Не оплатил") and email in sent[-1]
    async with SessionLocal() as session:
        assert (await session.get(Payment, uuid.UUID(card["id"]))).status == PaymentStatus.EXPIRED


def test_message_text_is_html_safe():
    assert notify.esc("<b>&") == "&lt;b&gt;&amp;"
    assert notify.rupiah(29900) == "Rp 29.900"
