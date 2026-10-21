from django.contrib import admin
from django.db import transaction
from .models import Building, Zev, Participant, Party, MeteringPoint, MeteringPointAssignment, ZevAccessGrant


class ParticipantInline(admin.TabularInline):
    model = Participant
    extra = 0
    show_change_link = True
    fields = ("party", "valid_from", "valid_to", "allocation_weight")
    raw_id_fields = ("party",)


class MeteringPointAssignmentInline(admin.TabularInline):
    model = MeteringPointAssignment
    extra = 0
    fields = ("metering_point", "valid_from", "valid_to", "allocation_mode")
    autocomplete_fields = ("metering_point",)


@admin.register(Zev)
class ZevAdmin(admin.ModelAdmin):
    list_display = ("name", "zev_type", "billing_interval", "disabled_at")
    list_filter = ("zev_type", "billing_interval", "disabled_at")
    search_fields = ("name", "grid_operator")
    inlines = [ParticipantInline]


@admin.register(Party)
class PartyAdmin(admin.ModelAdmin):
    list_display = ("display_name", "kind", "zev", "email", "city")
    list_filter = ("kind", "zev")
    search_fields = ("organisation_name", "first_name", "last_name", "email")


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("full_name", "zev", "email", "valid_from", "valid_to")
    list_filter = ("zev",)
    search_fields = ("party__organisation_name", "party__first_name", "party__last_name", "party__email")
    raw_id_fields = ("party", "user")
    inlines = [MeteringPointAssignmentInline]


@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ("name", "zev", "postal_code", "city", "egid")
    list_filter = ("zev",)
    search_fields = ("name", "address_line1", "city")


@admin.register(MeteringPoint)
class MeteringPointAdmin(admin.ModelAdmin):
    list_display = ("meter_id", "zev", "building", "meter_type", "is_active")
    list_filter = ("meter_type", "is_active")
    search_fields = ("meter_id",)
    # Every ZEV's buildings in one select would invite picking another ZEV's.
    raw_id_fields = ("building",)

    def get_actions(self, request):
        actions = super().get_actions(request)
        actions.pop("delete_selected", None)
        return actions

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and (
            obj is None or not obj.has_reading_history()
        )

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.has_reading_history():
            return ("zev", "meter_type")
        return ()

    @transaction.atomic
    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        if request.method == "POST":
            from .locks import lock_meter_identities

            lock_meter_identities()
        return super().changeform_view(request, object_id, form_url, extra_context)


@admin.register(ZevAccessGrant)
class ZevAccessGrantAdmin(admin.ModelAdmin):
    list_display = ("zev", "user", "role", "valid_from", "valid_to", "granted_by")
    list_filter = ("role",)
    search_fields = ("zev__name", "user__email", "user__username")
    raw_id_fields = ("user", "granted_by")

    def get_readonly_fields(self, request, obj=None):
        return ("zev", "user") if obj is not None else ()
