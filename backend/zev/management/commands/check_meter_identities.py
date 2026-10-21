"""Report ambiguous IDs read-only so an operator can reconcile them through the API/admin."""

from django.core.management.base import BaseCommand, CommandError

from zev.models import find_ambiguous_meter_identities


class Command(BaseCommand):
    help = (
        "List meter identities claimed by more than one metering point "
        "(primary/secondary cross-column collisions) or redundantly by one "
        "(secondary ID equal to its own primary ID)."
    )

    def handle(self, *args, **options):
        found = find_ambiguous_meter_identities()
        if not found:
            self.stdout.write("No ambiguous meter identities.")
            return
        for entry in found:
            points = ", ".join(str(point_id) for point_id in entry["point_ids"])
            self.stdout.write(f"{entry['identity']} [{entry['kind']}]: {points}")
        raise CommandError(f"Found {len(found)} ambiguous identities. Reconcile the secondary IDs; nothing was changed.")
