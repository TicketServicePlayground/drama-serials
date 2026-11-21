"""Each payment keeps what the paying browser sent: ad label, A/B group, counter id, country

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-21 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None

COLUMNS = [
    ('utm_source', 80), ('utm_medium', 80), ('utm_campaign', 150), ('utm_content', 150),
    ('country', 2), ('ab', 16), ('client_id', 32),
]


def upgrade() -> None:
    for name, size in COLUMNS:
        op.add_column('payments', sa.Column(name, sa.String(size), server_default='', nullable=False))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column('payments', name)
