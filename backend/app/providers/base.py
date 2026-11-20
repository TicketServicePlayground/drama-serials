from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from app.models import Payment, PaymentStatus


class ProviderError(Exception):
    """The provider refused the request or could not be reached."""


@dataclass(frozen=True)
class Checkout:
    """A payment page opened at the provider."""

    url: str
    provider_payment_id: str | None
    expires_at: datetime | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Snapshot:
    """The provider's current view of a payment, read from its API."""

    ref: str
    status: PaymentStatus
    amount: int | None
    currency: str | None
    channel: str | None
    raw: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(Protocol):
    def reference(self, payment: Payment) -> str:
        """The name the payment is filed under at the provider."""

    async def open(self, payment: Payment, *, payer_email: str | None, return_url: str) -> Checkout: ...

    async def fetch(self, payment: Payment) -> Snapshot: ...
