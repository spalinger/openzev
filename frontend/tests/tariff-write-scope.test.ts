import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitForCondition } from './helpers/waitForCondition'
import { useTariffEditor } from '../src/features/tariffs/useTariffEditor'
import { useTariffCrud } from '../src/features/tariffs/useTariffCrud'
import { useTariffVersions } from '../src/features/tariffs/useTariffVersions'
import type { Tariff, TariffInput, TariffPeriodInput, TariffSeries, TariffVersion, TariffVersionInput } from '../src/types/api'
import { queryKeys } from '../src/lib/api/queryKeys'

const api = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), rename: vi.fn(), userId: 1 }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: api.userId } }) }))
vi.mock('../src/lib/api/tariffs', () => ({
    createTariff: api.save, updateTariff: api.save, deleteTariff: api.remove,
    createTariffPeriod: api.save, updateTariffPeriod: api.save, deleteTariffPeriod: api.remove,
    createTariffVersion: api.save, duplicateTariff: api.save, renameTariffSeries: api.rename,
}))
let root: ReturnType<typeof createRoot>
let client: QueryClient
let container: HTMLDivElement
let crud: ReturnType<typeof useTariffCrud>
let versions: ReturnType<typeof useTariffVersions>
let zevId: string
let canWrite: boolean
let confirmation: { onConfirm: () => void }
const toast = vi.fn()
const tariffSaved = vi.fn()
const versionSaved = vi.fn()
const periodSaved = vi.fn()
const tariff: TariffVersion = {
    id: 'tariff-A', zev: 'A', name: 'Grid', category: 'energy', billing_mode: 'energy',
    energy_type: 'grid', valid_from: '2026-01-01', split_key: 'equal', periods: [],
}
const series: TariffSeries = { ...tariff, version_count: 1, active_version_id: tariff.id, gaps: [], versions: [tariff] }
const source = tariff
const tariffPayload: TariffInput = { ...tariff }
const periodPayload: TariffPeriodInput = { tariff: tariff.id, period_type: 'flat', price_chf_per_kwh: '0.25' }
const versionPayload: TariffVersionInput = { valid_from: '2027-01-01' }
const submissions = ['tariff', 'period', 'version', 'duplicate', 'rename'] as const
function openTask(name: typeof submissions[number]) {
    if (name === 'tariff') crud.startTariffEdit(tariff)
    if (name === 'period') crud.openCreatePeriod(tariff.id)
    if (name === 'version') versions.openNewVersion(series, source)
    if (name === 'duplicate') versions.openDuplicate(series, source)
    if (name === 'rename') versions.openRename(series, source)
}
function captureSubmit(name: typeof submissions[number]) {
    const previousCrud = crud
    const previousVersions = versions
    return () => {
        if (name === 'tariff') previousCrud.submitTariff(tariffPayload)
        if (name === 'period') previousCrud.submitPeriod(periodPayload)
        if (name === 'version') previousVersions.submitNewVersion(tariff.id, versionPayload)
        if (name === 'duplicate') previousVersions.submitDuplicate(tariff.id, { ...versionPayload, name: 'copy' })
        if (name === 'rename') previousVersions.submitRename(tariff.id, 'renamed')
    }
}
function Harness() {
    const editing = useTariffEditor(`${zevId}|${canWrite}|${api.userId}`)
    const shared = { editing, selectedZevId: zevId, canWrite, queryClient: client, pushToast: toast, t: (key: string) => key }
    const currentCrud = useTariffCrud({ ...shared, tariffs: [tariff], periods: [], tariffNameById: new Map(), confirm: options => { confirmation = options }, onTariffSaved: tariffSaved, onPeriodSaved: periodSaved })
    const currentVersions = useTariffVersions({ ...shared, onSaved: versionSaved })
    useLayoutEffect(() => { crud = currentCrud; versions = currentVersions }, [currentCrud, currentVersions])
    return null
}
async function render() {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))))
}
beforeEach(async () => {
    vi.clearAllMocks()
    api.userId = 1
    zevId = 'A'
    canWrite = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    await render()
})
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove() })

it('requires an explicit existing owner for a new band', () => {
    act(() => crud.openCreatePeriod('missing'))
    expect(crud.periodFormOpen).toBe(false)
    expect(toast).toHaveBeenCalledWith('pages.tariffs.messages.createEnergyTariffFirst', 'error')
})

it.each(['version', 'band'])('closes the affected task on a confirmed %s deletion and rejects its captured save', async kind => {
    act(() => crud.startTariffEdit(tariff))
    const submit = captureSubmit('tariff')
    act(() => kind === 'version' ? crud.confirmDeleteTariff(tariff) : crud.confirmDeletePeriod({ ...periodPayload, id: 'band' }))
    act(() => confirmation.onConfirm())
    expect(crud.tariffFormOpen).toBe(false)
    await act(async () => submit())
    expect(api.save).not.toHaveBeenCalled()
    await waitForCondition(() => api.remove.mock.calls.length > 0, 'deletion')
})

it.each(['community', 'permission', 'account'])('resets write dialogs and refuses a captured delete after a %s change', async change => {
    act(() => {
        crud.openCreateTariff()
        crud.openCreatePeriod(tariff.id)
        versions.openRename(series, source)
        crud.confirmDeleteTariff(tariff)
    })
    const captured = confirmation.onConfirm
    if (change === 'community') zevId = 'B'
    if (change === 'permission') canWrite = false
    if (change === 'account') api.userId = 2
    await render()
    expect(crud.tariffFormOpen).toBe(false)
    expect(crud.periodFormOpen).toBe(false)
    expect(versions.dialog).toBeNull()
    act(() => captured())
    expect(api.remove).not.toHaveBeenCalled()
})

it.each(['save', 'band', 'rename'])('ignores delayed %s UI completion while invalidating the submitting community', async operation => {
    let resolve!: (value: Tariff) => void
    const pending = new Promise<Tariff>(done => { resolve = done })
    api.save.mockReturnValue(pending)
    api.rename.mockReturnValue(pending)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const name = operation === 'save' ? 'tariff' : operation === 'band' ? 'period' : 'rename'
    act(() => openTask(name))
    act(captureSubmit(name))
    await waitForCondition(() => api.save.mock.calls.length + api.rename.mock.calls.length > 0, 'submitted write')
    zevId = 'B'
    await render()
    act(() => { crud.openCreateTariff(); versions.openRename({ ...series, zev: 'B' }, source) })
    await act(async () => resolve(tariff))
    await waitForCondition(() => invalidate.mock.calls.length > 0, 'cache invalidation')
    expect(crud.tariffFormOpen).toBe(false)
    expect(versions.dialog).not.toBeNull()
    expect(toast).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tariffs.series('A') })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.tariffs.series('B') })
})


it('does not save a tariff period without a resolved community, even with admin write capability', async () => {
    zevId = ''
    await render()
    act(() => crud.openCreatePeriod(tariff.id))
    act(() => crud.submitPeriod(periodPayload))
    expect(api.save).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('pages.tariffs.messages.periodSaveFailed', 'error')
})

for (const change of ['community', 'permission', 'account'] as const) {
    it.each(submissions)(`rejects a retained %s submission after a ${change} change`, async name => {
        act(() => openTask(name))
        const submit = captureSubmit(name)
        if (change === 'community') zevId = 'B'
        if (change === 'permission') canWrite = false
        if (change === 'account') api.userId = 2
        await render()
        await act(async () => submit())
        expect(api.save).not.toHaveBeenCalled()
        expect(api.rename).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
    })
}

it('rejects a tariff write queued before its submitting scope changes', async () => {
    act(() => crud.openCreateTariff())
    act(() => {
        crud.submitTariff(tariffPayload)
        zevId = 'B'
        root.render(createElement(QueryClientProvider, { client }, createElement(Harness)))
    })
    await act(async () => undefined)
    expect(api.save).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
})

it('closes the form and selects what was saved once the series has been refetched', async () => {
    api.save.mockResolvedValue(tariff)
    act(() => crud.openCreateTariff())
    act(() => crud.submitTariff(tariffPayload))
    await waitForCondition(() => tariffSaved.mock.calls.length > 0, 'saved tariff selected')
    expect(tariffSaved).toHaveBeenCalledWith(tariff, 'created')
    expect(crud.tariffFormOpen).toBe(false)
    expect(toast).toHaveBeenCalledWith('pages.tariffs.messages.created', 'success')
})

it('keeps a failed save in the form as a notice, not only a toast', async () => {
    api.save.mockRejectedValue(new Error('boom'))
    act(() => crud.openCreateTariff())
    act(() => crud.submitTariff(tariffPayload))
    await waitForCondition(() => crud.saveError !== null, 'save error')
    expect(crud.saveError).toBe('pages.tariffs.messages.saveFailed')
    expect(crud.tariffFormOpen).toBe(true)
    expect(toast).not.toHaveBeenCalled()
    act(() => crud.closeTariffForm())
    expect(crud.saveError).toBeNull()
})

it.each(['save', 'band', 'rename'])('a %s finishing after its form was closed neither reopens nor selects anything', async operation => {
    let resolve!: (value: Tariff) => void
    const pending = new Promise<Tariff>(done => { resolve = done })
    api.save.mockReturnValue(pending)
    api.rename.mockReturnValue(pending)
    const name = operation === 'save' ? 'tariff' : operation === 'band' ? 'period' : 'rename'
    act(() => openTask(name))
    act(captureSubmit(name))
    await waitForCondition(() => api.save.mock.calls.length + api.rename.mock.calls.length > 0, 'submitted write')
    // The user walks away from the form, then starts another one.
    act(() => {
        crud.closeTariffForm()
        versions.closeDialog()
        versions.openDuplicate(series, source)
    })
    await act(async () => resolve(tariff))
    await act(async () => undefined)
    expect(tariffSaved).not.toHaveBeenCalled()
    expect(versionSaved).not.toHaveBeenCalled()
    expect(periodSaved).not.toHaveBeenCalled()
    expect(crud.tariffFormOpen).toBe(false)
    expect(versions.dialog?.kind).toBe('duplicate')
    expect(toast).not.toHaveBeenCalled()
})

it('has only one active tariff, band or version editor', () => {
    act(() => crud.openCreateTariff())
    expect(crud.tariffFormOpen).toBe(true)
    act(() => crud.openCreatePeriod(tariff.id))
    expect(crud.tariffFormOpen).toBe(false)
    expect(crud.periodFormOpen).toBe(true)
    act(() => versions.openRename(series, source))
    expect(crud.periodFormOpen).toBe(false)
    expect(versions.dialog?.kind).toBe('rename')
    act(() => crud.startTariffEdit(tariff))
    expect(versions.dialog).toBeNull()
    expect(crud.editingTariffId).toBe(tariff.id)
})

it('passes the saved band’s owner to the pane so an inline edit can select its date range', async () => {
    api.save.mockResolvedValue({ tariff: tariff.id })
    act(() => crud.openCreatePeriod(tariff.id))
    act(() => crud.submitPeriod(periodPayload))
    await waitForCondition(() => periodSaved.mock.calls.length > 0, 'saved band owner selected')
    expect(periodSaved).toHaveBeenCalledWith(tariff.id)
})


it.each(submissions)('rejects an obsolete %s submit callback in the same scope', async name => {
    act(() => openTask(name))
    const submit = captureSubmit(name)
    act(() => crud.closeTariffForm())
    act(() => crud.openCreateTariff())
    await act(async () => submit())
    expect(api.save).not.toHaveBeenCalled()
    expect(api.rename).not.toHaveBeenCalled()
    expect(crud.tariffFormOpen).toBe(true)
    expect(crud.saveError).toBeNull()
    expect(toast).not.toHaveBeenCalled()
})

it.each(submissions)('rejects a queued %s write when its task is replaced before API dispatch', async name => {
    let release!: () => void
    const beforeDispatch = new Promise<void>(resolve => { release = resolve })
    const beforeWrite = vi.fn(() => beforeDispatch)
    client.getMutationCache().config.onMutate = beforeWrite
    act(() => openTask(name))
    act(captureSubmit(name))
    await waitForCondition(() => beforeWrite.mock.calls.length > 0, 'mutation waiting before dispatch')
    act(() => crud.closeTariffForm())
    act(() => crud.openCreateTariff())
    await act(async () => release())
    expect(api.save).not.toHaveBeenCalled()
    expect(api.rename).not.toHaveBeenCalled()
    expect(crud.tariffFormOpen).toBe(true)
    expect(crud.saveError).toBeNull()
    expect(toast).not.toHaveBeenCalled()
})

it.each(submissions)('keeps a replacement task editable during an old %s write', async name => {
    let release!: (saved: Tariff) => void
    const pending = new Promise<Tariff>(resolve => { release = resolve })
    api.save.mockReturnValue(pending)
    api.rename.mockReturnValue(pending)
    act(() => openTask(name))
    act(captureSubmit(name))
    await waitForCondition(() => api.save.mock.calls.length + api.rename.mock.calls.length > 0, 'submitted write')
    await waitForCondition(() => crud.tariffPending || crud.periodPending || versions.isPending, 'submitting task is pending')
    act(() => crud.closeTariffForm())
    act(() => openTask(name))
    expect(crud.tariffPending).toBe(false)
    expect(crud.periodPending).toBe(false)
    expect(versions.isPending).toBe(false)
    await act(async () => release(tariff))
    expect(toast).not.toHaveBeenCalled()
    expect(tariffSaved).not.toHaveBeenCalled()
    expect(periodSaved).not.toHaveBeenCalled()
    expect(versionSaved).not.toHaveBeenCalled()
})
