#!/usr/bin/env python3
"""Export the demo operatives' data as JSON for the static GitHub Pages mobile demo.

The mobile demo (mobile/demo) has no backend: it answers the operative API in the browser from
this file. The data is the real seed (backend/app/seed `build_dataset`, which includes
`operative_day.py`), shaped the way the operative endpoints answer today (see
backend/app/services/operative_jobs.py `build_job`). Only the published demo operative account is
exported: no password hashes, no other users' jobs, no manager notes, no money. Three operatives can
sign in (Dan Hughes, Priya Shah, Tom Bennett), each with only their own jobs. Everything in it is
fake. Dan's password is the one already published in backend/app/seed/catalogue.py; the real seed gives
the other painters no password (they cannot log in), so DEMO_PASSWORD below is a demo-only password
that exists only in this export (all three share it). Nothing in the backend changes.

Usage (from the repository root):

    cd backend && uv run python ../scripts/export-operative-mock-data.py [--anchor DATE] [--check]

`--anchor` is the day the data calls "today" (default: the same pinned day as the web demo's data).
The demo shifts every date at run time so the anchor day is the visitor's own today.
`--check` exits 1 when the committed file differs from a fresh export (for CI).
"""

import argparse
import dataclasses
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME  # noqa: E402
from app.models.enums import JobStatus, ReportState  # noqa: E402
from app.seed import catalogue  # noqa: E402
from app.seed.dataset import build_dataset  # noqa: E402
from app.seed.operative_day import DAN, PRIYA, TOM  # noqa: E402

OUTPUT = ROOT / "mobile" / "demo" / "mock" / "operativeData.json"
DEFAULT_ANCHOR = date(2026, 11, 15)
# Operatives who can sign in to the demo, in the order the demo lists them.
DEMO_OPERATIVES = [DAN, PRIYA, TOM]
# Demo-only, published, fake. Defined only here: the real seed's other painters have no password.
DEMO_PASSWORD = "Painter123!"  # noqa: S105


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def export(anchor: date) -> dict[str, object]:
    ds = build_dataset(anchor)
    dan_account = next(a for a in catalogue.DEMO_ACCOUNTS if a["email"] == DAN)
    assert dan_account["password"] == DEMO_PASSWORD, "Dan's published password changed"
    customers = {c.id: c for c in ds.customers}
    people = {u.id: u for u in ds.users}
    reports = {r.job_id: r for r in [*ds.reports, *ds.draft_reports]}
    report_items: dict[object, dict[object, object]] = {}
    for item in [*ds.checklist_items, *ds.draft_checklist_items]:
        report_items.setdefault(item.report_id, {})[item.id] = item
    job_items: dict[object, list[object]] = {}
    for item in sorted(ds.job_checklist_items, key=lambda i: i.position):
        job_items.setdefault(item.job_id, []).append(item)

    def jobs_of(painter: object) -> list[dict[str, object]]:
        return [job_json(j) for j in sorted(ds.jobs, key=lambda j: (j.scheduled_start, j.reference)) if j.painter_id == painter.id]  # type: ignore[attr-defined]

    def job_json(job: object) -> dict[str, object]:
        report = reports.get(job.id)
        recorded = report_items.get(report.id, {}) if report else {}
        live = [i for i in job_items.get(job.id, []) if i.removed_at is None]

        def status_of(row: object) -> str:
            if row is None:
                return "open"
            return "done" if row.done else "not_done" if row.cannot_do else "open"  # type: ignore[attr-defined]

        def dealt(row: object) -> bool:
            if row is None:
                return False
            return bool(row.done or (row.cannot_do and (row.note or "").strip()))  # type: ignore[attr-defined]

        checklist = [
            {
                "id": str(i.id),
                "position": i.position,
                "label": i.label,
                "status": status_of(recorded.get(i.id)),
                "note": recorded[i.id].note if i.id in recorded else None,  # type: ignore[attr-defined]
                "removed": False,
            }
            for i in live
        ]
        if job.status == JobStatus.cancelled:
            status = "cancelled"
        elif report is not None and report.state == ReportState.submitted:
            status = "submitted"
        elif job.status == JobStatus.completed:
            status = "completed_by_office"
        elif report is not None:
            status = "in_progress"
        else:
            status = "to_do"
        customer = customers[job.customer_id]

        def person(user_id: object) -> dict[str, str] | None:
            u = people.get(user_id) if user_id else None
            return {"id": str(u.id), "name": u.full_name} if u else None

        return (
            {
                "id": str(job.id),
                "reference": job.reference,
                "title": job.title,
                "job_type": job.job_type.value,
                "status": status,
                "scheduled_start": job.scheduled_start.isoformat(),
                "site_address": {
                    "line1": job.site_line1,
                    "line2": job.site_line2,
                    "town": job.site_town,
                    "county": job.site_county,
                    "postcode": job.site_postcode,
                },
                "checklist_total": len(live),
                "checklist_dealt_with": sum(dealt(recorded.get(i.id)) for i in live),
                "notes": job.notes,
                "contact": {
                    "name": customer.contact_name or customer.name,
                    "phone": customer.phone,
                },
                "checklist": checklist,
                "report": (
                    {
                        "id": str(report.id),
                        "state": report.state.value,
                        "notes": report.painter_notes,
                        "submitted_at": iso(report.submitted_at),
                        "submitted_by": person(report.submitted_by_id),
                        "review_status": (
                            report.review_status.value if report.review_status else None
                        ),
                        "reviewed_at": iso(report.reviewed_at),
                        "reviewed_by": person(report.reviewed_by_id),
                    }
                    if report is not None
                    else None
                ),
                # Server-side facts the list rules need; not part of the API answer.
                "_job_status": job.status.value,
                "_job_items": [str(i.id) for i in job_items.get(job.id, [])],
            }
        )

    accounts = []
    for email in DEMO_OPERATIVES:
        user = next(u for u in ds.users if u.email == email)
        accounts.append(
            {
                "email": user.email,
                "password": DEMO_PASSWORD,
                "user": {"id": str(user.id), "email": user.email, "full_name": user.full_name, "role": "painter"},
                "jobs": jobs_of(user),
            }
        )

    return {
        "anchor": anchor.isoformat(),
        "branding": {
            "company_name": DEFAULT_COMPANY_NAME,
            "theme": dataclasses.asdict(DEFAULT_THEME),
            "uk_only_contact_details": True,
        },
        "accounts": accounts,
    }


def render(data: dict[str, object]) -> str:
    """One job per line: small diffs when the dataset changes."""
    dump = lambda v: json.dumps(v, separators=(",", ":"))  # noqa: E731
    lines = ["{"]
    for key, value in data.items():
        if key != "accounts":
            lines.append(f'"{key}": {dump(value)},')
    lines.append('"accounts": [')
    accounts = data["accounts"]
    for n, account in enumerate(accounts):  # type: ignore[arg-type]
        head = {k: v for k, v in account.items() if k != "jobs"}
        lines.append("{" + ",".join(f'"{k}":{dump(v)}' for k, v in head.items()) + ',"jobs":[')
        jobs = account["jobs"]
        for i, job in enumerate(jobs):
            lines.append(dump(job) + ("," if i < len(jobs) - 1 else ""))
        lines.append("]}" + ("," if n < len(accounts) - 1 else ""))  # type: ignore[arg-type]
    lines.append("]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--anchor", type=date.fromisoformat, default=DEFAULT_ANCHOR)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = render(export(args.anchor))
    if args.check:
        current = OUTPUT.read_text() if OUTPUT.exists() else ""
        if current != text:
            print(f"{OUTPUT} is out of date: rerun this script", file=sys.stderr)
            return 1
        print("operative mock data is up to date")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text)
    print(f"wrote {OUTPUT} ({len(text) // 1024} KiB, anchor {args.anchor})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
