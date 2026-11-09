"""The operative's "today" (T-003c, T-003d): jobs scheduled for the anchor day.

`add_operative_day(base)` is a pure function that appends deterministic rows to the original
60-job dataset; nothing in the original rows changes except that the original jobs also get job
checklist items (done in `build_dataset`). Dates are relative to `base.anchor`, which is "today"
for the operative API (the injectable clock supplies the same day in tests).

* Dan Hughes (the demo operative): three jobs today, "Repaint lounge, hall and landing" (9 items,
  short notes), "Paper bedroom feature wall" (no checklist) and "Exterior repaint, front
  elevation" (14 items, about 1,500 characters of notes); yesterday a job with a draft report,
  6 of 9 items done and two photos.
* Priya Shah: a job submitted this morning (awaiting review, two before and two after photos)
  and one still to do.
* Every other operative: one job to do today.
"""

import dataclasses
import uuid
from datetime import date, datetime, timedelta

from app.models.enums import (
    JobStatus,
    JobType,
    PhotoStage,
    ReportState,
    ReviewStatus,
)
from app.seed import catalogue as cat
from app.seed.dataset import (
    ChecklistItemRow,
    Dataset,
    DatasetError,
    JobChecklistItemRow,
    JobRow,
    PhotoRow,
    ReportRow,
    at,
    uid,
)

DAN = "painter@jobproof.test"
PRIYA = "priya.shah@jobproof.test"
TOM = "tom.bennett@jobproof.test"
GARETH = "gareth.lewis@jobproof.test"
KASIA = "kasia.nowak@jobproof.test"
LIAM = "liam.oconnor@jobproof.test"

EXTERIOR_CHECKLIST = [
    "Scaffold tower or ladders set up safely",
    "Windows, doors and ground masked and protected",
    "Surfaces pressure washed",
    "Algae and mould treated and left to dry",
    "Cracks and loose render repaired",
    "Masonry stabilising solution applied",
    "First coat of masonry paint applied",
    "Second coat of masonry paint applied",
    "Window frames and sills sanded and primed",
    "Window frames and sills painted in satin",
    "Fascias, soffits and bargeboards painted",
    "Gutters and downpipes cleaned and painted",
    "Front door rubbed down and glossed",
    "Garden and drive left clean and tidy",
]

STAIRCASE_CHECKLIST = [
    "Stairs and floor protected",
    "Old paint stripped where flaking",
    "Chips and holes filled and sanded",
    "Spindles and newel posts primed",
    "Handrail prepared",
    "Undercoat applied",
    "Satin top coats applied",
    "Protection removed and area cleaned",
    "Customer shown the finish",
]

BATHROOM_CHECKLIST = [
    "Fittings masked and protected",
    "Mould treated and walls washed down",
    "Two coats of bathroom paint applied",
    "Ceiling painted with mould-resistant paint",
]

# About 1,500 characters: long enough to need "Show more" on a phone.
EXTERIOR_NOTES = (
    "Front elevation only, two storeys plus the bay. Access to the front is from the drive; the "
    "customer's car must be moved before 8am (she will text when it is done). Park the van on "
    "the road, not the drive. Scaffold tower is already on site, locked to the side gate. "
    "Render is sound on the left of the bay but has hairline cracks above the first floor "
    "windows: rake out and fill with flexible filler before the stabilising coat. There is "
    "algae along the base of the wall by the downpipe, so treat it and leave overnight before "
    "painting. Colour is Masonry Cream, six tins are in the garage (the side door is open, the "
    "key safe code is the same as for the front). Do not paint the stone window surrounds or "
    "the lintel over the front door: they are to be left natural. The bay window frames and "
    "the front door are to be rubbed down and finished in satin black; the door furniture "
    "comes off and goes back on at the end, so keep it in the labelled bag. Please protect the "
    "rose bed under the bay with dust sheets and stand ladders on boards, not on the soil. The "
    "neighbour at number 14 has asked that nothing is sprayed because of their washing line; "
    "brush and roller only. Forecast is dry until Thursday but check before starting each "
    "morning, and do not apply masonry paint if rain is due within four hours. Take before "
    "photos of every elevation first, including the cracks, and photograph the algae treated "
    "area and the finished bay. Customer pays by link after the manager has reviewed the "
    "report, so please do not take payment or discuss prices on site."
)

LOUNGE_NOTES = (
    "Key safe by the front door; code sent by text. Customer is at work until 5pm. Dog in the "
    "garden, keep the side gate shut. Lounge, hall and landing only; the bedrooms are not "
    "included."
)


@dataclasses.dataclass
class _Job:
    ref: str
    painter_email: str
    customer_name: str
    job_type: JobType
    title: str
    site: tuple[str, str | None, str, str, str | None, str]  # line1, line2, town, county, ..., pc
    notes: str | None
    scheduled: date
    status: JobStatus
    checklist: list[str]
    created: datetime


def _site(
    line1: str, postcode: str, line2: str | None = None, town: str = "Bristol"
) -> tuple[str, str | None, str, str, str | None, str]:
    county = "Bath and North East Somerset" if town == "Bath" else "City of Bristol"
    return (line1, line2, town, county, None, postcode)


def _plans(anchor: date) -> list[_Job]:
    yesterday = anchor - timedelta(days=1)
    created = at(anchor - timedelta(days=6), 10)
    return [
        _Job(
            "JP-1061",
            DAN,
            "Rajesh Patel",
            JobType.interior_repaint,
            "Repaint lounge, hall and landing",
            _site("31 Chesterfield Road", "BS6 5QA"),
            LOUNGE_NOTES,
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.interior_repaint],
            created,
        ),
        _Job(
            "JP-1062",
            DAN,
            "Sophie Hargreaves",
            JobType.wallpapering,
            "Paper bedroom feature wall",
            _site("Flat 2, 15 Whiteladies Gate", "BS8 2PX"),
            "Feature wall is the one behind the bed. Paper is delivered and in the hall cupboard.",
            anchor,
            JobStatus.scheduled,
            [],
            created,
        ),
        _Job(
            "JP-1063",
            DAN,
            "Helen & David Marsh",
            JobType.exterior_repaint,
            "Exterior repaint, front elevation",
            _site("6 North Street", "BS3 1AB"),
            EXTERIOR_NOTES,
            anchor,
            JobStatus.scheduled,
            EXTERIOR_CHECKLIST,
            created,
        ),
        _Job(
            "JP-1064",
            DAN,
            "Olivia Trenchard",
            JobType.staircase_woodwork,
            "Staircase and banister repaint",
            _site("23 Cotham Hill", "BS6 6JR"),
            "Spindles are original; sand by hand, no stripper near the carpet.",
            yesterday,
            JobStatus.in_progress,
            STAIRCASE_CHECKLIST,
            created,
        ),
        _Job(
            "JP-1065",
            PRIYA,
            "Callum Baines",
            JobType.interior_repaint,
            "Bathroom repaint after damp treatment",
            _site("12 Ashley Down Road", "BS7 9BW"),
            "Damp treatment finished last week; a small job, one visit.",
            anchor,
            JobStatus.completed,
            BATHROOM_CHECKLIST,
            created,
        ),
        _Job(
            "JP-1066",
            PRIYA,
            "Amara Nwosu",
            JobType.exterior_repaint,
            "Paint garage door and side gate",
            _site("5 Henleaze Gardens", "BS9 4HQ"),
            "Gate is wooden, garage door is metal. Wire brush the rust first.",
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.exterior_repaint][:5],
            created,
        ),
        _Job(
            "JP-1067",
            TOM,
            "Eleanor Whitcombe",
            JobType.interior_repaint,
            "Repaint master bedroom",
            _site("78 Coldharbour Road", "BS6 7NA"),
            None,
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.interior_repaint][:6],
            created,
        ),
        _Job(
            "JP-1068",
            GARETH,
            "Ian & Joan Pettigrew",
            JobType.wallpapering,
            "Hang wallpaper in dining room",
            _site("2 Victoria Square", "BS8 4ES"),
            "Two rolls spare are with the customer. Pattern repeat is 64 cm.",
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.wallpapering],
            created,
        ),
        _Job(
            "JP-1069",
            KASIA,
            "Clifton & Redland Property Co.",
            JobType.interior_repaint,
            "Flat refresh between tenants",
            _site("Flat 4, 9 Alma Road", "BS8 2BY"),
            "Key from the agent's office on Whiteladies Road. Call Fiona if the lock sticks.",
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.interior_repaint][:7],
            created,
        ),
        _Job(
            "JP-1070",
            LIAM,
            "Wells Road Dental Practice",
            JobType.commercial_unit,
            "Waiting room and corridor repaint",
            _site("Wells Road Dental Practice, 214 Wells Road", "BS4 2PN"),
            "Work from 6pm when the surgery closes. Reception will let you in.",
            anchor,
            JobStatus.scheduled,
            cat.CHECKLISTS[JobType.commercial_unit][:8],
            created,
        ),
    ]


def add_operative_day(base: Dataset) -> Dataset:
    anchor = base.anchor
    users = {u.email: u for u in base.users}
    customers = {c.name: c for c in base.customers}
    jobs: list[JobRow] = []
    reports: list[ReportRow] = []
    items: list[ChecklistItemRow] = []
    job_items: list[JobChecklistItemRow] = []
    photos: list[PhotoRow] = []
    draft_reports: list[ReportRow] = []
    draft_items: list[ChecklistItemRow] = []
    draft_photos: list[PhotoRow] = []
    ids: set[uuid.UUID] = set()

    def job_id_of(ref: str) -> uuid.UUID:
        return uid("job", ref)

    for plan in _plans(anchor):
        job_id = job_id_of(plan.ref)
        painter = users[plan.painter_email]
        customer = customers[plan.customer_name]
        line1, line2, town, county, _, postcode = plan.site
        completed_on = anchor if plan.status is JobStatus.completed else None
        updated = at(anchor, 7, 40) if completed_on else plan.created
        jobs.append(
            JobRow(
                job_id,
                plan.ref,
                customer.id,
                painter.id,
                plan.job_type,
                plan.title,
                plan.status,
                line1,
                line2,
                town,
                county,
                postcode,
                plan.notes,
                plan.scheduled,
                completed_on,
                plan.created,
                updated,
            )
        )
        ids.add(job_id)
        for position, label in enumerate(plan.checklist, start=1):
            item_id = uid("checklist", f"{plan.ref}:{position}")
            job_items.append(
                JobChecklistItemRow(
                    item_id, job_id, position, label, None, plan.created, plan.created
                )
            )
            ids.add(item_id)

    # ---- Dan's draft, yesterday: 6 of 9 done, two photos
    draft_ref = "JP-1064"
    draft_id = uid("report", draft_ref)
    drafted = at(anchor - timedelta(days=1), 16, 5)
    draft_reports.append(
        ReportRow(
            draft_id,
            job_id_of(draft_ref),
            users[DAN].id,
            None,
            "Stripped and filled; undercoat on, top coats to go on tomorrow.",
            None,
            None,
            None,
            at(anchor - timedelta(days=1), 15, 20),
            drafted,
            state=ReportState.draft,
            submitted_by_id=None,
        )
    )
    ids.add(draft_id)
    notes_on = {2: "Two hairline cracks on the third step, filled."}
    for position, label in enumerate(STAIRCASE_CHECKLIST, start=1):
        item_id = uid("checklist", f"{draft_ref}:{position}")
        draft_items.append(
            ChecklistItemRow(
                item_id,
                draft_id,
                position,
                label,
                position <= 6,
                notes_on.get(position),
                at(anchor - timedelta(days=1), 15, 20),
                drafted,
            )
        )
    stair_captions = cat.CAPTIONS[JobType.staircase_woodwork]
    for number, (stage, hour, minute) in enumerate(
        [(PhotoStage.before, 15, 22), (PhotoStage.during, 15, 58)], start=1
    ):
        photo_id = uid("photo", f"{draft_ref}:{number}")
        taken = at(anchor - timedelta(days=1), hour, minute)
        draft_photos.append(
            PhotoRow(
                photo_id,
                draft_id,
                stage,
                number,
                stair_captions[stage.value][0],
                taken,
                1200,
                1600,
                None,
                None,
                taken,
                taken,
            )
        )
        ids.add(photo_id)

    # ---- Priya's report, submitted this morning and awaiting review
    sub_ref = "JP-1065"
    sub_id = uid("report", sub_ref)
    submitted = at(anchor, 8, 50)
    reports.append(
        ReportRow(
            sub_id,
            job_id_of(sub_ref),
            users[PRIYA].id,
            submitted,
            "Walls washed and two coats on. Ceiling needed a stain block first.",
            ReviewStatus.awaiting_review,
            None,
            None,
            submitted,
            submitted,
            state=ReportState.submitted,
            submitted_by_id=users[PRIYA].id,
        )
    )
    ids.add(sub_id)
    for position, label in enumerate(BATHROOM_CHECKLIST, start=1):
        item_id = uid("checklist", f"{sub_ref}:{position}")
        items.append(
            ChecklistItemRow(item_id, sub_id, position, label, True, None, submitted, submitted)
        )
    captions = cat.CAPTIONS[JobType.interior_repaint]
    for number, (stage, hour, minute) in enumerate(
        [
            (PhotoStage.before, 7, 35),
            (PhotoStage.before, 7, 38),
            (PhotoStage.after, 8, 40),
            (PhotoStage.after, 8, 44),
        ],
        start=1,
    ):
        photo_id = uid("photo", f"{sub_ref}:{number}")
        taken = at(anchor, hour, minute)
        photos.append(
            PhotoRow(
                photo_id,
                sub_id,
                stage,
                number,
                captions[stage.value][number % 2],
                taken,
                1600,
                1200,
                None,
                None,
                taken,
                taken,
            )
        )
        ids.add(photo_id)

    return dataclasses.replace(
        _checked(base),
        jobs=base.jobs + tuple(jobs),
        reports=base.reports + tuple(reports),
        checklist_items=base.checklist_items + tuple(items),
        photos=base.photos + tuple(photos),
        job_checklist_items=base.job_checklist_items + tuple(job_items),
        draft_reports=tuple(draft_reports),
        draft_checklist_items=tuple(draft_items),
        draft_photos=tuple(draft_photos),
        operative_row_ids=frozenset(ids | {r.id for r in items} | {r.id for r in draft_items}),
    )


def _checked(base: Dataset) -> Dataset:
    if base.operative_row_ids:
        raise DatasetError("the operative day was already added")
    return base
