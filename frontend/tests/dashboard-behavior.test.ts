import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockState = vi.hoisted(() => ({
    // The account's relation to the selected community (#761).
    relation: 'manager',
    selectedZevId: 'z1',
    summary: null as unknown,
    summaryCalls: [] as Array<Record<string, unknown>>,
    hourlyProfile: null as unknown,
    hourlyCalls: [] as Array<Record<string, unknown>>,
    invoices: [] as Array<Record<string, unknown>>,
    invoiceCalls: [] as Array<unknown>,
}))

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

vi.mock('../src/lib/auth', () => ({
    useAuth: () => ({
        user: { role: 'user', memberships: [{ zev: 'z1', participants: [{ id: 'me', valid_from: '2026-01-01', valid_to: null, live: true }] }] },
    }),
}))

vi.mock('../src/lib/managedZev', () => {
    const context = {
        useManagedZev: () => ({
            managedZevs: [{ id: 'z1', name: 'Z1' }, { id: 'z2', name: 'Z2' }],
            selectedZevId: mockState.selectedZevId,
            selectedZev:
                mockState.relation === 'participant'
                    ? null
                    : { id: mockState.selectedZevId, name: mockState.selectedZevId.toUpperCase(), billing_interval: 'monthly' },
            relation: mockState.relation,
            entries: [{ id: mockState.selectedZevId, name: mockState.selectedZevId.toUpperCase(), relation: mockState.relation }],
            isLoading: false,
        }),
    }
    return { ...context, useOptionalManagedZev: context.useManagedZev }
})

vi.mock('../src/lib/appSettings', () => ({
    useAppSettings: () => ({ settings: {} }),
    formatShortDate: (d: string) => d,
}))

vi.mock('../src/lib/api/metering', () => ({
    fetchMeteringDashboardSummary: (args: Record<string, unknown>) => {
        mockState.summaryCalls.push(args ?? {})
        const value =
            typeof mockState.summary === 'function'
                ? (mockState.summary as (a: Record<string, unknown>) => unknown)(args ?? {})
                : mockState.summary
        return Promise.resolve(value)
    },
    fetchHourlyProfile: (args: Record<string, unknown>) => {
        mockState.hourlyCalls.push(args)
        return Promise.resolve({ hourly_profile: mockState.hourlyProfile })
    },
}))

vi.mock('../src/lib/api/invoices', () => ({
    fetchInvoices: (...args: unknown[]) => {
        mockState.invoiceCalls.push(args)
        return Promise.resolve(mockState.invoices)
    },
    openInvoicePdf: vi.fn(),
}))

import { DashboardPage } from '../src/pages/DashboardPage'
import { openInvoicePdf } from '../src/lib/api/invoices'

const cleanups: Array<() => void> = []
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    mockState.selectedZevId = 'z1'
    vi.clearAllMocks()
})

function managerSummary() {
    return {
        summary_kind: 'zev',
        bucket: 'day',
        zev_totals: { produced_kwh: 100, consumed_kwh: 80, imported_kwh: 20, exported_kwh: 40 },
        timeline: [],
        participant_stats: [
            {
                participant_id: 'p1',
                participant_name: 'Alice',
                total_consumed_kwh: 50,
                total_produced_kwh: 10,
                from_zev_kwh: 35,
                from_grid_kwh: 15,
            },
            {
                participant_id: 'p2',
                participant_name: 'Bob',
                total_consumed_kwh: 30,
                total_produced_kwh: 5,
                from_zev_kwh: 20,
                from_grid_kwh: 10,
            },
        ],
        selected_participant_name: null,
    }
}

function participantSummary(currentParticipantId: string | null) {
    return {
        summary_kind: 'participant',
        bucket: 'day',
        totals: { consumed_from_zev_kwh: 35, imported_from_grid_kwh: 15, total_consumed_kwh: 50 },
        timeline: [],
        zev_totals: { produced_kwh: 100, consumed_kwh: 80, imported_kwh: 20, exported_kwh: 40 },
        zev_participant_stats: [
            {
                participant_id: 'me',
                participant_name: 'Me',
                total_consumed_kwh: 50,
                total_produced_kwh: 10,
                from_zev_kwh: 35,
                from_grid_kwh: 15,
            },
        ],
        current_participant_id: currentParticipantId,
    }
}

// Re-renders the last mounted dashboard, as a community switch in the provider would.
let rerenderDashboard: () => Promise<void> = async () => {}

async function renderDashboard() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = () =>
        root.render(
            createElement(
                MantineProvider,
                null,
                createElement(
                    QueryClientProvider,
                    { client },
                    createElement(MemoryRouter, null, createElement(DashboardPage)),
                ),
            ),
        )
    await act(async () => {
        render()
    })
    rerenderDashboard = async () => {
        await act(async () => {
            render()
        })
    }
    await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
    })
    cleanups.push(() => {
        act(() => root.unmount())
        container.remove()
    })
    return container
}

async function flush() {
    await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
    })
}

describe('dashboard behavior preservation', () => {
    it('manager sees the per-participant breakdown table and no metering migration card', async () => {
        mockState.relation = 'manager'
        mockState.summary = managerSummary()
        mockState.summaryCalls = []
        mockState.invoiceCalls = []
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.invoices = []
        const container = await renderDashboard()
        expect(container.textContent).toContain('pages.dashboard.col.participant')
        expect(container.textContent).toContain('Alice')
        expect(container.textContent).toContain('Bob')
        expect(container.textContent).toContain('pages.dashboard.perParticipant')
        expect(container.textContent).not.toContain('perParticipantMigrated')
        expect(container.querySelector('a[href^="/metering/chart"]')).toBeNull()

        // ZEV-share column: Alice 35/50 = 70%, Bob 20/30 = 66.7%.
        expect(container.textContent).toContain('pages.dashboard.col.fromZevPercent')
        const rows = container.querySelectorAll('tbody tr')
        expect(rows[0].textContent).toContain('70 %')
        expect(rows[1].textContent).toContain('66.7 %')
    })

    it('flagged participant row shows — for the from-ZEV share and the ZEV-wide note appears', async () => {
        mockState.relation = 'manager'
        const base = managerSummary()
        mockState.summary = {
            ...base,
            zev_has_behind_meter_generation: true,
            participant_stats: base.participant_stats.map((participant) => ({
                ...participant,
                has_behind_meter_generation: participant.participant_id === 'p1',
            })),
        }
        mockState.summaryCalls = []
        mockState.invoiceCalls = []
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.invoices = []
        const container = await renderDashboard()

        const rows = container.querySelectorAll('.participant-table tbody tr')
        expect(rows.length).toBe(2)
        // Alice (p1) is flagged: her from-ZEV share is suppressed, and the badge appears.
        expect(rows[0].textContent).toContain('—')
        expect(rows[0].textContent).toContain('behindMeter.badge')
        // Bob (p2) is unaffected: his real 66.7 % share still shows, no badge.
        expect(rows[1].textContent).toContain('66.7 %')
        expect(rows[1].textContent).not.toContain('behindMeter.badge')

        expect(container.textContent).toContain('behindMeter.zevNote')
    })

    it('manager row click selects the participant and loads the hourly profile', async () => {
        mockState.relation = 'manager'
        mockState.summaryCalls = []
        mockState.summary = ((args: Record<string, unknown>) => {
            const base = managerSummary()
            if (args?.participantId === 'p1') {
                return { ...base, selected_participant_name: 'Alice' }
            }
            return base
        }) as unknown
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.invoices = []
        const container = await renderDashboard()
        expect(container.textContent).not.toContain('pages.dashboard.hourlyProfile.title')

        mockState.hourlyProfile = [{ hour: 10, from_zev_kwh: 1.5, from_grid_kwh: 0.5 }]
        const rows = container.querySelectorAll('tbody tr')
        expect(rows.length).toBe(2)
        await act(async () => {
            rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        for (let i = 0; i < 15 && !container.textContent?.includes('pages.dashboard.hourlyProfile.title'); i++) {
            await flush()
        }

        expect(mockState.hourlyCalls.some((call) => call.participantId === 'p1')).toBe(true)
        expect(mockState.summaryCalls.some((call) => call.participantId === 'p1')).toBe(true)
        expect(container.textContent).toContain('pages.dashboard.hourlyProfile.title')

        // Dropdown reflects the selection.
        const selects = container.querySelectorAll('select')
        expect(selects.length).toBeGreaterThan(0)
        expect((selects[0] as HTMLSelectElement).value).toBe('p1')

        // Selected row is highlighted (re-query after re-render).
        const updatedRows = container.querySelectorAll('tbody tr')
        expect(updatedRows.length).toBe(2)
        expect(updatedRows[0].classList.contains('is-selected')).toBe(true)
        const selectedButton = updatedRows[0].querySelector('button.participant-select')
        expect(selectedButton?.getAttribute('aria-current')).toBe('true')
        expect(updatedRows[1].querySelector('button.participant-select')?.hasAttribute('aria-current')).toBe(false)

        // Hourly heading names the participant.
        const hourlyHeading = Array.from(container.querySelectorAll('h3')).find((h) =>
            h.textContent?.includes('pages.dashboard.hourlyProfile.title'),
        )
        expect(hourlyHeading?.textContent).toContain('Alice')

        // Table shows Alice's actual breakdown values.
        expect(updatedRows[0].textContent).toContain('35 kWh')
        expect(updatedRows[0].textContent).toContain('15 kWh')

        // Community KPIs stay ZEV-wide.
        const kpiRow = container.querySelector('.kpi-row')
        expect(kpiRow?.textContent).toContain('100 kWh')
        expect(kpiRow?.textContent).toContain('80 kWh')
        expect(kpiRow?.textContent).toContain('20 kWh')
        expect(kpiRow?.textContent).toContain('40 kWh')

        // Balance chart heading is filtered to the participant.
        const balanceHeading = Array.from(container.querySelectorAll('h3')).find((h) =>
            h.textContent?.includes('pages.dashboard.consumptionAndProduction'),
        )
        expect(balanceHeading?.textContent).toContain('Alice')
    })

    it('manager community switch clears the participant filter before requesting', async () => {
        mockState.relation = 'manager'
        mockState.summaryCalls = []
        mockState.summary = managerSummary()
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.invoices = []
        const container = await renderDashboard()

        await act(async () => {
            container.querySelector('tbody tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        await flush()
        expect(mockState.summaryCalls.some((call) => call.zevId === 'z1' && call.participantId === 'p1')).toBe(true)

        mockState.selectedZevId = 'z2'
        await rerenderDashboard()
        await flush()

        const z2Summaries = mockState.summaryCalls.filter((call) => call.zevId === 'z2')
        expect(z2Summaries.length).toBeGreaterThan(0)
        expect(z2Summaries.every((call) => call.participantId === undefined)).toBe(true)
        expect(mockState.hourlyCalls.some((call) => call.zevId === 'z2')).toBe(false)
        expect((container.querySelector('select') as HTMLSelectElement).value).toBe('')
    })

    it('manager participant buttons and numeric cells select their rows', async () => {
        mockState.relation = 'manager'
        mockState.summaryCalls = []
        mockState.summary = managerSummary()
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.invoices = []
        const container = await renderDashboard()
        const rows = container.querySelectorAll('.participant-table tbody tr')
        expect(rows.length).toBe(2)
        const button = rows[1].querySelector('button.participant-select') as HTMLButtonElement
        expect(button.tabIndex).toBeGreaterThanOrEqual(0)
        button.focus()
        expect(document.activeElement).toBe(button)
        await act(async () => {
            button.click()
        })
        // jsdom cannot synthesize native Enter/Space button activation; the real browser check covers it.
        for (let i = 0; i < 20; i++) {
            await flush()
            const settledRows = container.querySelectorAll('.participant-table tbody tr')
            const profileLoaded = mockState.hourlyCalls.some((call) => call.participantId === 'p2')
            if (settledRows.length === 2 && settledRows[1].classList.contains('is-selected') && profileLoaded) break
        }
        expect(mockState.hourlyCalls.filter((call) => call.participantId === 'p2').length).toBe(1)

        const numericCell = container.querySelector('.participant-table tbody tr:first-child td.numeric')
        await act(async () => {
            numericCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        for (let i = 0; i < 20; i++) {
            await flush()
            const settledRows = container.querySelectorAll('.participant-table tbody tr')
            const profileLoaded = mockState.hourlyCalls.some((call) => call.participantId === 'p1')
            if (settledRows.length === 2 && settledRows[0].classList.contains('is-selected') && profileLoaded) break
        }
        expect(mockState.hourlyCalls.some((call) => call.participantId === 'p1')).toBe(true)
        expect(container.querySelector('.participant-table tbody tr:first-child')?.classList.contains('is-selected')).toBe(true)
    })

    it('participant energy flow requires current_participant_id', async () => {
        mockState.relation = 'participant'
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.summaryCalls = []
        mockState.invoiceCalls = []
        mockState.invoices = []

        mockState.summary = participantSummary(null)
        const withoutId = await renderDashboard()
        expect(withoutId.textContent).not.toContain('pages.dashboard.energyFlow.title')

        mockState.summary = participantSummary('me')
        const withId = await renderDashboard()
        expect(withId.textContent).toContain('pages.dashboard.energyFlow.title — Z1')

        // From-ZEV share KPI: 35 of 50 kWh = 70 %.
        expect(withId.textContent).toContain('pages.dashboard.participantStats.fromZevShare')
        expect(withId.textContent).toContain('70\u00a0%')
    })

    it('participant invoices keep the sent/paid pdf filter with details actions', async () => {
        mockState.relation = 'participant'
        mockState.hourlyProfile = null
        mockState.hourlyCalls = []
        mockState.summaryCalls = []
        mockState.invoiceCalls = []
        mockState.invoices = [
            { id: '1', invoice_number: 'INV-1', participant: 'me', status: 'approved', pdf_url: 'http://x/1', period_start: '2026-01-01', period_end: '2026-01-31', total_chf: '100.00' },
            { id: '2', invoice_number: 'INV-2', participant: 'me', status: 'draft', pdf_url: 'http://x/2', period_start: '2026-01-01', period_end: '2026-01-31', total_chf: '50.00' },
            { id: '3', invoice_number: 'INV-3', participant: 'me', status: 'sent', pdf_url: 'http://x/3', period_start: '2026-01-01', period_end: '2026-01-31', total_chf: '75.00' },
            { id: '4', invoice_number: 'INV-4', participant: 'me', status: 'paid', pdf_url: null, period_start: '2026-01-01', period_end: '2026-01-31', total_chf: '20.00' },
            { id: '5', invoice_number: 'INV-5', participant: 'me', status: 'paid', pdf_url: 'http://x/5', period_start: '2026-01-01', period_end: '2026-01-31', total_chf: '30.00' },
        ]
        // Defer the summary so the test proves invoices start loading independently.
        let resolveSummary!: (value: unknown) => void
        mockState.summary = new Promise((resolve) => {
            resolveSummary = resolve
        }) as unknown
        const container = await renderDashboard()
        expect(mockState.invoiceCalls.length).toBeGreaterThan(0)
        await act(async () => {
            resolveSummary(participantSummary('me'))
        })
        for (let i = 0; i < 15 && !container.textContent?.includes('INV-5'); i++) {
            await flush()
        }
        expect(container.textContent).not.toContain('INV-1')
        expect(container.textContent).toContain('INV-3')
        expect(container.textContent).toContain('INV-5')
        expect(container.textContent).not.toContain('INV-2')
        expect(container.textContent).not.toContain('INV-4')
        expect(container.querySelector('a[href="/billing/invoices/3"]')).not.toBeNull()
        expect(container.querySelector('a[href="/billing/invoices/5"]')).not.toBeNull()

        const paidRow = Array.from(container.querySelectorAll('tbody tr')).find((row) =>
            row.textContent?.includes('INV-5'),
        )
        expect(paidRow).not.toBeUndefined()
        const pdfButton = paidRow?.querySelector('button')
        expect(pdfButton).not.toBeNull()
        await act(async () => {
            pdfButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        expect(openInvoicePdf).toHaveBeenCalledWith('5')
    })
})
