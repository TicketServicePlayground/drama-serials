"""SBP payments through IXPAY

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-17 20:00:00
"""
from alembic import op


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'SBP'")
        op.execute("ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'ixpay'")


def downgrade() -> None:
    # Postgres cannot drop enum values; unused values are harmless.
    pass
