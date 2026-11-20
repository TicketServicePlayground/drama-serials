import hmac
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import media, notify
from app.billing import (
    access_until,
    apply_snapshot,
    has_episode,
    series_access_until,
    series_passes,
    refresh_payment,
    unlocked_episodes,
)
from app.config import settings
from app.db import get_session
from app.models import (
    AccessGrant,
    EpisodeMedia,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Provider,
    User,
)
from app.products import in_country, launch_active, launch_ends_at, price_for, products
from app.providers import PROVIDER_BY_METHOD, ProviderError, provider
from app.security import (
    hash_password,
    issue_token,
    normalize_email,
    read_token,
    return_key,
    valid_password,
    verify_password,
)

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """The visitor's IP for the audit lines. The API is reachable only from the site's server,
    which sends X-Forwarded-For = the IP nginx saw (lib/api.ts clientIp)."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "")


def visitor_country(request: Request) -> str:
    """ISO code of the visitor's country, sent by the site from nginx GeoIP (lib/api.ts)."""
    country = request.headers.get("x-country", "").strip().upper()
    return country if re.fullmatch(r"[A-Z]{2}", country) else ""


router = APIRouter(prefix="/api/v1")

Session = Annotated[AsyncSession, Depends(get_session)]
SLUG_RE = re.compile(r"^[a-z0-9-]{1,80}$")
LOCALES = {"en", "id", "es", "ru"}
# A pending payment page younger than this is handed out again instead of opening a second one.
REUSE_WINDOW = timedelta(minutes=45)


def error(code: str, status: int) -> JSONResponse:
    # Codes, not sentences: the site translates them.
    return JSONResponse({"error": code}, status_code=status)


class Credentials(BaseModel):
    email: str = ""
    password: str = ""


class Registration(Credentials):
    #: The sign-up form's "I agree to the Terms and Privacy Policy" box.
    accept_terms: bool = False


class AdContext(BaseModel):
    ua: str | None = Field(default=None, max_length=500)
    fbp: str | None = Field(default=None, max_length=200)
    fbc: str | None = Field(default=None, max_length=500)


class NewPayment(BaseModel):
    method: Literal["QRIS", "CREDIT_CARD", "SBP"]
    product: Literal["episode", "series_day", "week", "month", "year"] = "week"
    # For "episode" (with `episode`) and "series_day".
    slug: str | None = None
    episode: int | None = None
    locale: str = "en"
    next: str | None = None
    # The visitor's browser as the pixel sees it (the site reads the _fbp/_fbc cookies).
    ad: AdContext | None = None


async def current_user(
    session: Session, authorization: Annotated[str | None, Header()] = None
) -> User | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    user_id = read_token(authorization.removeprefix("Bearer "))
    return await session.get(User, user_id) if user_id else None


CurrentUser = Annotated[User | None, Depends(current_user)]


def who(user: User) -> str:
    """How a user is named in team notifications: the email, or a guest marker."""
    return user.email or f"гость {str(user.id)[:8]}"


async def account(session: AsyncSession, user: User) -> dict:
    until = await access_until(session, user.id)
    active = until is not None and until > datetime.now(UTC)
    return {
        "email": user.email,
        "access_until": until.isoformat() if until else None,
        "has_access": active,
        "episodes": await unlocked_episodes(session, user.id),
        "series_passes": await series_passes(session, user.id),
        # Left an email at the "more free episodes" offer: those episodes play.
        "email_bonus": user.email_gate_at is not None,
    }


def price_list(country: str = "") -> list[dict]:
    """Products in the paywall's order, with the price charged now and the regular one."""
    return [
        {
            "id": product.id,
            "kind": product.kind,
            "days": product.days,
            "hours": product.hours,
            "price": price_for(product, country=country),
            "regular_price": in_country(product.regular_price, country),
        }
        for product in products().values()
    ]


def pricing(country: str = "") -> dict:
    ends = launch_ends_at()
    return {
        "currency": "IDR",
        "methods": settings.enabled_methods,
        "products": price_list(country),
        # The launch price and its real end date; after it the regular prices apply.
        "launch": {
            "active": launch_active(),
            "ends_at": ends.isoformat() if ends else None,
            "discount_percent": settings.launch_discount_percent,
        },
        "free_episodes": settings.free_episodes,
        "email_bonus_episodes": settings.email_bonus_episodes,
    }


def payment_view(payment: Payment) -> dict:
    return {
        "id": str(payment.id),
        "status": payment.status.value,
        "method": payment.method.value,
        "amount": payment.amount,
        "currency": payment.currency,
        "invoice_url": payment.payment_url if payment.status == PaymentStatus.PENDING else None,
        "next": payment.return_slug,
        "product": payment.product,
        "episode": payment.target_episode,
        "slug": payment.target_slug,
    }


@router.get("/config")
async def public_config() -> dict:
    return pricing()


@router.post("/offer")
async def open_offer(request: Request):
    """What the paywall shows: plans, prices charged now and the launch price's end date. Open
    to visitors without an account: they sign up with their email when they pay."""
    return pricing(visitor_country(request))


@router.get("/me/purchases")
async def purchases(user: CurrentUser, session: Session):
    """Payment history for the profile page, newest first, with the access period each bought."""
    if user is None:
        return error("unauthorized", 401)
    rows = await session.execute(
        select(Payment, AccessGrant)
        .outerjoin(AccessGrant, AccessGrant.payment_id == Payment.id)
        .where(Payment.user_id == user.id)
        .order_by(Payment.created_at.desc())
        .limit(100)
    )
    return [
        {
            "id": str(p.id),
            "product": p.product,
            "slug": p.target_slug,
            "episode": p.target_episode,
            "amount": p.amount,
            "list_amount": p.list_amount,
            "currency": p.currency,
            "method": p.method.value,
            "status": p.status.value,
            "created_at": p.created_at.isoformat(),
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "starts_at": g.starts_at.isoformat() if g else None,
            "ends_at": g.ends_at.isoformat() if g else None,
        }
        for p, g in rows
    ]


@router.get("/media")
async def media_list(session: Session) -> list[dict]:
    """Uploaded episode videos with their durations (public: shown before paying)."""
    rows = (await session.scalars(select(EpisodeMedia))).all()
    return [
        {"slug": m.slug, "episode": m.episode, "lang": m.lang, "duration": m.duration_seconds}
        for m in rows
    ]


@router.get("/episodes/{slug}/{episode}/play")
async def play(
    slug: str,
    episode: int,
    request: Request,
    user: CurrentUser,
    session: Session,
    lang: str | None = None,
    vip_only: bool = False,
):
    """`vip_only`: the site marks VIP series (catalog `vip`); those play only with a pass, a
    bought single episode does not count."""
    from app.points import award_daily  # app.points imports this module

    now = datetime.now(UTC)
    free = 0 < episode <= settings.free_episodes
    # The next few play for those who left an email at the offer (half the visitors see it).
    bonus = settings.free_episodes < episode <= settings.free_episodes + settings.email_bonus_episodes
    if user is None and not free:
        return error("unauthorized", 401)
    until = await access_until(session, user.id) if user else None
    vip = until is not None and until > now
    entitled = free or vip or (bonus and user is not None and user.email_gate_at is not None)
    if not entitled and user is not None:
        series_until = await series_access_until(session, user.id, slug)
        entitled = (series_until is not None and series_until > now) or (
            not vip_only and await has_episode(session, user.id, slug, episode)
        )
    if not entitled:
        return error("payment_required", 402)
    logger.info(
        "audit play user=%s episode=%s/%s ip=%s", user.id if user else "-", slug, episode, client_ip(request)
    )
    cuts = (
        await session.scalars(
            select(EpisodeMedia).where(EpisodeMedia.slug == slug, EpisodeMedia.episode == episode)
        )
    ).all()
    item = media.pick_cut(list(cuts), lang)
    if item is None or not settings.media_enabled:
        return error("video_not_ready", 404)
    return {
        "url": media.signed_url(item.object_key),
        # A lighter 480p copy, when one has been made: the player's low quality.
        "sd_url": media.signed_url(media.sd_key(item.object_key)) if media.has_sd(item.object_key) else None,
        "duration": item.duration_seconds,
        "expires_in": settings.play_url_ttl_seconds,
        # VIP points given for watching today (once a day; 0 otherwise).
        "points_awarded": await award_daily(session, user.id) if vip and user else 0,
    }


@router.post("/auth/register")
async def register(body: Registration, request: Request, session: Session):
    email = normalize_email(body.email)
    if not email:
        return error("invalid_email", 400)
    if not valid_password(body.password):
        return error("short_password", 400)
    if not body.accept_terms:
        return error("terms_required", 400)
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        terms_version=settings.terms_version,
        terms_accepted_at=datetime.now(UTC),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        logger.info("audit register-taken email=%s ip=%s", email, client_ip(request))
        return error("email_taken", 409)
    logger.info("audit register user=%s email=%s ip=%s", user.id, user.email, client_ip(request))
    notify.registered(user.email, await session.scalar(select(func.count(User.id))))
    return {"token": issue_token(user.id), "user": await account(session, user)}


@router.post("/auth/login")
async def login(body: Credentials, request: Request, session: Session):
    email = normalize_email(body.email)
    user = await session.scalar(select(User).where(User.email == email)) if email else None
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        logger.info("audit login-failed email=%s ip=%s", email or body.email[:80], client_ip(request))
        return error("bad_credentials", 401)
    logger.info("audit login user=%s email=%s ip=%s", user.id, user.email, client_ip(request))
    return {"token": issue_token(user.id), "user": await account(session, user)}


@router.get("/me")
async def me(user: CurrentUser, session: Session):
    if user is None:
        return error("unauthorized", 401)
    return await account(session, user)


def ad_context(ad: AdContext | None, ip: str) -> dict | None:
    context = {"ip": ip, **(ad.model_dump(exclude_none=True) if ad else {})}
    context = {key: value for key, value in context.items() if value}
    return context or None


@router.post("/payments")
async def start_payment(body: NewPayment, request: Request, user: CurrentUser, session: Session):
    if user is None:
        return error("unauthorized", 401)
    if body.method not in settings.enabled_methods:
        return error("method_unavailable", 400)
    method = PaymentMethod(body.method)
    # Cards (DOKU) need the payer's email; QRIS and SBP go without (guest accounts).
    if method == PaymentMethod.CARD and not user.email:
        return error("email_required", 400)
    product = products()[body.product]
    from app.visits import link_payer  # app.visits imports this module

    await link_payer(session, user, client_ip(request), body.ad.ua if body.ad and body.ad.ua else "")
    locale = body.locale if body.locale in LOCALES else "en"
    next_slug = body.next if body.next and SLUG_RE.match(body.next) else None
    target_slug = target_episode = None
    if product.kind == "series":
        if not body.slug or not SLUG_RE.match(body.slug):
            return error("series_required", 400)
        target_slug = body.slug
    if product.kind == "episode":
        if (
            not body.slug
            or not SLUG_RE.match(body.slug)
            or not body.episode
            or not 0 < body.episode < 1000
        ):
            return error("episode_required", 400)
        target_slug, target_episode = body.slug, body.episode
        if await has_episode(session, user.id, target_slug, target_episode):
            return error("already_unlocked", 409)
    country = visitor_country(request)
    amount = price_for(product, country=country)

    recent = await session.scalar(
        select(Payment)
        .where(
            Payment.user_id == user.id,
            Payment.method == method,
            Payment.product == product.id,
            Payment.target_slug.is_not_distinct_from(target_slug),
            Payment.target_episode.is_not_distinct_from(target_episode),
            Payment.amount == amount,
            Payment.status == PaymentStatus.PENDING,
            Payment.payment_url.is_not(None),
            Payment.created_at > datetime.now(UTC) - REUSE_WINDOW,
        )
        .order_by(Payment.created_at.desc())
    )
    if recent is not None:
        await session.commit()
        return payment_view(recent)

    payment = Payment(
        id=uuid.uuid4(),
        user_id=user.id,
        product=product.id,
        target_slug=target_slug,
        target_episode=target_episode,
        amount=amount,
        list_amount=in_country(product.regular_price, country),
        currency="IDR",
        method=method,
        provider=PROVIDER_BY_METHOD[method],
        locale=locale,
        return_slug=next_slug,
        terms_version=settings.terms_version,
        ad_context=ad_context(body.ad, client_ip(request)),
    )
    gateway = provider(payment.provider)
    payment.provider_ref = gateway.reference(payment)
    session.add(payment)
    await session.commit()

    query = (
        {"lang": locale}
        | ({"next": next_slug} if next_slug else {})
        | ({"play": target_episode} if target_episode else {})
        # A guest has no password: the key signs them in wherever the provider sends them back.
        | ({"k": return_key(payment.id)} if not user.email else {})
    )
    return_url = f"{settings.public_site_url}/payment/{payment.id}?{urlencode(query)}"
    try:
        checkout = await gateway.open(payment, payer_email=user.email, return_url=return_url)
    except ProviderError:
        payment.status = PaymentStatus.FAILED
        await session.commit()
        notify.attempt_failed(payment, who(user))
        return error("payment_unavailable", 502)

    payment.provider_payment_id = checkout.provider_payment_id
    payment.payment_url = checkout.url
    payment.expires_at = checkout.expires_at
    payment.raw = checkout.raw
    await session.commit()
    logger.info(
        "audit payment-opened payment=%s user=%s product=%s amount=%s provider=%s ref=%s ip=%s",
        payment.id, user.id, payment.product, payment.amount, payment.provider, payment.provider_ref, client_ip(request),
    )
    notify.attempt(payment, who(user))
    return payment_view(payment)


@router.get("/payments/{payment_id}")
async def payment_status(payment_id: uuid.UUID, user: CurrentUser, session: Session):
    if user is None:
        return error("unauthorized", 401)
    payment = await session.get(Payment, payment_id)
    if payment is None or payment.user_id != user.id:
        return error("not_found", 404)
    payment = await refresh_payment(session, payment)
    return payment_view(payment) | {"account": await account(session, user)}


@router.post("/webhooks/xendit")
async def xendit_callback(
    request: Request,
    session: Session,
    x_callback_token: Annotated[str | None, Header()] = None,
):
    """For callbacks pointed straight at this service. Today they reach Eventstripe instead,
    and are picked up from its database by the reconciler."""
    expected = settings.xendit_webhook_token
    if not expected or not hmac.compare_digest(x_callback_token or "", expected):
        return error("forbidden", 403)
    payload = await request.json()
    payment = await session.scalar(
        select(Payment).where(
            Payment.provider == Provider.XENDIT,
            Payment.provider_ref == str(payload.get("external_id", "")),
        )
    )
    if payment is None:
        # Invoices of other products on the same account: acknowledged, not ours.
        return {"ok": True}
    try:
        # The callback only says "look"; the state comes from the API.
        snapshot = await provider(payment.provider).fetch(payment)
    except ProviderError:
        return error("retry", 503)
    await apply_snapshot(session, payment.id, snapshot)
    return {"ok": True}
