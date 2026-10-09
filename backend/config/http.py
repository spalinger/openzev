"""HTTP response helpers shared by download endpoints."""
from django.utils.http import content_disposition_header


def sanitize_filename(filename: str) -> str:
    """Strip control characters and path separators from a legacy or user-supplied file name."""
    cleaned = "".join("_" if char in "/\\" else char for char in filename if ord(char) >= 32 and ord(char) != 127)
    return cleaned or "download"


def content_disposition(disposition: str, filename: str) -> str:
    """Build an inline or attachment Content-Disposition header."""
    if disposition not in ("attachment", "inline"):
        raise ValueError(f"Unknown disposition {disposition!r}; expected 'attachment' or 'inline'.")
    filename = sanitize_filename(filename)
    return content_disposition_header(disposition == "attachment", filename)
