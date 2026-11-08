"""T-002n D10: the customer validators, driven by the case table shared with the TypeScript twin.

`shared/src/customer/validationCases.json` is the single source of truth for what each field
accepts, stores and says. `shared/src/customer/validation.test.ts` reads the same file.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas import customer_write as cw

CASES_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "customer" / "validationCases.json"
)
CASES: list[dict[str, Any]] = json.loads(CASES_PATH.read_text())

VALIDATORS: dict[str, Callable[[str | None], str | None]] = {
    "name": cw.validate_name,
    "contact_name": cw.validate_contact_name,
    "email": cw.validate_email,
    "phone": cw.validate_phone,
    "line1": cw.validate_line1,
    "line2": cw.validate_line2,
    "town": cw.validate_town,
    "county": cw.validate_county,
    "postcode": cw.validate_postcode,
}
ADDRESS_FIELDS = {"line1", "line2", "town", "county", "postcode"}


def _id(case: dict[str, Any]) -> str:
    return f"{case['field']}-{json.dumps(case['input'])[:40]}"


def body_for(case: dict[str, Any], version: int = 1) -> dict[str, Any]:
    field = case["field"]
    if field in ADDRESS_FIELDS:
        return {"version": version, "billing_address": {field: case["input"]}}
    return {"version": version, field: case["input"]}


def test_the_case_table_is_large_and_covers_every_field_and_range() -> None:
    assert len(CASES) >= 40
    assert {c["field"] for c in CASES} == set(VALIDATORS)
    for case in CASES:
        assert case["ok"] == ("stored" in case) != ("message" in case)
        assert set(case) <= {"field", "input", "ok", "stored", "message"}
    inputs = " ".join(json.dumps(c["input"]) for c in CASES)
    for escape in (
        "u0000", "u001f", "u007f", "u009f", "u200b", "u200f", "u202a", "u202e",
        "u2066", "u2069", "ufeff", "ud800", "udfff",
    ):  # fmt: skip
        assert escape in inputs, escape
    assert any(c["input"] == "+44 (0)117 496 0123" for c in CASES)
    assert any(c["input"] == "GIR 0AA" and not c["ok"] for c in CASES)
    assert any(c["input"] == "ec1a 1bb" and c["ok"] for c in CASES)
    assert any(c["field"] == "name" and c["ok"] and "\U0001f3a8" in c["input"] for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=[_id(c) for c in CASES])
def test_validator_matches_the_case_table(case: dict[str, Any]) -> None:
    validator = VALIDATORS[case["field"]]
    if case["ok"]:
        assert validator(case["input"]) == case["stored"]
    else:
        with pytest.raises(ValueError) as caught:
            validator(case["input"])
        assert str(caught.value) == case["message"]


@pytest.mark.parametrize("case", CASES, ids=[_id(c) for c in CASES])
def test_request_model_matches_the_case_table(case: dict[str, Any]) -> None:
    """The same cases through the Pydantic body, so wiring and messages cannot drift."""
    if case["ok"]:
        model = cw.CustomerUpdate.model_validate(body_for(case))
        target = model.billing_address if case["field"] in ADDRESS_FIELDS else model
        assert getattr(target, case["field"]) == case["stored"]
    else:
        with pytest.raises(ValidationError) as caught:
            cw.CustomerUpdate.model_validate(body_for(case))
        errors = caught.value.errors()
        assert len(errors) == 1
        assert str(errors[0]["msg"]).removeprefix("Value error, ") == case["message"]
        expected_loc = (
            ("billing_address", case["field"])
            if case["field"] in ADDRESS_FIELDS
            else (case["field"],)
        )
        assert errors[0]["loc"] == expected_loc


def test_validators_are_idempotent_on_their_own_output() -> None:
    for case in CASES:
        if case["ok"] and case["stored"] is not None:
            assert VALIDATORS[case["field"]](case["stored"]) == case["stored"], case


def test_only_sent_keys_are_validated_and_recorded() -> None:
    model = cw.CustomerUpdate.model_validate({"version": 3, "phone": "07700 900123"})
    assert model.model_fields_set == {"version", "phone"}
    part = cw.CustomerUpdate.model_validate({"version": 1, "billing_address": {"town": "Bath"}})
    assert part.billing_address is not None
    assert part.billing_address.model_fields_set == {"town"}


def test_all_problems_are_reported_at_once() -> None:
    with pytest.raises(ValidationError) as caught:
        cw.CustomerUpdate.model_validate(
            {
                "version": 1,
                "name": " ",
                "email": "nope",
                "phone": "abc",
                "billing_address": {"line1": "", "town": None, "postcode": "ZZ"},
                "surprise": 1,
            }
        )
    locs = sorted(".".join(str(p) for p in e["loc"]) for e in caught.value.errors())
    assert locs == [
        "billing_address.line1",
        "billing_address.postcode",
        "billing_address.town",
        "email",
        "name",
        "phone",
        "surprise",
    ]


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"version": 1}, "Send at least one field to change."),
        ({"version": 1, "billing_address": {}}, "Send at least one address field to change."),
        ({"version": 1, "billing_address": None}, "Send the address parts to change."),
    ],
)
def test_empty_updates_are_refused(body: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError) as caught:
        cw.CustomerUpdate.model_validate(body)
    assert [str(e["msg"]).removeprefix("Value error, ") for e in caught.value.errors()] == [message]


@pytest.mark.parametrize(
    "version", [None, 0, -1, True, False, 1.0, 1.5, "1", [], {}, "", float("nan")]
)
def test_version_must_be_a_strict_positive_integer(version: Any) -> None:
    with pytest.raises(ValidationError):
        cw.CustomerUpdate.model_validate({"version": version, "name": "X"})
    with pytest.raises(ValidationError):
        cw.CustomerUpdate.model_validate({"name": "X"})


@pytest.mark.parametrize("value", [5, 1.5, True, [], {}])
@pytest.mark.parametrize("field", ["name", "contact_name", "email", "phone"])
def test_non_strings_are_type_errors(field: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        cw.CustomerUpdate.model_validate({"version": 1, field: value})


@pytest.mark.parametrize("value", ["x", 5, [], [{"line1": "a"}], True])
def test_billing_address_must_be_an_object(value: Any) -> None:
    with pytest.raises(ValidationError):
        cw.CustomerUpdate.model_validate({"version": 1, "billing_address": value})


def test_phone_helpers() -> None:
    assert cw.phone_digits("+44 (0)117 496-0123") == "+441174960123"
    assert cw.phone_digits("(0117) 496 0123") == "01174960123"
    assert cw.normalise_phone("0117  496   0123") == "0117 496 0123"
    assert cw.normalise_postcode("bs65qa") == "BS6 5QA"
    assert cw.normalise_postcode("ec1a1bb") == "EC1A 1BB"


def test_company_name_rules_are_unchanged_by_the_move_to_text_py() -> None:
    from app.schemas import settings, text

    assert settings.contains_forbidden_character is text.contains_forbidden_character
    for bad in ("a​b", "a\ud800b", "\t", "a‮b", "a\x7fb"):
        with pytest.raises(ValueError, match="Remove control characters"):
            settings.validate_company_name(bad)
    assert settings.validate_company_name(" Acme \U0001f3a8 ") == "Acme \U0001f3a8"
