from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import BasePermission

from accounts.models import UserRole

from .models import AuditEvent
from .serializers import AuditEventFilterSerializer, AuditEventSerializer


class CanViewAuditEvents(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return request.user.is_admin or request.user.role == UserRole.ZEV_OWNER


class BaseAuditEventView:
    permission_classes = [CanViewAuditEvents]
    serializer_class = AuditEventSerializer

    def _base_queryset(self):
        queryset = AuditEvent.objects.select_related("actor_user", "zev")
        if self.request.user.is_admin:
            return queryset
        return queryset.filter(zev__owner=self.request.user)


class AuditEventListView(BaseAuditEventView, ListAPIView):
    def get_queryset(self):
        queryset = self._base_queryset()

        filter_serializer = AuditEventFilterSerializer(data=self.request.query_params)
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data

        if "actor_user" in filters:
            queryset = queryset.filter(actor_user_id=filters["actor_user"])
        if "zev" in filters:
            queryset = queryset.filter(zev_id=filters["zev"])
        if "action_category" in filters:
            queryset = queryset.filter(action_category=filters["action_category"])
        if "action_type" in filters:
            queryset = queryset.filter(action_type=filters["action_type"])
        if "target_type" in filters:
            queryset = queryset.filter(target_type=filters["target_type"])
        if "target_id" in filters:
            queryset = queryset.filter(target_id=filters["target_id"])
        if "status" in filters:
            queryset = queryset.filter(status=filters["status"])
        if "date_from" in filters:
            queryset = queryset.filter(created_at__date__gte=filters["date_from"])
        if "date_to" in filters:
            queryset = queryset.filter(created_at__date__lte=filters["date_to"])

        query = filters.get("q")
        if query:
            if not self.request.user.is_admin:
                raise PermissionDenied("Search is only available for admins in this version.")
            queryset = queryset.filter(
                Q(summary__icontains=query)
                | Q(target_display__icontains=query)
                | Q(action_type__icontains=query)
            )

        return queryset


class AuditEventDetailView(BaseAuditEventView, RetrieveAPIView):
    queryset = AuditEvent.objects.select_related("actor_user", "zev")

    def get_queryset(self):
        return self._base_queryset()
