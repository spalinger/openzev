import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ImportLog } from '../src/types/api'

import { en } from '../src/i18n/locales/en'

function localeHasKey(key: string): boolean {
    let node: unknown = en
    for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null || !(part in node)) return false
        node = (node as Record<string, unknown>)[part]
    }
    return typeof node === 'string'
}

vi.mock('react-i18next', () => ({
    // Faithful fallback: known keys resolve to themselves, unknown issue
    // codes resolve to the defaultValue exactly like i18next does.
    useTranslation: () => ({
        t: (key: string, vars?: Record<string, unknown>) =>
            vars && typeof vars.defaultValue === 'string' && !localeHasKey(key)
                ? vars.defaultValue as string
                : key,
    }),
}))
const heldApi = vi.hoisted(() => ({ fetchHeldMeteringReadings: vi.fn() }))
vi.mock('../src/lib/api/metering', () => ({
    fetchHeldMeteringReadings: heldApi.fetchHeldMeteringReadings,
}))
vi.mock('../src/lib/appSettings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/appSettings')>()
    return {
        ...actual,
        useAppSettings: () => ({ settings: {} }),
        formatDateTime: (value: string) => value,
    }
})

import { ImportProtocolModal } from '../src/features/imports/ImportProtocolModal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function baseLog(overrides: Partial<ImportLog> = {}): ImportLog {
    return {
        id: 'log-1',
        batch_id: 'batch-1',
        zev: 'zev-1',
        zev_name: 'ZEV 1',
        imported_by_display: 'admin',
        filename: 'delivery.xml',
        rows_total: 96,
        rows_imported: 96,
        rows_overwritten: 0,
        rows_skipped: 0,
        source: 'sdatch',
        errors: [],
        warnings: [],
        created_at: '2026-03-10T09:00:00Z',
        ...overrides,
    }
}

describe('ImportProtocolModal structured SDAT-CH rendering', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>
    let queryClient: QueryClient

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        heldApi.fetchHeldMeteringReadings.mockReset()
        heldApi.fetchHeldMeteringReadings.mockResolvedValue({ count: 0, page_size: 50, next: null, previous: null, results: [] })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function render(log: ImportLog) {
        act(() => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: queryClient },
                    createElement(ImportProtocolModal, { log, onClose: () => undefined }),
                ),
            )
        })
    }

    async function renderAndSettle(log: ImportLog) {
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    { client: queryClient },
                    createElement(ImportProtocolModal, { log, onClose: () => undefined }),
                ),
            )
        })
    }

    it('renders a mixed billable/held result from counters, not prose', () => {
        render(baseLog({
            result_status: 'accepted',
            result_counts: {
                created: 90, overwritten: 0, held: 4, promoted: 2, duplicate: 2,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [
                { code: 'reactive_excluded', severity: 'info', message: 'backend prose', block_id: 'DOC-9', product: '8716867000047' },
            ],
            source_delivery: {
                delivery_id: 'DEL-1', creation: '2026-03-09T10:00:00Z', status: '9', reason: 'E88',
                sender_id: 'SENDER', sender_role: 'DSO', receiver_id: 'OPENZEV', receiver_role: 'ZEV',
            },
        }))
        const text = container.textContent ?? ''
        // Outcome + counters from structured fields.
        expect(text).toContain('pages.imports.protocol.outcome.accepted')
        expect(text).toContain('pages.imports.protocol.counts.created')
        expect(text).toContain('pages.imports.protocol.counts.held')
        expect(text).toContain('pages.imports.protocol.promotedNote')
        // Delivery identity and stable issue code with params.
        expect(text).toContain('DEL-1')
        expect(text).toContain('pages.imports.issues.reactive_excluded')
        expect(text).toContain('pages.imports.protocol.issueParam.block_id')
        // Legacy CSV totals stay out of the structured view.
        expect(text).not.toContain('pages.imports.protocol.totalRows')
    })

    it('opens the held observations of this import, filtered to its batch', async () => {
        heldApi.fetchHeldMeteringReadings.mockResolvedValue({
            count: 2, page_size: 50, next: null, previous: null,
            results: ['METER-A', 'METER-B'].map((meter_id, index) => ({
                id: meter_id, meter_id,
                timestamp: `2026-10-25T0${index}:00:00Z`, direction: 'in', energy_kwh: '1.0000',
                condition: '21', accepted_energy_kwh: null, business_reason: 'E88',
                source_delivery_id: 'DELIVERY', source_document_id: `DOCUMENT-${index}`,
                source_creation: null, created_at: '2026-10-26T00:00:00Z',
            })),
        })
        await renderAndSettle(baseLog({
            result_status: 'accepted',
            batch_id: 'batch-42',
            result_counts: {
                created: 90, overwritten: 0, held: 4, promoted: 0, duplicate: 0,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.protocol.heldTitle')
        expect(heldApi.fetchHeldMeteringReadings).toHaveBeenCalledWith(
            expect.objectContaining({ importBatch: 'batch-42' }),
        )
        await vi.waitFor(() => expect(container.textContent).toContain('METER-B'))
        expect(container.textContent).toContain('METER-A')
        expect(container.textContent).toContain('DELIVERY')
        expect(container.textContent).toContain('DOCUMENT-0')
        expect(container.textContent).toContain('DOCUMENT-1')
        expect(container.textContent).toContain('GMT+02:00')
        expect(container.textContent).toContain('GMT+01:00')
    })

    it('keeps a held-only accepted result distinct from a rejection', () => {
        render(baseLog({
            result_status: 'held',
            rows_imported: 0,
            result_counts: {
                created: 0, overwritten: 0, held: 4, promoted: 0, duplicate: 0,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.protocol.outcome.held')
        expect(text).not.toContain('pages.imports.protocol.outcome.rejected')
    })

    it('marks a correction-only result successful with zero new rows', () => {
        render(baseLog({
            result_status: 'accepted',
            result_counts: {
                created: 0, overwritten: 4, held: 0, promoted: 4, duplicate: 0,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [],
        }))
        expect(container.textContent).toContain('pages.imports.protocol.outcome.correctionOnly')
    })

    it('renders an identical replay as unchanged and a bad file as rejected', () => {
        render(baseLog({
            result_status: 'unchanged',
            rows_imported: 0,
            result_counts: {
                created: 0, overwritten: 0, held: 0, promoted: 0, duplicate: 96,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [{ code: 'duplicate_delivery', severity: 'info', message: 'already there', duplicate: 96 }],
        }))
        expect(container.textContent).toContain('pages.imports.protocol.outcome.unchanged')

        render(baseLog({
            result_status: 'rejected',
            rows_imported: 0,
            result_counts: {
                created: 0, overwritten: 0, held: 0, promoted: 0, duplicate: 0,
                stale: 0, excluded: 0, rejected: 96, quarantine_overwritten: 0,
            },
            issues: [{ code: 'unknown_meter', severity: 'error', message: 'no such meter', meter_id: 'CH-X', block_id: 'DOC-1' }],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.protocol.outcome.rejected')
        expect(text).toContain('pages.imports.issues.unknown_meter')
        expect(text).toContain('pages.imports.protocol.issueParam.meter_id')
    })

    it('reports an unsupported profile by code with resolution details', () => {
        render(baseLog({
            result_status: 'rejected',
            rows_imported: 0,
            result_counts: {
                created: 0, overwritten: 0, held: 0, promoted: 0, duplicate: 0,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
            },
            issues: [{ code: 'unsupported_reason', severity: 'error', message: 'C40 LEG', reason: 'C40' }],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.issues.unsupported_reason')
        expect(text).toContain('pages.imports.protocol.issueParam.reason')
    })

    it('falls back to the backend message for unmapped codes', () => {
        render(baseLog({
            result_status: 'rejected',
            rows_imported: 0,
            issues: [{ code: 'future_code', severity: 'error', message: 'Some new backend detail.' }],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.issues.unknownCode')
        expect(text).toContain('Some new backend detail.')
    })

    it('explains quarantine-replacement protection distinctly', () => {
        render(baseLog({
            result_status: 'accepted',
            result_counts: {
                created: 0, overwritten: 0, held: 4, promoted: 0, duplicate: 0,
                stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 4,
            },
            deletable: false,
            deletion_protection_code: 'quarantine_replace_protected',
            issues: [],
        }))
        expect(container.textContent).toContain('pages.imports.delete.quarantineProtected')
    })

    it('keeps the legacy CSV rendering without structured metadata', () => {
        render(baseLog({
            source: 'csv',
            rows_total: 10,
            rows_imported: 9,
            rows_skipped: 1,
            warnings: [{ row: null, warning: 'Overwrote 1 existing reading.' }],
            errors: [{ row: 2, meter_id: 'M-9', error: 'Duplicate reading' }],
        }))
        const text = container.textContent ?? ''
        expect(text).toContain('pages.imports.protocol.totalRows')
        expect(text).toContain('Overwrote 1 existing reading.')
        expect(text).toContain('M-9')
        expect(text).not.toContain('pages.imports.protocol.outcome.accepted')
    })
})
