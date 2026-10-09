"""Traversal protection and source/specification limits for email templates.

Total rendered output is not capped; repeated fields can amplify it.
"""
import re
import string

MAX_TEMPLATE_CHARACTERS = 20_000
MAX_FORMAT_COMPONENT = 1_000


class SafeFormatter(string.Formatter):
    """Reject traversal and excessive format widths/precision."""

    def get_field(self, field_name, args, kwargs):
        if "." in field_name or "[" in field_name:
            raise KeyError(field_name)
        return super().get_field(field_name, args, kwargs)

    def format_field(self, value, format_spec):
        # Check expanded specifications before Python allocates padded/precise output.
        for component in re.findall(r"\d+", format_spec):
            if len(component) > 4 or int(component) > MAX_FORMAT_COMPONENT:
                raise ValueError("Format width or precision exceeds the limit.")
        return super().format_field(value, format_spec)


def safe_format(template: str, context: dict) -> str:
    if len(template) > MAX_TEMPLATE_CHARACTERS:
        raise ValueError("Email template exceeds the size limit.")
    return SafeFormatter().vformat(template, (), context)


_BAD_TEMPLATE = (KeyError, IndexError, ValueError)


def render_with_fallback(template: str, fallback: str, context: dict, on_error=None) -> str:
    """Render ``template``; if invalid or over the limits, render ``fallback``.

    ``fallback`` is a shipped default, so a failure there is a bug and is
    raised rather than sent out as a raw template. ``on_error`` (optional)
    receives the template exception, e.g. to log it.
    """
    try:
        return safe_format(template, context)
    except _BAD_TEMPLATE as exc:
        if on_error:
            on_error(exc)
        return safe_format(fallback, context)
