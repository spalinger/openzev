from rest_framework import serializers
from .models import MeterReading, ImportLog, QuarantinedReading
from .deletion import protection_code


class MeterReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeterReading
        fields = "__all__"
        read_only_fields = tuple(field.name for field in MeterReading._meta.fields)


class QuarantinedReadingSerializer(serializers.ModelSerializer):
    """Held observations with provenance and the accepted value, if any."""

    meter_id = serializers.CharField(source="metering_point.meter_id", read_only=True)
    accepted_energy_kwh = serializers.DecimalField(
        max_digits=12, decimal_places=4, read_only=True, allow_null=True
    )

    class Meta:
        model = QuarantinedReading
        fields = (
            "id",
            "metering_point",
            "meter_id",
            "timestamp",
            "direction",
            "energy_kwh",
            "resolution",
            "condition",
            "business_reason",
            "import_source",
            "import_batch",
            "source_document_id",
            "source_delivery_id",
            "source_creation",
            "source_product",
            "source_unit",
            "source_meter_id",
            "created_at",
            "accepted_energy_kwh",
        )
        read_only_fields = fields


class ImportLogListSerializer(serializers.ModelSerializer):
    zev_name = serializers.CharField(source="zev.name", read_only=True, allow_null=True)
    imported_by_display = serializers.SerializerMethodField()
    deletable = serializers.SerializerMethodField()
    deletion_protection_code = serializers.SerializerMethodField()

    class Meta:
        model = ImportLog
        exclude = ["reading_changes"]
        read_only_fields = tuple(field.name for field in ImportLog._meta.fields)

    def get_imported_by_display(self, obj):
        user = obj.imported_by
        if user is None:
            return None
        return user.get_full_name() or user.username or user.email or None

    def get_deletable(self, obj):
        return protection_code(obj) is None

    def get_deletion_protection_code(self, obj):
        return protection_code(obj)


class ImportLogSerializer(ImportLogListSerializer):
    class Meta(ImportLogListSerializer.Meta):
        exclude = None
        fields = "__all__"
