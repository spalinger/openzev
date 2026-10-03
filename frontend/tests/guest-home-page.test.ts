import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

import { GuestHomePage } from '../src/pages/GuestHomePage'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function renderGuestPage() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
        root.render(createElement(MemoryRouter, null, createElement(GuestHomePage)))
    })
    cleanups.push(() => {
        act(() => root.unmount())
        container.remove()
    })
    return container
}

describe('guest landing page', () => {
    it('explains the unlinked state and offers account settings as a secondary action', () => {
        const page = renderGuestPage()
        const section = page.querySelector('section.empty-state')
        expect(section).not.toBeNull()
        expect(section?.textContent).toContain('pages.guest.title')
        expect(section?.textContent).toContain('pages.guest.description')
        const link = section?.querySelector('a[href="/account"]')
        expect(link?.textContent).toBe('pages.guest.accountLink')
        expect(link?.className).toContain('button-secondary')
    })
})
