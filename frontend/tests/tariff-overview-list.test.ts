import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffOverview } from '../src/features/tariffs/TariffOverview'
import { tariffOverview } from '../src/features/tariffs/validity'
import { TariffVersionForm } from '../src/features/tariffs/TariffVersionForm'
import { TariffDetail, TariffSeriesActions } from '../src/features/tariffs/TariffDetailPane'
import { renderWithProviders, setInputValue } from './helpers/render'
import { act } from 'react'
import { waitForCondition } from './helpers/waitForCondition'
import type { TariffSeries, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { date?: string }) => key === 'pages.tariffs.versions.closesPrevious' ? `${key}: ${options?.date}` : key }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }))

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
})
const past = version('past', '2000-01-01', '2000-12-31')
const current = version('current', '2001-01-01', null)
const next = version('next', '2999-01-01', null)
const series: TariffSeries = { zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    version_count: 3, active_version_id: 'current', gaps: [], versions: [next, current, past] }

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

async function list(selected: { seriesKey: string, versionId: string } | null = null, onlyPast = false) {
    const groups = tariffOverview([onlyPast ? ({ ...series, versions: [past] } as TariffSeries) : series], TODAY)
    const { container } = await renderWithProviders(createElement(TariffOverview, { groups, settings, expandedVersion: () => selected?.versionId ?? null, renderDetail: () => createElement('p', null, 'Inline details'), onOpenDetail: vi.fn(), onCloseDetail: vi.fn() }), cleanups)
    return container
}

describe('TariffOverview', () => {
    it.each(['monthly_fee', 'yearly_fee'] as const)('shows the planned %s when the current fee is missing', async billing_mode => {
        const owner = { ...series, billing_mode, versions: [
            { ...next, billing_mode, fixed_price_chf: '15.00' },
            { ...current, billing_mode, fixed_price_chf: null },
        ] }
        const { container } = await renderWithProviders(createElement(TariffOverview, {
            groups: tariffOverview([owner], TODAY), settings, expandedVersion: () => null,
            renderDetail: () => null, onOpenDetail: vi.fn(), onCloseDetail: vi.fn(),
        }), cleanups)
        expect(container.querySelector('.tariff-upcoming-price')?.textContent).toContain('15.00')
        expect(container.querySelector('.tariff-price-current')?.textContent).toBe('—')
        expect(container.querySelector('.tariff-table-band:not(.tariff-price-headings) .tariff-table-band-unit')?.textContent).toBe(
            `pages.tariffs.rateCard.${billing_mode === 'yearly_fee' ? 'perYear' : 'perMonth'}`)
    })

    it('keeps the unavailable amount in a collapsed future-only dynamic tariff', async () => {
        const future = { ...next, billing_mode: 'energy', dynamic_source: 'source', dynamic_price_summary: null }
        const owner = { ...series, billing_mode: 'energy', versions: [future], version_count: 1 }
        const { container } = await renderWithProviders(createElement(TariffOverview, {
            groups: tariffOverview([owner], TODAY), settings, expandedVersion: () => null,
            renderDetail: () => null, onOpenDetail: vi.fn(), onCloseDetail: vi.fn(),
        }), cleanups)
        expect(container.querySelector('.tariff-price-current')?.textContent).toBe('—')
        expect(container.querySelector('.tariff-table-band-unit')?.textContent).toBe('pages.tariffs.rateCard.perKwh')
        expect(container.querySelector('.tariff-upcoming-price')).toBeNull()
    })

    it.each(['percentage', 'base', 'label', 'weekdays', 'hours'])('compares recurrence independently of a changed %s', async change => {
        const band: TariffVersion['periods'][number] = { id: 'band', tariff: current.id, period_type: 'band', label: 'Original',
            time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4', months: '', percentage: '10', price_chf_per_kwh: null }
        const source: TariffVersion = { ...current, billing_mode: 'percentage_of_energy', periods: [band], percentage_base_summary: {
            price_chf_per_kwh: '0.25', reference_date: TODAY, dynamic_status: null,
        } }
        const planned: TariffVersion = { ...source, id: next.id, valid_from: next.valid_from, periods: [{ ...band,
            percentage: change === 'percentage' ? '12' : '10', label: change === 'label' ? 'Renamed' : band.label,
            weekdays: change === 'weekdays' ? '0,1,2,3' : band.weekdays, time_from: change === 'hours' ? '08:00' : band.time_from,
        }], percentage_base_summary: { ...source.percentage_base_summary!, price_chf_per_kwh: change === 'base' ? '0.30' : '0.25' } }
        const owner = { ...series, billing_mode: 'percentage_of_energy', versions: [planned, source] }
        const { container } = await renderWithProviders(createElement(TariffOverview, {
            groups: tariffOverview([owner], TODAY), settings, expandedVersion: () => null,
            renderDetail: () => null, onOpenDetail: vi.fn(), onCloseDetail: vi.fn(),
        }), cleanups)
        expect(container.querySelector('[data-schedule-change]') !== null).toBe(['weekdays', 'hours'].includes(change))
    })

    it.each(['same bands', 'changed schedule', 'unpriced current'])('labels the future pricing context for %s', async scenario => {
        const bands: TariffVersion['periods'] = [{ id: 'flat', tariff: current.id, period_type: 'flat', price_chf_per_kwh: '0.20', percentage: null }]
        if (scenario === 'changed schedule') bands.splice(0, 1,
            { ...bands[0], id: 'current-high', period_type: 'high', time_from: '07:00', time_to: '21:00' },
            { ...bands[0], id: 'current-low', period_type: 'low' },
        )
        const source: TariffVersion = { ...current, category: 'energy', billing_mode: 'energy', energy_type: 'grid', periods: scenario === 'unpriced current' ? [] : bands }
        const future: TariffVersion = { ...source, id: next.id, valid_from: next.valid_from, periods: scenario === 'changed schedule' ? [
            { ...bands[0], id: 'high', tariff: next.id, period_type: 'high', price_chf_per_kwh: '0.40', time_from: '07:00', time_to: '21:00' },
            { ...bands[0], id: 'low', tariff: next.id, period_type: 'low', price_chf_per_kwh: '0.10', time_from: '21:00', time_to: '07:00' },
        ] : [{ ...bands[0], tariff: next.id, price_chf_per_kwh: '0.40' }] }
        const owner: TariffSeries = { ...series, category: 'energy', billing_mode: 'energy', energy_type: 'grid', versions: [future, source], version_count: 2 }
        const onOpenDetail = vi.fn()
        const { container } = await renderWithProviders(createElement(TariffOverview, {
            groups: tariffOverview([owner], TODAY), settings, expandedVersion: () => null,
            renderDetail: () => null, onOpenDetail, onCloseDetail: vi.fn(),
        }), cleanups)
        expect(container.querySelector('.tariff-price-headings [data-comparison="true"]') !== null).toBe(scenario === 'same bands')
        expect(container.querySelector('.tariff-price-headings')?.textContent).toContain('pages.tariffs.workspace.today')
        expect(container.querySelector('.tariff-price-planned-heading svg, .tariff-schedule-change svg')?.getAttribute('data-icon')).toBe('clock')
        const energyType = container.querySelector('.tariff-table-name .tariff-table-meta')!
        expect(energyType.textContent).toBe('pages.tariffs.energyTypes.grid')
        expect(energyType.tagName).toBe('BUTTON')
        await act(async () => (energyType as HTMLButtonElement).click())
        expect(energyType.getAttribute('aria-expanded')).toBe('true')
        await waitForCondition(() => document.getElementById(energyType.getAttribute('aria-controls')!) !== null, 'energy explanation open')
        expect(document.getElementById(energyType.getAttribute('aria-controls')!)?.textContent).toContain('pages.tariffs.form.energyTypeHints.grid')
        expect(onOpenDetail).not.toHaveBeenCalled()
        await act(async () => (energyType as HTMLButtonElement).click())
        const futureControl = container.querySelector<HTMLButtonElement>('.tariff-upcoming-price')!
        if (scenario === 'same bands') {
            expect(futureControl.textContent).toContain('0.400')
            expect(container.querySelector('.tariff-schedule-change')).toBeNull()
        } else {
            expect(futureControl.textContent).toContain('0.400')
            if (scenario === 'changed schedule') expect(futureControl.textContent).toContain('0.100')
            expect(futureControl.parentElement?.classList.contains('tariff-table-bands')).toBe(true)
            if (scenario === 'changed schedule') {
                expect(futureControl.querySelectorAll('.tariff-planned-rate')).toHaveLength(2)
                expect(futureControl.querySelectorAll('.tariff-planned-rate')[0].textContent).toContain('07:00–21:00')
                expect(futureControl.querySelectorAll('.tariff-planned-rate')[1].textContent).toContain('21:00–07:00')
                expect(futureControl.textContent).not.toContain('pages.tariffs.rateCard.perKwh')
                expect(container.querySelector('.tariff-current-rates')?.textContent).toContain('pages.tariffs.rateCard.perKwh')
            }
            expect(container.querySelector('.tariff-schedule-change')?.textContent).toContain('pages.tariffs.workspace.scheduleChanges')
            expect(container.querySelector('.tariff-schedule-change')?.closest('button')).toBe(futureControl)
        }
        expect(container.querySelector('.tariff-price-current')?.textContent).toBe(scenario === 'unpriced current' ? undefined : '0.200')
        if (scenario === 'unpriced current') {
            expect(futureControl.textContent).toContain('pages.tariffs.rateCard.perKwh')
        }
        await act(async () => futureControl.click())
        expect(onOpenDetail).toHaveBeenCalledOnce()
        expect(onOpenDetail).toHaveBeenCalledWith(owner, future.id)
    })

    it('lists current and upcoming prices without repeating their earlier versions', async () => {
        const container = await list()
        expect(container.querySelectorAll('.tariff-category-title')).toHaveLength(1)
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


it('unfolds details below its row and closes even when another version is selected', async () => {
    const onOpenDetail = vi.fn()
    const onCloseDetail = vi.fn()
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([series], TODAY), settings, expandedVersion: () => 'next', renderDetail: () => createElement('p', null, 'Inline details'), onOpenDetail, onCloseDetail,
    }), cleanups)
    await act(async () => container.querySelector<HTMLButtonElement>('.tariff-select')!.click())
    expect(onCloseDetail).toHaveBeenCalledWith(series)
    expect(container.querySelector('.tariff-table-open svg')?.getAttribute('data-icon')).toBe('chevron-up')
    expect(container.querySelectorAll('tr[data-series-key]')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-detail-row')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-select')).toHaveLength(1)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('.tariff-expanded-content')?.textContent).toBe('Inline details')
    expect(container.querySelector('.tariff-category-title')?.textContent).toBe('pages.tariffs.categories.grid_fees')
    expect(container.querySelector('.tariff-select')?.getAttribute('aria-controls')).toBe(container.querySelector('.tariff-expanded-content')?.id)
})

it('closes from the empty stretch of the action strip, which its buttons do not swallow', async () => {
    const onOpenDetail = vi.fn()
    const onCloseDetail = vi.fn()
    const onNewVersion = vi.fn()
    const owner = { ...series, versions: [next, current], version_count: 2 } as TariffSeries
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([owner], TODAY), settings,
        expandedVersion: () => 'next', renderDetail: () => null,
        renderActions: () => createElement(TariffSeriesActions, { series: owner, versionId: 'next', onRename: vi.fn(), onDuplicate: vi.fn(), onNewVersion }),
        onOpenDetail, onCloseDetail,
    }), cleanups)
    const strip = container.querySelector<HTMLElement>('.tariff-series-actions')!
    expect(strip.querySelectorAll('button')).toHaveLength(2)
    // The strip spans the row, so a click on its empty part is a click on the row.
    await act(async () => strip.click())
    expect(onCloseDetail).toHaveBeenCalledWith(owner)
    expect(onOpenDetail).not.toHaveBeenCalled()
    await act(async () => strip.querySelector<HTMLButtonElement>('[data-action-key="new-version"]')!.click())
    expect(onNewVersion).toHaveBeenCalledOnce()
    expect(onCloseDetail).toHaveBeenCalledOnce()
})

it('previews the actual predecessor and successor when scheduling from a past version', async () => {
    const withGap = { ...series, versions: [{ ...next, valid_from: '2028-01-01' }, { ...current, valid_from: '2026-01-01', valid_to: '2026-12-31' }, past] }
    const { container } = await renderWithProviders(createElement(TariffVersionForm, {
        dialog: { kind: 'new-version', series: withGap, source: past, validFrom: '2027-01-01' }, settings, isPending: false,
        onCancel: vi.fn(), onDirtyChange: vi.fn(), onSubmitNewVersion: vi.fn(), onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
    }), cleanups)
    expect(container.querySelector('.tariff-change-preview')?.textContent).toContain('pages.tariffs.versions.closesPrevious: 31.12.2026')
    expect(container.querySelector('.tariff-version-effective-date .tariff-readonly-value')?.textContent).toBe('31.12.2027')
    expect(container.textContent).toContain('pages.tariffs.workspace.endAutomatic')
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
    expect(container.querySelector('.tariff-version-effective-date .tariff-readonly-value')?.textContent).toBe('30.06.2026')
    expect(container.querySelectorAll('.tariff-time-row')).toHaveLength(1)
    expect(container.querySelector('.tariff-time-row')?.textContent).toContain('pages.tariffs.form.timeFrom')
    expect(container.querySelector('.tariff-time-row')?.textContent).toContain('pages.tariffs.form.timeTo')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
    expect(container.querySelector('.tariff-time-row [aria-invalid="true"]')).toBeNull()
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    if (incomplete) {
        expect(onSubmitNewVersion).not.toHaveBeenCalled()
        expect(container.querySelector('.tariff-time-row')?.textContent).toContain('pages.tariffs.form.errorRequired')
    }
    else expect(onSubmitNewVersion).toHaveBeenCalledWith(source.id, expect.objectContaining({ valid_from: '2026-06-30', periods: [expect.objectContaining({
        time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4', months: '6', label: 'HT',
    })] }))
})

it('shows down chevrons while collapsed and mounts the real detail only under the selected category row', async () => {
    const onOpenDetail = vi.fn()
    const onCloseDetail = vi.fn()
    const onEdit = vi.fn()
    const second = { ...series, name: 'Metering', category: 'metering', versions: [{ ...current, id: 'metering', name: 'Metering', category: 'metering' }] } as TariffSeries
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([series, second], TODAY), settings,
        onOpenDetail, onCloseDetail,
        expandedVersion: owner => owner.name === 'Grid' ? 'next' : null,
        renderDetail: (owner, versionId) => createElement(TariffDetail, {
            series: owner, allSeries: [series, second], settings, shownVersionId: versionId,
            onShowVersion: vi.fn(), deleteTariffDisabled: false, deletePeriodDisabled: false,
            onEditTariff: onEdit, onDeleteTariff: vi.fn(), onOpenCreatePeriod: vi.fn(),
            onEditPeriod: vi.fn(), onDeletePeriod: vi.fn(), onNewVersion: vi.fn(),
        }),
    }), cleanups)
    expect(container.querySelectorAll('.tariff-detail-row')).toHaveLength(1)
    const selectedRow = container.querySelector<HTMLTableRowElement>('tr.is-selected')!
    const trigger = selectedRow.querySelector<HTMLButtonElement>('.tariff-select')!
    const contentId = trigger.getAttribute('aria-controls')!
    expect(container.querySelector(`#${contentId} .tariff-detail`)).not.toBeNull()
    expect(container.querySelectorAll('table')).toHaveLength(2)
    expect(container.querySelector('table table')).toBeNull()
    expect(container.querySelectorAll('.tariff-version-columns')).toHaveLength(1)
    expect(container.querySelectorAll('.tariff-version-row')).toHaveLength(3)
    expect(selectedRow.nextElementSibling?.className).toBe('tariff-detail-row')
    expect(selectedRow.querySelector('.tariff-table-open svg')?.getAttribute('data-icon')).toBe('chevron-up')
    expect(container.querySelector('tr:not(.is-selected) .tariff-table-open svg')?.getAttribute('data-icon')).toBe('chevron-down')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="edit-next"]')!.click())
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledWith(next, 'edit-next', 'valid_from')
    expect(onOpenDetail).not.toHaveBeenCalled()
    expect(onCloseDetail).not.toHaveBeenCalled()
    await act(async () => selectedRow.querySelector<HTMLButtonElement>('.tariff-table-open button')!.click())
    expect(onCloseDetail).toHaveBeenCalledOnce()
})


it.each(['missing prices', 'missing time', 'partial dynamic'] as const)('shows a plain collapsed warning for %s without a repair button', async scenario => {
    const priced: TariffVersion = {
        ...current, billing_mode: 'energy', energy_type: 'grid',
        periods: scenario === 'missing time' ? [{ id: 'low', tariff: current.id, period_type: 'low', price_chf_per_kwh: '0.20', time_from: null, time_to: null }] : [],
        ...(scenario === 'partial dynamic' ? {
            dynamic_source: 'source',
            dynamic_price_summary: { status: 'partial' as const, average_chf_per_kwh: '0.20', reference_from: '2026-01-01', reference_to: '2026-01-31' },
        } : {}),
    }
    const owner: TariffSeries = { ...series, billing_mode: 'energy', energy_type: 'grid', versions: [priced], version_count: 1 }
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([owner], TODAY), settings, expandedVersion: () => null,
        renderDetail: () => null, onOpenDetail: vi.fn(), onCloseDetail: vi.fn(),
    }), cleanups)
    const warning = container.querySelector('.tariff-band-warning')!
    expect(warning.querySelector('svg[data-icon="circle-exclamation"]')).not.toBeNull()
    expect(warning.textContent).toBe(scenario === 'missing prices' ? 'pages.tariffs.workspace.incomplete'
        : scenario === 'missing time' ? 'pages.tariffs.bandEntry.uncoveredSummary' : 'pages.tariffs.ux.partial')
    expect(warning.querySelector('button')).toBeNull()
    expect(container.querySelector('[data-action-key^="repair-"]')).toBeNull()
    expect(container.querySelector('.tariff-row-repair')).toBeNull()
})

it.each(['new-version', 'duplicate'] as const)('seeds %s with the business date across a browser timezone boundary', async kind => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T22:30:00Z'))
    try {
        expect(new Date().getDate()).toBe(24)
        const { container } = await renderWithProviders(createElement(TariffVersionForm, {
            dialog: { kind, series, source: current }, settings, isPending: false,
            onCancel: vi.fn(), onDirtyChange: vi.fn(), onSubmitNewVersion: vi.fn(), onSubmitDuplicate: vi.fn(), onSubmitRename: vi.fn(),
        }), cleanups)
        expect(container.querySelector('.mantine-DatePickerInput-input')?.textContent).toBe('25.10.2026')
    } finally {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    }
})


it('shows shared notes once as plain text beneath the tariff name', async () => {
    const common = 'Shared tariff note'
    const owner: TariffSeries = { ...series, versions: series.versions.map(version => ({ ...version, notes: ` ${common} ` })) }
    const { container } = await renderWithProviders(createElement(TariffOverview, {
        groups: tariffOverview([owner], TODAY), settings, onOpenDetail: vi.fn(), onCloseDetail: vi.fn(),
        expandedVersion: () => current.id,
        renderDetail: () => createElement(TariffDetail, {
            series: owner, allSeries: [owner], settings, shownVersionId: current.id, onShowVersion: vi.fn(),
            deleteTariffDisabled: false, deletePeriodDisabled: false, onEditTariff: vi.fn(), onDeleteTariff: vi.fn(),
            onOpenCreatePeriod: vi.fn(), onEditPeriod: vi.fn(), onDeletePeriod: vi.fn(), onNewVersion: vi.fn(),
        }),
    }), cleanups)
    const notes = container.querySelectorAll('.tariff-shared-notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toBe(common)
    expect(notes[0].querySelector('button')).toBeNull()
    expect(container.querySelector('.tariff-version-note')).toBeNull()
})
