"""Sign-up at the paywall: only an email. The account gets a generated password, emailed to that
address, and the visitor is signed in at once to go on to the payment.

An email that already has an account is refused (email_taken): signing in by email alone would
hand anyone's account to whoever types its address. Paying accepts the Terms (the paywall says
so next to the pay buttons), so the acceptance is recorded as at a normal sign-up.
"""
import html
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import mailer, notify
from app.api import CurrentUser, Session, account, client_ip, error
from app.config import settings
from app.models import Payment, User
from app.security import (
    check_return_key,
    hash_password,
    issue_token,
    issue_transfer_token,
    normalize_email,
    read_transfer_token,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")

# No look-alikes (0/O, 1/l/I), so it can be typed from the email.
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

TEXT = {
    "en": ("Your AN Serials account", "Your account is ready. Sign in with this email and password:", "Password",
           "Open AN Serials", "You can change it any time with “Forgot password?” at sign-in."),
    "id": ("Akun AN Serials kamu", "Akunmu sudah siap. Masuk dengan email dan kata sandi ini:", "Kata sandi",
           "Buka AN Serials", "Kamu bisa menggantinya kapan saja lewat “Lupa kata sandi?” saat masuk."),
    "es": ("Tu cuenta de AN Serials", "Tu cuenta está lista. Entra con este correo y contraseña:", "Contraseña",
           "Abrir AN Serials", "Puedes cambiarla cuando quieras con «¿Olvidaste tu contraseña?» al entrar."),
    "ru": ("Ваш аккаунт AN Serials", "Аккаунт создан. Входите с этой почтой и паролем:", "Пароль",
           "Открыть AN Serials", "Сменить пароль можно в любой момент через «Забыли пароль?» при входе."),
}


def new_password(length: int = 10) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def compose(lang: str, email: str, password: str) -> tuple[str, str, str]:
    subject, lead, label, button, change = TEXT.get(lang, TEXT["en"])
    site = f"{settings.public_site_url.rstrip('/')}/?lang={lang}"
    plain = f"{lead}\n\nEmail: {email}\n{label}: {password}\n\n{button}: {site}\n\n{change}\n"
    e = html.escape
    body = f"""<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>{e(lead)}</p>
<p>Email: <b>{e(email)}</b><br>{e(label)}: <b style="font-family:monospace;font-size:17px">{e(password)}</b></p>
<p><a href="{e(site)}" style="display:inline-block;background:#e0245e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">{e(button)}</a></p>
<p style="color:#888;font-size:12px">{e(change)}</p></div>"""
    return subject, plain, body


class QuickSignup(BaseModel):
    email: str = ""
    locale: str = "en"


@router.post("/auth/guest")
async def guest_signup(request: Request, session: Session):
    """Paying by QRIS or SBP needs no email: an account without one, kept by the session cookie.
    Paying accepts the Terms (the paywall says so next to the buttons)."""
    user = User(terms_version=settings.terms_version, terms_accepted_at=datetime.now(UTC))
    session.add(user)
    await session.commit()
    logger.info("audit register-guest user=%s ip=%s", user.id, client_ip(request))
    return {"token": issue_token(user.id), "user": await account(session, user)}


@router.post("/auth/quick")
async def quick_signup(body: QuickSignup, request: Request, session: Session, current: CurrentUser):
    email = normalize_email(body.email)
    if not email:
        return error("invalid_email", 400)
    if await session.scalar(select(User.id).where(User.email == email)) is not None:
        return error("email_taken", 409)
    password = new_password()
    if current is not None and current.email is None:
        # A guest (already paid by QRIS/SBP, say) adds an email for a card payment: keep the account.
        user = current
        user.email = email
        user.password_hash = hash_password(password)
    else:
        user = User(
            email=email,
            password_hash=hash_password(password),
            terms_version=settings.terms_version,
            terms_accepted_at=datetime.now(UTC),
        )
        session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return error("email_taken", 409)
    logger.info("audit register-at-paywall user=%s email=%s ip=%s", user.id, user.email, client_ip(request))
    notify.registered(user.email, await session.scalar(select(func.count(User.id))))
    lang = body.locale if body.locale in TEXT else "en"
    try:
        await mailer.send(user.email, *compose(lang, user.email, password))
    except Exception:  # noqa: BLE001 — the account stands; "Forgot password?" recovers it
        logger.exception("welcome email to user %s failed", user.id)
    return {"token": issue_token(user.id), "user": await account(session, user)}


class ReturnLogin(BaseModel):
    payment_id: uuid.UUID
    key: str = ""


# How long the link back from the provider can sign a guest in.
RETURN_KEY_TTL = timedelta(days=30)


@router.post("/auth/return")
async def return_login(body: ReturnLogin, request: Request, session: Session):
    """Signs a guest in from the provider's return link (payment id + its signed key), so a
    purchase made in one browser shows up in the browser the payer comes back to."""
    payment = await session.get(Payment, body.payment_id)
    if payment is None or not check_return_key(payment.id, body.key):
        return error("bad_key", 401)
    if payment.created_at < datetime.now(UTC) - RETURN_KEY_TTL:
        return error("bad_key", 401)
    user = await session.get(User, payment.user_id)
    # Accounts with an email sign in with their password; the link only stands in for guests.
    if user is None or user.email:
        return error("sign_in_required", 403)
    logger.info("audit return-login user=%s payment=%s ip=%s", user.id, payment.id, client_ip(request))
    return {"token": issue_token(user.id), "user": await account(session, user)}


@router.post("/auth/transfer-link")
async def transfer_link(user: CurrentUser):
    """A token for a sign-in link that carries this session to another browser (7 days)."""
    if user is None:
        return error("unauthorized", 401)
    return {"token": issue_transfer_token(user.id)}


class Transfer(BaseModel):
    token: str = ""


@router.post("/auth/transfer")
async def transfer_login(body: Transfer, request: Request, session: Session):
    user_id = read_transfer_token(body.token)
    user = await session.get(User, user_id) if user_id else None
    if user is None:
        return error("bad_token", 401)
    logger.info("audit transfer-login user=%s ip=%s", user.id, client_ip(request))
    return {"token": issue_token(user.id), "user": await account(session, user)}
