from datetime import UTC, datetime, timedelta

from app import mailer, reminders
from app.config import settings
from app.models import Provider
from tests.test_flow import gateways, ref_of, signup  # noqa: F401  (fixture reused)
from tests.test_points import media_ready


async def test_reminders_before_a_series_pass_ends(client, gateways, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    async def fake_send(to, subject, text, html):
        sent.append((to, subject, text))

    async def fake_title(slug, lang):
        return "Тестовый сериал"

    monkeypatch.setattr(settings, "smtp_host", "smtp.example")
    monkeypatch.setattr(mailer, "send", fake_send)
    monkeypatch.setattr(reminders, "_title", fake_title)
    await media_ready(monkeypatch, slug="remind-show", episodes=(1, 2, 3))

    email = "reminded@example.com"
    headers = await signup(client, email)
    payment = (await client.post("/api/v1/payments", json={"method": "QRIS", "product": "series_day", "slug": "remind-show", "locale": "ru"}, headers=headers)).json()
    gateways[Provider.XENDIT].settle(await ref_of(payment["id"]), amount=12800)
    await client.get(f"/api/v1/payments/{payment['id']}", headers=headers)
    # Watched episode 1 of 3.
    await client.post("/api/v1/visits", json={"path": "/series/remind-show", "ip": "7.1.1.1", "ua": "Mozilla/5.0 (iPhone) Mobile",
                                              "event": "episode", "target": "remind-show/1"}, headers=headers)

    now = datetime.now(UTC)
    assert await reminders.remind_once(now) == 0  # 24 h left: too early
    assert await reminders.remind_once(now + timedelta(hours=19)) == 1  # 5 h left
    to, subject, text = sent[-1]
    assert to == email and subject.startswith("Осталось 5 ч") and "серии: 2" in text and "/series/remind-show?lang=ru" in text
    assert await reminders.remind_once(now + timedelta(hours=19, minutes=5)) == 0  # once per threshold
    assert await reminders.remind_once(now + timedelta(hours=23, minutes=30)) == 1  # the last hour
    assert await reminders.remind_once(now + timedelta(hours=23, minutes=40)) == 0
