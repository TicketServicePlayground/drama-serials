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


async def confirmed_at_offer(client, monkeypatch, email):
    """The email offer's two steps: a code to the address, then the code back."""
    codes: list[str] = []

    async def fake_send(to, subject, text, html):
        codes.append(subject.rsplit(" ", 1)[-1])

    monkeypatch.setattr(mailer, "send", fake_send)
    sent = await client.post("/api/v1/auth/email-code", json={"email": email, "locale": "ru"})
    assert sent.status_code == 200, sent.text
    return await client.post(
        "/api/v1/auth/quick",
        json={"email": email, "source": "email_gate", "code": codes[-1], "challenge": sent.json()["challenge"]},
    )


async def test_email_offer_confirms_the_address_with_a_code(client, monkeypatch):
    from app import quick_signup

    codes: list[tuple[str, str]] = []

    async def fake_send(to, subject, text, html):
        codes.append((to, subject.rsplit(" ", 1)[-1]))

    monkeypatch.setattr(mailer, "send", fake_send)
    email = "offer-taker@example.com"
    sent = await client.post("/api/v1/auth/email-code", json={"email": email, "locale": "ru"})
    assert sent.status_code == 200
    to, code = codes[-1]
    assert to == email and len(code) == 6 and code.isdigit()
    challenge = sent.json()["challenge"]
    assert code not in challenge  # the browser never holds the code itself
    # Asking again at once is refused (no spamming an address).
    assert (await client.post("/api/v1/auth/email-code", json={"email": email})).json() == {"error": "too_soon"}

    offer = {"email": email, "source": "email_gate", "challenge": challenge}
    # No code, a wrong code, a challenge for another address: no account.
    assert (await client.post("/api/v1/auth/quick", json={**offer, "code": "000000" if code != "000000" else "111111"})).json() == {"error": "bad_code"}
    other = {**offer, "email": "someone-else@example.com", "code": code}
    assert (await client.post("/api/v1/auth/quick", json=other)).json() == {"error": "bad_code"}
    assert (await client.post("/api/v1/auth/quick", json={**offer, "challenge": "junk", "code": code})).json() == {"error": "code_expired"}
    # The right code: account, signed in, the bonus episodes open.
    done = await client.post("/api/v1/auth/quick", json={**offer, "code": code})
    assert done.status_code == 200 and done.json()["user"]["email_bonus"] is True

    # Guessing is cut off after a few tries.
    sent2_email = "guesser@example.com"
    quick_signup._last_sent.pop(sent2_email, None)
    sent2 = await client.post("/api/v1/auth/email-code", json={"email": sent2_email})
    real = codes[-1][1]
    wrong = "000000" if real != "000000" else "111111"
    guess = {"email": sent2_email, "source": "email_gate", "challenge": sent2.json()["challenge"]}
    for _ in range(quick_signup.MAX_CODE_TRIES):
        await client.post("/api/v1/auth/quick", json={**guess, "code": wrong})
    assert (await client.post("/api/v1/auth/quick", json={**guess, "code": real})).json() == {"error": "too_many_attempts"}
    # An address with an account is refused before any code is sent.
    assert (await client.post("/api/v1/auth/email-code", json={"email": email})).json() == {"error": "email_taken"}
