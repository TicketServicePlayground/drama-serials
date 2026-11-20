"""guest accounts: email and password optional

A visitor paying by QRIS or SBP gets an account without an email or password, kept by the
session cookie. Card payments (DOKU) still ask for an email, which is then set on the account.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-20 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('users', 'email', existing_type=sa.String(254), nullable=True)
    op.alter_column('users', 'password_hash', existing_type=sa.String(200), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE email IS NULL")
    op.alter_column('users', 'password_hash', existing_type=sa.String(200), nullable=False)
    op.alter_column('users', 'email', existing_type=sa.String(254), nullable=False)
