"""T-001c scenarios 5 and 6: the paginated, filterable reports list."""

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.enums import ReviewStatus
from app.services.billing import BillingStatus
from tests.conftest import ANCHOR
from tests.contract import assert_contract
from tests.expected import ExpectedReport, expected_reports, parse_ts, search_matches

URL = "/api/v1/manager/reports"


@pytest.fixture(scope="module")
def expected(ds: Any) -> list[ExpectedReport]:
    return expected_reports(ds, ANCHOR)


def get(client: TestClient, headers: dict[str, str], **params: Any) -> Any:
    response = client.get(URL, headers=headers, params=params)
    assert_contract(response, "listManagerReports")
    return response


def ids(response: Any) -> list[str]:
    return [item["id"] for item in response.json()["items"]]


def expected_ids(rows: list[ExpectedReport]) -> list[str]:
    return [str(r.report.id) for r in rows]


# ---- scenario 5 --------------------------------------------------------------------------------


def test_default_page_is_twenty_newest_first(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    response = get(client, manager_headers)
    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["page"], body["page_size"]) == (60, 1, 20)
    assert len(body["items"]) == 20
    assert ids(response) == expected_ids(expected[:20])

    for item, want in zip(body["items"], expected[:20], strict=True):
        assert item["job_reference"] == want.job.reference
        assert item["job_id"] == str(want.job.id)
        assert item["job_type"] == want.job.job_type.value
        assert item["customer"] == {"id": str(want.customer.id), "name": want.customer.name}
        assert item["site_address"] == {
            "line1": want.job.site_line1,
            "line2": want.job.site_line2,
            "town": want.job.site_town,
            "county": want.job.site_county,
            "postcode": want.job.site_postcode,
        }
        assert item["painter"] == {"id": str(want.painter.id), "name": want.painter.full_name}
        assert item["completed_on"] == want.job.completed_on.isoformat()
        assert parse_ts(item["submitted_at"]) == want.report.submitted_at
        assert item["photo_count"] == want.photo_count
        assert item["review_status"] == want.report.review_status.value
        assert item["billing_status"] == want.billing.value


def test_sort_is_completed_on_then_submitted_at_then_reference_desc(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    items = get(client, manager_headers, page_size=100).json()["items"]
    keys = [(i["completed_on"], i["submitted_at"], i["job_reference"]) for i in items]
    assert keys == sorted(keys, reverse=True)
    assert len({i["id"] for i in items}) == 60


def test_pages_partition_the_list(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    page2 = get(client, manager_headers, page=2)
    page3 = get(client, manager_headers, page=3)
    assert ids(page2) == expected_ids(expected[20:40])
    assert ids(page3) == expected_ids(expected[40:60])
    assert page3.json()["page"] == 3 and len(page3.json()["items"]) == 20
    page4 = get(client, manager_headers, page=4)
    assert page4.status_code == 200
    assert page4.json()["items"] == []
    assert page4.json()["total"] == 60
    assert page4.json()["page"] == 4


def test_page_size_bounds(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    full = get(client, manager_headers, page_size=100)
    assert full.status_code == 200
    assert ids(full) == expected_ids(expected)
    assert full.json()["page_size"] == 100
    assert len(get(client, manager_headers, page_size=1).json()["items"]) == 1
    assert ids(get(client, manager_headers, page_size=7, page=9)) == expected_ids(expected[56:60])
    assert get(client, manager_headers, page_size=7, page=10).json()["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"page_size": 101},
        {"page_size": 0},
        {"page_size": -1},
        {"page": 0},
        {"page": -3},
        {"page": "abc"},
        {"page_size": "x"},
        {"page": 1.5},
    ],
)
def test_pagination_out_of_bounds_is_422(
    client: TestClient, manager_headers: dict[str, str], params: dict[str, Any]
) -> None:
    response = get(client, manager_headers, **params)
    assert response.status_code == 422
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert problem["errors"][0]["loc"][0] == "query"
    assert problem["errors"][0]["loc"][1] in params


def test_a_page_far_beyond_the_end_is_empty_not_an_error(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    response = get(client, manager_headers, page=10**30)
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 60


def test_unknown_query_parameters_are_ignored(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    response = get(client, manager_headers, colour="red", sort="oldest")
    assert response.status_code == 200
    assert response.json()["total"] == 60


# ---- scenario 6: filters -----------------------------------------------------------------------


@pytest.mark.parametrize("status", [s.value for s in ReviewStatus])
def test_filter_by_each_review_status(
    client: TestClient,
    manager_headers: dict[str, str],
    expected: list[ExpectedReport],
    status: str,
) -> None:
    want = [r for r in expected if r.report.review_status.value == status]
    response = get(client, manager_headers, review_status=status, page_size=100)
    assert response.json()["total"] == len(want) > 0
    assert ids(response) == expected_ids(want)


@pytest.mark.parametrize("status", [s.value for s in BillingStatus])
def test_filter_by_each_billing_status(
    client: TestClient,
    manager_headers: dict[str, str],
    expected: list[ExpectedReport],
    status: str,
) -> None:
    want = [r for r in expected if r.billing.value == status]
    response = get(client, manager_headers, billing_status=status, page_size=100)
    assert response.json()["total"] == len(want) > 0
    assert ids(response) == expected_ids(want)
    assert {i["billing_status"] for i in response.json()["items"]} == {status}


def test_billing_status_totals_cover_every_report(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    totals = {
        s.value: get(client, manager_headers, billing_status=s.value).json()["total"]
        for s in BillingStatus
    }
    assert sum(totals.values()) == 60
    assert totals["void"] == 1 and totals["not_invoiced"] == 8


def test_filter_by_each_painter(
    client: TestClient,
    manager_headers: dict[str, str],
    expected: list[ExpectedReport],
    ds: Any,
) -> None:
    painters = [u for u in ds.users if u.role.value == "painter"]
    seen = 0
    for painter in painters:
        want = [r for r in expected if r.painter.id == painter.id]
        response = get(client, manager_headers, painter_id=str(painter.id), page_size=100)
        assert response.json()["total"] == len(want)
        assert ids(response) == expected_ids(want)
        seen += len(want)
    assert seen == 60


def test_unknown_painter_matches_nothing(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    response = get(client, manager_headers, painter_id="00000000-0000-4000-8000-000000000000")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_date_range_is_inclusive_on_both_ends(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    days = sorted({r.job.completed_on for r in expected})
    lo, hi = days[3], days[10]
    want = [r for r in expected if lo <= r.job.completed_on <= hi]
    response = get(client, manager_headers, date_from=lo.isoformat(), date_to=hi.isoformat())
    assert response.json()["total"] == len(want)
    got = get(client, manager_headers, date_from=lo, date_to=hi, page_size=100)
    assert ids(got) == expected_ids(want)
    assert any(r.job.completed_on == lo for r in want)
    assert any(r.job.completed_on == hi for r in want)

    single = get(client, manager_headers, date_from=lo, date_to=lo, page_size=100)
    assert single.json()["total"] == sum(r.job.completed_on == lo for r in expected)

    from_only = get(client, manager_headers, date_from=hi)
    assert from_only.json()["total"] == sum(r.job.completed_on >= hi for r in expected)
    to_only = get(client, manager_headers, date_to=lo)
    assert to_only.json()["total"] == sum(r.job.completed_on <= lo for r in expected)


def test_date_range_with_nothing_in_it(client: TestClient, manager_headers: dict[str, str]) -> None:
    response = get(client, manager_headers, date_from="2020-01-01", date_to="2020-12-31")
    assert response.json()["total"] == 0 and response.json()["items"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"date_from": "2026-10-10", "date_to": "2026-10-09"},
    ],
)
def test_date_to_before_date_from_is_422(
    client: TestClient, manager_headers: dict[str, str], params: dict[str, str]
) -> None:
    response = get(client, manager_headers, **params)
    assert response.status_code == 422
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert problem["errors"][0]["loc"] == ["query", "date_to"]
    assert "date_from" in problem["errors"][0]["message"]


@pytest.mark.parametrize(
    "params",
    [
        {"review_status": "pending"},
        {"billing_status": "unpaid"},
        {"painter_id": "not-a-uuid"},
        {"date_from": "15/10/2026"},
        {"date_to": "2026-13-01"},
        {"q": ""},
        {"q": "x" * 101},
    ],
)
def test_invalid_filter_values_are_422(
    client: TestClient, manager_headers: dict[str, str], params: dict[str, str]
) -> None:
    response = get(client, manager_headers, **params)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"]


def test_combining_filters_applies_all_of_them(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport], ds: Any
) -> None:
    painter = ds.users[1]  # any painter with both review states in the data
    for p in (u for u in ds.users if u.role.value == "painter"):
        mine = [r for r in expected if r.painter.id == p.id]
        if {r.report.review_status for r in mine} == set(ReviewStatus):
            painter = p
            break
    for status in ReviewStatus:
        want = [
            r for r in expected if r.painter.id == painter.id and r.report.review_status is status
        ]
        response = get(
            client,
            manager_headers,
            painter_id=str(painter.id),
            review_status=status.value,
            page_size=100,
        )
        assert response.json()["total"] == len(want) > 0
        assert ids(response) == expected_ids(want)

    want = [
        r
        for r in expected
        if r.billing is BillingStatus.paid
        and r.report.review_status is ReviewStatus.reviewed
        and r.job.completed_on >= dt.date(2026, 7, 1)
    ]
    response = get(
        client,
        manager_headers,
        billing_status="paid",
        review_status="reviewed",
        date_from="2026-07-01",
        page_size=100,
    )
    assert ids(response) == expected_ids(want)


# ---- scenario 6: search ------------------------------------------------------------------------


def check_search(
    client: TestClient, headers: dict[str, str], expected: list[ExpectedReport], q: str
) -> list[ExpectedReport]:
    want = [r for r in expected if search_matches(r, q)]
    response = get(client, headers, q=q, page_size=100)
    assert response.status_code == 200
    assert response.json()["total"] == len(want), q
    assert ids(response) == expected_ids(want), q
    return want


def test_search_customer_name_in_lower_case(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    name = next(r.customer.name for r in expected if r.customer.name.startswith("Harbourside"))
    want = check_search(client, manager_headers, expected, name.lower())
    assert len(want) == 12
    assert {r.customer.name for r in want} == {name}
    check_search(client, manager_headers, expected, name.upper())
    check_search(client, manager_headers, expected, "  " + name[:6].lower() + "  ")


def test_search_postcode_with_and_without_the_space(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    postcode = expected[0].job.site_postcode
    assert " " in postcode
    with_space = check_search(client, manager_headers, expected, postcode)
    lower_with_space = check_search(client, manager_headers, expected, postcode.lower())
    without = check_search(client, manager_headers, expected, postcode.replace(" ", ""))
    lower_without = check_search(
        client, manager_headers, expected, postcode.replace(" ", "").lower()
    )
    assert with_space and with_space == lower_with_space == without == lower_without
    assert expected[0] in without
    outward = postcode.split()[0]
    assert len(check_search(client, manager_headers, expected, outward)) >= len(with_space)
    # a partial postcode that spans the space
    check_search(client, manager_headers, expected, postcode[:5].replace(" ", "").lower())


def test_search_part_of_a_street_name(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    line1 = expected[0].job.site_line1
    word = max(line1.replace(",", " ").split(), key=len)
    want = check_search(client, manager_headers, expected, word[1:-1].upper())
    assert expected[0] in want
    for fragment in ("road", "street", "kingsdown", "Bristol", "bath", "City of Bristol"):
        check_search(client, manager_headers, expected, fragment)
    # address line 2 and county are searched too
    long_row = next(r for r in expected if r.job.reference == "JP-1012")
    assert long_row.job.site_line2
    want = check_search(client, manager_headers, expected, long_row.job.site_line2[:20])
    assert long_row in want


def test_search_job_reference(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    want = check_search(client, manager_headers, expected, "jp-1042")
    assert [r.job.reference for r in want] == ["JP-1042"]
    assert len(check_search(client, manager_headers, expected, "JP-104")) == 10
    assert len(check_search(client, manager_headers, expected, "jp-")) == 60


@pytest.mark.parametrize(
    "q", ["%", "_", "\\", "100%", "%%", "_P-1042", "J_-1042", "'; DROP TABLE users;--"]
)
def test_sql_wildcards_and_quotes_match_literally(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport], q: str
) -> None:
    check_search(client, manager_headers, expected, q)
    assert get(client, manager_headers, q=q).json()["total"] == 0


def test_literal_special_characters_that_do_occur_still_match(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    want = check_search(client, manager_headers, expected, "&")
    assert want
    assert check_search(client, manager_headers, expected, ".")  # "Co.", "St." etc.


def test_search_with_no_matches_is_an_empty_page(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    response = get(client, manager_headers, q="zzzz-no-such-customer")
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}
    assert get(client, manager_headers, q="zzzz", page=3).json()["items"] == []


def test_blank_search_is_ignored(client: TestClient, manager_headers: dict[str, str]) -> None:
    assert get(client, manager_headers, q="   ").json()["total"] == 60


def test_search_combines_with_other_filters(
    client: TestClient, manager_headers: dict[str, str], expected: list[ExpectedReport]
) -> None:
    q = "harbourside"
    want = [
        r
        for r in expected
        if search_matches(r, q) and r.report.review_status is ReviewStatus.reviewed
    ]
    response = get(client, manager_headers, q=q, review_status="reviewed", page_size=100)
    assert ids(response) == expected_ids(want)
    painter = want[0].painter
    both = get(client, manager_headers, q=q, painter_id=str(painter.id), page_size=100)
    assert ids(both) == expected_ids(
        [r for r in expected if search_matches(r, q) and r.painter.id == painter.id]
    )
