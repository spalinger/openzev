import { act, createElement, useLayoutEffect, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { useTariffPaneNavigation } from '../src/features/tariffs/useTariffPaneNavigation'
import type { TariffSeries, TariffVersion } from '../src/types/api'

const current: TariffVersion = {
    id: 'current', zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid',
    valid_from: '2026-01-01', valid_to: '2026-12-31', split_key: 'equal', periods: [],
}
const next = { ...current, id: 'next', valid_from: '2027-01-01', valid_to: null }
const series: TariffSeries = { ...current, versions: [next, current], version_count: 2, active_version_id: current.id, gaps: [] }
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))

async function mount(url: string) {
    let navigation: ReturnType<typeof useTariffPaneNavigation>
    let refresh: () => void
    let scopeKey = '42|manager'
    const onScopeChange = vi.fn()
    const onSelectionChange = vi.fn()
    function Page() {
        const [, force] = useReducer(count => count + 1, 0)
        const value = useTariffPaneNavigation({ allSeries: [series], today: '2026-10-27', scopeKey, settled: true,
            editor: null, onScopeChange, onSelectionChange })
        useLayoutEffect(() => { navigation = value; refresh = force })
        return null
    }
    const router = createMemoryRouter([{ path: '/tariffs', element: createElement(Page) }], { initialEntries: [url] })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => { act(() => root.unmount()); router.dispose(); container.remove() })
    await act(async () => root.render(createElement(RouterProvider, { router })))
    return {
        router, onScopeChange, onSelectionChange,
        get navigation() { return navigation },
        changeScope: async () => { scopeKey = 'other|manager'; await act(async () => refresh()) },
    }
}

it('normalizes a renamed deep link by version and retains unrelated parameters', async () => {
    const state = await mount('/tariffs?tariff=42:Old&version=current&keep=1')
    expect(state.navigation.selected).toEqual({ seriesKey: '42:Grid', versionId: 'current' })
    const params = new URLSearchParams(state.router.state.location.search)
    expect(params.get('tariff')).toBe('42:Grid')
    expect(params.get('keep')).toBe('1')
    expect(state.router.state.historyAction).toBe('REPLACE')
})

it('pushes the first expansion, replaces version selection and collapses to the list', async () => {
    const state = await mount('/tariffs?keep=1')
    await act(async () => state.navigation.select(series, 'current'))
    expect(state.router.state.historyAction).toBe('PUSH')
    await act(async () => state.navigation.select(series, 'next'))
    expect(state.router.state.historyAction).toBe('REPLACE')
    expect(state.navigation.selected?.versionId).toBe('next')
    await act(async () => state.navigation.collapse(series))
    expect(state.router.state.location.search).toBe('?keep=1')
    expect(state.navigation.selected).toBeNull()
})

it('falls back to the current version for an obsolete version id', async () => {
    const state = await mount('/tariffs?tariff=42:Grid&version=gone')
    expect(state.navigation.selected?.versionId).toBe('current')
})

it('clears selection and tasks on a resolved community change', async () => {
    const state = await mount('/tariffs?tariff=42:Grid&version=current&keep=1')
    await state.changeScope()
    expect(state.onScopeChange).toHaveBeenCalledOnce()
    expect(state.router.state.location.search).toBe('?keep=1')
    expect(state.navigation.selected).toBeNull()
})
