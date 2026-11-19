"""Outgoing email over SMTP (STARTTLS on 587, TLS on 465). Off while SMTP_HOST is empty."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from app.config import settings

logger = logging.getLogger(__name__)


def enabled() -> bool:
    return bool(settings.smtp_host)


def _send(to: str, subject: str, text: str, html: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=settings.smtp_from.rsplit("@", 1)[-1].strip(">"))
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30, context=context)
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)
        smtp.starttls(context=context)
    with smtp:
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


async def send(to: str, subject: str, text: str, html: str) -> None:
    await asyncio.to_thread(_send, to, subject, text, html)
