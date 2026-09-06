import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchMe, impersonateParticipant as impersonateParticipantRequest, login as loginRequest, logout as logoutRequest, stopImpersonation as stopImpersonationRequest, updateProfile } from './api/auth'
import type { User } from '../types/api'

interface AuthContextValue {
    user: User | null
    isAuthenticated: boolean
    isLoading: boolean
    isImpersonating: boolean
    impersonator: User | null
    login: (email: string, password: string) => Promise<User>
    refreshUser: () => Promise<User>
    /** Persist the account's default community and refresh the cached user. */
    updatePreferredZev: (zevId: string | null) => Promise<void>
    startImpersonation: (participantUserId: number) => Promise<void>
    stopImpersonation: () => Promise<void>
    logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Serializes preference saves per user: each PATCH waits for the previous
    // one, and only the latest save for the current user merges its response.
    const prefSaveRef = useRef<{ userId: number | null; seq: number; tail: Promise<unknown> }>({
        userId: null,
        seq: 0,
        tail: Promise.resolve(),
    })

    // Drops queued and in-flight preference saves: call at the start of every
    // session transition so a save queued under one account can never dispatch
    // its PATCH (or merge its response) under the next account's cookies.
    function invalidatePrefSaves() {
        prefSaveRef.current = { userId: null, seq: 0, tail: Promise.resolve() }
    }

    async function loadCurrentUser() {
        const me = await fetchMe()
        setUser(me)
        return me
    }

    useEffect(() => {
        void loadCurrentUser()
            .catch(() => {
                setUser(null)
            })
            .finally(() => setIsLoading(false))
    }, [])

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            isAuthenticated: Boolean(user),
            isLoading,
            isImpersonating: Boolean(user?.impersonated_by),
            impersonator: user?.impersonated_by ?? null,
            async login(email: string, password: string) {
                invalidatePrefSaves()
                await loginRequest(email, password)
                return loadCurrentUser()
            },
            refreshUser() {
                return loadCurrentUser()
            },
            async updatePreferredZev(zevId: string | null) {
                const callerId = user?.id ?? null
                const slot = prefSaveRef.current
                if (slot.userId !== callerId) {
                    slot.userId = callerId
                    slot.seq = 0
                }
                const mySeq = (slot.seq += 1)
                const run = slot.tail
                    .catch(() => undefined)
                    .then(() =>
                        // Dispatch guard: the session may have turned over while
                        // queued. Never issue a PATCH under the next account's
                        // cookies. Skipped saves resolve null, which the merge
                        // below already ignores.
                        prefSaveRef.current !== slot ? null : updateProfile({ preferred_zev: zevId }),
                    )
                // Keep the chain alive for later saves even when this one fails.
                slot.tail = run.catch(() => undefined)
                const me = await run
                // Drop late responses from a superseded save, account switch, or logout.
                const latest = prefSaveRef.current
                if (latest.userId !== callerId || latest.seq !== mySeq) return
                setUser((current) =>
                    current && me && current.id === me.id
                        ? { ...current, preferred_zev: me.preferred_zev }
                        : current,
                )
            },
            async startImpersonation(participantUserId: number) {
                if (!user || user.role !== 'admin') {
                    throw new Error('Only admins can impersonate participants.')
                }
                invalidatePrefSaves()
                await impersonateParticipantRequest(participantUserId)
                await loadCurrentUser()
            },
            async stopImpersonation() {
                invalidatePrefSaves()
                await stopImpersonationRequest()
                await loadCurrentUser()
            },
            logout() {
                invalidatePrefSaves()
                void logoutRequest().catch(() => undefined)
                setUser(null)
            },
        }),
        [isLoading, user],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider')
    }
    return context
}
