"""visit events (funnel clicks)

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-16 13:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('visits', sa.Column('event', sa.String(length=20), server_default='', nullable=False))
    op.add_column('visits', sa.Column('target', sa.String(length=80), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('visits', 'target')
    op.drop_column('visits', 'event')
