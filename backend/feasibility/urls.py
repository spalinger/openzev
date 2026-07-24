from django.urls import path

from .views import FeasibilityCalculateView, FeasibilityPrefillView

urlpatterns = [
    path("calculate/", FeasibilityCalculateView.as_view(), name="feasibility-calculate"),
    path("prefill/<uuid:zev_id>/", FeasibilityPrefillView.as_view(), name="feasibility-prefill"),
]
