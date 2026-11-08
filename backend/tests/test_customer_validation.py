"""T-002n D10 and T-002p: the customer validators, driven by the case table shared with the
TypeScript twin.

`shared/src/customer/validationCases.json` is the single source of truth for what each field
accepts, stores and says. `shared/src/customer/validation.test.ts` reads the same file.
Phone and postcode cases carry `ukOnly` (true or false): the value of the company setting
`uk_only_contact_details` the case is evaluated under. A case without `ukOnly` holds in both modes.
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

MODE_FIELDS = {"phone", "postcode"}  # the rules that depend on `uk_only_contact_details`

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
    mode = {True: "uk", False: "any", None: ""}[case.get("ukOnly")]
    return f"{case['field']}-{mode}-{json.dumps(case['input'])[:40]}"


def run(case: dict[str, Any], uk_only: bool) -> str | None:
    """The pure validator for the case's field under one mode."""
    validator = VALIDATORS[case["field"]]
    if case["field"] in MODE_FIELDS:
        return validator(case["input"], uk_only=uk_only)  # type: ignore[call-arg]
    return validator(case["input"])


def modes(case: dict[str, Any]) -> list[bool]:
    return [case["ukOnly"]] if "ukOnly" in case else [True, False]


MODE_CASES = [c for c in CASES if c["field"] in MODE_FIELDS]
PLAIN_CASES = [c for c in CASES if c["field"] not in MODE_FIELDS]


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
        assert set(case) <= {"field", "ukOnly", "input", "ok", "stored", "message"}
        assert ("ukOnly" in case) == (case["field"] in MODE_FIELDS)
        assert isinstance(case.get("ukOnly", True), bool)
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


def test_the_case_table_covers_both_modes_for_phone_and_postcode() -> None:
    by_input: dict[tuple[str, str], dict[bool, dict[str, Any]]] = {}
    for case in MODE_CASES:
        key = (case["field"], json.dumps(case["input"]))
        assert case["ukOnly"] not in by_input.setdefault(key, {}), key
        by_input[key][case["ukOnly"]] = case
    assert all(set(modes_) == {True, False} for modes_ in by_input.values())

    def get(field: str, text: str, uk_only: bool) -> dict[str, Any]:
        return by_input[(field, json.dumps(text))][uk_only]

    for number in ("+1 202 555 0100", "+353 1 234 5678", "+33 1 23 45 67 89"):
        assert not get("phone", number, True)["ok"]  # international: refused when UK only
        assert get("phone", number, False)["ok"]  # and accepted otherwise
    for number in ("07700 900123", "+44 7700 900123", "+44 (0)117 496 0123"):
        assert get("phone", number, True)["ok"] and get("phone", number, False)["ok"]
    # `+44 0117 ...` is not a UK form (the national 0 stays only inside `(0)`); under the any-number
    # rule it is a well-formed international number
    assert not get("phone", "+44 0117 496 0123", True)["ok"]
    assert get("phone", "+44 0117 496 0123", False)["ok"]
    assert get("postcode", "10001", False)["ok"] and not get("postcode", "10001", True)["ok"]
    assert get("postcode", "", False)["message"] == "Enter a postcode."
    assert get("postcode", "", True)["message"] == "Enter a UK postcode such as BS6 5QA."
    assert get("phone", "abc", True)["message"] == "Enter a UK phone number such as 07700 900123."


@pytest.mark.parametrize("case", CASES, ids=[_id(c) for c in CASES])
def test_validator_matches_the_case_table(case: dict[str, Any]) -> None:
    for uk_only in modes(case):
        if case["ok"]:
            assert run(case, uk_only) == case["stored"]
        else:
            with pytest.raises(ValueError) as caught:
                run(case, uk_only)
            assert str(caught.value) == case["message"]


@pytest.mark.parametrize("case", PLAIN_CASES, ids=[_id(c) for c in PLAIN_CASES])
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
            for uk_only in modes(case):
                stored = case["stored"]
                again = run({**case, "input": stored}, uk_only)
                assert again == stored, case


def test_the_request_model_leaves_phone_and_postcode_to_the_service() -> None:
    """Their rules depend on a company setting a field validator cannot see (T-002p)."""
    model = cw.CustomerUpdate.model_validate(
        {"version": 1, "phone": "+1 202 555 0100", "billing_address": {"postcode": "10001"}}
    )
    assert model.phone == "+1 202 555 0100"
    assert model.billing_address is not None and model.billing_address.postcode == "10001"


def test_postcode_any_country_mode_rules() -> None:
    assert cw.validate_postcode("  d02   x285 ", uk_only=False) == "D02 X285"
    assert cw.validate_postcode("bs65qa", uk_only=False) == "BS6 5QA"
    assert cw.validate_postcode("12" + "3" * 10, uk_only=False) == "12" + "3" * 10
    for bad in ("1", "1" * 13, "-1", "1-", "12.3", "12/3", "1\u00e9", "12\t3"):
        with pytest.raises(ValueError, match="^Enter a postcode.$"):
            cw.validate_postcode(bad, uk_only=False)


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
                "billing_address": {"line1": "", "town": None},
                "surprise": 1,
            }
        )
    locs = sorted(".".join(str(p) for p in e["loc"]) for e in caught.value.errors())
    assert locs == [
        "billing_address.line1",
        "billing_address.town",
        "email",
        "name",
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
