from rest_framework import serializers
from .models import MeterReading, ImportLog
from .deletion import protection_code


class MeterReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeterReading
        fields = "__all__"
        read_only_fields = tuple(field.name for field in MeterReading._meta.fields)


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
