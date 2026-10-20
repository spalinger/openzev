from rest_framework.permissions import SAFE_METHODS, BasePermission

from .authentication import NOT_WHILE_IMPERSONATING, audit_impersonation_refusal
from .jwt_utils import impersonator_of


class NotWhileImpersonating(BasePermission):
    """Refuse credential writes except the view's impersonation_exempt_actions."""

    message = NOT_WHILE_IMPERSONATING["detail"]

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS or impersonator_of(request.auth) is None:
            return True
        exempt = getattr(view, "impersonation_exempt_actions", ())
        if getattr(view, "action", None) in exempt:
            return True
        audit_impersonation_refusal(request, request.user)
        return False


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_admin


class HasZevAccess(BasePermission):
    """The account may view (safe methods) or manage (unsafe ones) some ZEV.

    A coarse gate only: which ZEV is decided by the scoped queryset or an
    explicit ``zev.access.can_manage`` / ``can_view`` check in the view. A view
    may list read-only POST actions in ``viewer_allowed_actions``.
    """

    def has_permission(self, request, view):
        from zev import access

        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_admin:
            return True
        reads = self.only_reads(request, view)
        return bool(access.viewable_zev_ids(user) if reads else access.managed_zev_ids(user))

    def only_reads(self, request, view) -> bool:
        return request.method in SAFE_METHODS or getattr(view, "action", None) in getattr(
            view, "viewer_allowed_actions", ()
        )


class HasZevReadAccess(HasZevAccess):
    """``HasZevAccess`` for an endpoint whose every request only reads, whatever
    its method — the MCP endpoint, which is POST-only but read-only (ADR 0025)."""

    def only_reads(self, request, view) -> bool:
        return True
