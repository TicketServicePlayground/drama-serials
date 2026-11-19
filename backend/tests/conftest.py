import os

# Tests run against their own databases on the local dev Postgres (see README).
# TEST_PG_PORT points them at another server, e.g. a throwaway one.
PG = f"drama:drama@localhost:{os.environ.get('TEST_PG_PORT', '5436')}"
os.environ["DATABASE_URL"] = f"postgresql+asyncpg://{PG}/drama_test"
# A stand-in for the Eventstripe database: same tables, filled by the tests.
os.environ["EVENTSTRIPE_DB_DSN"] = f"postgresql://{PG}/eventstripe_test"
os.environ["XENDIT_SECRET_KEY"] = "xnd_development_test"
os.environ["XENDIT_WEBHOOK_TOKEN"] = "callback-token"
os.environ["DOKU_CLIENT_ID"] = "BRN-TEST"
os.environ["DOKU_SECRET_KEY"] = "SK-TEST"
os.environ["JWT_SECRET"] = "test-secret-of-at-least-thirty-two-bytes"
os.environ["PAYMENT_METHODS"] = "QRIS,CREDIT_CARD,SBP"
os.environ["STATS_KEY"] = "stats-key"
# Prices the tests were written against, whatever the current business prices are.
os.environ["PRICE_EPISODE_IDR"] = "5000"
os.environ["PRICE_SERIES_DAY_IDR"] = "12800"
os.environ["PRICE_WEEK_IDR"] = "9900"
os.environ["PRICE_MONTH_IDR"] = "29900"
os.environ["PRICE_YEAR_IDR"] = "199000"
os.environ["REGULAR_WEEK_IDR"] = "19800"
os.environ["REGULAR_MONTH_IDR"] = "59800"
os.environ["REGULAR_YEAR_IDR"] = "398000"
os.environ["LAUNCH_ENDS_AT"] = "2099-01-01T00:00:00+07:00"
# Most tests are about paid episodes; test_free_episodes turns free ones on.
os.environ["FREE_EPISODES"] = "0"

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

from app import eventstripe_hooks  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402

EVENTSTRIPE_SCHEMA = """
CREATE SCHEMA albus;
CREATE TABLE albus.payment_events (
    id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    provider varchar, direction varchar, operation varchar, order_id uuid,
    invoice_number varchar, http_status int, outcome varchar, provider_status varchar,
    amount numeric, payload text);
CREATE TABLE albus.xendit_webhook_logs (
    webhook_id varchar PRIMARY KEY, webhook_type varchar,
    processed_at timestamptz NOT NULL DEFAULT now(), payload text);
"""


@pytest.fixture(scope="session", autouse=True)
async def database():
    admin = await asyncpg.connect(f"postgresql://{PG}/drama")
    for name in ("drama_test", "eventstripe_test"):
        await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {name}")
    await admin.close()
    eventstripe = await asyncpg.connect(os.environ["EVENTSTRIPE_DB_DSN"])
    await eventstripe.execute(EVENTSTRIPE_SCHEMA)
    await eventstripe.close()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    await eventstripe_hooks.close()
    await engine.dispose()


@pytest.fixture
async def eventstripe_db():
    connection = await asyncpg.connect(os.environ["EVENTSTRIPE_DB_DSN"])
    yield connection
    await connection.close()


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
