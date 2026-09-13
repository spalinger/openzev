"""Small, dependency-free IBAN validation helpers."""

import re


#: Shared by model/serializer validation so the user-facing wording stays identical.
INVALID_IBAN_MESSAGE = "Enter a valid IBAN or leave this field empty."


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
