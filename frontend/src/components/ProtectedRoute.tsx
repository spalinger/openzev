import type { ReactElement } from 'react'
import { matchPath, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth'
import { useCommunityAccess, type ShellRole } from '../lib/communityAccess'

export function ProtectedRoute({
    children,
    allowedRoles,
    allowUnlinked = false,
}: {
    children: ReactElement
    /** Shell roles for the selected community that may open the route (#761). */
    allowedRoles?: ShellRole[]
    /** Auth-only wrapper before the community provider resolves the selected relation. */
    allowUnlinked?: boolean
}) {
    const { t } = useTranslation()
    const { isAuthenticated, isLoading, user, isImpersonating } = useAuth()
    const { shellRole } = useCommunityAccess()
    const location = useLocation()

    if (isLoading) {
        return <div className="center-screen">{t('common.loading')}</div>
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    const isAccountPath = matchPath('/account', location.pathname) != null

    if (user?.must_change_password && !isImpersonating && !isAccountPath) {
        return <Navigate to="/account" replace state={{ forcePasswordChange: true }} />
    }

    if (!allowUnlinked && shellRole === 'none' && location.pathname !== '/' && !isAccountPath) {
        return <Navigate to="/" replace />
    }

    if (allowedRoles && (!user || !allowedRoles.includes(shellRole))) {
        return <Navigate to="/" replace />
    }

    return children
}
