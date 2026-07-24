from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsZevOwnerOrAdmin
from zev.models import Zev

from .calculator import FeasibilityInput, ParticipantInput, compute_feasibility
from .prefill import build_prefill
from .serializers import (
    FeasibilityInputSerializer,
    FeasibilityPrefillSerializer,
    FeasibilityResultSerializer,
)


class FeasibilityCalculateView(APIView):
    """Stateless vZEV feasibility calculation.

    Not scoped to a specific ZEV — any authenticated user can run planning
    scenarios (e.g. a prospect evaluating whether to form a vZEV at all).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        input_serializer = FeasibilityInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        validated = dict(input_serializer.validated_data)
        validated["participants"] = tuple(
            ParticipantInput(**participant) for participant in validated["participants"]
        )

        inputs = FeasibilityInput(**validated)
        result = compute_feasibility(inputs)

        return Response(FeasibilityResultSerializer(result).data)


class FeasibilityPrefillView(APIView):
    """Best-effort prefill of calculator inputs from a real ZEV's
    participants and tariffs — see ``prefill.build_prefill`` for exactly
    what it can and can't determine. Scoped to the ZEV's owner (or an admin),
    unlike the calculate endpoint, since it exposes real participant names
    and tariff figures.
    """

    permission_classes = [IsAuthenticated, IsZevOwnerOrAdmin]

    def get(self, request, zev_id, *args, **kwargs):
        zev = self._get_accessible_zev(zev_id)
        if zev is None:
            return Response({"detail": "ZEV not found or not accessible."}, status=status.HTTP_404_NOT_FOUND)

        prefill = build_prefill(zev)
        return Response(FeasibilityPrefillSerializer(prefill).data)

    def _get_accessible_zev(self, zev_id):
        user = self.request.user
        if user.is_admin:
            return Zev.objects.filter(id=zev_id).first()
        return Zev.objects.filter(id=zev_id, owner=user).first()
