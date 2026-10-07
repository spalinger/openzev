import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppSettings } from '../src/types/api'
import { MfaPolicySection } from '../src/features/settings/MfaPolicySection'

const DATE_FORMATS = {
    date_format_short: 'dd.MM.yyyy',
    date_format_long: 'd. MMMM yyyy',
    date_time_format: 'dd.MM.yyyy HH:mm',
    updated_at: '2026-01-01T00:00:00Z',
} as const

const state = vi.hoisted(() => ({ settings: {} as AppSettings }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: vi.fn() }) }))
vi.mock('../src/lib/api/auth', () => ({
    fetchSystemHealth: vi.fn().mockResolvedValue({ mfa: { status: 'ok', encryption_key_configured: true } }),
    updateAppSettings: vi.fn(),
}))
vi.mock('../src/lib/appSettings', () => ({
    useAppSettings: () => ({ settings: state.settings, isLoading: false }),
}))

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

describe('MfaPolicySection', () => {
    it('stays disabled until the policy loads, then shows it', async () => {
        const container = document.createElement('div')
        document.body.append(container)
        const root = createRoot(container)
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        cleanups.push(() => { act(() => root.unmount()); client.clear(); container.remove() })
        const renderWith = (settings: AppSettings) => {
            state.settings = settings
            return act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(MfaPolicySection))))
        }
        const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        const graceDays = () => container.querySelector<HTMLInputElement>('input[type="number"]')!
        const save = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!

        await renderWith({ ...DATE_FORMATS })
        expect(checkbox().matches(':disabled')).toBe(true)
        expect(graceDays().value).toBe('')
        expect(graceDays().disabled).toBe(true)
        expect(save().disabled).toBe(true)

        await renderWith({ ...DATE_FORMATS, mfa_required: true, mfa_grace_period_days: 30 })
        expect(checkbox().checked).toBe(true)
        expect(checkbox().matches(':disabled')).toBe(false)
        expect(graceDays().value).toBe('30')
        expect(graceDays().disabled).toBe(false)
        expect(save().disabled).toBe(false)
    })
})
