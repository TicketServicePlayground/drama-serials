"""Xendit hosted invoices: used for QRIS.

Callbacks for invoices on this Xendit account go to the Eventstripe backend (the account is
shared), so the status is always read back from the API.
See https://docs.xendit.co/apidocs/create-invoice
"""

import logging
from datetime import datetime
from typing import Any

import httpx

from app.config import settings
from app.models import Payment, PaymentStatus
from app.products import products
from app.providers.base import Checkout, ProviderError, Snapshot

logger = logging.getLogger(__name__)

INVOICES_PATH = "/v2/invoices"
#: Prefix of our external_id, so invoices of this product are told apart from Eventstripe's
#: (whose external_id is a bare order UUID) on the shared account.
REF_PREFIX = "AN-"

STATUS_MAP: dict[str, PaymentStatus] = {
    "PENDING": PaymentStatus.PENDING,
    # PAID is the payer's side, SETTLED is the money reaching the balance; both open access.
    "PAID": PaymentStatus.PAID,
    "SETTLED": PaymentStatus.PAID,
    "EXPIRED": PaymentStatus.EXPIRED,
}


def _client() -> httpx.AsyncClient:
    if not settings.xendit_secret_key:
        raise ProviderError("xendit is not configured")
    return httpx.AsyncClient(
        base_url=settings.xendit_api_url,
        auth=(settings.xendit_secret_key, ""),
        timeout=settings.provider_timeout_seconds,
    )


def _snapshot(data: Any) -> Snapshot:
    if not isinstance(data, dict) or "id" not in data:
        raise ProviderError("xendit returned no invoice")
    raw_status = str(data.get("status", ""))
    status = STATUS_MAP.get(raw_status)
    if status is None:
        raise ProviderError(f"unknown xendit invoice status {raw_status!r}")
    amount = data.get("paid_amount") or data.get("amount")
    return Snapshot(
        ref=str(data.get("external_id", "")),
        status=status,
        amount=int(amount) if amount is not None else None,
        currency=data.get("currency"),
        channel=data.get("payment_channel") or data.get("payment_method"),
        raw=data,
    )


class XenditProvider:
    def reference(self, payment: Payment) -> str:
        return f"{REF_PREFIX}{payment.id}"

    async def open(self, payment: Payment, *, payer_email: str | None, return_url: str) -> Checkout:
        body = {
            "external_id": payment.provider_ref,
            "amount": payment.amount,
            "currency": payment.currency,
            # Guests (QRIS without an email) get no receipt email from Xendit.
            **({"payer_email": payer_email} if payer_email else {}),
            "description": products()[payment.product].title,
            "invoice_duration": settings.checkout_minutes * 60,
            "success_redirect_url": return_url,
            "failure_redirect_url": return_url,
            "payment_methods": [payment.method.value],
            "locale": "id" if payment.locale == "id" else "en",
            "items": [
                {
                    "name": products()[payment.product].title,
                    "quantity": 1,
                    "price": payment.amount,
                    "category": "Digital content",
                }
            ],
        }
        try:
            async with _client() as client:
                response = await client.post(INVOICES_PATH, json=body)
        except httpx.HTTPError as error:
            raise ProviderError("xendit did not answer") from error
        if response.status_code >= 400:
            logger.warning(
                "xendit refused an invoice: %s %s", response.status_code, response.text[:300]
            )
            raise ProviderError(response.text[:200])
        data = response.json()
        if not data.get("invoice_url") or not data.get("id"):
            raise ProviderError("xendit returned no invoice url")
        expires = data.get("expiry_date")
        return Checkout(
            url=data["invoice_url"],
            provider_payment_id=data["id"],
            expires_at=datetime.fromisoformat(expires.replace("Z", "+00:00")) if expires else None,
            raw=data,
        )

    async def fetch(self, payment: Payment) -> Snapshot:
        if not payment.provider_payment_id:
            raise ProviderError("payment has no xendit invoice")
        try:
            async with _client() as client:
                response = await client.get(f"{INVOICES_PATH}/{payment.provider_payment_id}")
        except httpx.HTTPError as error:
            raise ProviderError("xendit did not answer") from error
        if response.status_code >= 400:
            raise ProviderError(f"xendit answered {response.status_code}")
        return _snapshot(response.json())
