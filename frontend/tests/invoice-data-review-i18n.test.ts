import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { en } from '../src/i18n/locales/en'
import type { Invoice } from '../src/types/api'

// No react-i18next mock here: this file renders through a real instance so
// plural resolution (_one/_other) is genuinely exercised.
import { InvoiceDataReviewNotice } from '../src/features/invoices/InvoiceDataReviewNotice'

vi.mock('../src/lib/appSettings', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/appSettings')>()
    return {
        ...actual,
        useAppSettings: () => ({ settings: {} }),
        formatShortDate: (value: string) => value,
    }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const instance = i18n.createInstance()

async function readyI18n() {
    if (instance.isInitialized) return
    await instance.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: 'en',
        resources: { en: { translation: en } },
        interpolation: { escapeValue: false },
    })
}

describe('InvoiceDataReviewNotice evidence plural resolution', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>

    beforeEach(async () => {
        await readyI18n()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function invoice(overrides: Partial<Invoice> = {}): Invoice {
        return {
            id: 'inv-1',
            invoice_number: 'INV-1',
            zev: 'zev-1',
            zev_name: 'ZEV 1',
            participant: 'p-1',
            participant_name: 'Anna',
            period_start: '2026-02-01',
            period_end: '2026-02-28',
            total_chf: '10.00',
            status: 'sent',
            ...overrides,
        }
    }

    it('renders resolved evidence sentences, not raw keys', () => {
        const inv = invoice({
            needs_data_review: true,
            open_data_impact_count: 2,
            data_impacts: [
                {
                    id: 'imp-1',
                    import_log: 'log-1',
                    evidence: { source: 'sdat-import', delivery_id: 'DEL-1', change_count: 4, day_from: '2026-02-03', day_to: '2026-02-04' },
                    created_at: '2026-03-01T10:00:00Z',
                    resolution: '',
                    resolved_at: null,
                },
                {
                    id: 'imp-2',
                    import_log: null,
                    evidence: { source: 'import-deletion', deleted_readings: 1, day_from: '2026-02-05', day_to: '2026-02-05' },
                    created_at: '2026-03-02T10:00:00Z',
                    resolution: '',
                    resolved_at: null,
                },
            ],
        })
        act(() => {
            root.render(createElement(I18nextProvider, { i18n: instance },
                createElement(InvoiceDataReviewNotice, { invoice: inv, variant: 'detail', canAct: true })))
        })
        const text = container.textContent ?? ''
        // A missing `count` would render the raw key instead of a sentence.
        expect(text).not.toContain('pages.invoices.dataReview.evidenceImport')
        expect(text).not.toContain('pages.invoices.dataReview.evidenceDeletion')
        expect(text).toContain('Delivery DEL-1 changed 4 intervals between 2026-02-03 and 2026-02-04.')
        expect(text).toContain('An import deletion removed 1 reading between 2026-02-05 and 2026-02-05.')
    })
})
