"""Small, dependency-free IBAN validation helpers."""

import re


#: Shared by model/serializer validation so the user-facing wording stays identical.
INVALID_IBAN_MESSAGE = "Enter a valid IBAN or leave this field empty."
IBAN_ADDRESS_REQUIRED_MESSAGE = "An address is required when an IBAN is configured."


def normalize_iban(value: str) -> str:
    """Return an IBAN in the canonical compact uppercase representation."""
    return re.sub(r"\s+", "", value).upper()


def is_valid_iban(value: str) -> bool:
    """Validate the IBAN structure and ISO 13616 MOD-97 checksum."""
    iban = normalize_iban(value)
    if not iban or not re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}", iban):
        return False
    rearranged = iban[4:] + iban[:4]
    numeric = "".join(
        str(ord(char) - ord("A") + 10) if char.isalpha() else char
        for char in rearranged
    )
    return int(numeric) % 97 == 1


def has_required_iban_address(
    bank_iban: str | None,
    *,
    address_line1: str | None,
    postal_code: str | None,
    city: str | None,
) -> bool:
    """Return whether the recipient address satisfies the configured IBAN."""
    return not bank_iban or all(
        value and value.strip()
        for value in (address_line1, postal_code, city)
    )
