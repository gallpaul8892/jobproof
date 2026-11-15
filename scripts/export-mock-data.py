#!/usr/bin/env python3
"""Export the seed dataset as JSON for the static GitHub Pages demo (web `--mode pages`).

The demo has no backend: web/src/mock/ serves the API from this file, in the browser. The data
is the real seed (backend/app/seed `build_dataset`), so the demo shows the same realistic UK
painting and decorating data as the local stack. Only what the manager and admin screens read is
exported: no password hashes, no operative drafts. Everything in it is fake, and the demo
passwords are the ones already published in backend/app/seed/catalogue.py.

Usage (from the repository root):

    cd backend && uv run python ../scripts/export-mock-data.py [--anchor YYYY-MM-DD] [--check]

`--anchor` is the demo's fixed "today" (default: today in Europe/London). Dates in the dataset
are relative to it, and the demo treats it as the current date so "this month" always has data.
`--check` exits 1 when the committed file differs from a fresh export (for CI).
"""

import argparse
import dataclasses
import json
import sys
import uuid
from datetime import UTC, date, datetime
from enum import Enum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME  # noqa: E402
from app.clock import today_london  # noqa: E402
from app.models.enums import ReportState  # noqa: E402
from app.seed import catalogue  # noqa: E402
from app.seed.dataset import build_dataset  # noqa: E402

OUTPUT = ROOT / "web" / "src" / "mock" / "mockData.json"
# Pinned so the committed file is reproducible: the demo's fixed "today".
DEFAULT_ANCHOR = date(2026, 11, 15)


def plain(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return value


def rows(items: object, drop: tuple[str, ...] = ()) -> list[dict[str, object]]:
    out = []
    for item in items:  # type: ignore[attr-defined]
        record = dataclasses.asdict(item)
        out.append({k: plain(v) for k, v in record.items() if k not in drop})
    return out


def export(anchor: date) -> dict[str, object]:
    ds = build_dataset(anchor)
    # Managers never see drafts (T-003c): `reports` holds submitted reports only, but be explicit.
    reports = [r for r in ds.reports if r.state == ReportState.submitted]
    report_ids = {r.id for r in reports}
    return {
        "anchor": anchor.isoformat(),
        "settings": {
            "company_name": DEFAULT_COMPANY_NAME,
            "theme": dataclasses.asdict(DEFAULT_THEME),
            "uk_only_contact_details": True,
        },
        "demo_accounts": catalogue.DEMO_ACCOUNTS,
        "users": rows(ds.users, drop=("password_hash", "phone", "created_at", "updated_at")),
        "customers": rows(ds.customers, drop=("notes", "created_at", "updated_at")),
        "jobs": rows(ds.jobs, drop=("created_at", "updated_at")),
        "quotes": rows(ds.quotes, drop=("created_at", "updated_at")),
        "reports": rows(reports, drop=("created_at", "updated_at", "state", "submitted_by_id")),
        "checklist_items": rows(
            [c for c in ds.checklist_items if c.report_id in report_ids],
            drop=("created_at", "updated_at"),
        ),
        "photos": rows(
            [p for p in ds.photos if p.report_id in report_ids],
            drop=("created_at", "updated_at", "storage_key", "content_type"),
        ),
        "invoices": rows(ds.invoices, drop=("created_at", "updated_at")),
        "payments": rows(ds.payments, drop=("created_at", "updated_at", "provider_ref")),
    }


def render(data: dict[str, object]) -> str:
    """One row per line: small diffs when the dataset changes."""
    lines = ["{"]
    keys = list(data)
    for index, key in enumerate(keys):
        value = data[key]
        comma = "," if index < len(keys) - 1 else ""
        if isinstance(value, list):
            lines.append(f'"{key}": [')
            for i, row in enumerate(value):
                tail = "," if i < len(value) - 1 else ""
                lines.append(json.dumps(row, separators=(",", ":")) + tail)
            lines.append(f"]{comma}")
        else:
            lines.append(f'"{key}": {json.dumps(value, separators=(",", ":"))}{comma}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--anchor", type=date.fromisoformat, default=None)
    parser.add_argument("--today", action="store_true", help="use today (Europe/London) as anchor")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    anchor = args.anchor or (today_london() if args.today else DEFAULT_ANCHOR)
    text = render(export(anchor))
    if args.check:
        current = OUTPUT.read_text() if OUTPUT.exists() else ""
        if current != text:
            print(f"{OUTPUT} is out of date: run scripts/export-mock-data.py", file=sys.stderr)
            return 1
        print("mock data is up to date")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text)
    print(f"wrote {OUTPUT} ({len(text) // 1024} KiB, anchor {anchor})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
