"""visits.client_id: the same browser on another day

The daily visitor hash changes every day, so a person coming back tomorrow looked new.
A random id kept in the browser's own storage ties their visits together: return visits.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-20 16:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('visits', sa.Column('client_id', sa.String(32), server_default='', nullable=False))
    op.create_index('ix_visits_client_id', 'visits', ['client_id'])


def downgrade() -> None:
    op.drop_index('ix_visits_client_id', table_name='visits')
    op.drop_column('visits', 'client_id')
