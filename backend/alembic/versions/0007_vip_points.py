"""VIP points; access grants bought with points

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-17 12:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'points_entries',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('delta', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=20), nullable=False),
        sa.Column('day', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_points_entries_user_id', 'points_entries', ['user_id'])
    op.create_index(
        'ux_points_daily', 'points_entries', ['user_id', 'day'], unique=True,
        postgresql_where=sa.text("reason = 'daily_watch'"),
    )
    op.alter_column('access_grants', 'payment_id', existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column('access_grants', sa.Column('points_entry_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'access_grants_points_entry_id_fkey', 'access_grants', 'points_entries',
        ['points_entry_id'], ['id'], ondelete='CASCADE',
    )
    op.create_unique_constraint('access_grants_points_entry_id_key', 'access_grants', ['points_entry_id'])


def downgrade() -> None:
    op.drop_constraint('access_grants_points_entry_id_key', 'access_grants', type_='unique')
    op.drop_constraint('access_grants_points_entry_id_fkey', 'access_grants', type_='foreignkey')
    op.drop_column('access_grants', 'points_entry_id')
    op.execute("DELETE FROM access_grants WHERE payment_id IS NULL")
    op.alter_column('access_grants', 'payment_id', existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_index('ux_points_daily', table_name='points_entries')
    op.drop_index('ix_points_entries_user_id', table_name='points_entries')
    op.drop_table('points_entries')
