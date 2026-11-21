from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://drama:drama@localhost:5436/drama"
    jwt_secret: str = "dev-only-secret"
    jwt_ttl_days: int = 30

    # Where the payer comes back to after the provider's page.
    public_site_url: str = "http://localhost:3000"

    # Methods offered to payers, comma-separated: QRIS (Xendit), CREDIT_CARD (DOKU).
    payment_methods: str = "QRIS,CREDIT_CARD"

    xendit_api_url: str = "https://api.xendit.co"
    xendit_secret_key: str = ""
    # Token Xendit puts in x-callback-token, for callbacks sent straight to this service.
    xendit_webhook_token: str = ""

    doku_api_url: str = "https://api.doku.com"
    doku_client_id: str = ""
    doku_secret_key: str = ""

    provider_timeout_seconds: float = 20.0
    # IXPAY (SBP): the Eventstripe business unit, credited in IDR (app/providers/ixpay.py).
    ixpay_base_url: str = "https://ixpay-sea.com"
    ixpay_api_key: str = ""
    ixpay_business_unit_id: str = ""

    # Provider notifications land in the Eventstripe database (both accounts are Eventstripe's);
    # read-only connection to it. Empty disables that source; the API is polled regardless.
    eventstripe_db_dsn: str = ""
    eventstripe_db_schema: str = "albus"

    # Current version of the legal documents (the site's lib/legal.ts carries the same value).
    terms_version: str = "2026-11-17.2"

    # Team notifications (app/notify.py); both empty = off.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Meta Conversions API (app/meta_capi.py): the pixel id the site uses and a system-user
    # access token from Events Manager. Either empty = no server-side events.
    meta_pixel_id: str = ""
    meta_capi_token: str = ""
    # Events Manager → Test events code, to check the setup; leave empty in production.
    meta_test_event_code: str = ""

    # Secret part of the visit stats link (/stats/<key> on the site); empty = stats off.
    stats_key: str = ""
    # Outgoing mail (series-pass reminders, app/reminders.py); empty host = no emails.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "AN Serials <noreply@affinet.link>"
    # Hours before a one-series pass ends to remind about unwatched episodes.
    reminder_hours: str = "6,1"
    # The site's server inside the compose network (series titles for emails).
    web_internal_url: str = "http://web:3000"

    @property
    def reminder_hours_list(self) -> list[int]:
        return sorted({int(h) for h in self.reminder_hours.split(",") if h.strip().isdigit()}, reverse=True)

    # Team / test accounts, comma-separated emails: flagged is_test, left out of the stats.
    test_emails: str = ""

    @property
    def test_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.test_emails.split(",") if e.strip()}

    # Prices, whole rupiah. VIP passes have a launch price until LAUNCH_ENDS_AT, then the
    # regular one; the site shows the regular price crossed out and the end date meanwhile.
    price_episode_idr: int = 10000
    price_series_day_idr: int = 12800
    price_week_idr: int = 29800
    price_month_idr: int = 79800
    price_year_idr: int = 449000
    regular_week_idr: int = 129000
    regular_month_idr: int = 349000
    regular_year_idr: int = 1999000
    # The first moment the regular prices apply (ISO, with offset); empty = no launch price.
    launch_ends_at: str = "2027-01-01T00:00:00+07:00"
    # Prices times this in some countries (visitor IP country from nginx GeoIP), e.g. "US=2":
    # too low a price puts American viewers off.
    country_price_factors: str = "US=2"
    # The "-77%" badge next to the launch prices.
    launch_discount_percent: int = 77
    # "One series for a day": all episodes of one series for this long after paying.
    series_pass_hours: int = 24
    # The first episodes of every series play without paying or signing in.
    free_episodes: int = 7
    # The episodes after the free ones that play for anyone who leaves an email (signed up).
    email_bonus_episodes: int = 3
    # Kept for old rows (users.offer_expires_at); the 3-hour offer is no longer used.
    offer_hours: int = 3
    # VIP points: given once a day to a VIP who opened an episode; this many buy one VIP day.
    points_daily: int = 50
    points_per_vip_day: int = 1000

    # Episode videos in R2, read with short-lived signed URLs.
    # Layout: <media_prefix><series-slug>/[<lang>/]<episode-number>.mp4
    media_bucket: str = ""
    media_prefix: str = "video/"
    media_r2_account_id: str = ""
    media_r2_access_key_id: str = ""
    media_r2_secret_access_key: str = ""
    media_scan_seconds: int = 300
    play_url_ttl_seconds: int = 3 * 3600
    # How long a payment page stays payable.
    checkout_minutes: int = 60
    # Reconciler tick: notifications are read every tick; the API is asked per payment
    # at most every api_poll_seconds unless a notification says something changed.
    reconcile_interval_seconds: int = 10
    api_poll_seconds: int = 60

    @property
    def enabled_methods(self) -> list[str]:
        return [m.strip() for m in self.payment_methods.split(",") if m.strip()]

    @property
    def media_enabled(self) -> bool:
        return bool(
            self.media_bucket
            and self.media_r2_account_id
            and self.media_r2_access_key_id
            and self.media_r2_secret_access_key
        )

    @property
    def xendit_mode(self) -> str:
        return "test" if self.xendit_secret_key.startswith("xnd_development") else "live"


settings = Settings()
