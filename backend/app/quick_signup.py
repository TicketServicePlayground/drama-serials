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
    code_matches,
    issue_email_challenge,
    read_email_challenge,
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
    # "email_gate": given at the "more free episodes for an email" offer, which opens them. The
    # address must be confirmed first: the code emailed by /auth/email-code and its challenge.
    source: str = ""
    code: str = ""
    challenge: str = ""


class EmailCodeRequest(BaseModel):
    email: str = ""
    locale: str = "en"


CODE_TEXT = {
    "en": ("Your AN Serials code: {code}", "Your code to confirm this email on AN Serials:",
           "It works for 15 minutes. If you did not ask for it, ignore this email."),
    "id": ("Kode AN Serials kamu: {code}", "Kode untuk mengonfirmasi email ini di AN Serials:",
           "Berlaku 15 menit. Jika kamu tidak memintanya, abaikan email ini."),
    "es": ("Tu código de AN Serials: {code}", "Tu código para confirmar este correo en AN Serials:",
           "Vale 15 minutos. Si no lo pediste, ignora este correo."),
    "ru": ("Код AN Serials: {code}", "Код для подтверждения почты на AN Serials:",
           "Действует 15 минут. Если вы его не запрашивали, просто удалите письмо."),
}

# Wrong codes per challenge (this process; a restart only resets the count) and the last send
# per address: a code cannot be guessed in a few tries, and an address is not spammed.
MAX_CODE_TRIES = 5
_code_tries: dict[str, int] = {}
_last_sent: dict[str, datetime] = {}
RESEND_AFTER = timedelta(seconds=30)


def compose_code(lang: str, code: str) -> tuple[str, str, str]:
    subject, lead, note = CODE_TEXT.get(lang, CODE_TEXT["en"])
    subject = subject.format(code=code)
    plain = f"{lead}\n\n{code}\n\n{note}\n"
    e = html.escape
    body = f"""<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>{e(lead)}</p>
<p style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:6px">{e(code)}</p>
<p style="color:#888;font-size:12px">{e(note)}</p></div>"""
    return subject, plain, body


@router.post("/auth/email-code")
async def email_code(body: EmailCodeRequest, request: Request, session: Session):
    """Step one of the email offer: a 6-digit code to the address; the browser gets a signed
    challenge to send back with the code (POST /auth/quick, source "email_gate")."""
    email = normalize_email(body.email)
    if not email:
        return error("invalid_email", 400)
    if await session.scalar(select(User.id).where(User.email == email)) is not None:
        return error("email_taken", 409)
    now = datetime.now(UTC)
    last = _last_sent.get(email)
    if last is not None and now - last < RESEND_AFTER:
        return error("too_soon", 429)
    code = f"{secrets.randbelow(1_000_000):06d}"
    lang = body.locale if body.locale in CODE_TEXT else "en"
    try:
        await mailer.send(email, *compose_code(lang, code))
    except Exception:  # noqa: BLE001
        logger.exception("email code to %s failed", email)
        return error("mail_failed", 502)
    _last_sent[email] = now
    logger.info("audit email-code email=%s ip=%s", email, client_ip(request))
    return {"challenge": issue_email_challenge(email, code)}


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
    if body.source == "email_gate":
        challenge = read_email_challenge(body.challenge)
        if challenge is None:
            return error("code_expired", 400)
        jti = challenge.get("jti", "")
        if _code_tries.get(jti, 0) >= MAX_CODE_TRIES:
            return error("too_many_attempts", 429)
        if not code_matches(challenge, email, body.code):
            _code_tries[jti] = _code_tries.get(jti, 0) + 1
            return error("bad_code", 400)
        _code_tries.pop(jti, None)
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
    if body.source == "email_gate":
        user.email_gate_at = datetime.now(UTC)
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
