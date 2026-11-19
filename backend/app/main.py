import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import eventstripe_hooks, media, password_reset, points, quick_signup, reminders, visits
from app.api import router
from app.reconciler import run_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [
        asyncio.create_task(run_forever()),
        asyncio.create_task(media.run_forever()),
        asyncio.create_task(reminders.run_forever()),
    ]
    yield
    for task in tasks:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await eventstripe_hooks.close()


app = FastAPI(title="AN Serials API", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(router)
app.include_router(visits.router)
app.include_router(points.router)
app.include_router(password_reset.router)
app.include_router(quick_signup.router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
