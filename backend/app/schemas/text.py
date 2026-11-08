"""Text rules shared by the company name (T-002c) and the customer fields (T-002n)."""

import re

# Rejected anywhere in a value: U+0000-001F, U+007F-009F, and the invisible formatting characters
# U+200B-200F (zero width, direction marks), U+202A-202E (bidi embeddings and overrides),
# U+2066-2069 (bidi isolates), U+FEFF (byte order mark) and lone UTF-16 surrogates U+D800-U+DFFF
# (not valid text; a JSON "\ud800" escape produces one in Python and PostgreSQL then refuses to
# store it). A surrogate pair is a normal astral character in JavaScript and never reaches Python
# as two code points. Twin of `shared/src/text/forbidden.ts`.
FORBIDDEN = re.compile("[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿\ud800-\udfff]")

MSG_CONTROL = "Remove control characters."


def contains_forbidden_character(value: str) -> bool:
    return FORBIDDEN.search(value) is not None


def trim(raw: str) -> str:
    """Only the ordinary space (U+0020) is trimmed, so Python and JavaScript agree exactly."""
    return raw.strip(" ")


def clean_text(
    raw: str | None,
    *,
    required_message: str | None,
    max_length: int,
    long_message: str | None = None,
) -> str | None:
    """Trim, then apply the common rules in order (first failure wins).

    Returns the trimmed text, or None for a blank optional value. A required value that is
    missing or blank raises `required_message`. Length counts code points after trimming.
    """
    value = trim(raw) if raw is not None else ""
    if not value:
        if required_message is not None:
            raise ValueError(required_message)
        return None
    if len(value) > max_length:
        raise ValueError(long_message or f"Use {max_length} characters or fewer.")
    if contains_forbidden_character(value):
        raise ValueError(MSG_CONTROL)
    return value


def clean_required(raw: str | None, *, message: str, max_length: int) -> str:
    """`clean_text` for a field that cannot be blank: blank raises `message`."""
    value = clean_text(raw, required_message=message, max_length=max_length)
    if value is None:  # unreachable: a required message makes clean_text raise instead
        raise ValueError(message)
    return value
