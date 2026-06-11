"""
Shared role-based queryset scoping for ZEV-related viewsets.

Every ZEV-scoped viewset applies the same three-tier visibility rule:

- **admin** — sees everything
- **zev_owner** — sees objects belonging to ZEVs they own
- **participant** — sees only objects linked to their own participant record
  (or nothing, for owner-only resources such as tariffs)

Centralizing the rule makes the tenant-isolation logic auditable in one
place instead of being re-implemented per viewset.
"""


class ZevScopedQuerySetMixin:
    """Mixin for DRF viewsets that scopes querysets by user role.

    Class attributes:

    - ``zev_owner_filter``: ORM lookup path from the model to the owning
      user, e.g. ``"zev__owner"``.
    - ``participant_filter``: ORM lookup path from the model to the
      participant's user, e.g. ``"participant__user"``. ``None`` means
      participants get an empty queryset (owner-only resource).
    - ``participant_distinct``: set to ``True`` when the participant filter
      traverses a to-many relation and may produce duplicate rows.
    """

    zev_owner_filter: str
    participant_filter: str | None = None
    participant_distinct: bool = False

    def scope_queryset(self, qs):
        user = self.request.user
        if user.is_admin:
            return qs
        if user.is_zev_owner:
            return qs.filter(**{self.zev_owner_filter: user})
        if self.participant_filter is None:
            return qs.none()
        qs = qs.filter(**{self.participant_filter: user})
        if self.participant_distinct:
            qs = qs.distinct()
        return qs
