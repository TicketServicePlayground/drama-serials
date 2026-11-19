import re

from app import mailer, password_reset
from app.config import settings
from tests.test_flow import signup


async def test_forgot_password_link_sets_a_new_one_and_signs_in(client, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    async def fake_send(to, subject, text, html):
        sent.append((to, subject, text))

    monkeypatch.setattr(settings, "smtp_host", "smtp.example")
    monkeypatch.setattr(mailer, "send", fake_send)
    email = "forgetful@example.com"
    await signup(client, email)

    # Unknown address: same answer, no email.
    assert (await client.post("/api/v1/auth/forgot", json={"email": "nobody@example.com"})).json() == {"ok": True}
    assert sent == []
    assert (await client.post("/api/v1/auth/forgot", json={"email": email.upper(), "locale": "ru"})).json() == {"ok": True}
    to, subject, text = sent[-1]
    assert to == email and subject == password_reset.TEXT["ru"][0]
    token = re.search(r"token=([\w-]+)", text).group(1)
    # A second request within a minute sends nothing more.
    await client.post("/api/v1/auth/forgot", json={"email": email})
    assert len(sent) == 1

    assert (await client.post("/api/v1/auth/reset", json={"token": token, "password": "123"})).json() == {"error": "short_password"}
    done = await client.post("/api/v1/auth/reset", json={"token": token, "password": "brand-new"})
    assert done.status_code == 200 and done.json()["token"]
    # One use only; the new password works, the old one does not.
    assert (await client.post("/api/v1/auth/reset", json={"token": token, "password": "again-new"})).json() == {"error": "reset_invalid"}
    assert (await client.post("/api/v1/auth/login", json={"email": email, "password": "brand-new"})).status_code == 200
    assert (await client.post("/api/v1/auth/login", json={"email": email, "password": "secret1"})).status_code == 401
