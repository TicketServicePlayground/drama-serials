"""episode media audio language

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-14 14:20:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'episode_media', sa.Column('lang', sa.String(length=8), server_default='', nullable=False)
    )
    op.drop_constraint('episode_media_slug_episode_key', 'episode_media', type_='unique')
    op.create_unique_constraint(
        'episode_media_slug_episode_lang_key', 'episode_media', ['slug', 'episode', 'lang']
    )


def downgrade() -> None:
    op.execute("DELETE FROM episode_media WHERE lang <> ''")
    op.drop_constraint('episode_media_slug_episode_lang_key', 'episode_media', type_='unique')
    op.create_unique_constraint('episode_media_slug_episode_key', 'episode_media', ['slug', 'episode'])
    op.drop_column('episode_media', 'lang')
