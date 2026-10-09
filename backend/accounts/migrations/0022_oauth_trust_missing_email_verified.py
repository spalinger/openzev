from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0021_collapse_user_role")]

    operations = [
        migrations.AddField(
            model_name="oauthprovider",
            name="trust_missing_email_verified",
            field=models.BooleanField(
                default=False,
                help_text="Only for trusted providers that verify email ownership but omit email_verified.",
            ),
        ),
    ]
