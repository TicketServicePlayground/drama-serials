import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


class PaymentStatus(enum.StrEnum):
    PENDING = "pending"
    PAID = "paid"
    EXPIRED = "expired"
    FAILED = "failed"


class PaymentMethod(enum.StrEnum):
    QRIS = "QRIS"
    CARD = "CREDIT_CARD"
    # Russia's Faster Payments System, through IXPAY: the payer pays rubles, IDR is credited.
    SBP = "SBP"


class Provider(enum.StrEnum):
    XENDIT = "xendit"
    DOKU = "doku"
    IXPAY = "ixpay"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stored lower-cased, so the unique index is case-insensitive in practice.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    # End of this user's one-time offer; set the first time they see the paywall, never reset.
    offer_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Which version of the Terms and Privacy Policy the user accepted at sign-up, and when.
    terms_version: Mapped[str | None] = mapped_column(String(20))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Team / test account (TEST_EMAILS): its visits and payments stay out of the stats.
    is_test: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    # Where the user first came from (first signed-in visit of the day carries that day's
    # landing): kept so a payment days later still counts for that campaign and country.
    src_source: Mapped[str | None] = mapped_column(String(120))
    src_medium: Mapped[str | None] = mapped_column(String(80))
    src_campaign: Mapped[str | None] = mapped_column(String(150))
    src_content: Mapped[str | None] = mapped_column(String(150))
    src_country: Mapped[str | None] = mapped_column(String(2))
    src_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        # The reconciler walks pending payments; most rows are settled, so a partial index.
        Index("ix_payments_pending", "created_at", postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # episode | week | month | year (see app/products.py).
    product: Mapped[str] = mapped_column(String(40))
    # For product "episode": which one it unlocks.
    target_slug: Mapped[str | None] = mapped_column(String(80))
    target_episode: Mapped[int | None] = mapped_column(Integer)
    # Rupiah have no minor unit, so this is whole rupiah. What is charged...
    amount: Mapped[int] = mapped_column(BigInteger)
    # ...and the regular price it was compared against when the payment was opened.
    list_amount: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    method: Mapped[PaymentMethod] = mapped_column(_enum(PaymentMethod, "payment_method"))
    provider: Mapped[Provider] = mapped_column(_enum(Provider, "payment_provider"))
    status: Mapped[PaymentStatus] = mapped_column(
        _enum(PaymentStatus, "payment_status"), default=PaymentStatus.PENDING
    )
    # What the provider files the payment under: Xendit external_id, DOKU invoice_number.
    # Set before the provider is called, so a callback can never arrive for an unknown name.
    provider_ref: Mapped[str] = mapped_column(String(64), unique=True)
    # The provider's own id for it (Xendit invoice id); DOKU has none beyond invoice_number.
    provider_payment_id: Mapped[str | None] = mapped_column(String(64))
    payment_url: Mapped[str | None] = mapped_column(String(500))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # What actually collected the money, as the provider reports it (QRIS, CREDIT_CARD, ...).
    paid_channel: Mapped[str | None] = mapped_column(String(60))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Last status seen in a provider notification (read from the Eventstripe database).
    hook_status: Mapped[str | None] = mapped_column(String(30))
    hook_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Last time the provider API was asked.
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Where the payer returns to: series slug and UI language.
    return_slug: Mapped[str | None] = mapped_column(String(80))
    locale: Mapped[str] = mapped_column(String(5), default="en")
    # Terms and Refund Policy version the payer agreed to by opening the payment.
    terms_version: Mapped[str | None] = mapped_column(String(20))
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # What the Meta pixel saw when the payment was opened: {ip, ua, fbp, fbc}
    # (app/meta_capi.py sends it with the server-side Purchase).
    ad_context: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AccessGrant(Base):
    """A period of VIP access: paid (one per payment, so a replayed confirmation cannot add
    time) or bought with VIP points (one per points entry)."""

    __tablename__ = "access_grants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payments.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    points_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("points_entries.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    # Set for a one-series pass (product series_day): that series only. None = VIP, every series.
    slug: Mapped[str | None] = mapped_column(String(80))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EpisodeUnlock(Base):
    """One episode bought on its own; kept for good. One per payment."""

    __tablename__ = "episode_unlocks"
    __table_args__ = (Index("ix_episode_unlocks_user", "user_id", "slug", "episode"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payments.id", ondelete="CASCADE"), unique=True
    )
    slug: Mapped[str] = mapped_column(String(80))
    episode: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EpisodeMedia(Base):
    """An uploaded episode video, as found in the media bucket by the scanner."""

    __tablename__ = "episode_media"
    __table_args__ = (UniqueConstraint("slug", "episode", "lang"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80))
    episode: Mapped[int] = mapped_column(Integer)
    # Audio language of this cut ("id", "ru", ...); "" when the file serves every language.
    lang: Mapped[str] = mapped_column(String(8), server_default="", default="")
    object_key: Mapped[str] = mapped_column(String(300))
    etag: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    # None until ffprobe could read it.
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Visit(Base):
    """One page view, sent by the site's own counter. No cookies: the visitor is a hash of
    IP + browser that changes every day, so it counts people per day but cannot follow them."""

    __tablename__ = "visits"
    __table_args__ = (Index("ix_visits_at", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    visitor: Mapped[str] = mapped_column(String(16))
    path: Mapped[str] = mapped_column(String(300))
    # Host of the external page the visitor came from; "" = typed in, bookmark or app.
    referrer: Mapped[str] = mapped_column(String(120), server_default="", default="")
    utm_source: Mapped[str] = mapped_column(String(80), server_default="", default="")
    lang: Mapped[str] = mapped_column(String(8), server_default="", default="")
    # mobile | tablet | desktop
    device: Mapped[str] = mapped_column(String(10), server_default="", default="")
    # "" = page view; otherwise a click on the way to paying (see app/visits.py EVENTS).
    event: Mapped[str] = mapped_column(String(20), server_default="", default="")
    # What the click was about: series slug, "slug/episode" or the auth reason.
    target: Mapped[str] = mapped_column(String(80), server_default="", default="")
    # Ad labels of the landing URL (utm_*), and whether it carried a Meta click id.
    utm_medium: Mapped[str] = mapped_column(String(80), server_default="", default="")
    utm_campaign: Mapped[str] = mapped_column(String(150), server_default="", default="")
    utm_content: Mapped[str] = mapped_column(String(150), server_default="", default="")
    fbclid: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    # ISO country code of the visitor's IP, as the proxy in front reports it; no IP is kept.
    country: Mapped[str] = mapped_column(String(2), server_default="", default="")
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PointsEntry(Base):
    """VIP points: +daily for a VIP who watched that day, − when exchanged for VIP days.
    The balance is the sum of deltas."""

    __tablename__ = "points_entries"
    __table_args__ = (
        # One daily award per user and day, however many episodes they open.
        Index(
            "ux_points_daily", "user_id", "day", unique=True, postgresql_where=text("reason = 'daily_watch'")
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    # daily_watch | redeem
    reason: Mapped[str] = mapped_column(String(20))
    # Bali day of a daily award.
    day: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SeriesReminder(Base):
    """An email reminding about a one-series pass about to end; one per pass and threshold."""

    __tablename__ = "series_reminders"
    __table_args__ = (UniqueConstraint("grant_id", "hours", name="uq_series_reminders_grant_hours"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("access_grants.id", ondelete="CASCADE"))
    # Hours-before-end threshold that triggered it (REMINDER_HOURS).
    hours: Mapped[int] = mapped_column(Integer)
    # sent | skipped (nothing left to watch) | failed
    outcome: Mapped[str] = mapped_column(String(10))
    remaining: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordReset(Base):
    """A "forgot password" link: only the SHA-256 of its token is kept; one use, short-lived."""

    __tablename__ = "password_resets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
