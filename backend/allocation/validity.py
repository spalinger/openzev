"""Validity-window and civil-date period helpers (dependency-free).

These predicates express ``valid_from``/``valid_to`` overlap and civil-date
to UTC conversions. They deliberately live outside
:mod:`allocation.read_model`, which imports ``zev``/``metering`` models:
model layers (``accounts``, ``tariffs``, ``zev``) need the predicates in
``clean()``/query code, and importing them from the read model would force
deferred imports to dodge app-loading cycles. This module depends only on
Django's ORM expressions and the stdlib, so every consumer imports it at
module level.
"""

from datetime import date, datetime, timedelta, timezone

from django.db import models


def active_during(queryset, start: date, end: date):
    """Rows with ``valid_from <= end`` and (``valid_to`` null or ``>= start``)."""
    return queryset.filter(valid_from__lte=end).filter(
        models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=start)
    )


def active_on(queryset, day: date):
    """Rows active on exactly ``day``."""
    return active_during(queryset, day, day)


def period_start_dt(day: date) -> datetime:
    """Inclusive UTC lower bound for a civil date."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def period_end_exclusive_dt(day: date) -> datetime:
    """Exclusive UTC upper bound for a civil date."""
    return period_start_dt(day) + timedelta(days=1)


def period_window(period_start: date, period_end: date) -> tuple[datetime, datetime]:
    """UTC bounds for a civil-date period: [start 00:00, end+1d 00:00).

    Use the half-open helpers above for one-sided ranges. Never use
    ``timestamp__date__`` lookups: they convert to Europe/Zurich and drop
    late-evening UTC readings (ADR 0007).
    """
    return period_start_dt(period_start), period_end_exclusive_dt(period_end)
