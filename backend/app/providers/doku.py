"""DOKU Checkout (hosted payment page): used for cards.

Money goes to the main DOKU account: no split settlement or sub-account is attached.
Notifications for this DOKU account go to the Eventstripe backend, which records every one
in its payment_events table; the status is still confirmed through the status API.
Signing follows https://developers.doku.com (Checkout, HMAC-SHA256 "non-SNAP").
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta

import httpx

from app.config import settings
from app.models import Payment, PaymentStatus
from app.products import products
from app.providers.base import Checkout, ProviderError, Snapshot

logger = logging.getLogger(__name__)

CHECKOUT_TARGET = "/checkout/v1/payment"
#: Our invoice numbers start with this; Eventstripe's start with "ES". The card acquirer
#: allows at most 30 characters, so the payment UUID is packed into base36.
REF_PREFIX = "AN"
BODY_LENGTH = 25

STATUS_MAP: dict[str, PaymentStatus] = {
    "SUCCESS": PaymentStatus.PAID,
    "SETTLEMENT": PaymentStatus.PAID,
    "EXPIRED": PaymentStatus.EXPIRED,
    # A declined card is not final in Checkout: the payer can try another card on the page.
    "FAILED": PaymentStatus.PENDING,
    "PENDING": PaymentStatus.PENDING,
}


def invoice_number(payment_id: uuid.UUID) -> str:
    n = payment_id.int
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    body = ""
    while n:
        n, r = divmod(n, 36)
        body = digits[r] + body
    return REF_PREFIX + body.rjust(BODY_LENGTH, "0")


def _sign(request_id: str, timestamp: str, target: str, body: str | None) -> dict[str, str]:
    lines = [
        f"Client-Id:{settings.doku_client_id}",
        f"Request-Id:{request_id}",
        f"Request-Timestamp:{timestamp}",
        f"Request-Target:{target}",
    ]
    headers = {
        "Client-Id": settings.doku_client_id,
        "Request-Id": request_id,
        "Request-Timestamp": timestamp,
    }
    if body:
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        lines.append(f"Digest:{digest}")
        headers["Digest"] = digest
    mac = hmac.new(settings.doku_secret_key.encode(), "\n".join(lines).encode(), hashlib.sha256)
    headers["Signature"] = "HMACSHA256=" + base64.b64encode(mac.digest()).decode()
    return headers


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _customer_name(email: str) -> str:
    # DOKU rejects the whole checkout on non-Latin or special characters in the name.
    name = re.sub(r"[^A-Za-z0-9 ]+", " ", email.split("@")[0]).strip()
    return (name or "Customer")[:50]


def _locate(data: dict, key: str) -> dict | None:
    # DOKU answers either with the node at the root or wrapped in "response".
    node = data.get(key) or (data.get("response") or {}).get(key)
    return node if isinstance(node, dict) else None


class DokuProvider:
    def reference(self, payment: Payment) -> str:
        return invoice_number(payment.id)

    def _client(self) -> httpx.AsyncClient:
        if not settings.doku_client_id or not settings.doku_secret_key:
            raise ProviderError("doku is not configured")
        return httpx.AsyncClient(
            base_url=settings.doku_api_url, timeout=settings.provider_timeout_seconds
        )

    async def open(self, payment: Payment, *, payer_email: str | None, return_url: str) -> Checkout:
        if not payer_email:  # the API refuses guests before this; DOKU needs the customer email
            raise ProviderError("doku needs the payer email")
        body = json.dumps(
            {
                "order": {
                    "amount": payment.amount,
                    "invoice_number": payment.provider_ref,
                    "currency": payment.currency,
                    "callback_url": return_url,
                    "line_items": [
                        {
                            "name": products()[payment.product].title,
                            "price": payment.amount,
                            "quantity": 1,
                        }
                    ],
                },
                "payment": {
                    "payment_due_date": settings.checkout_minutes,
                    "payment_method_types": [payment.method.value],
                },
                "customer": {
                    "id": str(payment.user_id),
                    "name": _customer_name(payer_email),
                    "email": payer_email,
                },
            },
            separators=(",", ":"),
        )
        headers = _sign(str(uuid.uuid4()), _now(), CHECKOUT_TARGET, body)
        headers["Content-Type"] = "application/json"
        try:
            async with self._client() as client:
                response = await client.post(CHECKOUT_TARGET, content=body, headers=headers)
        except httpx.HTTPError as error:
            raise ProviderError("doku did not answer") from error
        if response.status_code >= 400:
            logger.warning(
                "doku refused a checkout: %s %s", response.status_code, response.text[:300]
            )
            raise ProviderError(response.text[:200])
        data = response.json()
        page = _locate(data, "payment") or {}
        if not page.get("url"):
            raise ProviderError("doku returned no payment url")
        return Checkout(
            url=page["url"],
            provider_payment_id=None,
            expires_at=datetime.now(UTC) + timedelta(minutes=settings.checkout_minutes),
            raw=data,
        )

    async def fetch(self, payment: Payment) -> Snapshot:
        target = f"/orders/v1/status/{payment.provider_ref}"
        try:
            async with self._client() as client:
                response = await client.get(
                    target, headers=_sign(str(uuid.uuid4()), _now(), target, None)
                )
        except httpx.HTTPError as error:
            raise ProviderError("doku did not answer") from error
        if response.status_code == 404:
            # DOKU knows the invoice only once the payer has started on the page.
            return Snapshot(payment.provider_ref, PaymentStatus.PENDING, None, None, None, {})
        if response.status_code >= 400:
            raise ProviderError(f"doku answered {response.status_code}: {response.text[:200]}")
        data = response.json()
        order = _locate(data, "order") or {}
        tx = _locate(data, "transaction") or {}
        raw_status = str(tx.get("status", "PENDING")).upper()
        status = STATUS_MAP.get(raw_status, PaymentStatus.PENDING)
        channel = (_locate(data, "channel") or {}).get("id") or (
            _locate(data, "acquirer") or {}
        ).get("id")
        amount = order.get("amount")
        return Snapshot(
            ref=str(order.get("invoice_number") or payment.provider_ref),
            status=status,
            amount=int(float(amount)) if amount is not None else None,
            currency=order.get("currency") or "IDR",
            channel=channel,
            raw=data,
        )
