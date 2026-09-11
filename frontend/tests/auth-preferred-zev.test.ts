import { createRoot } from 'react-dom/client'
import { act, createElement, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/lib/auth'
import type { User } from '../src/types/api'

const apiAuth = vi.hoisted(() => ({
    fetchMe: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
}))

vi.mock('../src/lib/api/auth', () => ({
    fetchMe: apiAuth.fetchMe,
    impersonateParticipant: vi.fn(),
    login: vi.fn(),
    logout: apiAuth.logout,
    stopImpersonation: vi.fn(),
    updateProfile: apiAuth.updateProfile,
}))

const baseUser = (preferredZev: string | null): User => ({
    id: 1,
    username: 'owner1',
    email: 'owner1@example.com',
    first_name: 'Owner',
    last_name: 'One',
    role: 'zev_owner',
    must_change_password: false,
    preferred_zev: preferredZev,
})

describe('AuthProvider.updatePreferredZev serialization', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>

    beforeEach(() => {
        apiAuth.fetchMe.mockReset()
        apiAuth.logout.mockReset()
        apiAuth.updateProfile.mockReset()
        apiAuth.fetchMe.mockResolvedValue(baseUser(null))
        apiAuth.logout.mockResolvedValue(undefined)
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => {
            root.unmount()
        })
        container.remove()
    })

    function renderProvider() {
        const latest = { current: null as ReturnType<typeof useAuth> | null }

        function Harness() {
            const context = useAuth()
            useEffect(() => {
                latest.current = context
            }, [context])
            return null
        }

        act(() => {
            root.render(createElement(AuthProvider, null, createElement(Harness)))
        })

        return latest
    }

    async function flush() {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }

    it('persists rapid selections in order so the latest choice wins', async () => {
        const latest = renderProvider()
        await flush()
        expect(latest.current?.user?.preferred_zev).toBeNull()

        let resolveB!: (value: User) => void
        let resolveC!: (value: User) => void
        apiAuth.updateProfile
            .mockImplementationOnce(() => new Promise<User>((resolve) => { resolveB = resolve }))
            .mockImplementationOnce(() => new Promise<User>((resolve) => { resolveC = resolve }))

        let saveB!: Promise<void>
        let saveC!: Promise<void>
        act(() => {
            saveB = latest.current!.updatePreferredZev('zB')
            saveC = latest.current!.updatePreferredZev('zC')
        })

        // The second PATCH waits for the first: only one request in flight.
        await flush()
        expect(apiAuth.updateProfile).toHaveBeenCalledTimes(1)
        expect(apiAuth.updateProfile).toHaveBeenLastCalledWith({ preferred_zev: 'zB' })

        await act(async () => {
            resolveB(baseUser('zB'))
            await saveB
            await new Promise((resolve) => setTimeout(resolve, 0))
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(apiAuth.updateProfile).toHaveBeenCalledTimes(2)
        expect(apiAuth.updateProfile).toHaveBeenLastCalledWith({ preferred_zev: 'zC' })
        // The superseded response must not clobber the newer save.
        expect(latest.current?.user?.preferred_zev).toBeNull()

        await act(async () => {
            resolveC(baseUser('zC'))
            await saveC
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(latest.current?.user?.preferred_zev).toBe('zC')
    })

    it('a logout in flight drops the late response instead of resurrecting state', async () => {
        const latest = renderProvider()
        await flush()

        let resolveSave!: (value: User) => void
        apiAuth.updateProfile.mockImplementationOnce(
            () => new Promise<User>((resolve) => { resolveSave = resolve }),
        )

        let save!: Promise<void>
        act(() => {
            save = latest.current!.updatePreferredZev('zB')
        })
        // Let the chained PATCH dispatch while the session is still current.
        await flush()
        expect(apiAuth.updateProfile).toHaveBeenCalledTimes(1)

        act(() => {
            latest.current!.logout()
        })

        await act(async () => {
            resolveSave(baseUser('zB'))
            await save.catch(() => undefined)
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(latest.current?.user).toBeNull()
    })

    it('a logout before the first save resolves cancels the queued second PATCH', async () => {
        const latest = renderProvider()
        await flush()

        let resolveB!: (value: User) => void
        apiAuth.updateProfile.mockImplementationOnce(
            () => new Promise<User>((resolve) => { resolveB = resolve }),
        )

        let saveB!: Promise<void>
        let saveC!: Promise<void>
        act(() => {
            saveB = latest.current!.updatePreferredZev('zB')
            saveC = latest.current!.updatePreferredZev('zC')
        })
        // The first PATCH dispatches while the session is still current …
        await flush()
        expect(apiAuth.updateProfile).toHaveBeenCalledTimes(1)

        // … then the user logs out while it is pending.
        act(() => {
            latest.current!.logout()
        })

        await act(async () => {
            resolveB(baseUser('zB'))
            await saveB.catch(() => undefined)
            await saveC.catch(() => undefined)
            await new Promise((resolve) => setTimeout(resolve, 0))
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        // The queued save must never dispatch under the next session's cookies.
        expect(apiAuth.updateProfile).toHaveBeenCalledTimes(1)
        expect(latest.current?.user).toBeNull()
    })
})
