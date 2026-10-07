import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '../src/components/Layout'
import { PageHeader } from '../src/components/PageHeader'
import { usePageNavigation } from '../src/lib/usePageNavigation'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

vi.mock('../src/lib/auth', () => ({
    useAuth: () => ({
        user: { id: 7, username: 'manager@example.com', email: 'manager@example.com', first_name: 'Test', last_name: 'User', role: 'user', preferred_zev: null },
        logout: vi.fn(),
        isImpersonating: false,
        impersonator: null,
        stopImpersonation: vi.fn(),
    }),
}))

vi.mock('../src/lib/managedZev', () => {
    const value = {
        managedZevs: [{ id: 'z1', name: 'Muster ZEV' }],
        entries: [{ id: 'z1', name: 'Muster ZEV', relation: 'manager' }],
        relation: 'manager',
        selectedZevId: 'z1',
        selectedZev: { id: 'z1', name: 'Muster ZEV' },
        isSelectable: false,
        isLoading: false,
        setSelectedZevId: vi.fn(),
    }
    return { useManagedZev: () => value, useOptionalManagedZev: () => value }
})

vi.mock('../src/lib/api/feasibility', () => ({
    fetchFeasibilityCalculatorEnabled: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('../src/lib/toast', () => ({
    useToast: () => ({ pushToast: vi.fn() }),
}))

let navigateRef: NavigateFunction | null = null

function NavigateProbe() {
    const navigate = useNavigate()
    const location = useLocation()
    useEffect(() => { navigateRef = navigate }, [navigate])
    return createElement('output', { id: 'location' }, `${location.pathname}${location.search}${location.hash}`)
}

const mounted = new Set<() => void>()

function Page({ title }: { title: string }) {
    const { updateParams } = usePageNavigation()
    return createElement('div', { className: 'page-stack' },
        createElement(PageHeader, { title }),
        createElement('button', { type: 'button', id: 'filter', onClick: () => updateParams((params) => params.set('q', '1')) }, 'Filter'),
        createElement('a', { href: '/elsewhere', id: 'in-page-link', onClick: (event: MouseEvent) => { event.preventDefault(); navigateRef?.('/other') } }, 'Go'),
        createElement('button', { type: 'button', id: 'replace-link', onClick: () => navigateRef?.('/participants', { replace: true }) }, 'Replace'),
    )
}

// Distinct element types per route, as in AppRoutes: a different page remounts.
const OtherPage = () => createElement(Page, { title: 'Other' })
const ParticipantsPage = () => createElement(Page, { title: 'Participants' })

/** One element type for both routed tabs, so the hub persists across them. */
function Hub() {
    const { pathname } = useLocation()
    const { navigateTab } = usePageNavigation()
    return createElement('div', { className: 'page-stack' },
        createElement(PageHeader, { title: 'Hub' }),
        createElement('button', { type: 'button', id: 'tab', role: 'tab', onClick: () => navigateTab(pathname === '/hub/one' ? '/hub/two' : '/hub/one') }, 'Tab'),
    )
}

/** A page that focuses its own control, like a deep link to an invalid field. */
function SelfFocusPage() {
    useEffect(() => { document.getElementById('field')?.focus() }, [])
    return createElement('div', { className: 'page-stack' },
        createElement(PageHeader, { title: 'Self focus' }),
        createElement('input', { id: 'field', 'aria-label': 'Field' }),
    )
}

async function renderShell(path: string) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: [path] },
            createElement(QueryClientProvider, { client: new QueryClient() },
                createElement(NavigateProbe),
                createElement(Routes, null,
                    createElement(Route, { path: '/', element: createElement(Layout) },
                        createElement(Route, { index: true, element: createElement(Page, { title: 'Home' }) }),
                        createElement(Route, { path: 'participants', element: createElement(ParticipantsPage) }),
                        createElement(Route, { path: 'other', element: createElement(OtherPage) }),
                        createElement(Route, { path: 'hub/one', element: createElement(Hub) }),
                        createElement(Route, { path: 'hub/two', element: createElement(Hub) }),
                        createElement(Route, { path: 'self', element: createElement(SelfFocusPage) }),
                        createElement(Route, { path: 'alias', element: createElement(Navigate, { to: '/other', replace: true }) }),
                    ),
                ),
            ),
        ))
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    mounted.add(() => act(() => root.unmount()))
    const main = () => container.querySelector<HTMLElement>('main')!
    return {
        container,
        main,
        heading: () => main().querySelector('h1'),
        go: async (to: string | number) => {
            await act(async () => {
                // navigate() has separate overloads for a path and a history delta.
                if (typeof to === 'number') void navigateRef!(to)
                else void navigateRef!(to)
            })
        },
        location: () => container.querySelector('#location')?.textContent,
        // A real click: input first, so the shell sees user activity.
        click: async (element: Element | null) => {
            await act(async () => {
                element!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
                ;(element as HTMLElement).click()
            })
        },
    }
}

afterEach(() => {
    mounted.forEach((cleanup) => cleanup())
    mounted.clear()
    document.body.innerHTML = ''
    navigateRef = null
})

describe('skip link and landmarks', () => {
    it('makes the skip link the first focusable element and focuses main without a hash change', async () => {
        const shell = await renderShell('/')
        const focusable = shell.container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
        expect(focusable[0].className).toBe('skip-link')
        expect(focusable[0].getAttribute('href')).toBe('#main-content')
        expect(focusable[0].textContent).toBe('nav.skipToContent')

        const before = shell.location()
        await shell.click(focusable[0])
        expect(document.activeElement).toBe(shell.main())
        expect(shell.main().id).toBe('main-content')
        // Pathname, search and hash unchanged: no #main-content entered the router.
        expect(shell.location()).toBe(before)
        expect(before).toBe('/')
    })

    it('keeps the top bar outside the single main landmark', async () => {
        const shell = await renderShell('/')
        expect(shell.container.querySelectorAll('main')).toHaveLength(1)
        expect(shell.main().querySelector('.top-nav')).toBeNull()
        expect(shell.container.querySelector('.top-nav')).not.toBeNull()
        expect(shell.heading()?.getAttribute('tabindex')).toBe('-1')
    })
})

describe('focus on page navigation', () => {
    it('does not move focus on the first render', async () => {
        await renderShell('/')
        expect(document.activeElement).toBe(document.body)
    })

    it('does not move focus for a redirect while the page loads', async () => {
        const shell = await renderShell('/alias')
        expect(shell.heading()?.textContent).toBe('Other')
        expect(document.activeElement).toBe(document.body)
        // The next real navigation still moves focus.
        await shell.go('/participants')
        expect(document.activeElement).toBe(shell.heading())
    })

    it('moves focus when the first navigation replaces history', async () => {
        const shell = await renderShell('/')
        const button = shell.container.querySelector<HTMLElement>('#replace-link')!
        button.focus()
        await shell.click(button)
        expect(shell.heading()?.textContent).toBe('Participants')
        expect(document.activeElement).toBe(shell.heading())
    })

    it('moves focus from a sidebar link to the new page title', async () => {
        const shell = await renderShell('/')
        const link = shell.container.querySelector<HTMLAnchorElement>('aside a[href="/participants"]')!
        link.focus()
        await shell.click(link)
        expect(shell.heading()?.textContent).toBe('Participants')
        expect(document.activeElement).toBe(shell.heading())
    })

    it('moves focus to the title when an in-page link unmounts with its page, and on Back', async () => {
        const shell = await renderShell('/')
        const link = shell.container.querySelector<HTMLElement>('#in-page-link')!
        link.focus()
        await shell.click(link)
        expect(document.activeElement).toBe(shell.heading())
        expect(shell.heading()?.textContent).toBe('Other')

        // Back while focus is still on the Other page's title.
        await shell.go(-1)
        expect(shell.heading()?.textContent).toBe('Home')
        expect(document.activeElement).toBe(shell.heading())
    })

    it('keeps focus on a routed hub tab', async () => {
        const shell = await renderShell('/hub/one')
        const tab = shell.container.querySelector<HTMLElement>('#tab')!
        tab.focus()
        await shell.click(tab)
        expect(shell.container.querySelector('#tab')).toBe(tab)
        expect(document.activeElement).toBe(tab)
    })

    it('keeps focus on a control that only edits the query', async () => {
        const shell = await renderShell('/')
        const filter = shell.container.querySelector<HTMLElement>('#filter')!
        filter.focus()
        await shell.click(filter)
        expect(document.activeElement).toBe(filter)
    })

    it('keeps focus where the new page placed it', async () => {
        const shell = await renderShell('/')
        await shell.go('/self')
        expect(document.activeElement).toBe(shell.container.querySelector('#field'))
    })

    it.each([
        ['role="dialog"', () => Object.assign(document.createElement('div'), { role: 'dialog' })],
        ['role="alertdialog"', () => Object.assign(document.createElement('div'), { role: 'alertdialog' })],
        ['a native dialog', () => document.createElement('dialog')],
    ])('leaves focus inside an open %s', async (_, createDialog) => {
        const shell = await renderShell('/')
        const dialog = createDialog()
        if (dialog instanceof HTMLDialogElement) dialog.setAttribute('open', '')
        const button = document.createElement('button')
        dialog.appendChild(button)
        document.body.appendChild(dialog)
        button.focus()
        await shell.go('/other')
        expect(document.activeElement).toBe(button)
    })

    it('lands on the canonical page title after an alias redirect', async () => {
        const shell = await renderShell('/')
        await shell.go('/alias')
        expect(shell.heading()?.textContent).toBe('Other')
        expect(document.activeElement).toBe(shell.heading())
    })
})
