import { createRoot } from 'react-dom/client'
import { act, createElement, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchZevs } from '../src/lib/api/zev'
import { ManagedZevProvider, resolveManagedSelection, useManagedZev } from '../src/lib/managedZev'
import type { User, UserRole, Zev } from '../src/types/api'

type IdOnly = Pick<Zev, 'id'>

const zev = (id: string): IdOnly => ({ id })

describe('resolveManagedSelection — admin', () => {
    it('is always selectable and can pick any managed ZEV', () => {
        const resolution = resolveManagedSelection({
            role: 'admin',
            managedZevs: [zev('z1'), zev('z2')],
            currentId: 'z1',
        })
        expect(resolution.isSelectable).toBe(true)
        expect(resolution.isAllowedId('z1')).toBe(true)
        expect(resolution.isAllowedId('z2')).toBe(true)
    })

    it('keeps the current selection while it exists', () => {
        const resolution = resolveManagedSelection({
            role: 'admin',
            managedZevs: [zev('z1'), zev('z2')],
            currentId: 'z2',
        })
        expect(resolution.selection).toBe('z2')
    })

    it('falls back to the first ZEV when the stored id is stale', () => {
        const resolution = resolveManagedSelection({
            role: 'admin',
            managedZevs: [zev('z1'), zev('z2')],
            currentId: 'deleted-zev',
        })
        expect(resolution.selection).toBe('z1')
        expect(resolution.isAllowedId('deleted-zev')).toBe(false)
    })

    it('uses the account preference instead of the first-by-name ZEV', () => {
        const resolution = resolveManagedSelection({
            role: 'admin',
            managedZevs: [zev('z1'), zev('z2')],
            currentId: '',
            preferredZevId: 'z2',
        })
        expect(resolution.selection).toBe('z2')
    })

    it('ignores a preference for a ZEV that is no longer managed', () => {
        const resolution = resolveManagedSelection({
            role: 'admin',
            managedZevs: [zev('z1')],
            currentId: '',
            preferredZevId: 'transferred-away',
        })
        expect(resolution.selection).toBe('z1')
    })
})

describe('resolveManagedSelection — zev_owner', () => {
    it('pins a single owned ZEV and is not selectable', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own')],
            currentId: '',
        })
        expect(resolution.isSelectable).toBe(false)
        expect(resolution.selection).toBe('own')
        expect(resolution.isAllowedId('own')).toBe(true)
    })

    it('an owner with more than one ZEV can switch among them', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: 'own1',
        })
        expect(resolution.isSelectable).toBe(true)
        expect(resolution.isAllowedId('own1')).toBe(true)
        expect(resolution.isAllowedId('own2')).toBe(true)
        expect(resolution.selection).toBe('own1')
    })

    it('falls back to the first owned ZEV when nothing is stored yet', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: '',
        })
        expect(resolution.isSelectable).toBe(true)
        expect(resolution.selection).toBe('own1')
    })

    it('rejects a selection that is not one of the owned ZEVs', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: 'own1',
        })
        expect(resolution.isAllowedId('someone-elses-zev')).toBe(false)
    })

    it('keeps an owned selection instead of re-pinning to the first entry', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: 'own2',
        })
        expect(resolution.selection).toBe('own2')
    })

    it('prefers the explicit in-session pick over the account preference', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: 'own2',
            preferredZevId: 'own1',
        })
        expect(resolution.selection).toBe('own2')
    })

    it('lands on the account preference when nothing is picked yet', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('own1'), zev('own2')],
            currentId: '',
            preferredZevId: 'own2',
        })
        expect(resolution.selection).toBe('own2')
    })

    it('falls back to the first owned ZEV when the stored id is stale', () => {
        const resolution = resolveManagedSelection({
            role: 'zev_owner',
            managedZevs: [zev('taken-over-1'), zev('taken-over-2')],
            currentId: 'transferred-away',
        })
        expect(resolution.isSelectable).toBe(true)
        expect(resolution.selection).toBe('taken-over-1')
        expect(resolution.isAllowedId('transferred-away')).toBe(false)
    })
})

describe('resolveManagedSelection — roles without management scope', () => {
    it.each(['participant', 'guest'] as const)('%s gets neither selection nor switching', (role) => {
        const resolution = resolveManagedSelection({
            role,
            managedZevs: [zev('z1')],
            currentId: 'z1',
        })
        expect(resolution.isSelectable).toBe(false)
        expect(resolution.selection).toBe('')
        expect(resolution.isAllowedId('z1')).toBe(false)
    })
})

describe('resolveManagedSelection — missing data', () => {
    it('selects nothing before the user or the list is loaded', () => {
        const resolution = resolveManagedSelection({
            role: undefined,
            managedZevs: [],
            currentId: '',
        })
        expect(resolution.isSelectable).toBe(false)
        expect(resolution.selection).toBe('')
        expect(resolution.isAllowedId('z1')).toBe(false)
    })
})

/**
 * Provider-level coverage the pure helper cannot exercise: preference-first
 * selection, optimistic picks, failed-save tolerance, and account-switch
 * isolation (no cross-account leakage; no browser storage is consulted).
 */

const authState = vi.hoisted(() => ({ current: null as User | null }))
const updatePreferredZev = vi.hoisted(() => vi.fn<(zevId: string | null) => Promise<void>>())

vi.mock('../src/lib/auth', () => ({
    useAuth: () => ({ user: authState.current, updatePreferredZev }),
}))

vi.mock('../src/lib/api/zev', () => ({
    fetchZevs: vi.fn(),
}))

const fullZev = (id: string, owner: number): Zev => ({
    id,
    name: id,
    start_date: '2026-01-01',
    owner,
    zev_type: 'zev',
    grid_operator: 'op',
    billing_interval: 'monthly',
})

const userWithRole = (role: UserRole): User => ({
    id: 1,
    username: 'owner1',
    email: 'owner1@example.com',
    first_name: 'Owner',
    last_name: 'One',
    role,
    must_change_password: false,
    preferred_zev: null,
})

const adminUser = (id: number, preferredZev: string | null): User => ({
    id,
    username: `admin${id}`,
    email: `admin${id}@example.com`,
    first_name: 'Admin',
    last_name: `${id}`,
    role: 'admin',
    must_change_password: false,
    preferred_zev: preferredZev,
})

describe('ManagedZevProvider selection persistence', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>
    let resolveFetch: ((value: Zev[]) => void) | undefined

    beforeEach(() => {
        authState.current = null
        resolveFetch = undefined
        vi.mocked(fetchZevs).mockReset()
        vi.mocked(updatePreferredZev).mockReset()
        vi.mocked(updatePreferredZev).mockResolvedValue(undefined)
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
        const latest = { current: null as ReturnType<typeof useManagedZev> | null }

        function Harness() {
            const context = useManagedZev()
            useEffect(() => {
                latest.current = context
            }, [context])
            return null
        }

        function render() {
            act(() => {
                root.render(
                    createElement(
                        QueryClientProvider,
                        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
                        createElement(ManagedZevProvider, null, createElement(Harness)),
                    ),
                )
            })
        }

        render()
        return { latest, rerender: render }
    }

    function deferFetch() {
        vi.mocked(fetchZevs).mockImplementation(
            () => new Promise<Zev[]>((resolve) => { resolveFetch = resolve }),
        )
    }

    /**
     * Resolves the pending ZEV fetch and lets the react-query update land.
     * The observer update is delivered on a later scheduler tick, so a plain
     * microtask flush inside act is not enough — give it a timer tick.
     */
    function resolveTwoZevs() {
        return act(async () => {
            resolveFetch?.([fullZev('own1', 1), fullZev('own2', 1)])
            await new Promise((resolve) => setTimeout(resolve, 0))
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }

    it('selects nothing while the list is loading, then lands on the account preference', async () => {
        authState.current = { ...userWithRole('zev_owner'), preferred_zev: 'own2' }
        deferFetch()

        const { latest } = renderProvider()

        expect(latest.current?.selectedZevId).toBe('')

        await resolveTwoZevs()

        expect(latest.current?.managedZevs.map((z) => z.id)).toEqual(['own1', 'own2'])
        expect(latest.current?.selectedZevId).toBe('own2')
    })

    it('falls back to the first managed ZEV without an account preference', async () => {
        authState.current = userWithRole('zev_owner')
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')
    })

    it('ignores an account preference for a ZEV that is no longer managed', async () => {
        authState.current = { ...userWithRole('zev_owner'), preferred_zev: 'transferred-away' }
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')
    })

    it('keeps an explicit pick instead of re-pinning to the first entry', async () => {
        authState.current = userWithRole('zev_owner')
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        act(() => {
            latest.current?.setSelectedZevId('own2')
        })

        expect(latest.current?.selectedZevId).toBe('own2')
        expect(latest.current?.isSelectable).toBe(true)
    })

    it('prefers the explicit pick even when the account preference differs', async () => {
        authState.current = { ...userWithRole('zev_owner'), preferred_zev: 'own1' }
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        act(() => {
            latest.current?.setSelectedZevId('own2')
        })

        expect(latest.current?.selectedZevId).toBe('own2')
    })

    it('persists a user-initiated switch as the account preference', async () => {
        authState.current = userWithRole('zev_owner')
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')

        act(() => {
            latest.current?.setSelectedZevId('own2')
        })

        expect(vi.mocked(updatePreferredZev)).toHaveBeenCalledWith('own2')
        expect(latest.current?.selectedZevId).toBe('own2')
    })

    it('does not persist a switch to a ZEV the user no longer manages', async () => {
        authState.current = userWithRole('zev_owner')
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        act(() => {
            latest.current?.setSelectedZevId('transferred-away')
        })

        expect(vi.mocked(updatePreferredZev)).not.toHaveBeenCalled()
        expect(latest.current?.selectedZevId).toBe('own1')
    })

    it('a failed preference save leaves the local selection usable', async () => {
        authState.current = userWithRole('zev_owner')
        deferFetch()

        const { latest } = renderProvider()

        await resolveTwoZevs()

        vi.mocked(updatePreferredZev).mockRejectedValueOnce(new Error('network down'))
        act(() => {
            latest.current?.setSelectedZevId('own2')
        })

        expect(vi.mocked(updatePreferredZev)).toHaveBeenCalledWith('own2')
        expect(latest.current?.selectedZevId).toBe('own2')
    })

    it('an account switch drops the previous pick and honors the new preference', async () => {
        authState.current = adminUser(1, 'own1')
        deferFetch()

        const { latest, rerender } = renderProvider()

        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')

        act(() => {
            latest.current?.setSelectedZevId('own2')
        })

        expect(latest.current?.selectedZevId).toBe('own2')

        // A second user on the same browser must land on their own preference.
        authState.current = adminUser(2, 'own1')
        rerender()
        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')
    })

    it('an account switch without a preference falls back to the first managed ZEV', async () => {
        authState.current = adminUser(1, 'own2')
        deferFetch()

        const { latest, rerender } = renderProvider()

        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own2')

        authState.current = adminUser(2, null)
        rerender()
        await resolveTwoZevs()

        expect(latest.current?.selectedZevId).toBe('own1')
    })

    it('clears the selection for a non-managing role', async () => {
        authState.current = userWithRole('participant')

        const { latest } = renderProvider()

        expect(latest.current?.selectedZevId).toBe('')
        expect(latest.current?.isSelectable).toBe(false)
    })
})
