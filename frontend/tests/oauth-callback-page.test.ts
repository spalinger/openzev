import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { LoginPage } from '../src/pages/LoginPage'
import { OAuthCallbackPage } from '../src/pages/OAuthCallbackPage'
import { oauthTokenExchange } from '../src/lib/api/auth'
import { en } from '../src/i18n/locales/en'
import { de } from '../src/i18n/locales/de'
import { fr } from '../src/i18n/locales/fr'
import { it as italian } from '../src/i18n/locales/it'

vi.mock('../src/lib/auth', () => ({
    useAuth: () => ({ refreshUser: vi.fn() }),
}))

vi.mock('../src/lib/api/auth', () => ({
    fetchRegistrationEnabled: vi.fn().mockResolvedValue(false),
    fetchOAuthProviders: vi.fn().mockResolvedValue([]),
    oauthLoginInitiate: vi.fn(),
    register: vi.fn(),
    oauthTokenExchange: vi.fn(),
}))

describe('OAuth refusal messages', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>
    let client: QueryClient
    const instance = createInstance()
    const locales = { en, de, fr, it: italian }

    beforeEach(async () => {
        vi.clearAllMocks()
        await instance.use(initReactI18next).init({
            lng: 'en',
            fallbackLng: false,
            resources: Object.fromEntries(Object.entries(locales).map(([lng, translation]) => [lng, { translation }])),
            interpolation: { escapeValue: false },
        })
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        client.clear()
        container.remove()
    })

    async function renderPage(path: string, error?: string) {
        await act(async () => {
            root.render(
                createElement(I18nextProvider, { i18n: instance },
                    createElement(QueryClientProvider, { client },
                        createElement(MemoryRouter, { initialEntries: [path + (error ? `?oauth_error=${error}` : '')] },
                            createElement(path === '/login' ? LoginPage : OAuthCallbackPage),
                        ),
                    ),
                ),
            )
        })
        expect(oauthTokenExchange).not.toHaveBeenCalled()
        return container.querySelector('.error-banner')?.textContent
    }

    describe.each(['/login', '/oauth/callback'])('%s', path => {
        it.each(Object.entries(locales))('explains invalid_state in %s', async (lng, locale) => {
            await instance.changeLanguage(lng)
            expect(await renderPage(path, 'invalid_state')).toBe(locale.auth.oauth.errors.invalid_state)
        })

        it('keeps the generic fallback for unknown errors', async () => {
            expect(await renderPage(path, 'some_unknown_slug')).toBe('OAuth error: some_unknown_slug')
        })
    })

    it('reports a missing exchange code', async () => {
        expect(await renderPage('/oauth/callback')).toBe(en.auth.oauth.errors.missingCode)
    })
})
