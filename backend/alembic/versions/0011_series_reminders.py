"""series-pass reminder emails

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-17 23:30:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'series_reminders',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('grant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('hours', sa.Integer(), nullable=False),
        sa.Column('outcome', sa.String(length=10), nullable=False),
        sa.Column('remaining', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['grant_id'], ['access_grants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('grant_id', 'hours', name='uq_series_reminders_grant_hours'),
    )


def downgrade() -> None:
    op.drop_table('series_reminders')
