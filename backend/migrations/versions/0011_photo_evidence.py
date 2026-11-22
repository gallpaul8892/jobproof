"""photo upload and evidence columns on report_photos (T-003g)

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-22

Additive: every new column is nullable or has a default, so existing (seeded placeholder) photos
keep working: `registered_at` stays null for them, which is how the PhotoStore tells a generated
placeholder from an uploaded file. Downgrade refuses while any photo has been registered by the
app (uploaded files would be orphaned in object storage and their evidence lost).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

photo_source = postgresql.ENUM("camera", "gallery", name="photo_source", create_type=False)
taken_at_source = postgresql.ENUM(
    "device_clock", "file_metadata", "added_time", name="taken_at_source", create_type=False
)
location_source = postgresql.ENUM(
    "device", "file", name="photo_location_source", create_type=False
)

_NEW_COLUMNS = (
    "checklist_item_id",
    "source",
    "taken_at_source",
    "registered_at",
    "registered_by_id",
    "device_sent_at",
    "clock_offset_seconds",
    "received_at",
    "latitude",
    "longitude",
    "location_accuracy_m",
    "location_source",
    "original_width",
    "original_height",
    "original_bytes",
    "original_sha256",
    "upload_bytes",
    "sha256",
    "stored_sha256",
    "thumb_storage_key",
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    bind = op.get_bind()
    photo_source.create(bind, checkfirst=False)
    taken_at_source.create(bind, checkfirst=False)
    location_source.create(bind, checkfirst=False)

    op.alter_column("report_photos", "caption", server_default=sa.text("''"))
    op.add_column("report_photos", sa.Column("checklist_item_id", sa.Uuid(), nullable=True))
    op.add_column(
        "report_photos",
        sa.Column("source", photo_source, server_default="camera", nullable=False),
    )
    op.add_column(
        "report_photos",
        sa.Column("taken_at_source", taken_at_source, server_default="device_clock", nullable=False),
    )
    op.add_column(
        "report_photos", sa.Column("registered_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("report_photos", sa.Column("registered_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "report_photos", sa.Column("device_sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("report_photos", sa.Column("clock_offset_seconds", sa.Integer(), nullable=True))
    op.add_column(
        "report_photos", sa.Column("received_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("report_photos", sa.Column("latitude", sa.Float(53), nullable=True))
    op.add_column("report_photos", sa.Column("longitude", sa.Float(53), nullable=True))
    op.add_column("report_photos", sa.Column("location_accuracy_m", sa.Float(53), nullable=True))
    op.add_column("report_photos", sa.Column("location_source", location_source, nullable=True))
    op.add_column("report_photos", sa.Column("original_width", sa.Integer(), nullable=True))
    op.add_column("report_photos", sa.Column("original_height", sa.Integer(), nullable=True))
    op.add_column("report_photos", sa.Column("original_bytes", sa.BigInteger(), nullable=True))
    op.add_column("report_photos", sa.Column("original_sha256", sa.CHAR(64), nullable=True))
    op.add_column("report_photos", sa.Column("upload_bytes", sa.Integer(), nullable=True))
    op.add_column("report_photos", sa.Column("sha256", sa.CHAR(64), nullable=True))
    op.add_column("report_photos", sa.Column("stored_sha256", sa.CHAR(64), nullable=True))
    op.add_column("report_photos", sa.Column("thumb_storage_key", sa.Text(), nullable=True))

    op.create_foreign_key(
        op.f("fk_report_photos_checklist_item_id_report_checklist_items"),
        "report_photos",
        "report_checklist_items",
        ["checklist_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_report_photos_registered_by_id_users"),
        "report_photos",
        "users",
        ["registered_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_report_photos_checklist_item_id"), "report_photos", ["checklist_item_id"]
    )
    op.create_index(
        "uq_report_photos_original",
        "report_photos",
        ["report_id", "original_sha256"],
        unique=True,
        postgresql_where=sa.text("original_sha256 IS NOT NULL"),
    )
    op.create_check_constraint(
        op.f("ck_report_photos_received_has_file"),
        "report_photos",
        "received_at IS NULL OR (storage_key IS NOT NULL AND sha256 IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_report_photos_location_all_or_none"),
        "report_photos",
        "(latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL) = (location_source IS NULL)"
        " AND (location_accuracy_m IS NULL OR latitude IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_report_photos_registered_fields_together"),
        "report_photos",
        "(registered_at IS NULL) = (registered_by_id IS NULL)",
    )


def downgrade() -> None:
    uploaded = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM report_photos WHERE registered_at IS NOT NULL"))
        .scalar_one()
    )
    if uploaded:
        raise RuntimeError(
            f"Cannot downgrade 0011: {uploaded} photo(s) were registered by the app; dropping the "
            "columns would orphan their stored files and lose their evidence."
        )
    op.drop_constraint(op.f("ck_report_photos_registered_fields_together"), "report_photos")
    op.drop_constraint(op.f("ck_report_photos_location_all_or_none"), "report_photos")
    op.drop_constraint(op.f("ck_report_photos_received_has_file"), "report_photos")
    op.drop_index("uq_report_photos_original", table_name="report_photos")
    op.drop_index(op.f("ix_report_photos_checklist_item_id"), table_name="report_photos")
    op.drop_constraint(
        op.f("fk_report_photos_registered_by_id_users"), "report_photos", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_report_photos_checklist_item_id_report_checklist_items"),
        "report_photos",
        type_="foreignkey",
    )
    for column in reversed(_NEW_COLUMNS):
        op.drop_column("report_photos", column)
    op.alter_column("report_photos", "caption", server_default=None)
    bind = op.get_bind()
    location_source.drop(bind, checkfirst=False)
    taken_at_source.drop(bind, checkfirst=False)
    photo_source.drop(bind, checkfirst=False)
