from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .calculator import FeasibilityInput, compute_feasibility
from .serializers import FeasibilityInputSerializer, FeasibilityResultSerializer


class FeasibilityCalculateView(APIView):
    """Stateless vZEV feasibility calculation.

    Not scoped to a specific ZEV — any authenticated user can run planning
    scenarios (e.g. a prospect evaluating whether to form a vZEV at all).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        input_serializer = FeasibilityInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        inputs = FeasibilityInput(**input_serializer.validated_data)
        result = compute_feasibility(inputs)

        return Response(FeasibilityResultSerializer(result).data)
