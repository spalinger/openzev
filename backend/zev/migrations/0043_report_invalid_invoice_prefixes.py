import re

from django.db import migrations


_PATTERN = re.compile(r"^[A-Z0-9-]{1,10}$")


def report_invalid_prefixes(apps, schema_editor):
    Zev = apps.get_model("zev", "Zev")
    qs = Zev.objects.using(schema_editor.connection.alias).only("id", "name", "invoice_prefix").iterator()
    for zev in qs:
        if not _PATTERN.fullmatch(zev.invoice_prefix):
            print(
                f"ZEV {zev.id} ({zev.name}) has legacy invoice_prefix {zev.invoice_prefix!r}; "
                "it was not rewritten. Update it through the admin API before the next invoice."
            )


class Migration(migrations.Migration):
    dependencies = [("zev", "0042_meteringpoint_building_required")]
    operations = [migrations.RunPython(report_invalid_prefixes, migrations.RunPython.noop)]
