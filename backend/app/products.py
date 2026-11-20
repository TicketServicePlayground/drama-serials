"""What can be bought, and what it costs right now."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.config import settings

Kind = Literal["episode", "series", "vip"]


@dataclass(frozen=True)
class Product:
    id: str
    #: episode: one episode for good; series: one series for `hours`; vip: every series for `days`.
    kind: Kind
    #: The launch price for VIP passes; the only price for the rest.
    price: int
    #: The regular price, crossed out while the launch price runs.
    regular_price: int
    days: int | None = None
    hours: int | None = None

    @property
    def title(self) -> str:
        if self.kind == "episode":
            return "AN Serials: one episode"
        if self.kind == "series":
            return f"AN Serials: one series for {self.hours} hours"
        return f"AN Serials: all series for {self.days} days"


def products() -> dict[str, Product]:
    s = settings
    return {
        "series_day": Product("series_day", "series", s.price_series_day_idr, s.price_series_day_idr, hours=s.series_pass_hours),
        "week": Product("week", "vip", s.price_week_idr, s.regular_week_idr, days=7),
        "month": Product("month", "vip", s.price_month_idr, s.regular_month_idr, days=30),
        "year": Product("year", "vip", s.price_year_idr, s.regular_year_idr, days=365),
        "episode": Product("episode", "episode", s.price_episode_idr, s.price_episode_idr),
    }


def launch_ends_at() -> datetime | None:
    return datetime.fromisoformat(settings.launch_ends_at) if settings.launch_ends_at else None


def launch_active(now: datetime | None = None) -> bool:
    ends = launch_ends_at()
    return ends is not None and (now or datetime.now(UTC)) < ends


def country_factor(country: str | None) -> float:
    """settings.country_price_factors for this ISO country code; 1 elsewhere."""
    for item in settings.country_price_factors.split(","):
        code, _, factor = item.partition("=")
        if country and code.strip().upper() == country.upper():
            try:
                return float(factor)
            except ValueError:
                return 1
    return 1


def in_country(amount: int, country: str | None) -> int:
    return round(amount * country_factor(country))


def price_for(product: Product, now: datetime | None = None, country: str | None = None) -> int:
    """The price charged now: the launch price until the launch ends, the regular one after;
    times the visitor country's factor."""
    return in_country(product.price if launch_active(now) else product.regular_price, country)
