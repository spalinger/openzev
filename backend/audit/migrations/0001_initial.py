from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("zev", "0015_meter_id_unique"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor_role_snapshot", models.CharField(blank=True, default="", max_length=20)),
                ("actor_display", models.CharField(blank=True, default="", max_length=255)),
                (
                    "action_category",
                    models.CharField(
                        choices=[
                            ("auth", "Auth"),
                            ("governance", "Governance"),
                            ("participant", "Participant"),
                            ("metering", "Metering"),
                            ("tariff", "Tariff"),
                            ("invoice", "Invoice"),
                            ("import", "Import"),
                            ("template", "Template"),
                            ("system", "System"),
                        ],
                        max_length=40,
                    ),
                ),
                ("action_type", models.CharField(max_length=80)),
                ("target_type", models.CharField(max_length=120)),
                ("target_id", models.CharField(blank=True, default="", max_length=64)),
                ("target_display", models.CharField(blank=True, default="", max_length=255)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("started", "Started"),
                            ("queued", "Queued"),
                            ("success", "Success"),
                            ("failed", "Failed"),
                            ("denied", "Denied"),
                        ],
                        default="success",
                        max_length=20,
                    ),
                ),
                ("request_id", models.CharField(blank=True, max_length=64, null=True)),
                ("correlation_id", models.CharField(blank=True, max_length=64, null=True)),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("api", "API"),
                            ("celery", "Celery"),
                            ("system", "System"),
                            ("management_command", "Management command"),
                        ],
                        default="api",
                        max_length=20,
                    ),
                ),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True, default="")),
                ("summary", models.CharField(max_length=500)),
                ("reason", models.TextField(blank=True, default="")),
                ("changes_json", models.JSONField(blank=True, default=dict)),
                ("metadata_json", models.JSONField(blank=True, default=dict)),
                (
                    "actor_user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="audit_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "zev",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="audit_events",
                        to="zev.zev",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["created_at"], name="audit_evt_created_idx"),
                    models.Index(fields=["zev", "created_at"], name="audit_evt_zev_created_idx"),
                    models.Index(fields=["actor_user", "created_at"], name="audit_evt_actor_created_idx"),
                    models.Index(fields=["action_category", "created_at"], name="audit_evt_actcat_created_idx"),
                    models.Index(fields=["target_type", "target_id", "created_at"], name="audit_evt_target_lookup_idx"),
                    models.Index(fields=["status", "created_at"], name="audit_evt_status_created_idx"),
                ],
            },
        ),
    ]
