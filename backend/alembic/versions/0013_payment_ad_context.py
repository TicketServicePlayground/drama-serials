"""payment ad context for the Meta Conversions API

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-19 15:30:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payments', sa.Column('ad_context', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('payments', 'ad_context')
