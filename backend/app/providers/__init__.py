from app.models import PaymentMethod, Provider
from app.providers.base import Checkout, PaymentProvider, ProviderError, Snapshot
from app.providers.doku import DokuProvider
from app.providers.ixpay import IxpayProvider
from app.providers.xendit import XenditProvider

#: QRIS goes through Xendit, cards through DOKU, SBP through IXPAY (all Eventstripe's accounts).
PROVIDER_BY_METHOD: dict[PaymentMethod, Provider] = {
    PaymentMethod.QRIS: Provider.XENDIT,
    PaymentMethod.CARD: Provider.DOKU,
    PaymentMethod.SBP: Provider.IXPAY,
}

_providers: dict[Provider, PaymentProvider] = {
    Provider.XENDIT: XenditProvider(),
    Provider.DOKU: DokuProvider(),
    Provider.IXPAY: IxpayProvider(),
}


def provider(name: Provider) -> PaymentProvider:
    return _providers[name]


__all__ = [
    "PROVIDER_BY_METHOD",
    "Checkout",
    "PaymentProvider",
    "ProviderError",
    "Snapshot",
    "provider",
]
