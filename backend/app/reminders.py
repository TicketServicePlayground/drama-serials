"""Emails before a one-series pass ends: "access closes in N hours, M episodes left" + VIP.

Every few minutes: passes (access_grants with a slug) ending within the largest REMINDER_HOURS
threshold, whose owner has no VIP. For each threshold reached and not yet handled, count the
episodes the owner has not opened since the pass began (episode clicks in visits) and email
them in the language they paid in; nothing left to watch = no email. One row per pass and
threshold in series_reminders, so nothing is sent twice.
"""

import asyncio
import html
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, text

from app import mailer
from app.billing import access_until
from app.config import settings
from app.db import SessionLocal
from app.models import AccessGrant, Payment, SeriesReminder, User

logger = logging.getLogger(__name__)

TICK_SECONDS = 300

TEXT = {
    "en": {
        "subject": "{hours} h left: {title}",
        "lead": "Your access to «{title}» closes in about {hours} h, and {left} episodes are still waiting for you.",
        "watch": "Keep watching",
        "vip": "With VIP every series stays open: 7 days, 30 days or a year.",
        "vip_link": "Get VIP",
        "why": "You get this email because you bought one-day access to this series on AN Serials.",
    },
    "id": {
        "subject": "Sisa {hours} jam: {title}",
        "lead": "Akses kamu ke «{title}» berakhir sekitar {hours} jam lagi, dan masih ada {left} episode yang menunggu.",
        "watch": "Lanjut menonton",
        "vip": "Dengan VIP semua serial tetap terbuka: 7 hari, 30 hari, atau setahun.",
        "vip_link": "Dapatkan VIP",
        "why": "Kamu menerima email ini karena membeli akses satu hari ke serial ini di AN Serials.",
    },
    "es": {
        "subject": "Quedan {hours} h: {title}",
        "lead": "Tu acceso a «{title}» termina en unas {hours} h y aún te esperan {left} episodios.",
        "watch": "Seguir viendo",
        "vip": "Con VIP todas las series quedan abiertas: 7 días, 30 días o un año.",
        "vip_link": "Hazte VIP",
        "why": "Recibes este correo porque compraste acceso de un día a esta serie en AN Serials.",
    },
    "ru": {
        "subject": "Осталось {hours} ч: {title}",
        "lead": "Доступ к сериалу «{title}» закроется примерно через {hours} ч, а вас ещё ждут серии: {left}.",
        "watch": "Смотреть дальше",
        "vip": "С VIP открыты все сериалы: на 7 дней, 30 дней или год.",
        "vip_link": "Оформить VIP",
        "why": "Вы получили это письмо, потому что купили доступ к этому сериалу на сутки на AN Serials.",
    },
}


async def _title(slug: str, lang: str) -> str:
    """The series title in that language, from the site (the catalog lives there)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{settings.web_internal_url}/api/series-title", params={"slug": slug, "lang": lang})
            if response.status_code == 200:
                return response.json().get("title") or slug
    except httpx.HTTPError:
        pass
    return slug


def compose(lang: str, title: str, hours: int, left: int, slug: str) -> tuple[str, str, str]:
    t = TEXT.get(lang, TEXT["en"])
    site = settings.public_site_url.rstrip("/")
    series_url = f"{site}/series/{slug}?lang={lang}"
    vip_url = f"{site}/vip?lang={lang}"
    subject = t["subject"].format(hours=hours, title=title)
    lead = t["lead"].format(hours=hours, title=title, left=left)
    plain = f"{lead}\n\n{t['watch']}: {series_url}\n\n{t['vip']}\n{t['vip_link']}: {vip_url}\n\n{t['why']}\n"
    e = html.escape
    body = f"""<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>{e(lead)}</p>
<p><a href="{e(series_url)}" style="display:inline-block;background:#e0245e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">{e(t['watch'])}</a></p>
<p>{e(t['vip'])} <a href="{e(vip_url)}">{e(t['vip_link'])}</a></p>
<p style="color:#888;font-size:12px">{e(t['why'])}</p></div>"""
    return subject, plain, body


async def _left(session, user_id, slug: str, since: datetime) -> int:
    total = await session.scalar(
        text("SELECT count(DISTINCT episode) FROM episode_media WHERE slug = :slug"), {"slug": slug}
    )
    opened = await session.scalar(
        text(
            "SELECT count(DISTINCT split_part(target, '/', 2)) FROM visits WHERE user_id = :user AND "
            "event = 'episode' AND target LIKE :prefix AND at >= :since"
        ),
        {"user": user_id, "prefix": f"{slug}/%", "since": since},
    )
    return max(0, int(total or 0) - int(opened or 0))


async def remind_once(now: datetime | None = None) -> int:
    """One pass over the passes ending soon; returns the emails sent."""
    thresholds = settings.reminder_hours_list
    if not thresholds or not mailer.enabled():
        return 0
    now = now or datetime.now(UTC)
    sent = 0
    async with SessionLocal() as session:
        grants = (
            await session.scalars(
                select(AccessGrant).where(
                    AccessGrant.slug.is_not(None),
                    AccessGrant.ends_at > now,
                    AccessGrant.ends_at <= now + timedelta(hours=thresholds[0]),
                )
            )
        ).all()
        for grant in grants:
            done = set(
                (await session.scalars(select(SeriesReminder.hours).where(SeriesReminder.grant_id == grant.id))).all()
            )
            # The smallest threshold already reached is the one to act on; larger ones it covers.
            due = [h for h in thresholds if grant.ends_at - now <= timedelta(hours=h) and h not in done]
            if not due:
                continue
            hours = min(due)
            vip_until = await access_until(session, grant.user_id)
            user = await session.get(User, grant.user_id)
            left = await _left(session, grant.user_id, grant.slug, grant.starts_at)
            outcome = "skipped"
            if user and user.email and left > 0 and not (vip_until and vip_until > now) and not user.is_test:
                payment = await session.get(Payment, grant.payment_id) if grant.payment_id else None
                lang = payment.locale if payment and payment.locale in TEXT else "en"
                hours_left = max(1, round((grant.ends_at - now).total_seconds() / 3600))
                subject, plain, body = compose(lang, await _title(grant.slug, lang), hours_left, left, grant.slug)
                try:
                    await mailer.send(user.email, subject, plain, body)
                    outcome = "sent"
                    sent += 1
                    logger.info("reminder sent: grant %s, %s h, %s episodes left", grant.id, hours, left)
                except Exception:  # noqa: BLE001 — one bad address must not stop the rest
                    logger.exception("reminder for grant %s failed", grant.id)
                    outcome = "failed"
            for h in due:  # larger thresholds passed meanwhile are covered by this one
                session.add(SeriesReminder(grant_id=grant.id, hours=h, outcome=outcome, remaining=left))
            await session.commit()
    return sent


async def run_forever() -> None:
    while True:
        try:
            await remind_once()
        except Exception:  # noqa: BLE001 — the loop must outlive any single failure
            logger.exception("reminders failed")
        await asyncio.sleep(TICK_SECONDS)
