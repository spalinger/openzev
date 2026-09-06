import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchZevs } from './api/zev'
import { queryKeys } from './api/queryKeys'
import { useAuth } from './auth'
import type { UserRole, Zev } from '../types/api'

interface ManagedZevContextValue {
    managedZevs: Zev[]
    selectedZevId: string
    selectedZev: Zev | null
    isSelectable: boolean
    isLoading: boolean
    setSelectedZevId: (zevId: string) => void
}

interface ManagedSelectionInput {
    role?: UserRole
    managedZevs: ReadonlyArray<Pick<Zev, 'id'>>
    /** Explicit in-session pick ('' while the user has not switched yet). */
    currentId: string
    /** Account-level default community (``User.preferred_zev``), if any. */
    preferredZevId?: string | null
}

interface ManagedSelection {
    /** User may switch between managed ZEVs. */
    isSelectable: boolean
    /** Reconciled selection: explicit pick if still managed, else account preference, else first managed ZEV. */
    selection: string
    /** Whether a user-initiated selection request targets a managed ZEV. */
    isAllowedId: (zevId: string) => boolean
}

/**
 * Admin: always switch. Owner: switch only with 2+ ZEVs. Else: no selection.
 * (No hooks, unit-testable.)
 */
export function resolveManagedSelection({
    role,
    managedZevs,
    currentId,
    preferredZevId = '',
}: ManagedSelectionInput): ManagedSelection {
    const isAdmin = role === 'admin'
    const isOwner = role === 'zev_owner'
    const canManage = isAdmin || isOwner
    const allowedIds = new Set(managedZevs.map((zev) => zev.id))
    const preferredId = preferredZevId ?? ''

    // Selection order: explicit pick (if still managed) → account preference
    // (if still managed) → first managed ZEV by name.
    const selection =
        canManage && managedZevs.length > 0
            ? (allowedIds.has(currentId)
                  ? currentId
                  : allowedIds.has(preferredId)
                    ? preferredId
                    : managedZevs[0].id)
            : ''

    return {
        isSelectable: isAdmin || (isOwner && managedZevs.length > 1),
        selection,
        isAllowedId: (zevId) => canManage && allowedIds.has(zevId),
    }
}

const ManagedZevContext = createContext<ManagedZevContextValue | undefined>(undefined)

export function ManagedZevProvider({ children }: { children: ReactNode }) {
    const { user, updatePreferredZev } = useAuth()
    const isAdmin = user?.role === 'admin'
    const isOwner = user?.role === 'zev_owner'
    const canManageZev = isAdmin || isOwner

    const zevsQuery = useQuery({
        queryKey: queryKeys.zev.list(),
        queryFn: fetchZevs,
        enabled: canManageZev,
    })

    const managedZevs = useMemo(() => {
        const allZevs = zevsQuery.data ?? []
        if (isAdmin) return allZevs
        if (isOwner && user) return allZevs.filter((zev) => zev.owner === user.id)
        return []
    }, [isAdmin, isOwner, user, zevsQuery.data])

    // Explicit in-session pick (null until the user switches). Reset on every
    // account change so one account's choice never leaks into another session.
    // Not persisted: the saved account preference follows the user instead.
    const [explicitPick, setExplicitPick] = useState<string | null>(null)
    const accountId = user?.id ?? null
    const lastAccountId = useRef<number | null>(accountId)
    if (lastAccountId.current !== accountId) {
        lastAccountId.current = accountId
        setExplicitPick(null)
    }

    const resolution = useMemo(
        () =>
            resolveManagedSelection({
                role: user?.role,
                managedZevs,
                currentId: explicitPick ?? '',
                preferredZevId: user?.preferred_zev ?? '',
            }),
        [user?.role, user?.preferred_zev, managedZevs, explicitPick],
    )

    const selectedZevId = resolution.selection
    const selectedZev = managedZevs.find((zev) => zev.id === selectedZevId) ?? null

    const value = useMemo<ManagedZevContextValue>(
        () => ({
            managedZevs,
            selectedZevId,
            selectedZev,
            isSelectable: resolution.isSelectable,
            isLoading: zevsQuery.isLoading,
            setSelectedZevId: (zevId: string) => {
                if (!resolution.isAllowedId(zevId)) return
                // Optimistic switch; the serialized account save follows. A
                // failed save keeps the local selection for this session.
                setExplicitPick(zevId)
                updatePreferredZev(zevId).catch(() => undefined)
            },
        }),
        [managedZevs, selectedZevId, selectedZev, resolution, zevsQuery.isLoading, updatePreferredZev],
    )

    return <ManagedZevContext.Provider value={value}>{children}</ManagedZevContext.Provider>
}

export function useManagedZev() {
    const context = useContext(ManagedZevContext)
    if (!context) {
        throw new Error('useManagedZev must be used within ManagedZevProvider')
    }
    return context
}
