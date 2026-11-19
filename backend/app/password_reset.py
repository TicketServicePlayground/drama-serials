"""Forgotten password: an emailed one-time link (1 hour) that sets a new password and signs in.

POST /auth/forgot always answers the same, so it does not tell which emails have accounts.
Only the token's SHA-256 is stored. Setting the password spends every open link of the user.
"""
import hashlib
import html
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select, update

from app import mailer
from app.api import Session, account, client_ip, error
from app.config import settings
from app.models import PasswordReset, User
from app.security import hash_password, issue_token, normalize_email, valid_password

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")

LIFETIME = timedelta(hours=1)
# One email per address per this long, against floods.
COOLDOWN = timedelta(minutes=1)

TEXT = {
    "en": ("Reset your AN Serials password", "Someone asked to reset the password of your AN Serials account. The link works for 1 hour.",
           "Set a new password", "If it was not you, ignore this email: your password stays the same."),
    "id": ("Atur ulang kata sandi AN Serials", "Ada permintaan untuk mengatur ulang kata sandi akun AN Serials kamu. Tautan berlaku 1 jam.",
           "Buat kata sandi baru", "Jika bukan kamu, abaikan email ini: kata sandimu tetap sama."),
    "es": ("Restablece tu contraseña de AN Serials", "Alguien pidió restablecer la contraseña de tu cuenta de AN Serials. El enlace sirve durante 1 hora.",
           "Crear una contraseña nueva", "Si no fuiste tú, ignora este correo: tu contraseña no cambia."),
    "ru": ("Восстановление пароля AN Serials", "Кто-то запросил сброс пароля вашего аккаунта AN Serials. Ссылка действует 1 час.",
           "Задать новый пароль", "Если это были не вы, просто проигнорируйте письмо: пароль останется прежним."),
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def compose(lang: str, link: str) -> tuple[str, str, str]:
    subject, lead, button, ignore = TEXT.get(lang, TEXT["en"])
    plain = f"{lead}\n\n{button}: {link}\n\n{ignore}\n"
    e = html.escape
    body = f"""<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>{e(lead)}</p>
<p><a href="{e(link)}" style="display:inline-block;background:#e0245e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">{e(button)}</a></p>
<p style="color:#888;font-size:12px">{e(ignore)}</p></div>"""
    return subject, plain, body


class Forgot(BaseModel):
    email: str = ""
    locale: str = "en"


class Reset(BaseModel):
    token: str = ""
    password: str = ""


@router.post("/auth/forgot")
async def forgot(body: Forgot, request: Request, session: Session):
    email = normalize_email(body.email)
    if not email:
        return error("invalid_email", 400)
    if not mailer.enabled():
        return error("mail_unavailable", 503)
    user = await session.scalar(select(User).where(User.email == email))
    now = datetime.now(UTC)
    logger.info("audit password-forgot email=%s known=%s ip=%s", email, user is not None, client_ip(request))
    if user is None:
        return {"ok": True}
    recent = await session.scalar(
        select(PasswordReset.id).where(PasswordReset.user_id == user.id, PasswordReset.created_at > now - COOLDOWN)
    )
    if recent is not None:
        return {"ok": True}
    token = secrets.token_urlsafe(32)
    session.add(PasswordReset(user_id=user.id, token_hash=_hash(token), expires_at=now + LIFETIME))
    await session.commit()
    lang = body.locale if body.locale in TEXT else "en"
    link = f"{settings.public_site_url.rstrip('/')}/reset?token={token}&lang={lang}"
    try:
        await mailer.send(user.email, *compose(lang, link))
    except Exception:  # noqa: BLE001 — the answer stays the same; the log says why
        logger.exception("password reset email to user %s failed", user.id)
    return {"ok": True}


@router.post("/auth/reset")
async def reset(body: Reset, request: Request, session: Session):
    if not valid_password(body.password):
        return error("short_password", 400)
    now = datetime.now(UTC)
    link = await session.scalar(
        select(PasswordReset).where(PasswordReset.token_hash == _hash(body.token or "")).with_for_update()
    )
    if link is None or link.used_at is not None or link.expires_at < now:
        return error("reset_invalid", 400)
    user = await session.get(User, link.user_id)
    if user is None:
        return error("reset_invalid", 400)
    user.password_hash = hash_password(body.password)
    await session.execute(
        update(PasswordReset)
        .where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))
        .values(used_at=now)
    )
    await session.commit()
    logger.info("audit password-reset user=%s ip=%s", user.id, client_ip(request))
    return {"token": issue_token(user.id), "user": await account(session, user)}
