import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { getCurrentBillingPeriod, getPreviousBillingPeriod } from '../src/lib/billingPeriod'
import { useBillingPeriodParams } from '../src/lib/useBillingPeriodParams'
import { usePageNavigation } from '../src/lib/usePageNavigation'

type Policy = Parameters<typeof useBillingPeriodParams>[0]
const defaultPolicy: Policy = { interval: 'monthly', ready: true, scopeId: 'a', fallback: 'current', scopeChange: 'preserve-url' }
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))

async function mount(url: string, initialPolicy: Partial<Policy> = {}) {
    let policy = { ...defaultPolicy, ...initialPolicy }
    let result!: ReturnType<typeof useBillingPeriodParams>
    let navigation!: ReturnType<typeof usePageNavigation>
    let navigate!: ReturnType<typeof useNavigate>
    const reads: Array<{ scopeId: string; period: { from: string; to: string } }> = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    function Host() {
        result = useBillingPeriodParams(policy)
        reads.push({ scopeId: policy.scopeId, period: result.period })
        navigation = usePageNavigation()
        navigate = useNavigate()
        const location = useLocation()
        return createElement('output', null, location.pathname + location.search + location.hash)
    }
    const render = () => root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Host)))
    await act(async () => render())
    cleanups.push(() => { act(() => root.unmount()); container.remove() })
    return {
        get period() { return result.period },
        get ready() { return result.isReady },
        get url() { return container.textContent ?? '' },
        reads,
        setPeriod: async (range: { from: string; to: string }) => { await act(async () => result.setPeriod(range)) },
        reconcile: async (next: Partial<Policy>) => {
            policy = { ...policy, ...next }
            await act(async () => render())
        },
        go: async (to: string | number) => { await act(async () => typeof to === 'number' ? navigate(to) : navigate(to)) },
        tab: async (pathname: string) => { await act(async () => navigation.navigateTab(pathname)) },
        queryTab: async (tab: string) => {
            await act(async () => navigation.updateParams(params => params.set('tab', tab), { replace: false }))
        },
    }
}

describe('shared period URL policies', () => {
    it('accepts historical invoice periods from community start even before the current aligned floor', async () => {
        const page = await mount('/billing/invoices?period_start=2026-02-15&period_end=2026-02-28', {
            interval: 'quarterly', fallback: 'previous-complete', minimumRangeStart: '2026-02-15',
            minimumFallback: { from: '2026-04-01', to: '2026-06-30' },
        })
        expect(page.period).toEqual({ from: '2026-02-15', to: '2026-02-28' })
        await page.reconcile({ interval: 'annual', minimumFallback: { from: '2027-01-01', to: '2027-12-31' } })
        expect(page.period).toEqual({ from: '2026-02-15', to: '2026-02-28' })
    })

    it('bounds the previous complete fallback by the first aligned period', async () => {
        const first = { from: '2099-04-01', to: '2099-06-30' }
        const page = await mount('/billing/invoices', { fallback: 'previous-complete', minimumFallback: first })
        expect(page.period).toEqual(first)
        const older = await mount('/billing/invoices', { fallback: 'previous-complete' })
        expect(older.period).toEqual(getPreviousBillingPeriod('monthly'))
    })

    it('accepts custom and single-day chart ranges without an aligned minimum', async () => {
        const page = await mount('/metering/chart?period_start=2024-02-29&period_end=2024-02-29')
        expect(page.period).toEqual({ from: '2024-02-29', to: '2024-02-29' })
        await page.go('/metering/chart?period_start=2024-02-12&period_end=2024-03-14')
        await page.reconcile({ interval: 'semi_annual' })
        expect(page.period).toEqual({ from: '2024-02-12', to: '2024-03-14' })
    })

    it.each([
        'period_start=nope&period_end=2026-01-31',
        'period_start=2026-02-30&period_end=2026-03-31',
        'period_start=2026-01-01',
        'period_end=2026-01-31',
        'period_start=2026-02-01&period_end=2026-01-31',
        'period_start=2026-01-01&period_end=2026-01-31&from=2025-01-01',
    ])('validates URL input: %s', async query => {
        const page = await mount(`/dashboard?${query}`)
        expect(page.period).toEqual(query.startsWith('period_start=2026-01-01&period_end=2026-01-31')
            ? { from: '2026-01-01', to: '2026-01-31' }
            : getCurrentBillingPeriod('monthly'))
    })

    it.each([
        'period_start=2026-02-30&period_end=2026-03-31',
        'period_start=2026-09-01',
        'period_end=2026-09-30',
        'period_start=2026-09-30&period_end=2026-09-01',
        'from=invalid&to=2026-09-30',
    ])('rewrites rejected billing parameters to the displayed fallback: %s', async query => {
        const page = await mount(`/billing/invoices?${query}&tab=history#details`, {
            scopeChange: 'align', legacyParams: true, fallback: 'previous-complete',
        })
        const params = new URL(page.url, 'https://example.test').searchParams
        expect(params.get('period_start')).toBe(page.period.from)
        expect(params.get('period_end')).toBe(page.period.to)
        expect(params.has('from')).toBe(false)
        expect(params.has('to')).toBe(false)
        expect(params.get('tab')).toBe('history')
        expect(page.url).toContain('#details')
    })

    it('only reads legacy pairs for the chart and never mixes partial canonical pairs', async () => {
        const url = '/metering/chart?from=2025-02-03&to=2025-03-14'
        const chart = await mount(url, { legacyParams: true })
        expect(chart.period).toEqual({ from: '2025-02-03', to: '2025-03-14' })
        const dashboard = await mount(url)
        expect(dashboard.period).toEqual(getCurrentBillingPeriod('monthly'))
        await chart.go(`${url}&period_start=2024-01-01`)
        expect(chart.period).toEqual(getCurrentBillingPeriod('monthly'))
    })

    it('writes canonical periods with replace and keeps other parameters and the hash through tabs/reload/back', async () => {
        const page = await mount('/before?period_start=2024-01-01&period_end=2024-01-31')
        await page.go('/metering/chart?from=2025-02-03&to=2025-03-14&metering_point=mp1&quality_severity=red#details')
        await page.reconcile({ legacyParams: true })
        await page.setPeriod({ from: '2025-02-12', to: '2025-03-14' })
        expect(page.url).toContain('metering_point=mp1&quality_severity=red')
        expect(page.url).toContain('period_start=2025-02-12&period_end=2025-03-14#details')
        expect(new URL(page.url, 'https://example.test').searchParams.has('from')).toBe(false)
        await page.tab('/metering/quality')
        expect(page.url).toContain('/metering/quality?')
        expect(page.url).toContain('#details')
        const reload = await mount(page.url, { legacyParams: true })
        expect(reload.period).toEqual(page.period)
        await page.go(-1)
        expect(page.period).toEqual({ from: '2024-01-01', to: '2024-01-31' })
        expect(page.url).toContain('/before?')
    })

    it('waits for necessary scope data and uses the resolved interval for its first default', async () => {
        const page = await mount('/billing/invoices?period_start=2025-01-01&period_end=2025-01-31', { ready: false })
        expect(page.ready).toBe(false)
        expect(page.period).toEqual({ from: '', to: '' })
        await page.setPeriod({ from: '2024-01-01', to: '2024-01-31' })
        expect(page.url).toContain('2025-01-01')
        await page.reconcile({ ready: true, interval: 'quarterly', minimumRangeStart: '2026-01-01', fallback: 'previous-complete' })
        expect(page.period).toEqual(getPreviousBillingPeriod('quarterly'))
    })

    it('revalidates invoices on community switches without carrying a pre-start range', async () => {
        const page = await mount('/billing/invoices?period_start=2025-01-01&period_end=2025-01-31', {
            fallback: 'previous-complete', minimumRangeStart: '2024-01-01',
        })
        await page.reconcile({ scopeId: 'b', minimumRangeStart: '2026-01-01' })
        expect(page.period).toEqual(getPreviousBillingPeriod('monthly'))
    })

    it('aligns a carried-over billing range to the new community\'s periods on a switch', async () => {
        const page = await mount('/billing/invoices?period_start=2026-09-01&period_end=2026-09-30', {
            fallback: 'previous-complete', minimumRangeStart: '2025-01-01', scopeChange: 'align',
        })
        // A monthly community's September is the quarterly community's Q3 …
        await page.reconcile({ scopeId: 'b', interval: 'quarterly' })
        expect(page.period).toEqual({ from: '2026-07-01', to: '2026-09-30' })
        expect(page.url).toContain('period_start=2026-07-01&period_end=2026-09-30')
        // … every read meanwhile was a whole period of the community it was paired with.
        expect(page.reads.filter(read => read.scopeId === 'b').map(read => read.period))
            .not.toContainEqual({ from: '2026-09-01', to: '2026-09-30' })
        // … and Q3 is September again on the way back.
        await page.reconcile({ scopeId: 'a', interval: 'monthly' })
        expect(page.period).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    })

    it('keeps a deep-linked range within one community and falls back before its first period', async () => {
        const page = await mount('/billing/invoices?period_start=2026-09-01&period_end=2026-09-30', {
            interval: 'quarterly', fallback: 'previous-complete', minimumRangeStart: '2025-01-01', scopeChange: 'align',
        })
        // An old monthly invoice's period, opened in a now-quarterly community, stays as linked.
        expect(page.period).toEqual({ from: '2026-09-01', to: '2026-09-30' })
        const first = { from: '2026-10-01', to: '2026-12-31' }
        await page.reconcile({ scopeId: 'b', minimumRangeStart: '2026-10-01', minimumFallback: first })
        expect(page.period).toEqual(first)
    })

    it('replaces a billing link it cannot show with the period it shows', async () => {
        // The community starts in July 2026: a range from 2025 is not one of its periods.
        const first = { from: '2026-07-01', to: '2026-07-31' }
        const page = await mount('/billing/invoices?period_start=2025-09-01&period_end=2026-09-30&tab=x', {
            fallback: 'previous-complete', minimumRangeStart: '2026-07-01', minimumFallback: first, scopeChange: 'align',
        })
        const shown = page.period
        expect(shown).not.toEqual({ from: '2025-09-01', to: '2026-09-30' })
        expect(page.url).toContain(`period_start=${shown.from}&period_end=${shown.to}`)
        expect(page.url).toContain('tab=x')
    })

    it('dashboard deep links reset to the current period on community and interval changes', async () => {
        const page = await mount('/dashboard?period_start=2025-02-03&period_end=2025-03-14&filter=mine#balance', { scopeChange: 'reset' })
        expect(page.period.from).toBe('2025-02-03')
        await page.reconcile({ scopeId: 'b' })
        expect(page.period).toEqual(getCurrentBillingPeriod('monthly'))
        expect(page.reads.filter(read => read.scopeId === 'b').every(read =>
            read.period.from === getCurrentBillingPeriod('monthly').from
            && read.period.to === getCurrentBillingPeriod('monthly').to,
        )).toBe(true)
        expect(page.url).toContain('filter=mine')
        expect(page.url).toContain('#balance')
        await page.reconcile({ interval: 'annual' })
        expect(page.period).toEqual(getCurrentBillingPeriod('annual'))
        await page.go('/dashboard?period_start=2025-06-01&period_end=2025-06-30')
        expect(page.period.from).toBe('2025-06-01')
    })

    it('query-based tabs push history while retaining filters and hashes', async () => {
        const page = await mount('/account?tab=profile&source=bookmark#security')
        await page.queryTab('security')
        expect(page.url).toBe('/account?tab=security&source=bookmark#security')
        await page.go(-1)
        expect(page.url).toBe('/account?tab=profile&source=bookmark#security')
    })
})
