"""Turning a provider's confirmation into access, exactly once."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import meta_capi, notify
from app.models import AccessGrant, EpisodeUnlock, Payment, PaymentStatus, User
from app.products import products
from app.providers import ProviderError, Snapshot, provider

logger = logging.getLogger(__name__)


async def access_until(session: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    """End of the user's VIP access (every series), or None if never. May be in the past."""
    return await session.scalar(
        select(func.max(AccessGrant.ends_at)).where(
            AccessGrant.user_id == user_id, AccessGrant.slug.is_(None)
        )
    )


async def series_access_until(session: AsyncSession, user_id: uuid.UUID, slug: str) -> datetime | None:
    """End of the user's one-series pass for this series, or None. May be in the past."""
    return await session.scalar(
        select(func.max(AccessGrant.ends_at)).where(
            AccessGrant.user_id == user_id, AccessGrant.slug == slug
        )
    )


async def series_passes(session: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The one-series passes still running: [{slug, until}]."""
    rows = await session.execute(
        select(AccessGrant.slug, func.max(AccessGrant.ends_at))
        .where(
            AccessGrant.user_id == user_id,
            AccessGrant.slug.is_not(None),
            AccessGrant.ends_at > datetime.now(UTC),
        )
        .group_by(AccessGrant.slug)
    )
    return [{"slug": slug, "until": until.isoformat()} for slug, until in rows]


async def has_episode(session: AsyncSession, user_id: uuid.UUID, slug: str, episode: int) -> bool:
    found = await session.scalar(
        select(EpisodeUnlock.id).where(
            EpisodeUnlock.user_id == user_id,
            EpisodeUnlock.slug == slug,
            EpisodeUnlock.episode == episode,
        )
    )
    return found is not None


async def unlocked_episodes(session: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    rows = await session.execute(
        select(EpisodeUnlock.slug, EpisodeUnlock.episode)
        .where(EpisodeUnlock.user_id == user_id)
        .distinct()
    )
    return [{"slug": slug, "episode": episode} for slug, episode in rows]


async def apply_snapshot(
    session: AsyncSession, payment_id: uuid.UUID, snapshot: Snapshot
) -> Payment:
    """Records what the provider says about a payment and grants access when it is paid.

    The payment row is locked, so the return page, a notification and the reconciler racing
    on the same payment still produce one grant.
    """
    payment = await session.scalar(
        select(Payment)
        .where(Payment.id == payment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if payment is None:
        raise LookupError(payment_id)
    payment.checked_at = datetime.now(UTC)
    if snapshot.ref != payment.provider_ref:
        logger.error(
            "%s payment %s answered for %s", payment.provider, payment.provider_ref, snapshot.ref
        )
        await session.commit()
        return payment
    if snapshot.raw:
        payment.raw = snapshot.raw
    if payment.status == PaymentStatus.PAID or snapshot.status == payment.status:
        await session.commit()
        return payment

    if snapshot.status == PaymentStatus.PAID:
        if (snapshot.amount or 0) < payment.amount or (
            snapshot.currency or "IDR"
        ) != payment.currency:
            logger.error(
                "payment %s underpaid: %s %s for %s %s",
                payment.id,
                snapshot.amount,
                snapshot.currency,
                payment.amount,
                payment.currency,
            )
            payment.status = PaymentStatus.FAILED
            await session.commit()
            await _notify_outcome(session, payment)
            return payment
        now = datetime.now(UTC)
        product = products()[payment.product]
        if product.kind == "series":
            current = await series_access_until(session, payment.user_id, payment.target_slug)
            starts = max(now, current) if current else now
            session.add(
                AccessGrant(
                    user_id=payment.user_id,
                    payment_id=payment.id,
                    slug=payment.target_slug,
                    starts_at=starts,
                    ends_at=starts + timedelta(hours=product.hours),
                )
            )
        elif product.kind == "episode":
            session.add(
                EpisodeUnlock(
                    user_id=payment.user_id,
                    payment_id=payment.id,
                    slug=payment.target_slug,
                    episode=payment.target_episode,
                )
            )
        else:
            current = await access_until(session, payment.user_id)
            # Buying while access is still running extends it instead of overlapping.
            starts = max(now, current) if current else now
            session.add(
                AccessGrant(
                    user_id=payment.user_id,
                    payment_id=payment.id,
                    starts_at=starts,
                    ends_at=starts + timedelta(days=product.days),
                )
            )
        payment.status = PaymentStatus.PAID
        payment.paid_at = now
        payment.paid_channel = snapshot.channel
        logger.info("payment %s paid via %s/%s", payment.id, payment.provider, snapshot.channel)
    else:
        payment.status = snapshot.status
    await session.commit()
    if payment.status == PaymentStatus.PAID:
        payer = await session.get(User, payment.user_id)
        # Team / test accounts (TEST_EMAILS) would teach Meta's optimisation the wrong buyers.
        if payer is None or not payer.is_test:
            meta_capi.purchase(payment)
    await _notify_outcome(session, payment)
    return payment


async def _notify_outcome(session: AsyncSession, payment: Payment) -> None:
    if payment.status == PaymentStatus.PENDING:
        return
    user = await session.get(User, payment.user_id)
    kind = products()[payment.product].kind if payment.product in products() else "vip"
    if kind == "vip":
        until = await access_until(session, payment.user_id)
    elif kind == "series" and payment.target_slug:
        until = await series_access_until(session, payment.user_id, payment.target_slug)
    else:
        until = None
    notify.outcome(payment, (user.email or f"гость {str(user.id)[:8]}") if user else "?", until)


async def refresh_payment(session: AsyncSession, payment: Payment) -> Payment:
    """Re-reads a pending payment from its provider. Errors leave it pending for the next try."""
    if payment.status != PaymentStatus.PENDING:
        return payment
    try:
        snapshot = await provider(payment.provider).fetch(payment)
    except ProviderError as error:
        logger.warning("could not refresh payment %s: %s", payment.id, error)
        payment.checked_at = datetime.now(UTC)
        await session.commit()
        return payment
    return await apply_snapshot(session, payment.id, snapshot)
