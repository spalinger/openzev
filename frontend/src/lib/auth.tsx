import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchMe, impersonateParticipant as impersonateParticipantRequest, login as loginRequest, logout as logoutRequest, stopImpersonation as stopImpersonationRequest } from './api/auth'
import type { User } from '../types/api'

interface AuthContextValue {
    user: User | null
    isAuthenticated: boolean
    isLoading: boolean
    isImpersonating: boolean
    impersonator: User | null
    login: (email: string, password: string) => Promise<User>
    refreshUser: () => Promise<User>
    startImpersonation: (participantUserId: number) => Promise<void>
    stopImpersonation: () => Promise<void>
    logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [isLoading, setIsLoading] = useState(true)

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
                await loginRequest(email, password)
                return loadCurrentUser()
            },
            refreshUser() {
                return loadCurrentUser()
            },
            async startImpersonation(participantUserId: number) {
                if (!user || user.role !== 'admin') {
                    throw new Error('Only admins can impersonate participants.')
                }
                await impersonateParticipantRequest(participantUserId)
                await loadCurrentUser()
            },
            async stopImpersonation() {
                await stopImpersonationRequest()
                await loadCurrentUser()
            },
            logout() {
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
