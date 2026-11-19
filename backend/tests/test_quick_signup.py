from app import mailer
from tests.test_flow import signup


async def test_paywall_signup_emails_a_password_and_signs_in(client, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    async def fake_send(to, subject, text, html):
        sent.append((to, subject, text))

    monkeypatch.setattr(mailer, "send", fake_send)
    assert (await client.post("/api/v1/offer")).status_code == 200  # prices without an account
    email = "payer-new@example.com"
    done = await client.post("/api/v1/auth/quick", json={"email": email, "locale": "ru"})
    assert done.status_code == 200 and done.json()["token"]
    to, subject, text = sent[-1]
    assert to == email and subject == "Ваш аккаунт AN Serials"
    password = text.split("Пароль: ")[1].split("\n")[0]
    assert len(password) == 10
    assert (await client.post("/api/v1/auth/login", json={"email": email, "password": password})).status_code == 200

    # An existing account is not signed in by its email alone.
    await signup(client, "already-here@example.com")
    taken = await client.post("/api/v1/auth/quick", json={"email": "Already-Here@example.com"})
    assert taken.status_code == 409 and taken.json() == {"error": "email_taken"}
    assert (await client.post("/api/v1/auth/quick", json={"email": "nope"})).json() == {"error": "invalid_email"}
