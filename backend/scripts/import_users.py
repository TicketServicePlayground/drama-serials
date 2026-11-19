"""Imports accounts from the first, Node-only version of the site (users.json).

Usage: python -m scripts.import_users /path/to/users.json
Existing emails are skipped, so it is safe to run twice.
"""

import asyncio
import json
import sys
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal, engine
from app.models import User


async def main(path: str) -> None:
    with open(path) as file:
        rows = json.load(file)
    async with SessionLocal() as session:
        for row in rows:
            await session.execute(
                insert(User)
                .values(
                    email=row["email"].strip().lower(),
                    password_hash=row["passwordHash"],
                    created_at=datetime.fromisoformat(row["createdAt"].replace("Z", "+00:00")),
                )
                .on_conflict_do_nothing(index_elements=["email"])
            )
        await session.commit()
    await engine.dispose()
    print(f"{len(rows)} accounts in file, imported where new")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
