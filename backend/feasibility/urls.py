from django.urls import path

from .views import FeasibilityCalculateView

urlpatterns = [
    path("calculate/", FeasibilityCalculateView.as_view(), name="feasibility-calculate"),
]
