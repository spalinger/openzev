import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchAppSettings, fetchSystemHealth } from '../src/lib/api/auth'
import { queryKeys } from '../src/lib/api/queryKeys'
import { AppSettingsProvider, useAppSettings } from '../src/lib/appSettings'
import { MfaPolicySection } from '../src/features/settings/MfaPolicySection'
import type { AppSettings } from '../src/types/api'
import { waitForCondition } from './helpers/waitForCondition'

vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }))
vi.mock('../src/lib/api/auth', () => ({ fetchAppSettings: vi.fn(), fetchSystemHealth: vi.fn(), updateAppSettings: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: vi.fn() }) }))

const POLICY: AppSettings = {
    date_format_short: 'yyyy-MM-dd',
    date_format_long: 'd. MMMM yyyy',
    date_time_format: 'yyyy-MM-dd HH:mm',
    mfa_required: true,
    mfa_grace_period_days: 14,
    updated_at: '2026-01-01T00:00:00Z',
}

const cleanups: (() => void)[] = []
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    vi.resetAllMocks()
})

async function mountProvider(settings?: AppSettings, withSection = false) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    if (settings) client.setQueryData(queryKeys.auth.appSettings(), settings)
    const latest = { current: null as ReturnType<typeof useAppSettings> | null }

    function Consumer() {
        const context = useAppSettings()
        useEffect(() => { latest.current = context }, [context])
        return null
    }

    cleanups.push(() => { act(() => root.unmount()); client.clear(); container.remove() })
    await act(async () => root.render(
        createElement(QueryClientProvider, { client },
            createElement(AppSettingsProvider, null, createElement(Consumer), withSection ? createElement(MfaPolicySection) : null)),
    ))
    await waitForCondition(() => latest.current !== null, 'app settings context')
    return { client, container, context: () => latest.current! }
}

describe('AppSettingsProvider', () => {
    it('exposes an authenticated fetch failure and recovers after a successful refetch', async () => {
        vi.mocked(fetchAppSettings).mockRejectedValueOnce(new Error('Settings unavailable'))
        const { client, context } = await mountProvider()
        await waitForCondition(() => context().isError, 'authenticated settings fetch failure')

        expect(fetchAppSettings).toHaveBeenCalledOnce()
        expect(context().isError).toBe(true)
        expect(context().isLoading).toBe(false)
        expect(context().settings.date_format_short).toBe('dd.MM.yyyy')
        expect(context().settings.mfa_required).toBeUndefined()
        expect(context().settings.mfa_grace_period_days).toBeUndefined()

        vi.mocked(fetchAppSettings).mockResolvedValueOnce(POLICY)
        await act(async () => { await client.refetchQueries({ queryKey: queryKeys.auth.appSettings() }) })
        await waitForCondition(
            () => !context().isError && context().settings.mfa_required === POLICY.mfa_required,
            'settings fetch recovery',
        )

        expect(fetchAppSettings).toHaveBeenCalledTimes(2)
        expect(context().settings).toEqual(POLICY)
        expect(context().isError).toBe(false)
    })

    it('retains the loaded policy and exposes an error after a failed refresh', async () => {
        const { client, context } = await mountProvider(POLICY)
        expect(context().settings).toEqual(POLICY)
        expect(context().isError).toBe(false)

        vi.mocked(fetchAppSettings).mockRejectedValueOnce(new Error('Refresh unavailable'))
        await act(async () => { await client.refetchQueries({ queryKey: queryKeys.auth.appSettings() }) })
        await waitForCondition(() => context().isError, 'cached settings refresh failure')

        expect(fetchAppSettings).toHaveBeenCalledOnce()
        expect(context().settings).toEqual(POLICY)
        expect(context().isLoading).toBe(false)
        expect(context().isError).toBe(true)
    })

    it('retries the unavailable policy in place, with busy feedback and recovery after another failure', async () => {
        vi.mocked(fetchSystemHealth).mockResolvedValue({ mfa: { encryption_key_configured: true } } as Awaited<ReturnType<typeof fetchSystemHealth>>)
        vi.mocked(fetchAppSettings).mockRejectedValueOnce(new Error('Settings unavailable'))
        const { container, context } = await mountProvider(undefined, true)
        const retry = () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!
        const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        const graceDays = () => container.querySelector<HTMLInputElement>('input[type="number"]')!
        const save = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        await waitForCondition(() => retry() !== null, 'policy retry notice')
        expect(retry().textContent).toBe('common.retry')
        expect(checkbox().matches(':disabled')).toBe(true)
        expect(save().matches(':disabled')).toBe(true)

        let rejectRetry!: (error: Error) => void
        vi.mocked(fetchAppSettings).mockImplementationOnce(() => new Promise<AppSettings>((_, reject) => { rejectRetry = reject }))
        act(() => retry().click())
        await waitForCondition(() => retry().disabled, 'busy retry button')
        expect(retry().getAttribute('aria-busy')).toBe('true')
        expect(retry().textContent).toBe('common.loading')
        act(() => retry().click())
        expect(fetchAppSettings).toHaveBeenCalledTimes(2)

        await act(async () => { rejectRetry(new Error('Still unavailable')) })
        await waitForCondition(() => !retry().disabled, 'retry available after another failure')
        expect(context().isError).toBe(true)
        expect(retry().textContent).toBe('common.retry')
        expect(retry().hasAttribute('aria-busy')).toBe(false)
        expect(graceDays().matches(':disabled')).toBe(true)

        const policy = { ...POLICY, mfa_required: false, mfa_grace_period_days: 0 }
        vi.mocked(fetchAppSettings).mockResolvedValueOnce(policy)
        await act(async () => retry().click())
        await waitForCondition(() => container.querySelector('[role="alert"]') === null, 'successful retry')
        expect(fetchAppSettings).toHaveBeenCalledTimes(3)
        expect(context().settings).toEqual(policy)
        expect(context().isError).toBe(false)
        expect(checkbox().checked).toBe(false)
        expect(checkbox().matches(':disabled')).toBe(false)
        expect(graceDays().value).toBe('0')
        expect(graceDays().matches(':disabled')).toBe(false)
        expect(save().matches(':disabled')).toBe(false)
    })
})
