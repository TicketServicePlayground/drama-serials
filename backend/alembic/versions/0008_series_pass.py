"""one-series passes (access_grants.slug)

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-17 18:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('access_grants', sa.Column('slug', sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM access_grants WHERE slug IS NOT NULL")
    op.drop_column('access_grants', 'slug')
