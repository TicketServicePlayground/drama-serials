"""site visits (own counter)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-15 01:30:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'visits',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('visitor', sa.String(length=16), nullable=False),
        sa.Column('path', sa.String(length=300), nullable=False),
        sa.Column('referrer', sa.String(length=120), server_default='', nullable=False),
        sa.Column('utm_source', sa.String(length=80), server_default='', nullable=False),
        sa.Column('lang', sa.String(length=8), server_default='', nullable=False),
        sa.Column('device', sa.String(length=10), server_default='', nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_visits_at', 'visits', ['at'])


def downgrade() -> None:
    op.drop_index('ix_visits_at', table_name='visits')
    op.drop_table('visits')
