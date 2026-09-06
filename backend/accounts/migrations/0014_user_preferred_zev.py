import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_magiclinktoken"),
        ("zev", "0023_zev_itemize_tariff_bands"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="preferred_zev",
            field=models.ForeignKey(
                blank=True,
                help_text="Default community (ZEV) opened for this user.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="zev.zev",
            ),
        ),
    ]
