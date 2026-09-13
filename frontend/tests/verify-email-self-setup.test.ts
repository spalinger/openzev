import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VerifyEmailPage } from '../src/pages/VerifyEmailPage'

/** Self-registration ZEV creation — bank fields. */
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

const refreshUserMock = vi.fn()
vi.mock('../src/lib/auth', () => ({
    useAuth: () => ({ refreshUser: refreshUserMock }),
}))

vi.mock('../src/lib/api/auth', () => ({
    verifyEmail: vi.fn(() => Promise.resolve({})),
    setInitialPassword: vi.fn(() => Promise.resolve({})),
}))

const createSelfSetupZevMock = vi.fn()
vi.mock('../src/lib/api/zev', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createSelfSetupZev: (...args: unknown[]) => createSelfSetupZevMock(...args),
    // GridOperatorField is rendered on the card and queries the operator list.
    fetchGridOperators: () => Promise.resolve({ operators: [], source: '', cube: '', licence: '', period: '', fetched_on: '' }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => mockNavigate,
}))

/** React 19 tracks input values, so assignments must go through the native setter. */
function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

async function renderAtCreateZevStep(token = 'tok') {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(
            createElement(
                MemoryRouter,
                { initialEntries: [`/verify-email?token=${token}`] },
                createElement(
                    MantineProvider,
                    null,
                    createElement(
                        QueryClientProvider,
                        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
                        createElement(VerifyEmailPage),
                    ),
                ),
            ),
        )
    })
    // Mount auto-verifies → set-password step; drive it to reach create-zev.
    for (let i = 0; i < 20 && !container.querySelector('input[type="password"]'); i++) {
        await flush()
    }
    const passwordForm = container.querySelector('form')
    expect(passwordForm).not.toBe(null)
    const passwordInputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]')
    expect(passwordInputs.length).toBe(2)
    await act(async () => {
        setInputValue(passwordInputs[0], 'Str0ngPassphrase!')
        setInputValue(passwordInputs[1], 'Str0ngPassphrase!')
    })
    await act(async () => {
        passwordForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    // Wait until the create-ZEV card (with its bank fields) is on screen.
    for (let i = 0; i < 20 && !container.querySelector('input[name="bank_iban"]'); i++) {
        await flush()
    }
    expect(container.querySelector('input[name="bank_iban"]')).not.toBe(null)
    return { container, root }
}

function clickCreateButton(container: HTMLElement) {
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('auth.verify.zevSubmit'),
    )
    expect(button).not.toBe(undefined)
    return (button as HTMLButtonElement).click()
}

describe('VerifyEmailPage self-setup — bank fields', () => {
    beforeEach(() => {
        createSelfSetupZevMock.mockClear()
    })

    it('sends bank_iban and bank_name with the self-setup payload', async () => {
        createSelfSetupZevMock.mockResolvedValue({
            zev: { id: 'z1', name: 'Self ZEV' },
            owner_participant_id: 'p1',
        })
        const { container, root } = await renderAtCreateZevStep()
        try {
            const nameInput = container.querySelector<HTMLInputElement>('input[name="name"]')!
            setInputValue(nameInput, 'Self ZEV')
            setInputValue(
                container.querySelector<HTMLInputElement>('input[name="bank_iban"]')!,
                'CH93 0076 2011 6238 5295 7',
            )
            setInputValue(
                container.querySelector<HTMLInputElement>('input[name="bank_name"]')!,
                'Demo Bank',
            )
            setInputValue(
                container.querySelector<HTMLInputElement>('input[name="owner_address_line1"]')!,
                'Example 1',
            )
            setInputValue(
                container.querySelector<HTMLInputElement>('input[name="owner_postal_code"]')!,
                '8000',
            )
            setInputValue(
                container.querySelector<HTMLInputElement>('input[name="owner_city"]')!,
                'Zurich',
            )

            await act(async () => {
                clickCreateButton(container)
            })
            await flush()

            expect(createSelfSetupZevMock).toHaveBeenCalledTimes(1)
            const payload = createSelfSetupZevMock.mock.calls[0][0]
            expect(payload.bank_iban).toBe('CH9300762011623852957')
            expect(payload.bank_name).toBe('Demo Bank')
            expect(payload.owner_address_line1).toBe('Example 1')
            expect(payload.owner_postal_code).toBe('8000')
            expect(payload.owner_city).toBe('Zurich')
        } finally {
            act(() => root.unmount())
            container.remove()
        }
    })

    it('sends empty bank fields when left blank — no client-side required', async () => {
        createSelfSetupZevMock.mockResolvedValue({
            zev: { id: 'z2', name: 'Blank ZEV' },
            owner_participant_id: 'p2',
        })
        const { container, root } = await renderAtCreateZevStep()
        try {
            const nameInput = container.querySelector<HTMLInputElement>('input[name="name"]')!
            setInputValue(nameInput, 'Blank ZEV')

            await act(async () => {
                clickCreateButton(container)
            })
            await flush()

            expect(createSelfSetupZevMock).toHaveBeenCalledTimes(1)
            const payload = createSelfSetupZevMock.mock.calls[0][0]
            expect(payload.bank_iban).toBe('')
            expect(payload.bank_name).toBe('')
        } finally {
            act(() => root.unmount())
            container.remove()
        }
    })
})
