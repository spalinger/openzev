import { createElement, type ComponentProps } from 'react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffDetail, TariffSeriesActions } from '../src/features/tariffs/TariffDetailPane'
import { renderWithProviders } from './helpers/render'
import { waitForCondition } from './helpers/waitForCondition'
import type { TariffSeries, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))

// Reading is inline; focused tasks use a separate pane.

const settings = { date_format_short: 'dd.MM.yyyy', date_format_long: 'd MMMM yyyy', date_time_format: 'dd.MM.yyyy HH:mm', updated_at: '' }
const version = (id: string, valid_from: string, valid_to: string | null): TariffVersion => ({
    id, zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    valid_from, valid_to, fixed_price_chf: '10.00', split_key: 'equal', notes: '', periods: [],
})
const past = version('past', '2000-01-01', '2000-12-31')
const current = version('current', '2001-01-01', null)
const next = version('next', '2999-01-01', null)
const series: TariffSeries = { zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    version_count: 3, active_version_id: 'current', gaps: [], versions: [next, current, past] }

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const noop = () => undefined
const handlers = {
    onShowVersion: noop, deleteTariffDisabled: false, deletePeriodDisabled: false, onEditTariff: noop,
    onDeleteTariff: noop, onOpenCreatePeriod: noop, onEditPeriod: noop, onDeletePeriod: noop, onNewVersion: noop,
}
async function pane(props: Partial<ComponentProps<typeof TariffDetail>> = {}): Promise<HTMLElement> {
    const element = createElement(TariffDetail, { series, allSeries: [series], settings, shownVersionId: null, ...handlers, ...props })
    const { container } = await renderWithProviders(element, cleanups)
    return container
}

async function actionMenuItem(container: HTMLElement, key: string, label: string) {
    const trigger = container.querySelector<HTMLButtonElement>(`[data-action-key="${key}"]`)!
    await act(async () => trigger.click())
    let item: HTMLButtonElement | undefined
    await waitForCondition(() => {
        const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
        item = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].find(node => node.textContent === label)
        return item !== undefined
    }, `version menu item: ${label}`)
    return item!
}

const versionMenuItem = (container: HTMLElement, id: string, label: string) => actionMenuItem(container, `version-actions-${id}`, label)

describe('TariffDetail', () => {
    it('keeps an overlap-only warning in expanded details when every hour is covered', async () => {
        const source: TariffVersion = { ...current, billing_mode: 'energy', periods: [
            { id: 'high', tariff: current.id, period_type: 'high', price_chf_per_kwh: '0.30', time_from: '00:00', time_to: '00:00' },
            { id: 'low', tariff: current.id, period_type: 'low', price_chf_per_kwh: '0.20', time_from: '00:00', time_to: '00:00' },
        ] }
        const container = await pane({ series: { ...series, billing_mode: 'energy', versions: [source] } })
        expect(container.querySelector('.tariff-band-warning')?.textContent).toContain('pages.tariffs.bandEntry.overlaps')
        expect(container.querySelector('.tariff-band-warning')?.textContent).not.toContain('pages.tariffs.bandEntry.fallback')
    })

    it('distinguishes an unavailable linked source from a failed source query', async () => {
        const container = await pane({ series: { ...series, billing_mode: 'energy', versions: [{ ...current, billing_mode: 'energy', dynamic_source: 'missing' }] } })
        await waitForCondition(() => container.textContent?.includes('pages.tariffs.workspace.sourceUnavailable') === true, 'source lookup finished')
        expect(container.textContent).not.toContain('pages.dynamicSources.loadError')
    })
    it('omits shared notes from the version table without adding a title or nested table', async () => {
        const container = await pane({ series: { ...series, versions: [{ ...current, notes: 'Notes have room across the version row' }] } })
        expect(container.querySelector('h2')).toBeNull()
        expect(container.querySelector('table')).toBeNull()
        const notes = container.querySelectorAll('.tariff-version-note')
        expect(notes).toHaveLength(0)
        expect(container.querySelector('.tariff-version-validity .tariff-version-note')).toBeNull()
        expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('pages.tariffs.versions.history')
        expect(container.querySelectorAll('.tariff-version-row')).toHaveLength(1)
    })

    it('shows current, scheduled and earlier versions together in a table without disclosures', async () => {
        const container = await pane()
        const dates = [...container.querySelectorAll('.tariff-version-window')].map((node) => node.textContent)
        expect(dates).toEqual(['01.01.2999 – pages.tariffs.openEnded', '01.01.2001 – pages.tariffs.openEnded', '01.01.2000 – 31.12.2000'])
        expect(container.querySelectorAll('.tariff-version-row')).toHaveLength(3)
        expect(container.querySelector('.tariff-chart-section')).toBeNull()
        expect(container.querySelector('details')).toBeNull()
    })

    it('opens date correction instead of passive version selection when clicking a date', async () => {
        const onShowVersion = vi.fn()
        const onEditTariff = vi.fn()
        const container = await pane({ shownVersionId: 'past', onShowVersion, onEditTariff })
        expect(container.querySelector('.tariff-version-row.is-shown.is-ended')).not.toBeNull()
        await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-select')!.click())
        expect(onShowVersion).not.toHaveBeenCalled()
        expect(onEditTariff).toHaveBeenCalledWith(next, 'edit-next', 'valid_from')
    })

    it('keeps date correction beside its existing validity values', async () => {
        const container = await pane()
        const edit = container.querySelector('.tariff-version-validity [data-action-key="edit-current"]')!
        expect(edit.getAttribute('aria-label')).toContain('pages.tariffs.workspace.editValidity')
        expect(container.querySelectorAll('[data-action-key="edit-current"]')).toHaveLength(1)
    })

    it('offers a viewer the same facts and warnings with no write controls', async () => {
        const container = await pane({ readOnly: true })
        expect(container.querySelector('[data-action-key^="edit-"]')).toBeNull()
        expect(container.querySelector('[data-action-key="rename-series"]')).toBeNull()
        expect(container.querySelector('[data-action-key^="version-actions-"]')).toBeNull()
        expect(container.querySelector('[data-action-key="new-version"]')).toBeNull()
        expect(container.querySelector('[data-action-key="add-period-current"]')).toBeNull()
        expect(container.querySelector('.tariff-version-row .button')).toBeNull()
        expect(container.querySelector('.tariff-version-select')).toBeNull()
        expect(container.querySelector('.tariff-value-edit')).toBeNull()
        expect(container.querySelector('.tariff-version-window')).not.toBeNull()
    })


})


it('explains missing prices and offers one direct add-price action', async () => {
    const onOpenCreatePeriod = vi.fn()
    const unpriced = { ...series, billing_mode: 'energy', versions: [{ ...current, billing_mode: 'energy', periods: [] }] }
    const container = await pane({ series: unpriced, onOpenCreatePeriod })
    expect(container.textContent).toContain('pages.tariffs.workspace.incompleteBody')
    expect([...container.querySelectorAll('button')].filter(button => button.textContent?.includes('pages.tariffs.ux.addPrices'))).toHaveLength(1)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="add-period-current"]')!.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('current', 'add-period-current')
})

it.each(['energy', 'percentage_of_energy'] as const)('edits only the clicked band value or notes (%s)', async billingMode => {
    const period: TariffVersion['periods'][number] = {
        id: 'band', tariff: 'current', period_type: 'flat', price_chf_per_kwh: billingMode === 'energy' ? '0.20' : null,
        percentage: billingMode === 'percentage_of_energy' ? '80' : null,
    }
    const priced: TariffVersion = { ...current, billing_mode: billingMode, notes: 'Editable note', periods: [period] }
    const onEditPeriod = vi.fn(), onEditTariff = vi.fn(), onShowVersion = vi.fn()
    const container = await pane({ series: { ...series, billing_mode: billingMode, versions: [priced] }, onEditPeriod, onEditTariff, onShowVersion })
    expect(container.querySelector('[data-action-key="edit-applies-band"] .tariff-text-edit-icon')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="edit-applies-band"]')!.click())
    expect(onEditPeriod).toHaveBeenLastCalledWith(period, 'edit-applies-band', 'period_type')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="edit-period-band"]')!.click())
    expect(onEditPeriod).toHaveBeenLastCalledWith(period, 'edit-period-band', billingMode === 'energy' ? 'price_chf_per_kwh' : 'percentage')
    await act(async () => (container.querySelector('.tariff-version-unit') as HTMLElement).click())
    expect(onEditPeriod).toHaveBeenCalledTimes(2)
    expect(onEditTariff).not.toHaveBeenCalled()
    const editNotes = await versionMenuItem(container, 'current', 'pages.tariffs.workspace.editNamed')
    await act(async () => editNotes.click())
    expect(onEditTariff).toHaveBeenCalledWith(priced, 'version-actions-current', 'notes')
    expect(onShowVersion).not.toHaveBeenCalled()
})

it('keeps fetched applicability, prices and units read-only for writers too', async () => {
    const dynamic = { ...current, dynamic_source: 'source' }
    const container = await pane({ series: { ...series, billing_mode: 'energy', versions: [dynamic] } })
    expect(container.querySelector('.tariff-version-rate .tariff-value-edit')).toBeNull()
    expect(container.querySelector('.tariff-version-unit button')).toBeNull()
    expect(container.querySelector('[data-action-key="edit-current"]')).not.toBeNull()
})

it('uses an explicit history selector to inspect another dynamic version without editing', async () => {
    const onShowVersion = vi.fn(), onEditTariff = vi.fn()
    const container = await pane({
        series: { ...series, versions: [{ ...next, dynamic_source: 'source' }, current] },
        readOnly: true, onShowVersion, onEditTariff,
    })
    const selector = container.querySelector<HTMLSelectElement>('.tariff-history-version select')!
    await act(async () => {
        selector.value = next.id
        selector.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onShowVersion).toHaveBeenCalledWith(next.id)
    expect(onEditTariff).not.toHaveBeenCalled()
})

it('repairs an interior gap using the preceding prices and the missing start date', async () => {
    const onNewVersion = vi.fn()
    const withGap = { ...series, gaps: [{ start: '2001-01-01', end: '2001-01-31' }], versions: [{ ...current, valid_from: '2001-02-01' }, past] }
    const container = await pane({ series: withGap, onNewVersion })
    const action = [...container.querySelectorAll<HTMLButtonElement>('.tariff-gap-warning button')][0]
    await act(async () => action.click())
    expect(onNewVersion).toHaveBeenCalledWith(withGap, past, '2001-01-01')
})

it.each([false, true])('keeps coverage warnings and repair actions with their own version (readOnly: %s)', async readOnly => {
    const high: TariffVersion['periods'][number] = {
        id: 'high', tariff: current.id, period_type: 'high', price_chf_per_kwh: '0.30', time_from: '07:00', time_to: '21:00',
    }
    const low: TariffVersion['periods'][number] = { ...high, id: 'low', period_type: 'low', time_from: '22:00', time_to: '07:00' }
    const gappy: TariffVersion = { ...current, billing_mode: 'energy', periods: [high, low] }
    const covered: TariffVersion = { ...next, billing_mode: 'energy', periods: [{ ...high, id: 'flat', tariff: next.id, period_type: 'flat', time_from: null, time_to: null }] }
    const owner: TariffSeries = { ...series, billing_mode: 'energy', versions: [covered, gappy] }
    const onEditPeriod = vi.fn()
    const container = await pane({ series: owner, shownVersionId: next.id, readOnly, onEditPeriod })
    const rows = container.querySelectorAll('.tariff-version-row')
    expect(rows[0].querySelector('.tariff-version-coverage')?.childElementCount).toBe(0)
    expect(rows[1].querySelector('.tariff-band-warning')).not.toBeNull()
    const repair = rows[1].querySelector<HTMLButtonElement>('[data-action-key="repair-version-current"]')
    if (readOnly) expect(repair).toBeNull()
    else {
        await act(async () => repair!.click())
        expect(onEditPeriod).toHaveBeenCalledWith(high, 'repair-version-current', 'time_from')
    }
})

it('shows prices once with their contextual actions', async () => {
    const onOpenCreatePeriod = vi.fn()
    const onEditTariff = vi.fn()
    const priced = { ...current, billing_mode: 'energy', notes: 'Version comment', periods: [{
        id: 'flat', tariff: 'current', period_type: 'flat', label: '', price_chf_per_kwh: '0.20',
        percentage: null, time_from: null, time_to: null, weekdays: '', months: '',
    }] }
    const energy = { ...series, billing_mode: 'energy', versions: [priced] }
    const container = await pane({ series: energy, onOpenCreatePeriod, onEditTariff })
    expect(container.querySelectorAll('.tariff-version-row')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-version-amount')).toHaveLength(1)
    expect(container.querySelector('.tariff-version-note')).toBeNull()
    expect(container.querySelector('[data-action-key="new-version"]')).toBeNull()
    const add = await versionMenuItem(container, 'current', 'pages.tariffs.addPeriod')
    await act(async () => add.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('current', 'version-actions-current')
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-validity [data-action-key="edit-current"]')!.click())
    expect(onEditTariff).toHaveBeenCalledWith(priced, 'edit-current', 'valid_from')
})

it.each([4, 5])('keeps every version in a labelled region in page flow (%s versions)', async count => {
    const versions = Array.from({ length: count }, (_, index) => version(`version-${index}`, `${2020 + index}-01-01`, `${2020 + index}-12-31`))
    const container = await pane({ series: { ...series, versions }, shownVersionId: 'version-0' })
    const list = container.querySelector('.tariff-version-list')!
    expect(list.getAttribute('role')).toBe('region')
    expect(list.getAttribute('tabindex')).toBeNull()
    expect(list.querySelectorAll('.tariff-version-row')).toHaveLength(count)
    expect(list.querySelector('.tariff-version-columns')).not.toBeNull()
    expect(list.querySelector('[data-action-key="new-version"]')).toBeNull()
    expect(list.querySelector('.is-shown .tariff-version-window')?.textContent).toContain('01.01.2020')
})

it('keeps version deletion in its menu and preserves its scope and disabled state', async () => {
    const onDeleteTariff = vi.fn()
    const container = await pane({ shownVersionId: 'past', onDeleteTariff })
    const remove = await versionMenuItem(container, 'past', 'pages.tariffs.versions.deleteVersion')
    await act(async () => remove.click())
    expect(onDeleteTariff).toHaveBeenCalledWith(past)
    const disabled = await pane({ deleteTariffDisabled: true })
    expect(disabled.querySelector<HTMLButtonElement>('[data-action-key="version-actions-current"]')?.disabled).toBe(false)
    const disabledDelete = await versionMenuItem(disabled, 'current', 'pages.tariffs.versions.deleteVersion')
    expect(disabledDelete.hasAttribute('data-disabled')).toBe(true)
})

it('opens the fixed-price field from its amount without making the unit clickable', async () => {
    const onShowVersion = vi.fn()
    const onEditTariff = vi.fn()
    const ownPrices = { ...series, versions: [{ ...next, fixed_price_chf: '20.00' }, current] }
    const container = await pane({ series: ownPrices, onShowVersion, onEditTariff })
    const select = container.querySelector<HTMLButtonElement>('.tariff-version-select')!
    const row = select.closest('.tariff-version-row')!
    expect(row.querySelector('.tariff-version-validity')).not.toBeNull()
    expect(row.querySelector('.tariff-version-prices')?.textContent).toContain('20.00')
    expect(container.querySelector('.is-shown .tariff-version-prices')?.textContent).toContain('10.00')
    await act(async () => row.querySelector<HTMLButtonElement>('.tariff-version-amount .tariff-value-edit')!.click())
    expect(onEditTariff).toHaveBeenCalledWith(ownPrices.versions[0], 'edit-price-next', 'fixed_price_chf')
    expect(row.querySelector('.tariff-version-unit button')).toBeNull()
    expect(onShowVersion).not.toHaveBeenCalled()
})

it('keeps date and band actions in their columns and targets the clicked version', async () => {
    const period = { id: 'next-band', tariff: 'next', period_type: 'flat', label: '', price_chf_per_kwh: '0.25',
        percentage: null, time_from: null, time_to: null, weekdays: '', months: '' }
    const future = { ...next, billing_mode: 'energy', periods: [period] }
    const energy = { ...series, billing_mode: 'energy', versions: [future, { ...current, billing_mode: 'energy' }] }
    const onEditPeriod = vi.fn()
    const onDeletePeriod = vi.fn()
    const onEditTariff = vi.fn()
    const onDeleteTariff = vi.fn()
    const onOpenCreatePeriod = vi.fn()
    const onShowVersion = vi.fn()
    const container = await pane({ series: energy, onEditPeriod, onDeletePeriod, onEditTariff, onDeleteTariff, onOpenCreatePeriod, onShowVersion })
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-validity [data-action-key="edit-next"]')!.click())
    expect(onEditTariff).toHaveBeenCalledWith(future, 'edit-next', 'valid_from')
    const removeVersion = await versionMenuItem(container, 'next', 'pages.tariffs.versions.deleteVersion')
    await act(async () => removeVersion.click())
    expect(onDeleteTariff).toHaveBeenCalledWith(future)
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-price-column [data-action-key="edit-period-next-band"]')!.click())
    expect(onEditPeriod).toHaveBeenCalledWith(period, 'edit-period-next-band', 'price_chf_per_kwh')
    const removeBand = await versionMenuItem(container, 'next', 'pages.tariffs.workspace.deleteNamed')
    await act(async () => removeBand.click())
    expect(onDeletePeriod).toHaveBeenCalledWith(period)
    const add = await versionMenuItem(container, 'next', 'pages.tariffs.addPeriod')
    await act(async () => add.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('next', 'version-actions-next')
    expect(onShowVersion).not.toHaveBeenCalled()
})

it('keeps fetched dynamic prices read-only in the price column', async () => {
    const dynamic = { ...current, billing_mode: 'energy', dynamic_source: 'source' }
    const container = await pane({ series: { ...series, billing_mode: 'energy', versions: [dynamic] } })
    expect(container.querySelector('.tariff-version-price-column button')).toBeNull()
    expect(container.querySelector('.tariff-version-validity [data-action-key="edit-current"]')).not.toBeNull()
})

it('puts rename, duplicate and scheduling beside the original tariff identity', async () => {
    const onRename = vi.fn()
    const onDuplicate = vi.fn()
    const onNewVersion = vi.fn()
    const { container } = await renderWithProviders(createElement(TariffSeriesActions, { series, versionId: 'past', onRename, onDuplicate, onNewVersion }), cleanups)
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(2)
    const rename = await actionMenuItem(container, 'series-actions', 'pages.tariffs.pane.task.rename')
    await act(async () => rename.click())
    expect(onRename).toHaveBeenCalledWith(past)
    const duplicate = await actionMenuItem(container, 'series-actions', 'pages.tariffs.versions.duplicate')
    await act(async () => duplicate.click())
    expect(onDuplicate).toHaveBeenCalledWith(past)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="new-version"]')!.click())
    expect(onNewVersion).toHaveBeenCalledWith(current)
})

it('labels version groups and each read-only rate without relying on visual column headings', async () => {
    const container = await pane({ readOnly: true })
    const row = container.querySelector('.tariff-version-row')!
    expect(row.getAttribute('role')).toBe('group')
    expect(document.getElementById(row.getAttribute('aria-labelledby')!)?.textContent).toContain('01.01.2999')
    const rate = row.querySelector('.tariff-version-rate')!
    expect(rate.getAttribute('role')).toBe('group')
    expect(rate.getAttribute('aria-label')).toBeTruthy()
    expect(rate.querySelector('.tariff-version-applies .visually-hidden')?.textContent).toContain('pages.tariffs.rateCard.applies')
    expect(rate.querySelector('.tariff-version-amount .visually-hidden')?.textContent).toContain('pages.tariffs.rateCard.price')
    expect(rate.querySelector('.tariff-version-unit .visually-hidden')?.textContent).toContain('pages.tariffs.rateCard.unit')
})


it('offers every version edit before destructive menu actions', async () => {
    const onEditTariff = vi.fn()
    const container = await pane({ onEditTariff })
    const edit = await versionMenuItem(container, 'current', 'pages.tariffs.workspace.editValidity')
    const items = [...edit.closest('[role="menu"]')!.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)
    expect(items).toEqual([
        'pages.tariffs.workspace.editValidity', 'pages.tariffs.workspace.editPrice',
        'pages.tariffs.workspace.editNamed', 'pages.tariffs.versions.deleteVersion',
    ])
    await act(async () => edit.click())
    expect(onEditTariff).toHaveBeenCalledWith(current, 'version-actions-current', 'valid_from')
})
