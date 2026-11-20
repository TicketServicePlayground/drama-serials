"""A/B test at the first locked episode: paywall at once or an email for more free episodes

users.ab / visits.ab: the group ("paywall" / "email"); users.email_gate_at: left an email at
the offer, so the episodes after the free ones play.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-21 10:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('ab', sa.String(16), server_default='', nullable=False))
    op.add_column('users', sa.Column('email_gate_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('visits', sa.Column('ab', sa.String(16), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('visits', 'ab')
    op.drop_column('users', 'email_gate_at')
    op.drop_column('users', 'ab')
