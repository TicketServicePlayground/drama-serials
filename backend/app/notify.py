"""Telegram notifications for the team: sign-ups, payment attempts and their outcome.

Fire-and-forget: a slow or failing Telegram never delays or breaks a user's request.
Disabled when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set.
"""

import asyncio
import html
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import settings
from app.models import Payment

logger = logging.getLogger(__name__)

# Tasks are kept referenced until done, or the event loop may drop them mid-flight.
_pending: set[asyncio.Task] = set()
TZ = ZoneInfo("Asia/Makassar")  # Bali time, where the team reads the chat.

METHOD = {"QRIS": "QRIS (Xendit)", "CREDIT_CARD": "карта (DOKU)", "SBP": "СБП (IXPAY)"}


def esc(value: object) -> str:
    return html.escape(str(value), quote=False)


def rupiah(amount: int) -> str:
    return "Rp " + f"{amount:,}".replace(",", ".")


def local_time(moment: datetime) -> str:
    return moment.astimezone(TZ).strftime("%d.%m %H:%M")


def product_label(payment: Payment) -> str:
    if payment.product == "episode":
        return f"серия {payment.target_episode} · {payment.target_slug}"
    if payment.product == "series_day":
        return f"сериал на сутки · {payment.target_slug}"
    return {"week": "все сериалы · 7 дней", "month": "все сериалы · 30 дней", "year": "все сериалы · 1 год"}.get(
        payment.product, payment.product
    )


def payment_line(payment: Payment, email: str) -> str:
    price = rupiah(payment.amount)
    if payment.list_amount and payment.amount < payment.list_amount:
        price += f" (цена запуска, обычно {rupiah(payment.list_amount)})"
    return (
        f"👤 {esc(email)}\n"
        f"🎬 {esc(product_label(payment))}\n"
        f"💰 {price} · {METHOD.get(payment.method.value, payment.method.value)}"
    )


async def _send(text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                json={
                    "chat_id": settings.telegram_chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
        if response.status_code >= 400:
            logger.warning("telegram refused: %s %s", response.status_code, response.text[:200])
    except httpx.HTTPError as error:
        logger.warning("telegram unreachable: %s", error)


def send(text: str) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return
    task = asyncio.get_running_loop().create_task(_send(f"<b>AN Serials</b>\n{text}"))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def registered(email: str, total_users: int) -> None:
    send(f"🆕 Регистрация\n👤 {esc(email)}\nВсего пользователей: {total_users}")


def attempt(payment: Payment, email: str) -> None:
    send(f"🛒 Открыл оплату\n{payment_line(payment, email)}")


def attempt_failed(payment: Payment, email: str) -> None:
    send(f"⚠️ Не удалось открыть оплату (провайдер не ответил)\n{payment_line(payment, email)}")


def outcome(payment: Payment, email: str, access_until: datetime | None = None) -> None:
    status = payment.status.value
    if status == "paid":
        tail = f"\n📡 {esc(payment.paid_channel or '—')}"
        if access_until:
            tail += f"\n🔓 доступ до {local_time(access_until)}"
        send(f"✅ Оплачено\n{payment_line(payment, email)}{tail}")
    elif status == "expired":
        send(f"⌛ Не оплатил, ссылка истекла\n{payment_line(payment, email)}")
    elif status == "failed":
        send(f"❌ Платёж не прошёл проверку (сумма/валюта)\n{payment_line(payment, email)}")
