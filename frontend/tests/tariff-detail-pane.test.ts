import { createElement, type ReactElement } from 'react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffDetail, TariffSeriesActions } from '../src/features/tariffs/TariffDetailPane'
import { renderWithProviders } from './helpers/render'
import type { TariffSeries, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))

// Reading is inline; focused tasks use a separate pane.

const settings = { date_format_short: 'dd.MM.yyyy', date_format_long: 'd MMMM yyyy', date_time_format: 'dd.MM.yyyy HH:mm', updated_at: '' }
const version = (id: string, valid_from: string, valid_to: string | null): TariffVersion => ({
    id, zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    valid_from, valid_to, fixed_price_chf: '10.00', split_key: 'equal', notes: '', periods: [],
}) as unknown as TariffVersion
const past = version('past', '2000-01-01', '2000-12-31')
const current = version('current', '2001-01-01', null)
const next = version('next', '2999-01-01', null)
const series = { zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    version_count: 3, active_version_id: 'current', gaps: [], versions: [next, current, past] } as unknown as TariffSeries

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const noop = () => undefined
const handlers = {
    onShowVersion: noop, deleteTariffDisabled: false, deletePeriodDisabled: false, onClose: noop, onEditTariff: noop,
    onDeleteTariff: noop, onOpenCreatePeriod: noop, onEditPeriod: noop, onDeletePeriod: noop, onNewVersion: noop,
    onDuplicate: noop, onRenameSeries: noop,
}
async function pane(props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const element = createElement(TariffDetail, { series, allSeries: [series], settings, shownVersionId: null, ...handlers, ...props } as never) as ReactElement
    const { container } = await renderWithProviders(element, cleanups)
    return container
}

describe('TariffDetail', () => {
    it('uses the existing row without repeating its name, notes or table headings', async () => {
        const container = await pane({ series: { ...series, versions: [{ ...current, notes: 'Already in the identity cell' }] } })
        expect(container.querySelector('h2')).toBeNull()
        expect(container.querySelector('table')).toBeNull()
        expect(container.textContent).not.toContain('Already in the identity cell')
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

    it('identifies a selected past version and selects another through its date', async () => {
        const onShowVersion = vi.fn()
        const container = await pane({ shownVersionId: 'past', onShowVersion })
        expect(container.querySelector('.tariff-version-row.is-shown.is-ended')).not.toBeNull()
        expect(container.querySelector('.tariff-version-row.is-shown .tariff-version-status')?.textContent).toBe('pages.tariffs.versions.statusEnded')
        await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-select')!.click())
        expect(onShowVersion).toHaveBeenCalledWith('next')
    })

    it('keeps date correction beside its existing validity values', async () => {
        const container = await pane()
        const edit = container.querySelector('.tariff-version-validity [data-action-key="edit-current"]')!
        expect(edit.getAttribute('aria-label')).toBe('pages.tariffs.workspace.editVersion')
        expect(container.querySelectorAll('[data-action-key="edit-current"]')).toHaveLength(1)
    })

    it('offers a viewer the same facts and warnings with no write controls', async () => {
        const container = await pane({ readOnly: true })
        expect(container.querySelector('[data-action-key^="edit-"]')).toBeNull()
        expect(container.querySelector('[data-action-key="rename-series"]')).toBeNull()
        expect(container.querySelector('[data-action-key^="delete-version-"]')).toBeNull()
        expect(container.querySelector('[data-action-key="new-version"]')).toBeNull()
        expect(container.querySelector('[data-action-key="add-period-current"]')).toBeNull()
        expect(container.querySelector('.tariff-version-row .button')).toBeNull()
        expect(container.querySelector('.tariff-version-select')).not.toBeNull()
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

it('repairs an interior gap using the preceding prices and the missing start date', async () => {
    const onNewVersion = vi.fn()
    const withGap = { ...series, gaps: [{ start: '2001-01-01', end: '2001-01-31' }], versions: [{ ...current, valid_from: '2001-02-01' }, past] }
    const container = await pane({ series: withGap, onNewVersion })
    const action = [...container.querySelectorAll<HTMLButtonElement>('.tariff-gap-warning button')][0]
    await act(async () => action.click())
    expect(onNewVersion).toHaveBeenCalledWith(withGap, past, '2001-01-01')
})

it('shows prices once with their contextual actions and scheduling below', async () => {
    const onNewVersion = vi.fn()
    const onOpenCreatePeriod = vi.fn()
    const onEditTariff = vi.fn()
    const priced = { ...current, billing_mode: 'energy', notes: 'Version comment', periods: [{
        id: 'flat', tariff: 'current', period_type: 'flat', label: '', price_chf_per_kwh: '0.20',
        percentage: null, time_from: null, time_to: null, weekdays: '', months: '',
    }] }
    const energy = { ...series, billing_mode: 'energy', versions: [priced] }
    const container = await pane({ series: energy, onNewVersion, onOpenCreatePeriod, onEditTariff })
    expect(container.querySelectorAll('.tariff-version-row')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-version-amount')).toHaveLength(1)
    expect(container.textContent).not.toContain('Version comment')
    const schedule = container.querySelector<HTMLButtonElement>('.tariff-version-section > [data-action-key="new-version"]')!
    const add = container.querySelector<HTMLButtonElement>('.tariff-version-row.is-shown [data-action-key="add-period-current"]')!
    expect(container.querySelector('.is-shown .tariff-version-rate')!.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => schedule.click())
    expect(onNewVersion).toHaveBeenCalledWith(energy, priced)
    await act(async () => add.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('current', 'add-period-current')
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-validity [data-action-key="edit-current"]')!.click())
    expect(onEditTariff).toHaveBeenCalledWith(priced, 'edit-current')
})

it('keeps all versions in a focusable scrolling region when there are more than five', async () => {
    const versions = Array.from({ length: 7 }, (_, index) => version(`version-${index}`, `${2020 + index}-01-01`, `${2020 + index}-12-31`))
    const container = await pane({ series: { ...series, versions }, shownVersionId: 'version-0' })
    const list = container.querySelector('.tariff-version-list')!
    expect(list.getAttribute('tabindex')).toBe('0')
    expect(list.querySelectorAll('.tariff-version-row')).toHaveLength(7)
    expect(list.querySelector('.is-shown .tariff-version-window')?.textContent).toContain('01.01.2020')
})

it('keeps version deletion beside validity periods and preserves its selected scope and disabled state', async () => {
    const onDeleteTariff = vi.fn()
    const container = await pane({ shownVersionId: 'past', onDeleteTariff })
    expect(container.querySelector('.tariff-detail-header [data-action-key^="delete-version-"]')).toBeNull()
    const remove = container.querySelector<HTMLButtonElement>('.tariff-version-validity [data-action-key="delete-version-past"]')!
    await act(async () => remove.click())
    expect(onDeleteTariff).toHaveBeenCalledWith(past)
    const disabled = await pane({ deleteTariffDisabled: true })
    expect(disabled.querySelector<HTMLButtonElement>('[data-action-key="delete-version-current"]')?.disabled).toBe(true)
})

it('includes each version’s own prices and lets price text select its row', async () => {
    const onShowVersion = vi.fn()
    const ownPrices = { ...series, versions: [{ ...next, fixed_price_chf: '20.00' }, current] }
    const container = await pane({ series: ownPrices, onShowVersion })
    const select = container.querySelector<HTMLButtonElement>('.tariff-version-select')!
    const row = select.closest('.tariff-version-row')!
    expect(row.querySelector('.tariff-version-validity')).not.toBeNull()
    expect(row.querySelector('.tariff-version-prices')?.textContent).toContain('20.00')
    expect(container.querySelector('.is-shown .tariff-version-prices')?.textContent).toContain('10.00')
    await act(async () => (row.querySelector('.tariff-version-amount') as HTMLElement).click())
    expect(onShowVersion).toHaveBeenCalledWith('next')
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
    expect(onEditTariff).toHaveBeenCalledWith(future, 'edit-next')
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-validity [data-action-key="delete-version-next"]')!.click())
    expect(onDeleteTariff).toHaveBeenCalledWith(future)
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-price-column [data-action-key="edit-period-next-band"]')!.click())
    expect(onEditPeriod).toHaveBeenCalledWith(period, 'edit-period-next-band')
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-price-column [data-action-key="delete-period-next-band"]')!.click())
    expect(onDeletePeriod).toHaveBeenCalledWith(period)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="add-period-next"]')!.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('next', 'add-period-next')
    expect(onShowVersion).not.toHaveBeenCalled()
})

it('keeps fetched dynamic prices read-only in the price column', async () => {
    const dynamic = { ...current, billing_mode: 'energy', dynamic_source: 'source' }
    const container = await pane({ series: { ...series, billing_mode: 'energy', versions: [dynamic] } })
    expect(container.querySelector('.tariff-version-price-column button')).toBeNull()
    expect(container.querySelector('.tariff-version-validity [data-action-key="edit-current"]')).not.toBeNull()
})

it('puts rename and duplicate beside the original tariff identity', async () => {
    const onRename = vi.fn()
    const onDuplicate = vi.fn()
    const { container } = await renderWithProviders(createElement(TariffSeriesActions, { series, versionId: 'past', onRename, onDuplicate }), cleanups)
    expect(container.querySelector('h2')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="rename-series"]')!.click())
    expect(onRename).toHaveBeenCalledWith(past)
})
