import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { buildRateLines, sameBandSchedule, type RateLineTranslate } from '../src/features/tariffs/rateLines'
import type { TariffSeries, TariffVersion } from '../src/types/api'

it('matches equivalent recurrence masks and time precision while respecting seasonal and flat semantics', () => {
    const band: TariffVersion['periods'][number] = { id: 'one', tariff: 'tariff', period_type: 'high', time_from: '07:00', time_to: '21:00', weekdays: '', months: '' }
    expect(sameBandSchedule(band, { ...band, label: 'Renamed', period_type: 'band', price_chf_per_kwh: '0.4', time_from: '07:00:00', weekdays: '6,5,4,3,2,1,0', months: '12,11,10,9,8,7,6,5,4,3,2,1' })).toBe(true)
    expect(sameBandSchedule(band, { ...band, months: '1,2,3' })).toBe(false)
    expect(sameBandSchedule({ ...band, period_type: 'flat' }, { ...band, period_type: 'flat', time_from: null, weekdays: '0' })).toBe(true)
})

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mockT }),
}))

vi.mock('../src/lib/api/tariffs', () => ({
    fetchDynamicTariffSources: vi.fn().mockResolvedValue([]),
}))

function mockT(key: string, opts?: Record<string, unknown>): string {
    if (key === 'pages.tariffs.rateCard.perKwh') return 'CHF/kWh'
    if (key === 'pages.tariffs.rateCard.perMonth') return 'CHF/month'
    if (key === 'pages.tariffs.rateCard.perYear') return 'CHF/year'
    if (key === 'pages.tariffs.rateCard.perParticipant') return 'per participant'
    if (key === 'pages.tariffs.rateCard.perMeteringPoint') return 'per metering point'
    if (key === 'pages.tariffs.rateCard.shared') return 'shared by the participants'
    if (key === 'pages.tariffs.rateCard.allHours') return 'All hours'
    if (key === 'pages.tariffs.rateCard.noTimeWindow') return 'time window not configured'
    if (key === 'pages.tariffs.rateCard.dynamicAverage') return `Dynamic, average ${String(opts?.from)} – ${String(opts?.to)}`
    if (key === 'pages.tariffs.rateCard.dynamicPartial') return `Dynamic, incomplete average ${String(opts?.from)} – ${String(opts?.to)}`
    if (key === 'pages.tariffs.rateCard.incompleteBaseAverage') return 'incomplete base average'
    if (key === 'pages.tariffs.approxPriceTooltip') return `${String(opts?.percentage)}% of CHF ${String(opts?.basePrice)}/kWh = CHF ${String(opts?.effectivePrice)}/kWh`
    if (key === 'pages.tariffs.dynamicAveragePartialTooltip') return 'The average uses only the intervals available in the reference period.'
    if (key === 'pages.tariffs.dynamicPriced') return 'Dynamic price'
    if (key === 'pages.tariffs.noPeriods') return 'No tariff periods yet.'
    if (key === 'pages.tariffs.rateCard.percentOf') return `${String(opts?.percentage)}% of the grid tariff`
    if (key === 'pages.tariffs.rateCard.percentOfBase') return `${String(opts?.percentage)}% of the grid tariff (${String(opts?.base)})`
    if (key.startsWith('pages.tariffs.periodTypes.')) {
        const fallback = opts?.defaultValue
        if (typeof fallback === 'string') {
            if (fallback === 'high') return 'High (HT)'
            if (fallback === 'low') return 'Low (NT)'
            if (fallback === 'flat') return 'Flat'
            if (fallback === 'band') return 'Time band'
            return fallback
        }
        return key.split('.').pop() ?? key
    }
    if (typeof opts?.defaultValue === 'string') return opts.defaultValue
    return key
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const t: RateLineTranslate = mockT

function energySeries(overrides: Partial<TariffSeries> = {}): TariffSeries {
    return {
        zev: 'z1', name: 'Grid', category: 'energy', billing_mode: 'energy',
        energy_type: 'grid', version_count: 1, active_version_id: 'v1', gaps: [], versions: [],
        ...overrides,
    } as TariffSeries
}

function energyVersion(periods: TariffVersion['periods'], overrides: Partial<TariffVersion> = {}): TariffVersion {
    return {
        id: 'v1', zev: 'z1', name: 'Grid', category: 'energy', billing_mode: 'energy',
        energy_type: 'grid', fixed_price_chf: null, split_key: 'equal',
        valid_from: '2020-01-01', valid_to: null, notes: '',
        periods, ...overrides,
    } as TariffVersion
}

function period(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id, tariff: 'v1', period_type: 'flat', label: null,
        price_chf_per_kwh: null, percentage: null,
        time_from: null, time_to: null, weekdays: '', months: '',
        ...overrides,
    }
}

const formatDate = (isoDate: string) => isoDate.split('-').reverse().join('.')

describe('buildRateLines', () => {
    it.each(['', '1,2,3'])('ignores legacy weekday/time restrictions on flat bands but keeps seasons (%s)', months => {
        const version = energyVersion([period('flat', {
            price_chf_per_kwh: '0.25', weekdays: '0,1,2,3,4', time_from: '07:00', time_to: '21:00', months,
        })])
        expect(buildRateLines(energySeries(), version, t, DAY_NAMES, MONTH_NAMES, formatDate)[0].applies)
            .toBe(months ? 'Flat Jan–Mar' : 'All hours')
    })
    it.each(['energy', 'percentage_of_energy'] as const)('identifies untimed non-flat bands without claiming complementary coverage (%s)', (billing_mode) => {
        const series = energySeries({ billing_mode })
        const high = period('ht', { period_type: 'high', price_chf_per_kwh: '0.295', percentage: '80', time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4' })
        const low = period('nt', { period_type: 'low', price_chf_per_kwh: '0.225', percentage: '60' })
        for (const periods of [[high, low], [low]]) {
            const lines = buildRateLines(series, energyVersion(periods), t, DAY_NAMES, MONTH_NAMES, formatDate)
            expect(lines.at(-1)?.applies.split(' · ')[0]).toBe('Low (NT) time window not configured')
        }
    })

    it.each([
        { time_from: null, time_to: null },
        { time_from: '07:00', time_to: null },
        { time_from: null, time_to: '21:00' },
    ])('keeps weekday and season restrictions while identifying an incomplete window: %j', (window) => {
        const version = energyVersion([period('p1', { period_type: 'band', label: 'Winter', weekdays: '0,1,2,3,4', months: '10,11,12,1,2,3', ...window })])
        expect(buildRateLines(energySeries(), version, t, DAY_NAMES, MONTH_NAMES, formatDate)[0].applies)
            .toBe('Winter Mon–Fri, Oct–Mar, time window not configured')
    })

    it('shows an unnamed imported band window once, with its weekdays and season', () => {
        const version = energyVersion([period('p1', { period_type: 'band', time_from: '07:00:00', time_to: '12:00:00', weekdays: '0,1,2,3,4', months: '10,11,12,1,2,3' })])
        expect(buildRateLines(energySeries(), version, t, DAY_NAMES, MONTH_NAMES, formatDate)[0].applies)
            .toBe('07:00–12:00 Mon–Fri, Oct–Mar')
    })

    it('keeps a named band and its window', () => {
        const version = energyVersion([period('p1', { period_type: 'band', label: 'Morning', time_from: '07:00', time_to: '12:00', weekdays: '0,1,2,3,4' })])
        expect(buildRateLines(energySeries(), version, t, DAY_NAMES, MONTH_NAMES, formatDate)[0].applies)
            .toBe('Morning Mon–Fri, 07:00–12:00')
    })

    it('keeps applicability for a single restricted percentage band', () => {
        const series = energySeries({ billing_mode: 'percentage_of_energy' })
        const version = energyVersion(
            [period('p1', { period_type: 'high', percentage: '60', weekdays: '0,1,2,3,4', time_from: '07:00', time_to: '21:00' })],
            { percentage_base_summary: { price_chf_per_kwh: '0.295', dynamic_status: null, reference_date: '2026-06-15' } },
        )
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.applies).toContain('High (HT)')
        expect(line.applies).toContain('Mon–Fri')
        expect(line.applies).toContain('07:00–21:00')
        expect(line.applies).toContain('60% of the grid tariff (0.295)')
        expect(line.price).toBe('≈ 0.177')
        expect(line.unit).toBe('CHF/kWh')
    })

    it('names an unrestricted single percentage band honestly instead of dropping it', () => {
        const series = energySeries({ billing_mode: 'percentage_of_energy' })
        const version = energyVersion(
            [period('p1', { period_type: 'flat', percentage: '60' })],
            { percentage_base_summary: { price_chf_per_kwh: '0.295', dynamic_status: null, reference_date: '2026-06-15' } },
        )
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.applies).toBe('All hours · 60% of the grid tariff (0.295)')
    })

    it('keeps season restrictions on a single percentage band', () => {
        const series = energySeries({ billing_mode: 'percentage_of_energy' })
        const version = energyVersion(
            [period('p1', { period_type: 'band', label: 'Winter', percentage: '90', months: '10,11,12,1,2,3' })],
            { percentage_base_summary: { price_chf_per_kwh: '0.300', dynamic_status: null, reference_date: '2026-06-15' } },
        )
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.applies).toContain('Winter')
        expect(line.applies).toContain('Oct–Mar')
        expect(line.applies).toContain('90% of the grid tariff')
    })

    it('keeps hours, prices and units paired and ordered across energy bands', () => {
        const series = energySeries({})
        const version = energyVersion([
            period('ht', { period_type: 'high', price_chf_per_kwh: '0.28000', time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4' }),
            period('nt', { period_type: 'low', price_chf_per_kwh: '0.18000', time_from: '21:00', time_to: '07:00' }),
        ])
        const lines = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(lines).toHaveLength(2)
        expect(lines[0].applies).toContain('High (HT)')
        expect(lines[0].price).toBe('0.280')
        expect(lines[0].unit).toBe('CHF/kWh')
        expect(lines[1].applies).toContain('Low (NT)')
        expect(lines[1].price).toBe('0.180')
        expect(lines[1].unit).toBe('CHF/kWh')
    })

    it('reads a decimal zero price as a price, not as missing', () => {
        const series = energySeries({})
        const version = energyVersion([period('p1', { period_type: 'flat', price_chf_per_kwh: '0.00000' })])
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.price).toBe('0.000')
    })

    it('labels dynamic complete, partial and unavailable distinctly', () => {
        const series = energySeries({})
        const complete = energyVersion([], {
            dynamic_source: 's1',
            dynamic_price_summary: { status: 'complete', average_chf_per_kwh: '0.123', reference_from: '2026-09-15', reference_to: '2026-10-14' },
        })
        const partial = energyVersion([], {
            dynamic_source: 's1',
            dynamic_price_summary: { status: 'partial', average_chf_per_kwh: '0.123', reference_from: '2026-09-15', reference_to: '2026-10-14' },
        })
        const unavailable = energyVersion([], {
            dynamic_source: 's1',
            dynamic_price_summary: { status: 'unavailable', average_chf_per_kwh: null, reference_from: null, reference_to: null },
        })
        expect(buildRateLines(series, complete, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'Dynamic, average 15.09.2026 – 14.10.2026', price: '0.123', unit: 'CHF/kWh',
        })
        expect(buildRateLines(series, partial, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'Dynamic, incomplete average 15.09.2026 – 14.10.2026', price: '0.123',
        })
        expect(buildRateLines(series, unavailable, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'Dynamic price', price: '—',
        })
    })

    it('shows no fabricated approximation when the percentage base is unavailable', () => {
        const series = energySeries({ billing_mode: 'percentage_of_energy' })
        const version = energyVersion(
            [period('p1', { period_type: 'flat', percentage: '60' })],
            { percentage_base_summary: { price_chf_per_kwh: null, dynamic_status: 'unavailable', reference_date: '2026-06-15' } },
        )
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.price).toBe('—')
        expect(line.applies).toContain('60% of the grid tariff')
        expect(line.applies).not.toContain('≈')
    })

    it('names monthly and yearly fee allocation and units', () => {
        const monthly = energySeries({ billing_mode: 'monthly_fee' })
        const sharedYearly = energySeries({ billing_mode: 'shared_yearly_fee' })
        const perPoint = energySeries({ billing_mode: 'per_metering_point_monthly_fee' })
        const monthlyVersion = energyVersion([], { fixed_price_chf: '50.00' })
        const sharedVersion = energyVersion([], { fixed_price_chf: '90.00' })
        expect(buildRateLines(monthly, energyVersion([], { fixed_price_chf: null }), t, DAY_NAMES, MONTH_NAMES, formatDate)[0].price).toBe('—')
        expect(buildRateLines(monthly, energyVersion([], { fixed_price_chf: '0.00' }), t, DAY_NAMES, MONTH_NAMES, formatDate)[0].price).toBe('0.00')
        expect(buildRateLines(monthly, monthlyVersion, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'per participant', price: '50.00', unit: 'CHF/month',
        })
        expect(buildRateLines(sharedYearly, sharedVersion, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'shared by the participants', price: '90.00', unit: 'CHF/year',
        })
        expect(buildRateLines(perPoint, monthlyVersion, t, DAY_NAMES, MONTH_NAMES, formatDate)[0]).toMatchObject({
            applies: 'per metering point', unit: 'CHF/month',
        })
    })

    it('reports a version without bands instead of an empty row', () => {
        const series = energySeries({})
        const version = energyVersion([])
        const [line] = buildRateLines(series, version, t, DAY_NAMES, MONTH_NAMES, formatDate)
        expect(line.applies).toBe('No tariff periods yet.')
        expect(line.price).toBe('')
    })
})

// Currency stays beside every price, independently of the hidden column headings.
describe('tariff list narrow markup', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>
    let client: QueryClient
    const onOpenDetail = vi.fn()

    beforeEach(() => {
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        onOpenDetail.mockClear()
    })

    afterEach(() => {
        act(() => root.unmount())
        client.clear()
        container.remove()
    })

    async function renderList(overrides: Partial<TariffVersion> = {}, seriesOverrides: Partial<TariffSeries> = {}) {
        const { TariffCategorySections } = await import('../src/features/tariffs/TariffCategorySections')
        const settings = {
            date_format_short: 'dd.MM.yyyy', date_format_long: 'd MMMM yyyy',
            date_time_format: 'dd.MM.yyyy HH:mm', updated_at: '',
        }
        const version = energyVersion([
            period('ht', { period_type: 'high', price_chf_per_kwh: '0.28000', time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4' }),
            period('nt', { period_type: 'low', price_chf_per_kwh: '0.18000', time_from: '21:00', time_to: '07:00' }),
        ], overrides)
        const series = energySeries({ versions: [version], active_version_id: 'v1', ...seriesOverrides })
        await act(async () => {
            root.render(createElement(
                QueryClientProvider,
                { client },
                createElement(MantineProvider, null, createElement(TariffCategorySections, {
                    rows: [{ series, version }],
                    kind: 'current',
                    settings,
                    expandedVersion: () => null,
                    renderDetail: () => null,
                    onOpenDetail,
                    onCloseDetail: vi.fn(),
                })),
            ))
        })
    }

    it('keeps CHF in the narrow per-band markup and a tooltip on the validity', async () => {
        await renderList()
        const bands = container.querySelectorAll('.tariff-table-band-price')
        expect(bands.length).toBe(2)
        expect(bands[0].textContent).toContain('0.280')
        expect(bands[0].textContent).toContain('CHF')
        expect(bands[0].textContent).toContain('CHF/kWh')
        const valid = container.querySelector('.tariff-table-valid span[title]')
        expect(valid?.getAttribute('title')).toContain('01.01.2020')
    })

    it('opens once from the button and once from the row', async () => {
        await renderList({}, { active_version_id: 'stale-version' })
        const button = container.querySelector('button.tariff-select') as HTMLButtonElement
        expect(button.getAttribute('aria-expanded')).toBe('false')
        await act(async () => { button.click() })
        expect(onOpenDetail).toHaveBeenCalledTimes(1)
        expect(onOpenDetail).toHaveBeenLastCalledWith(expect.anything(), 'v1')
        const row = container.querySelector('tbody tr') as HTMLTableRowElement
        await act(async () => {
            row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        expect(onOpenDetail).toHaveBeenCalledTimes(2)
        expect(onOpenDetail).toHaveBeenLastCalledWith(expect.anything(), 'v1')
    })

    it('visibly qualifies a partial percentage base and retains its pricing explanation', async () => {
        await renderList({
            periods: [period('p1', { percentage: '60' })],
            percentage_base_summary: {
                price_chf_per_kwh: '0.295', dynamic_status: 'partial', reference_date: '2026-06-15',
            },
        }, { billing_mode: 'percentage_of_energy' })
        const band = container.querySelector('.tariff-table-band')!
        expect(band.textContent).toContain('incomplete base average')
        expect(band.textContent).toContain('≈ 0.177 CHF')
        expect(band.getAttribute('title')).toContain('60% of CHF 0.295/kWh = CHF 0.177/kWh')
        expect(band.getAttribute('title')).toContain('only the intervals available')
        const cell = band.closest('td')!
        const headers = cell.getAttribute('headers')!.split(' ').map(id => container.querySelector(`#${id}`)?.textContent)
        expect(headers).toContain('pages.tariffs.rateCard.price')
    })

    it('does not mark a complete percentage base as incomplete', async () => {
        await renderList({
            periods: [period('p1', { percentage: '60' })],
            percentage_base_summary: {
                price_chf_per_kwh: '0.295', dynamic_status: 'complete', reference_date: '2026-06-15',
            },
        }, { billing_mode: 'percentage_of_energy' })
        expect(container.querySelector('.tariff-table-band')!.textContent).not.toContain('incomplete base average')
    })
})
