import { act, createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { DynamicPriceHistoryPanel } from '../src/features/tariffs/DynamicPriceHistoryModal'
import { renderWithProviders, setInputValue } from './helpers/render'
import { waitForCondition } from './helpers/waitForCondition'
import type { DynamicTariffSource } from '../src/types/api'

const fetchHistory = vi.hoisted(() => vi.fn().mockResolvedValue({ points: [], gaps: [] }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicPriceHistory: fetchHistory }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/appSettings', async importOriginal => ({
    ...await importOriginal<typeof import('../src/lib/appSettings')>(),
    useAppSettings: () => ({ settings: { date_format_short: 'dd.MM.yyyy' } }),
}))
vi.mock('../src/components/CivilDateInput', () => ({
    CivilDateInput: ({ value, onChange, error, errorId }: { value: string, onChange: (value: string) => void, error?: string, errorId?: string }) =>
        createElement('div', null,
            createElement('input', { type: 'date', value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value), 'aria-invalid': !!error, 'aria-describedby': error ? errorId : undefined }),
            error && createElement('span', { id: errorId, role: 'alert' }, error)),
}))

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); fetchHistory.mockClear() })

it('associates inverted-range errors with the dates and sends no request until corrected', async () => {
    const source: DynamicTariffSource = { id: 'source', label: 'Grid', api_version: 'v1_0_5' } as DynamicTariffSource
    const { container } = await renderWithProviders(createElement(DynamicPriceHistoryPanel, { source, compact: true }), cleanups)
    await waitForCondition(() => fetchHistory.mock.calls.length > 0, 'initial history request')
    const [from, to] = container.querySelectorAll<HTMLInputElement>('input[type="date"]')
    const end = to.value
    fetchHistory.mockClear()
    await act(async () => setInputValue(from, '2999-01-01'))
    expect(fetchHistory).not.toHaveBeenCalled()
    expect(to.getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(document.getElementById(to.getAttribute('aria-describedby')!)?.textContent).toBe('pages.tariffs.apiErrors.dateRange')
    await act(async () => setInputValue(from, end))
    await waitForCondition(() => fetchHistory.mock.calls.length > 0, 'corrected history request')
    expect(to.getAttribute('aria-invalid')).toBe('false')
})

it('keeps inline records visible on short pages without losing later intervals', async () => {
    fetchHistory.mockResolvedValueOnce({ points: Array.from({ length: 13 }, (_, index) => ({
        valid_from: new Date(Date.UTC(2026, 9, 1, 0, index * 15)).toISOString(),
        valid_to: new Date(Date.UTC(2026, 9, 1, 0, (index + 1) * 15)).toISOString(),
        price_chf_per_kwh: `0.${String(index + 10).padStart(2, '0')}`,
    })), gaps: [] })
    const source: DynamicTariffSource = { id: 'source', label: 'Grid', api_version: 'v1_0_5' } as DynamicTariffSource
    const { container } = await renderWithProviders(createElement(DynamicPriceHistoryPanel, { source, compact: true }), cleanups)
    await waitForCondition(() => container.querySelectorAll('tbody tr').length === 12, 'first records page')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="common.pagination.next"]')!.click())
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelector('tbody')?.textContent).toContain('0.22000')
})
