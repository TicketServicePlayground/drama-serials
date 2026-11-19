"""stats for paid traffic: ad labels and country on visits, first source and test flag on users

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-17 22:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None

VISIT = [
    ('utm_medium', 80), ('utm_campaign', 150), ('utm_content', 150), ('country', 2),
]
USER = [
    ('src_source', 120), ('src_medium', 80), ('src_campaign', 150), ('src_content', 150), ('src_country', 2),
]


def upgrade() -> None:
    for name, size in VISIT:
        op.add_column('visits', sa.Column(name, sa.String(length=size), server_default='', nullable=False))
    op.add_column('visits', sa.Column('fbclid', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('users', sa.Column('is_test', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    for name, size in USER:
        op.add_column('users', sa.Column(name, sa.String(length=size), nullable=True))
    op.add_column('users', sa.Column('src_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for name, _ in USER:
        op.drop_column('users', name)
    op.drop_column('users', 'src_at')
    op.drop_column('users', 'is_test')
    op.drop_column('visits', 'fbclid')
    for name, _ in VISIT:
        op.drop_column('visits', name)
