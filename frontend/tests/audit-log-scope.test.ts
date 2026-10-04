import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuditLogsPage } from '../src/pages/AdminAuditLogsPage'
import { waitForCondition } from './helpers/waitForCondition'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

const mockAuth = vi.fn()
const mockManagedZev = vi.fn()

vi.mock('../src/lib/auth', () => ({
    useAuth: () => mockAuth(),
}))

vi.mock('../src/lib/managedZev', () => ({
    ManagedZevProvider: (props: { children: unknown }) => props.children,
    useManagedZev: () => mockManagedZev(),
    useOptionalManagedZev: () => mockManagedZev(),
}))

vi.mock('../src/lib/appSettings', () => ({
    useAppSettings: () => ({ settings: {}, isLoading: false }),
    formatShortDate: (d: string) => d,
    formatDateTime: (d: string) => d,
    toDayJsDateFormat: () => 'YYYY-MM-DD',
}))

const fetchAuditEvents = vi.fn()
const fetchAuditEvent = vi.fn()

vi.mock('../src/lib/api/audit', () => ({
    fetchAuditEvents: (...args: unknown[]) => fetchAuditEvents(...args),
    fetchAuditEvent: (...args: unknown[]) => fetchAuditEvent(...args),
    fetchAuditFilterOptions: () => Promise.resolve({
        zevs: [
            { id: 'z1', name: 'Z1' },
            { id: 'z2', name: 'Z2' },
        ],
        actors: [],
    }),
}))

const emptyPage = { results: [], count: 0, next: null, previous: null }

const sampleEvent = {
    id: 'e1',
    created_at: '2026-01-01',
    summary: 'Did something',
    zev: 'z1',
    action_category: 'metering',
    action_type: 'metering_point.update',
    target_display: 'meter',
    target_type: 'zev.MeteringPoint',
    target_id: 'm1',
    actor_display: 'owner',
    status: 'success',
}

function mockOwner() {
    mockAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        isImpersonating: false,
        impersonator: null,
        user: {
            id: 9,
            username: 'owner@example.com',
            email: 'owner@example.com',
            first_name: '',
            last_name: '',
            role: 'user',
            must_change_password: false,
            preferred_zev: null,
        },
    })
}

function mockAdmin() {
    mockAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        isImpersonating: false,
        impersonator: null,
        user: {
            id: 1,
            username: 'admin@example.com',
            email: 'admin@example.com',
            first_name: '',
            last_name: '',
            role: 'admin',
            must_change_password: false,
            preferred_zev: null,
        },
    })
}

function mockSelection(selectedZevId: string | null) {
    mockManagedZev.mockReturnValue({
        managedZevs: selectedZevId ? [{ id: selectedZevId }] : [],
        selectedZevId,
        selectedZev: selectedZevId ? { id: selectedZevId, name: selectedZevId === 'z1' ? 'Z1' : 'Z2' } : null,
        isSelectable: false,
        isLoading: false,
        setSelectedZevId: vi.fn(),
    })
}

function renderAuditLogs(scope: 'admin' | 'owner', initialEntries: string[] = ['/']) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root = createRoot(container)
    let navigate: ReturnType<typeof useNavigate>
    let path = ''
    function RouteProbe() {
        navigate = useNavigate()
        const location = useLocation()
        path = `${location.pathname}${location.search}${location.hash}`
        return null
    }
    const ui = () =>
        createElement(
            MantineProvider,
            null,
            createElement(
                MemoryRouter,
                { initialEntries },
                createElement(QueryClientProvider, { client }, createElement(AuditLogsPage, { scope }), createElement(RouteProbe)),
            ),
        )
    return {
        container,
        location: () => path,
        navigate: async (to: string) => {
            await act(async () => { navigate(to) })
        },
        mount: async () => {
            await act(async () => {
                root.render(ui())
            })
            for (let i = 0; i < 100 && !container.querySelector('h1'); i += 1) {
                await act(async () => {
                    await new Promise((r) => setTimeout(r, 50))
                })
            }
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0))
            })
        },
        rerender: async () => {
            await act(async () => {
                root.render(ui())
            })
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0))
            })
        },
        unmount: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

async function click(element: Element) {
    await act(async () => {
        ;(element as HTMLElement).click()
    })
    await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
    })
}

function buttonByText(container: HTMLElement, text: string) {
    const buttons = Array.from(container.querySelectorAll('button'))
    const found = buttons.find((b) => b.textContent === text)
    if (!found) throw new Error(`button "${text}" not found`)
    return found
}

async function waitForButton(container: HTMLElement, text: string) {
    for (let i = 0; i < 100; i += 1) {
        const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)
        if (found) return found
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50))
        })
    }
    throw new Error(`button "${text}" not found`)
}

function filterInput(container: HTMLElement, name: string) {
    const label = Array.from(container.querySelectorAll('label'))
        .find(label => label.textContent?.includes(`pages.auditLogs.filters.${name}`))
    return label!.querySelector('input')!
}

async function typeValue(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

describe('audit log community scope', () => {
    it('applies source activity links as visible target filters from the first request', async () => {
        mockAdmin()
        mockSelection('z1')
        const page = renderAuditLogs('admin', ['/admin/audit?target_type=tariffs.DynamicTariffSource&target_id=source-1&from=tariff#activity'])
        await page.mount()
        expect(fetchAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ target_type: 'tariffs.DynamicTariffSource', target_id: 'source-1' }))
        expect(fetchAuditEvents.mock.calls.every(([filters]) => filters.target_id === 'source-1')).toBe(true)
        const targetLabel = Array.from(page.container.querySelectorAll('label'))
            .find(label => label.textContent?.includes('pages.auditLogs.filters.targetId'))
        expect(targetLabel?.querySelector('input')?.value).toBe('source-1')
        await click(buttonByText(page.container, 'pages.auditLogs.actions.clearFilters'))
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ target_type: undefined, target_id: undefined }))
        expect(page.location()).toBe('/admin/audit?from=tariff#activity')
        page.unmount()
    })

    beforeEach(() => {
        document.body.innerHTML = ''
        vi.clearAllMocks()
        fetchAuditEvents.mockResolvedValue(emptyPage)
        fetchAuditEvent.mockResolvedValue({ id: 'e1' })
    })

    it.each([
        ['actionType', 'action_type', 'source.fetch'],
        ['targetType', 'target_type', 'tariffs.DynamicTariffSource'],
        ['targetId', 'target_id', 'source-2'],
    ])('keeps %s typing local and commits one request on Enter or blur', async (name, param, value) => {
        mockAdmin()
        mockSelection(null)
        const page = renderAuditLogs('admin', ['/admin/audit?from=bookmark#activity'])
        await page.mount()
        const input = filterInput(page.container, name)
        const before = fetchAuditEvents.mock.calls.length
        for (let length = 1; length <= value.length; length += 1) {
            await typeValue(input, value.slice(0, length))
            expect(input.value).toBe(value.slice(0, length))
        }
        expect(fetchAuditEvents).toHaveBeenCalledTimes(before)
        expect(page.location()).toBe('/admin/audit?from=bookmark#activity')
        await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
        await waitForCondition(() => fetchAuditEvents.mock.calls.length > before, 'committed audit text')
        expect(fetchAuditEvents.mock.calls.slice(before)).toHaveLength(1)
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ [param]: value, page: 1 }))
        expect(page.location()).toContain(`${param}=${encodeURIComponent(value)}`)
        expect(page.location()).toContain('from=bookmark')
        expect(page.location()).toContain('#activity')

        await typeValue(input, `${value}-updated`)
        const beforeBlur = fetchAuditEvents.mock.calls.length
        await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
        await waitForCondition(() => fetchAuditEvents.mock.calls.length > beforeBlur, 'blurred audit text')
        expect(fetchAuditEvents.mock.calls.slice(beforeBlur)).toHaveLength(1)
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ [param]: `${value}-updated` }))
        page.unmount()
    })

    it('synchronizes text drafts with external filters and clears unapplied typing', async () => {
        mockAdmin()
        mockSelection(null)
        const page = renderAuditLogs('admin', ['/admin/audit?target_id=source-1'])
        await page.mount()
        const input = filterInput(page.container, 'targetId')
        await typeValue(input, 'unapplied')
        await page.navigate('/admin/audit?target_id=source-1&from=bookmark#activity')
        expect(input.value).toBe('unapplied')
        await page.navigate('/admin/audit?target_id=source-2&from=bookmark#activity')
        expect(input.value).toBe('source-2')
        await typeValue(input, 'another draft')
        await click(buttonByText(page.container, 'pages.auditLogs.actions.clearFilters'))
        expect(input.value).toBe('')
        expect(page.location()).toBe('/admin/audit?from=bookmark#activity')
        page.unmount()
    })

    it('closes the previous event when a new actor intent arrives', async () => {
        mockAdmin()
        mockSelection(null)
        fetchAuditEvents.mockResolvedValue({ results: [sampleEvent], count: 150, next: 'next', previous: 'previous' })
        const page = renderAuditLogs('admin', ['/admin/audit?actor=41&actorUsername=first'])
        await page.mount()
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        await click(buttonByText(page.container, sampleEvent.summary))
        await waitForCondition(() => document.querySelector('[role="dialog"]') !== null, 'actor event drawer')
        await page.navigate('/admin/audit?actor=42&actorUsername=second&from=account#activity')
        await waitForCondition(() => fetchAuditEvents.mock.calls.at(-1)?.[0].actor_user === 42, 'new actor filter')
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ actor_user: 42, page: 1 }))
        await waitForCondition(() => document.querySelector('[role="dialog"]') === null, 'closed actor drawer')
        expect(page.location()).toBe('/admin/audit?from=account#activity')
        expect(page.container.querySelector('option[value="42"]')?.textContent).toBe('second')
        page.unmount()
    })

    it.each([
        ['target_id', 'source-2'],
        ['target_type', 'accounts.User'],
        ['action_category', 'system'],
        ['action_type', 'source.fetch'],
    ])('resets pagination and closes the drawer before requesting a changed %s', async (key, value) => {
        mockAdmin()
        mockSelection('z1')
        fetchAuditEvents.mockResolvedValue({ results: [sampleEvent], count: 150, next: 'next', previous: 'previous' })
        const initial = '/admin/audit?target_type=tariffs.DynamicTariffSource&target_id=source-1'
        const page = renderAuditLogs('admin', [initial])
        await page.mount()
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
        await click(page.container.querySelector('tbody tr')!)
        await waitForCondition(() => document.querySelector('[role="dialog"]') !== null, 'audit drawer')

        await page.navigate(`${initial}&from=bookmark#activity`)
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        const callsBeforeChange = fetchAuditEvents.mock.calls.length
        const url = new URL(initial, 'https://openzev.test')
        url.searchParams.set(key, value)
        await page.navigate(`${url.pathname}${url.search}`)
        await waitForCondition(() => fetchAuditEvents.mock.calls.length > callsBeforeChange, 'new contextual audit request')
        expect(fetchAuditEvents.mock.calls.slice(callsBeforeChange).map(([filters]) => filters.page)).toEqual([1])
        await waitForCondition(() => document.querySelector('[role="dialog"]') === null, 'closed audit drawer')
        page.unmount()
    })

    it('owner request is scoped to the global selection', async () => {
        mockOwner()
        mockSelection('z1')
        const page = renderAuditLogs('owner')
        await page.mount()
        expect(fetchAuditEvents).toHaveBeenCalled()
        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.zev).toBe('z1')
        expect(arg.page).toBe(1)
        page.unmount()
    })

    it('owner view has no independent community selector', async () => {
        mockOwner()
        mockSelection('z1')
        const page = renderAuditLogs('owner')
        await page.mount()
        const labels = Array.from(page.container.querySelectorAll('label')).map((l) => l.textContent)
        expect(labels.some((text) => text?.includes('pages.auditLogs.filters.zev'))).toBe(false)
        page.unmount()
    })

    it('switching communities rescopes the request and resets the page', async () => {
        mockOwner()
        mockSelection('z1')
        fetchAuditEvents.mockResolvedValue({ results: [sampleEvent], count: 150, next: 'next', previous: 'previous' })
        const page = renderAuditLogs('owner')
        await page.mount()
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        expect(fetchAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
        const before = fetchAuditEvents.mock.calls.length

        mockSelection('z2')
        await page.rerender()
        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.zev).toBe('z2')
        expect(arg.page).toBe(1)
        expect(fetchAuditEvents.mock.calls.slice(before).map(([filters]) => filters.page)).toEqual([1])
        page.unmount()
    })

    it('switching communities closes the open event drawer', async () => {
        mockOwner()
        mockSelection('z1')
        fetchAuditEvents.mockResolvedValue({
            results: [sampleEvent],
            count: 1,
            next: null,
            previous: null,
        })
        const page = renderAuditLogs('owner')
        await page.mount()
        const row = page.container.querySelector('tbody tr')
        expect(row).toBeTruthy()
        await click(row!)
        expect(fetchAuditEvent).toHaveBeenCalledTimes(1)

        mockSelection('z2')
        await page.rerender()
        expect(fetchAuditEvent).toHaveBeenCalledTimes(1)
        page.unmount()
    })

    it('clearing filters keeps the community scope', async () => {
        mockOwner()
        mockSelection('z1')
        fetchAuditEvents.mockResolvedValue({ results: [sampleEvent], count: 2, next: 'page-2', previous: null })
        const page = renderAuditLogs('owner')
        await page.mount()
        await click(await waitForButton(page.container, 'pages.auditLogs.pagination.next'))
        await click(buttonByText(page.container, 'pages.auditLogs.actions.clearFilters'))
        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.zev).toBe('z1')
        expect(arg.page).toBe(1)
        page.unmount()
    })

    it('no request fires without a valid selection', async () => {
        mockOwner()
        mockSelection(null)
        const page = renderAuditLogs('owner')
        await page.mount()
        expect(fetchAuditEvents).not.toHaveBeenCalled()
        expect(page.container.textContent).toContain('pages.auditLogs.empty')
        page.unmount()
    })

    it('a deep-linked actor pre-fills the filter, is consumed once, and clears the URL', async () => {
        mockAdmin()
        mockSelection(null)
        const page = renderAuditLogs('admin', ['/admin/audit?actor=42&actorUsername=alice'])
        await page.mount()

        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.actor_user).toBe(42)

        const selects = Array.from(page.container.querySelectorAll('select'))
        const actorSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === '42')) as HTMLSelectElement
        expect(actorSelect).toBeTruthy()
        expect(actorSelect.value).toBe('42')
        expect(Array.from(actorSelect.options).find((o) => o.value === '42')?.textContent).toBe('alice')

        // Consumed once: clearing filters afterward must not bring it back.
        await click(buttonByText(page.container, 'pages.auditLogs.actions.clearFilters'))
        const afterClear = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(afterClear.actor_user).toBeUndefined()
        page.unmount()
    })

    it('without a deep link the actor filter starts unset', async () => {
        mockAdmin()
        mockSelection(null)
        const page = renderAuditLogs('admin')
        await page.mount()

        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.actor_user).toBeUndefined()
        page.unmount()
    })

    it('admin view keeps its community selector and sends the chosen zev', async () => {
        mockAdmin()
        mockSelection(null)
        const page = renderAuditLogs('admin')
        await page.mount()
        const selects = Array.from(page.container.querySelectorAll('select'))
        const zevSelect = selects.find((s) =>
            Array.from(s.options).some((o) => o.value === 'z2'),
        ) as HTMLSelectElement
        expect(zevSelect).toBeTruthy()
        await act(async () => {
            zevSelect.value = 'z2'
            zevSelect.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0))
        })
        const arg = fetchAuditEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(arg.zev).toBe('z2')
        page.unmount()
    })
})
