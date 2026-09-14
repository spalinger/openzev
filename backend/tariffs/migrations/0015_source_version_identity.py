from django.db import migrations, models


def reject_invalid_source_capabilities(apps, schema_editor):
    Source = apps.get_model("tariffs", "DynamicTariffSource")
    sources = Source.objects.using(schema_editor.connection.alias)
    invalid = list(
        sources.filter(request_mode="exact_url", supports_range=True)
        .values_list("pk", "url")[:10]
    )
    if invalid:
        details = ", ".join(f"{pk} ({url})" for pk, url in invalid)
        raise RuntimeError(
            "Cannot add exact-URL dynamic source capability constraint; "
            f"set supports_range=False for these sources first: {details}"
        )


class Migration(migrations.Migration):
    dependencies = [("tariffs", "0014_remove_dynamicpricepoint_dyn_price_source_from_idx_and_more")]

    operations = [
        migrations.RemoveConstraint(model_name="dynamictariffsource", name="unique_dynamic_tariff_source"),
        migrations.AlterField(
            model_name="dynamictariffsource", name="tariff_type",
            field=models.CharField(choices=[
                ("electricity", "Electricity supply"), ("grid", "Grid usage"),
                ("metering", "Metering"), ("national_fees", "National fees"),
                ("integrated", "Integrated supply and network"), ("dso", "DSO total"),
                ("dso_complete", "Complete DSO total"), ("integrated_complete", "Complete integrated total"),
                ("regional_fees", "Regional fees"), ("feed_in", "Feed-in remuneration"),
                ("refund", "Storage refund"),
            ], max_length=20),
        ),
        migrations.AddConstraint(
            model_name="dynamictariffsource",
            constraint=models.UniqueConstraint(fields=("url", "api_version", "tariff_type", "tariff_name"), name="unique_dynamic_tariff_source"),
        ),
        migrations.RunPython(reject_invalid_source_capabilities, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="dynamictariffsource",
            constraint=models.CheckConstraint(condition=~models.Q(request_mode="exact_url", supports_range=True), name="dynamic_exact_url_no_range"),
        ),
    ]
