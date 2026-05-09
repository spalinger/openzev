from django.urls import path

from .views import AuditEventDetailView, AuditEventListView


urlpatterns = [
    path("events/", AuditEventListView.as_view(), name="audit-event-list"),
    path("events/<uuid:pk>/", AuditEventDetailView.as_view(), name="audit-event-detail"),
]
