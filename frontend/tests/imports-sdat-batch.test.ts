import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mutateCalls: Array<{ vars: any; opts?: any }> = []
const mutationOptions: Array<any> = []
const pushToast = vi.fn()
const translate = vi.fn((key: string) => key)

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: importLogsData, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
    useMutation: (options: any) => {
        mutationOptions.push(options)
        return {
            isPending: false,
            mutate: (vars: unknown, opts?: any) => {
                mutateCalls.push({ vars, opts })
            },
        }
    },
}))
vi.mock('../src/components/CivilDateInput', () => ({
    CivilDateInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        createElement('input', { type: 'date', value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value) }),
}))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }))
vi.mock('../src/lib/managedZev', () => ({
    useManagedZev: () => ({ selectedZevId: 'zev-1', selectedZev: { id: 'zev-1', name: 'ZEV 1' } }),
    useOptionalManagedZev: () => ({ selectedZevId: 'zev-1', selectedZev: { id: 'zev-1', name: 'ZEV 1' } }),
}))
vi.mock('../src/lib/appSettings', () => ({
    useAppSettings: () => ({ settings: {} }),
    formatDateTime: (value: string) => value,
    formatShortDate: (value: string) => value,
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}))
vi.mock('../src/lib/toast', () => ({
    useToast: () => ({ pushToast }),
}))

import { ImportsPage } from '../src/pages/ImportsPage'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let importLogsData: any[] = []

function buttons(label: string): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('button')).filter(
        (button) => button.textContent === label,
    ) as HTMLButtonElement[]
}

function sdatLog(overrides: Record<string, unknown> = {}) {
    return {
        id: 'log-1',
        batch_id: 'batch-1',
        zev: 'zev-1',
        created_at: '2026-03-10T09:00:00Z',
        source: 'sdatch',
        filename: 'delivery.xml',
        rows_total: 96,
        rows_imported: 96,
        rows_overwritten: 0,
        rows_skipped: 0,
        errors: [],
        warnings: [],
        result_status: 'accepted',
        result_counts: {
            created: 96, overwritten: 0, held: 0, promoted: 0, duplicate: 0,
            stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
        },
        issues: [],
        ...overrides,
    }
}

function renderPage() {
    act(() => {
        root.render(
            createElement(MantineProvider, null,
                createElement(MemoryRouter, null, createElement(ImportsPage))),
        )
    })
}

function openWizard() {
    act(() => {
        buttons('pages.imports.actions.newImport')[0].click()
    })
}

function selectSdatch() {
    const select = container.querySelector('select') as HTMLSelectElement
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => {
        setter.call(select, 'sdatch')
        select.dispatchEvent(new Event('change', { bubbles: true }))
    })
}

function pick(...names: string[]) {
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const picked = names.map((name) => new File(['<x/>'], name, { type: 'text/xml' }))
    Object.defineProperty(input, 'files', { value: picked, configurable: true })
    act(() => {
        input.dispatchEvent(new Event('change', { bubbles: true }))
    })
}

function goToStep2WithFiles(...names: string[]) {
    openWizard()
    selectSdatch()
    pick(...names)
    act(() => {
        buttons('pages.imports.wizard.nextConfig')[0].click()
    })
}

function startImport() {
    act(() => {
        buttons('pages.imports.wizard.startImport')[0].click()
    })
}

/** Resolve the upload mutation with one outcome per file. */
function resolveUpload(outcomes: Array<{ file: File; value: unknown; error: unknown }>) {
    act(() => {
        mutationOptions[1].onSuccess(outcomes, mutateCalls[mutateCalls.length - 1].vars)
    })
}

function uploadFiles(): File[] {
    return (mutateCalls[mutateCalls.length - 1].vars as { files: File[] }).files
}

beforeEach(() => {
    mutateCalls.length = 0
    mutationOptions.length = 0
    importLogsData = []
    pushToast.mockClear()
    translate.mockClear()
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    renderPage()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('ImportsPage SDAT-CH batch outcomes', () => {
    it('accepts gzipped deliveries in the picker', () => {
        openWizard()
        selectSdatch()
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        expect(input.accept).toContain('.gz')
        pick('delivery.xml.gz')
        expect(buttons('pages.imports.wizard.nextConfig')[0].disabled).toBe(false)
    })

    it('keeps only the rejected file selected after a mixed batch', () => {
        goToStep2WithFiles('good.xml', 'bad.xml')
        startImport()
        const files = uploadFiles()
        resolveUpload([
            { file: files[0], value: sdatLog({ id: 'log-good', filename: 'good.xml' }), error: null },
            {
                file: files[1],
                value: sdatLog({
                    id: 'log-bad',
                    filename: 'bad.xml',
                    rows_imported: 0,
                    result_status: 'rejected',
                    issues: [{ code: 'unknown_meter', severity: 'error', message: 'no such meter', meter_id: 'CH-X' }],
                }),
                error: null,
            },
        ])
        // The rejected 201 log failed semantically: partial toast names it…
        expect(pushToast).toHaveBeenCalledWith('pages.imports.messages.importBatchPartial', 'error')
        expect(translate).toHaveBeenCalledWith('pages.imports.messages.importBatchPartial', {
            done: 1, total: 2, failed: 1, names: 'bad.xml',
        })
        // …its protocol opens, and the retry covers only that file.
        expect(container.textContent).toContain('pages.imports.protocol.title')
        expect(container.textContent).toContain('pages.imports.protocol.outcome.rejected')
        startImport()
        expect(uploadFiles().map((file) => file.name)).toEqual(['bad.xml'])
    })

    it('opens the protocol with a rejected notice for a single rejected file', () => {
        goToStep2WithFiles('bad.xml')
        startImport()
        const files = uploadFiles()
        resolveUpload([
            {
                file: files[0],
                value: sdatLog({
                    rows_imported: 0,
                    result_status: 'rejected',
                    issues: [{ code: 'missing_position', severity: 'error', message: 'incomplete', block_id: 'DOC-1' }],
                }),
                error: null,
            },
        ])
        expect(pushToast).toHaveBeenCalledWith('pages.imports.messages.importSdatRejected', 'error')
        expect(container.textContent).toContain('pages.imports.protocol.title')
        // A rejected file wrote nothing: the wizard stays open for a retry.
        expect(container.textContent).toContain('pages.imports.wizard.title')
    })

    it('closes the wizard for held-only and correction-only successes', () => {        goToStep2WithFiles('held.xml')
        startImport()
        const files = uploadFiles()
        resolveUpload([
            {
                file: files[0],
                value: sdatLog({
                    rows_imported: 0,
                    result_status: 'held',
                    result_counts: {
                        created: 0, overwritten: 0, held: 4, promoted: 0, duplicate: 0,
                        stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 0,
                    },
                }),
                error: null,
            },
        ])
        expect(pushToast).toHaveBeenCalledWith('pages.imports.messages.importSuccess', 'success')
        expect(container.textContent).not.toContain('pages.imports.wizard.title')
    })
})

describe('ImportsPage SDAT-CH deletion gating', () => {
    function historyLog(overrides: Record<string, unknown> = {}) {
        return {
            id: 'log-1',
            zev: 'zev-1',
            created_at: '2026-03-10T09:00:00Z',
            source: 'sdatch',
            filename: 'delivery.xml',
            rows_total: 96,
            rows_imported: 96,
            rows_overwritten: 0,
            rows_skipped: 0,
            ...overrides,
        }
    }

    function openBulkDelete() {
        act(() => {
            buttons('pages.imports.actions.deleteImports')[0].click()
        })
    }

    function setInputValue(input: HTMLInputElement, value: string) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        act(() => {
            setter.call(input, value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
        })
    }

    it('gates a quarantine-replacement import like a billable overwrite', () => {
        importLogsData = [
            historyLog({
                id: 'log-held',
                filename: 'held.xml',
                rows_overwritten: 0,
                result_status: 'accepted',
                result_counts: {
                    created: 0, overwritten: 0, held: 4, promoted: 0, duplicate: 0,
                    stale: 0, excluded: 0, rejected: 0, quarantine_overwritten: 4,
                },
                deletable: false,
                deletion_protection_code: 'quarantine_replace_protected',
            }),
            historyLog({ id: 'log-clean', filename: 'clean.xml' }),
        ]
        renderPage()
        // Single delete is disabled for the protected log…
        const rows = Array.from(container.querySelectorAll('tbody tr'))
        const heldRow = rows.find((row) => row.textContent?.includes('held.xml'))!
        const actions = Array.from(heldRow.querySelectorAll('button')).find(
            (button) => button.textContent === 'pages.imports.actions.rowActions',
        )!
        expect(actions.disabled).toBe(true)
        const protocol = Array.from(heldRow.querySelectorAll('button')).find(
            (button) => button.textContent === 'pages.imports.actions.openProtocol',
        )!
        act(() => protocol.click())
        expect(container.textContent).toContain('pages.imports.delete.quarantineProtected')
        act(() => {
            (container.querySelector('.form-modal-close') as HTMLButtonElement).click()
        })
        // …and a bulk selection containing it is blocked all-or-nothing.
        openBulkDelete()
        const dates = container.querySelectorAll<HTMLInputElement>('input[type=date]')
        setInputValue(dates[0], '2026-03-01')
        setInputValue(dates[1], '2026-03-31')
        expect(container.textContent).toContain('pages.imports.delete.blockedNotice')
        expect(buttons('pages.imports.delete.reviewAction')[0].disabled).toBe(true)
    })
})
