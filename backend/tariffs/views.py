from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from accounts.permissions import IsZevOwnerOrAdmin
from zev.models import Zev
from .models import Tariff, TariffPeriod
from .serializers import TariffSerializer, TariffPeriodSerializer
from audit.models import AuditActionCategory, AuditEventStatus
from audit.services import build_diff, record_audit_event


def _record_tariff_event(
    *,
    request,
    action_type: str,
    target_type: str,
    summary: str,
    target=None,
    target_id: str = "",
    target_display: str = "",
    status: str = AuditEventStatus.SUCCESS,
    changes: dict | None = None,
    metadata: dict | None = None,
):
    record_audit_event(
        request=request,
        action_category=AuditActionCategory.TARIFF,
        action_type=action_type,
        target_type=target_type,
        target=target,
        target_id=target_id,
        target_display=target_display,
        summary=summary,
        status=status,
        changes=changes,
        metadata=metadata,
    )


class TariffViewSet(viewsets.ModelViewSet):
    serializer_class = TariffSerializer
    permission_classes = [IsAuthenticated, IsZevOwnerOrAdmin]

    def get_queryset(self):
        user = self.request.user
        if user.is_admin:
            return Tariff.objects.all()
        return Tariff.objects.filter(zev__owner=user)

    def perform_create(self, serializer):
        tariff = serializer.save()
        _record_tariff_event(
            request=self.request,
            action_type="tariff.create",
            target_type="tariffs.Tariff",
            target=tariff,
            target_id=str(tariff.pk),
            target_display=tariff.name,
            summary=f"Created tariff {tariff.name}.",
            metadata={"zev_id": str(tariff.zev_id), "category": tariff.category},
        )

    def perform_update(self, serializer):
        tariff = self.get_object()
        before = {
            "name": tariff.name,
            "category": tariff.category,
            "billing_mode": tariff.billing_mode,
            "energy_type": tariff.energy_type,
            "valid_from": tariff.valid_from,
            "valid_to": tariff.valid_to,
        }
        tariff = serializer.save()
        after = {
            "name": tariff.name,
            "category": tariff.category,
            "billing_mode": tariff.billing_mode,
            "energy_type": tariff.energy_type,
            "valid_from": tariff.valid_from,
            "valid_to": tariff.valid_to,
        }
        _record_tariff_event(
            request=self.request,
            action_type="tariff.update",
            target_type="tariffs.Tariff",
            target=tariff,
            target_id=str(tariff.pk),
            target_display=tariff.name,
            summary=f"Updated tariff {tariff.name}.",
            changes=build_diff(
                before,
                after,
                ["name", "category", "billing_mode", "energy_type", "valid_from", "valid_to"],
            ),
        )

    def perform_destroy(self, instance):
        tariff_id = str(instance.pk)
        name = instance.name
        zev_id = str(instance.zev_id)
        instance.delete()
        _record_tariff_event(
            request=self.request,
            action_type="tariff.delete",
            target_type="tariffs.Tariff",
            target_id=tariff_id,
            target_display=name,
            summary=f"Deleted tariff {name}.",
            metadata={"zev_id": zev_id},
        )

    def _get_accessible_zev(self, zev_id):
        user = self.request.user
        if user.is_admin:
            return Zev.objects.filter(id=zev_id).first()
        return Zev.objects.filter(id=zev_id, owner=user).first()

    def _serialize_tariff_preset(self, tariff):
        return {
            'name': tariff.name,
            'category': tariff.category,
            'billing_mode': tariff.billing_mode,
            'energy_type': tariff.energy_type,
            'fixed_price_chf': str(tariff.fixed_price_chf) if tariff.fixed_price_chf is not None else None,
            'percentage': str(tariff.percentage) if tariff.percentage is not None else None,
            'valid_from': tariff.valid_from.isoformat(),
            'valid_to': tariff.valid_to.isoformat() if tariff.valid_to else None,
            'notes': tariff.notes,
            'periods': [
                {
                    'period_type': period.period_type,
                    'price_chf_per_kwh': str(period.price_chf_per_kwh),
                    'time_from': period.time_from.isoformat() if period.time_from else None,
                    'time_to': period.time_to.isoformat() if period.time_to else None,
                    'weekdays': period.weekdays,
                }
                for period in tariff.periods.all()
            ],
        }

    @action(detail=False, methods=['get'], url_path='export')
    def export_tariffs(self, request):
        """Export all tariffs for a ZEV as JSON."""
        zev_id = request.query_params.get('zev_id')
        if not zev_id:
            _record_tariff_event(
                request=request,
                action_type="tariff.export",
                target_type="zev.Zev",
                summary="Tariff export failed: missing zev_id.",
                status=AuditEventStatus.FAILED,
            )
            return Response({'error': 'zev_id query parameter is required.'}, status=status.HTTP_400_BAD_REQUEST)

        zev = self._get_accessible_zev(zev_id)
        if not zev:
            _record_tariff_event(
                request=request,
                action_type="tariff.export",
                target_type="zev.Zev",
                target_id=str(zev_id),
                target_display=str(zev_id),
                summary="Tariff export failed: ZEV not accessible.",
                status=AuditEventStatus.FAILED,
            )
            return Response({'error': 'ZEV not found or not accessible.'}, status=status.HTTP_404_NOT_FOUND)

        tariffs = self.get_queryset().filter(zev_id=zev_id)
        if not tariffs.exists():
            return Response({'error': 'No tariffs found for this ZEV.'}, status=status.HTTP_404_NOT_FOUND)

        _record_tariff_event(
            request=request,
            action_type="tariff.export",
            target_type="zev.Zev",
            target=zev,
            target_id=str(zev.id),
            target_display=zev.name,
            summary=f"Exported {tariffs.count()} tariffs for ZEV {zev.name}.",
            metadata={"tariff_count": tariffs.count()},
        )

        return Response([self._serialize_tariff_preset(tariff) for tariff in tariffs])

    @action(detail=False, methods=['post'], url_path='import')
    def import_tariffs(self, request):
        """Import tariffs and periods from JSON data."""
        zev_id = request.data.get('zev_id')
        tariffs_data = request.data.get('tariffs', [])

        if not zev_id:
            _record_tariff_event(
                request=request,
                action_type="tariff.import",
                target_type="zev.Zev",
                summary="Tariff import failed: missing zev_id.",
                status=AuditEventStatus.FAILED,
            )
            return Response({'error': 'zev_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not tariffs_data:
            _record_tariff_event(
                request=request,
                action_type="tariff.import",
                target_type="zev.Zev",
                target_id=str(zev_id),
                target_display=str(zev_id),
                summary="Tariff import failed: missing tariffs payload.",
                status=AuditEventStatus.FAILED,
            )
            return Response({'error': 'tariffs array is required.'}, status=status.HTTP_400_BAD_REQUEST)

        zev = self._get_accessible_zev(zev_id)
        if not zev:
            _record_tariff_event(
                request=request,
                action_type="tariff.import",
                target_type="zev.Zev",
                target_id=str(zev_id),
                target_display=str(zev_id),
                summary="Tariff import failed: ZEV not accessible.",
                status=AuditEventStatus.FAILED,
            )
            return Response({'error': 'ZEV not found or not accessible.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            with transaction.atomic():
                created_tariffs = []
                for tariff_data in tariffs_data:
                    tariff_data = dict(tariff_data)
                    # Extract periods before creating tariff
                    periods_data = tariff_data.pop('periods', [])
                    tariff_data.pop('id', None)
                    tariff_data.pop('zev', None)
                    tariff_data.pop('created_at', None)
                    tariff_data.pop('updated_at', None)
                    # Set the ZEV ID
                    tariff_data['zev'] = str(zev.id)

                    # Create tariff
                    tariff_serializer = TariffSerializer(data=tariff_data)
                    if not tariff_serializer.is_valid():
                        raise Exception(f"Invalid tariff data: {tariff_serializer.errors}")
                    tariff = tariff_serializer.save()

                    # Create periods
                    for period_data in periods_data:
                        period_data = dict(period_data)
                        period_data.pop('id', None)
                        period_data.pop('tariff', None)
                        period_data['tariff'] = str(tariff.id)
                        period_serializer = TariffPeriodSerializer(data=period_data)
                        if not period_serializer.is_valid():
                            raise Exception(f"Invalid period data: {period_serializer.errors}")
                        period_serializer.save()

                    created_tariffs.append(tariff_serializer.data)

                _record_tariff_event(
                    request=request,
                    action_type="tariff.import",
                    target_type="zev.Zev",
                    target=zev,
                    target_id=str(zev.id),
                    target_display=zev.name,
                    summary=f"Imported {len(created_tariffs)} tariffs for ZEV {zev.name}.",
                    metadata={"created": len(created_tariffs)},
                )

                return Response(
                    {'created': len(created_tariffs), 'tariffs': created_tariffs},
                    status=status.HTTP_201_CREATED
                )

        except Exception as e:
            _record_tariff_event(
                request=request,
                action_type="tariff.import",
                target_type="zev.Zev",
                target=zev,
                target_id=str(zev.id),
                target_display=zev.name,
                summary=f"Tariff import failed for ZEV {zev.name}.",
                status=AuditEventStatus.FAILED,
                metadata={"error": str(e)},
            )
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class TariffPeriodViewSet(viewsets.ModelViewSet):
    serializer_class = TariffPeriodSerializer
    permission_classes = [IsAuthenticated, IsZevOwnerOrAdmin]

    def get_queryset(self):
        user = self.request.user
        if user.is_admin:
            return TariffPeriod.objects.all()
        return TariffPeriod.objects.filter(tariff__zev__owner=user)

    def perform_create(self, serializer):
        period = serializer.save()
        _record_tariff_event(
            request=self.request,
            action_type="tariff_period.create",
            target_type="tariffs.TariffPeriod",
            target=period,
            target_id=str(period.pk),
            target_display=period.period_type,
            summary=f"Created tariff period {period.period_type} for tariff {period.tariff.name}.",
            metadata={"tariff_id": str(period.tariff_id)},
        )

    def perform_update(self, serializer):
        period = self.get_object()
        before = {
            "period_type": period.period_type,
            "price_chf_per_kwh": period.price_chf_per_kwh,
            "time_from": period.time_from,
            "time_to": period.time_to,
            "weekdays": period.weekdays,
        }
        period = serializer.save()
        after = {
            "period_type": period.period_type,
            "price_chf_per_kwh": period.price_chf_per_kwh,
            "time_from": period.time_from,
            "time_to": period.time_to,
            "weekdays": period.weekdays,
        }
        _record_tariff_event(
            request=self.request,
            action_type="tariff_period.update",
            target_type="tariffs.TariffPeriod",
            target=period,
            target_id=str(period.pk),
            target_display=period.period_type,
            summary=f"Updated tariff period {period.period_type} for tariff {period.tariff.name}.",
            changes=build_diff(before, after, ["period_type", "price_chf_per_kwh", "time_from", "time_to", "weekdays"]),
        )

    def perform_destroy(self, instance):
        period_id = str(instance.pk)
        period_type = instance.period_type
        tariff_name = instance.tariff.name
        instance.delete()
        _record_tariff_event(
            request=self.request,
            action_type="tariff_period.delete",
            target_type="tariffs.TariffPeriod",
            target_id=period_id,
            target_display=period_type,
            summary=f"Deleted tariff period {period_type} for tariff {tariff_name}.",
        )
