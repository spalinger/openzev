import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffOverview } from '../src/features/tariffs/TariffOverview'
import { tariffOverview } from '../src/features/tariffs/validity'
import { TariffVersionForm } from '../src/features/tariffs/TariffVersionForm'
import { renderWithProviders, setInputValue } from './helpers/render'
import { act } from 'react'
import type { TariffSeries, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { date?: string }) => ['pages.tariffs.versions.closesPrevious', 'pages.tariffs.workspace.newStarts', 'pages.tariffs.workspace.newEnds'].includes(key) ? `${key}: ${options?.date}` : key }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))

vi.mock('../src/lib/appSettings', async (importOriginal) => ({
    ...await importOriginal<typeof import('../src/lib/appSettings')>(),
    useAppSettings: () => ({ settings }),
}))

// Past versions belong to the detail; only entirely ended tariffs remain in the overview.

const settings = { date_format_short: 'dd.MM.yyyy', date_format_long: 'd MMMM yyyy', date_time_format: 'dd.MM.yyyy HH:mm', updated_at: '' }
const TODAY = new Date().toISOString().slice(0, 10)
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

async function list(selected: { seriesKey: string, versionId: string } | null = null, onlyPast = false) {
    const groups = tariffOverview([onlyPast ? ({ ...series, versions: [past] } as TariffSeries) : series], TODAY)
    const { container } = await renderWithProviders(createElement(TariffOverview, { groups, settings, selected, expandedVersion: () => selected?.versionId ?? null, renderDetail: () => createElement('p', null, 'Inline details'), onOpenDetail: vi.fn(), onCloseDetail: vi.fn() }), cleanups)
    return container
}

describe('TariffOverview', () => {
    it('lists current and upcoming prices without repeating their earlier versions', async () => {
        const container = await list()
        expect(container.querySelectorAll('h2')).toHaveLength(0)
        expect(container.querySelectorAll('.tariff-upcoming-price')).toHaveLength(1)
        expect(container.querySelector('.tariff-overview-history')).toBeNull()
    })

    it('shows each group the version it is about, in plain text rather than a pill', async () => {
        const container = await list()
        const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-row-key'))
        expect(rows).toEqual(['z:Grid:current'])
        expect(container.querySelector('.tariff-table-valid .badge')).toBeNull()
        expect(container.querySelector('tr.is-ended')).toBeNull()
    })

    it('has no totals', async () => {
        const container = await list()
        expect(container.querySelector('.badge-neutral')).toBeNull()
        expect(container.textContent).not.toMatch(/\b3\b/)
    })

    it('shows ended-only tariffs without a disclosure', async () => {
        const container = await list({ seriesKey: 'z:Grid', versionId: 'past' }, true)
        expect(container.querySelector('.tariff-overview-history tr.is-selected')).not.toBeNull()
        expect(container.querySelector('details')).toBeNull()
    })

    it('says so when nothing is in force, and keeps a past-only tariff reachable', async () => {
        const container = await list(null, true)
        expect(container.querySelector('p.muted')?.textContent).toBe('pages.tariffs.overview.nothingCurrent')
        expect(container.querySelectorAll('.tariff-overview-history tbody tr')).toHaveLength(1)
    })
})

describe('TariffVersionForm', () => {
    it('reports unsaved input only once something differs from what it was seeded with', async () => {
        const onDirtyChange = vi.fn()
        const { container } = await renderWithProviders(createElement(TariffVersionForm, {
            dialog: { kind: 'rename', series, source: current }, settings, isPending: false, onCancel: vi.fn(), onDirtyChange,
            onSubmitNewVersion: vi.fn(), onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
        }), cleanups)
        expect(onDirtyChange).toHaveBeenLastCalledWith(false)
        const name = container.querySelector<HTMLInputElement>('input')!
        await act(async () => setInputValue(name, 'Grid 2'))
        expect(onDirtyChange).toHaveBeenLastCalledWith(true)
        await act(async () => setInputValue(name, 'Grid'))
        expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    })

    it('puts the cursor in the first field and locks the fields while saving', async () => {
        const { container } = await renderWithProviders(createElement(TariffVersionForm, {
            dialog: { kind: 'rename', series, source: current }, settings, isPending: true, onCancel: vi.fn(), onDirtyChange: vi.fn(),
            onSubmitNewVersion: vi.fn(), onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
        }), cleanups)
        expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true')
        expect(container.querySelector('fieldset')?.disabled).toBe(true)
        expect(container.querySelector('button[type="submit"]')?.textContent).toContain('common.saving')
    })
})


it('expands and closes the original row without duplicating its summary', async () => {
    const onOpenDetail = vi.fn()
    const onCloseDetail = vi.fn()
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([series], TODAY), settings, selected: { seriesKey: 'z:Grid', versionId: 'current' }, expandedVersion: () => 'current', renderDetail: () => createElement('p', null, 'Inline details'), onOpenDetail, onCloseDetail,
    }), cleanups)
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-select')!.click())
    expect(onCloseDetail).toHaveBeenCalledWith(series)
    expect(container.querySelector('.tariff-expanded-close svg')?.getAttribute('data-icon')).toBe('chevron-up')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-select')).toHaveLength(1)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('.tariff-expanded-content')?.textContent).toBe('Inline details')
    expect(container.querySelector('thead')?.classList.contains('tariff-table-heading-merged')).toBe(true)
    expect(container.querySelector('.tariff-expanded-category')?.textContent).toBe('pages.tariffs.categories.grid_fees')
    expect(container.querySelector('.tariff-upcoming-price')).toBeNull()
})

it('previews the actual predecessor and successor when scheduling from a past version', async () => {
    const withGap = { ...series, versions: [{ ...next, valid_from: '2028-01-01' }, { ...current, valid_from: '2026-01-01', valid_to: '2026-12-31' }, past] }
    const { container } = await renderWithProviders(createElement(TariffVersionForm, {
        dialog: { kind: 'new-version', series: withGap, source: past, validFrom: '2027-01-01' }, settings, isPending: false,
        onCancel: vi.fn(), onDirtyChange: vi.fn(), onSubmitNewVersion: vi.fn(), onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
    }), cleanups)
    expect(container.querySelector('.tariff-change-preview')?.textContent).toContain('pages.tariffs.versions.closesPrevious: 31.12.2026')
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('31.12.2027')
    expect(container.textContent).toContain('pages.tariffs.workspace.endAutomatic')
    expect(container.textContent).not.toContain('pages.tariffs.workspace.newStarts')
    expect(container.textContent).not.toContain('pages.tariffs.versions.resultingPrices')
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain('pages.tariffs.workspace.scheduleChange')
})

it.each([true, false])('offers copied band times and blocks incomplete windows when filling a one-day gap (incomplete: %s)', async incomplete => {
    const source: TariffVersion = { ...current, billing_mode: 'energy', energy_type: 'grid', valid_from: '2026-01-01', valid_to: '2026-06-29', periods: [{
        id: 'ht', tariff: current.id, period_type: 'high', label: 'HT', price_chf_per_kwh: '0.3', percentage: null,
        time_from: incomplete ? null : '07:00', time_to: incomplete ? null : '21:00', weekdays: '0,1,2,3,4', months: '6',
    }] }
    const owner: TariffSeries = { ...series, billing_mode: 'energy', energy_type: 'grid', versions: [source, { ...source, id: 'july', valid_from: '2026-07-01', valid_to: null }] }
    const onSubmitNewVersion = vi.fn()
    const { container } = await renderWithProviders(createElement(TariffVersionForm, {
        dialog: { kind: 'new-version', series: owner, source, validFrom: '2026-06-30' }, settings, isPending: false,
        onCancel: vi.fn(), onDirtyChange: vi.fn(), onSubmitNewVersion, onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
    }), cleanups)
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('30.06.2026')
    expect(container.querySelectorAll('.tariff-time-row')).toHaveLength(1)
    expect(container.querySelector('.tariff-time-row')?.textContent).toContain('pages.tariffs.form.timeFrom')
    expect(container.querySelector('.tariff-time-row')?.textContent).toContain('pages.tariffs.form.timeTo')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(incomplete)
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    if (incomplete) expect(onSubmitNewVersion).not.toHaveBeenCalled()
    else expect(onSubmitNewVersion).toHaveBeenCalledWith(source.id, expect.objectContaining({ valid_from: '2026-06-30', periods: [expect.objectContaining({
        time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4', months: '6', label: 'HT',
    })] }))
})
