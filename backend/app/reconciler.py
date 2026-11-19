"""Background settlement of pending payments.

Each tick reads the latest provider notifications from the Eventstripe database; a payment
whose notification changed is re-read from its provider at once. Every pending payment is
also re-read every api_poll_seconds, so nothing depends on a notification arriving.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app import eventstripe_hooks, notify
from app.billing import refresh_payment
from app.config import settings
from app.db import SessionLocal
from app.models import Payment, PaymentStatus, Provider, User

logger = logging.getLogger(__name__)

# Pages live checkout_minutes; this slack covers clocks and late notifications.
GRACE = timedelta(minutes=30)


async def reconcile_once() -> None:
    now = datetime.now(UTC)
    horizon = now - timedelta(minutes=settings.checkout_minutes) - GRACE
    async with SessionLocal() as session:
        pending = (
            await session.scalars(
                select(Payment)
                .where(Payment.status == PaymentStatus.PENDING)
                .order_by(Payment.created_at)
            )
        ).all()
        if not pending:
            return

        try:
            signals = await eventstripe_hooks.latest_signals(
                [p.provider_ref for p in pending if p.provider == Provider.DOKU],
                [p.provider_ref for p in pending if p.provider == Provider.XENDIT],
                [p.provider_payment_id for p in pending if p.provider == Provider.IXPAY and p.provider_payment_id],
            )
        except Exception:  # noqa: BLE001 — the API path still works without this source
            logger.exception("reading notifications from the Eventstripe database failed")
            signals = []
        by_ref = {signal.ref: signal for signal in signals}

        poll_before = now - timedelta(seconds=settings.api_poll_seconds)
        for payment in pending:
            # IXPAY notifications name the deposit, the others our reference.
            key = payment.provider_payment_id if payment.provider == Provider.IXPAY else payment.provider_ref
            signal = by_ref.get(key) if key else None
            fresh_signal = signal is not None and (
                payment.hook_seen_at is None or signal.seen_at > payment.hook_seen_at
            )
            if fresh_signal:
                logger.info("notification %s for payment %s", signal.status, payment.id)
                payment.hook_status = signal.status
                payment.hook_seen_at = signal.seen_at
                await session.commit()
            due = payment.checked_at is None or payment.checked_at < poll_before
            if fresh_signal or due:
                await refresh_payment(session, payment)
            # Never resolved within the window: the page is gone, so close it out locally.
            if payment.status == PaymentStatus.PENDING and payment.created_at < horizon:
                payment.status = PaymentStatus.EXPIRED
                await session.commit()
                user = await session.get(User, payment.user_id)
                notify.outcome(payment, user.email if user else "?")


async def run_forever() -> None:
    while True:
        try:
            await reconcile_once()
        except Exception:  # noqa: BLE001 — the loop must outlive any single failure
            logger.exception("reconcile failed")
        await asyncio.sleep(settings.reconcile_interval_seconds)
