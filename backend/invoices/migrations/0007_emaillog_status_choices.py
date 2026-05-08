from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0006_participant_cascade_delete"),
    ]

    operations = [
        migrations.AlterField(
            model_name="emaillog",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("sent", "Sent"),
                    ("failed", "Failed"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]
