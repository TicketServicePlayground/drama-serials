import base64
import hashlib
import hmac
import uuid

from app.providers.doku import _sign, invoice_number


def test_invoice_number_fits_card_limit_and_is_unique():
    numbers = {invoice_number(uuid.uuid4()) for _ in range(500)}
    assert len(numbers) == 500
    assert all(n.startswith("AN") and len(n) == 27 and n.isalnum() for n in numbers)
    assert invoice_number(uuid.UUID(int=0)) == "AN" + "0" * 25


def test_signature_matches_doku_canon():
    # Same canon as Eventstripe's DokuClient: header lines joined by \n, Digest only with a body.
    body = '{"order":{"amount":9900}}'
    headers = _sign("req-1", "2026-11-14T00:00:00Z", "/checkout/v1/payment", body)
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    canon = (
        "Client-Id:BRN-TEST\nRequest-Id:req-1\nRequest-Timestamp:2026-11-14T00:00:00Z\n"
        f"Request-Target:/checkout/v1/payment\nDigest:{digest}"
    )
    expected = base64.b64encode(hmac.new(b"SK-TEST", canon.encode(), hashlib.sha256).digest())
    assert headers["Digest"] == digest
    assert headers["Signature"] == "HMACSHA256=" + expected.decode()

    get = _sign("req-2", "2026-11-14T00:00:00Z", "/orders/v1/status/AN1", None)
    assert "Digest" not in get
