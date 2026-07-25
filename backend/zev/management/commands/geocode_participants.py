"""
Django management command: python manage.py geocode_participants

Warms the geocoding cache for every participant that has an address but
hasn't been geocoded yet — e.g. participants created before this feature
existed, or ones whose owner-setup bootstrap bypassed the usual API path.

Calls Nominatim sequentially (one request at a time) rather than enqueuing
Celery tasks in a burst, to respect its public usage policy.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from zev.geocoding import warm_geocode_cache
from zev.models import Participant


class Command(BaseCommand):
    help = "Warm the geocoding cache for participants with an address that hasn't been geocoded yet."

    def handle(self, *args, **options):
        participants = Participant.objects.exclude(address_line1="").exclude(city="")

        geocoded = 0
        for participant in participants:
            warm_geocode_cache(participant.address_line1, participant.postal_code, participant.city)
            geocoded += 1

        self.stdout.write(self.style.SUCCESS(f"Warmed geocoding cache for {geocoded} participant address(es)."))
