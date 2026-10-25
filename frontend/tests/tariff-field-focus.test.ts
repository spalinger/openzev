import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffForm } from '../src/features/tariffs/TariffForm'
import { TariffPeriodForm } from '../src/features/tariffs/TariffPeriodForm'
import { renderWithProviders, setInputValue } from './helpers/render'
import { useTariffEditor } from '../src/features/tariffs/useTariffEditor'
import type { TariffPeriod, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/lib/appSettings', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/appSettings')>(),
  useAppSettings: () => ({ settings: { date_format_short: 'dd.MM.yyyy' } }),
}))

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
})
const fee = {
  id: 'fee', zev: 'z', name: 'Fee', category: 'metering', billing_mode: 'monthly_fee', energy_type: null,
  valid_from: '2026-01-01', valid_to: null, fixed_price_chf: '10.00', split_key: 'equal', notes: 'Version note', periods: [],
} as TariffVersion
const band: TariffPeriod = { id: 'band', tariff: 'fee', period_type: 'flat', price_chf_per_kwh: '0.20', percentage: null }
const callbacks = { onSubmit: vi.fn(), onCancel: vi.fn(), onDirtyChange: vi.fn() }

function EditHarness() {
  const editing = useTariffEditor('z')
  return createElement('div', null,
    createElement('button', { 'data-testid': 'price', onClick: () => editing.open({ kind: 'edit', tariffId: fee.id, initialFocus: { field: 'fixed_price_chf' } }) }, 'Price'),
    createElement('button', { 'data-testid': 'notes', onClick: () => editing.open({ kind: 'edit', tariffId: fee.id, initialFocus: { field: 'notes' } }) }, 'Notes'),
    editing.task?.kind === 'edit' && createElement(TariffForm, {
      ...callbacks, key: editing.task.sessionId, initialTariff: fee, selectedZevId: 'z', initialFocus: editing.task.initialFocus,
    }),
  )
}

describe('tariff field focus', () => {
  it('reseeds and refocuses a fresh editing task for the same version', async () => {
    const { container } = await renderWithProviders(createElement(EditHarness), cleanups)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="price"]')!.click())
    const price = container.querySelector<HTMLInputElement>('input[name="fixed_price_chf"]')!
    await act(async () => setInputValue(price, '99'))
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="notes"]')!.click())
    expect(price.isConnected).toBe(false)
    expect(Number(container.querySelector<HTMLInputElement>('input[name="fixed_price_chf"]')!.value)).toBe(10)
    expect(document.activeElement).toBe(container.querySelector('textarea[name="notes"]'))
  })

  it.each(['energy', 'percentage_of_energy'] as const)('focuses and selects the clicked band price (%s)', async billingMode => {
    const field = billingMode === 'energy' ? 'price_chf_per_kwh' : 'percentage'
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    const { container } = await renderWithProviders(createElement(TariffPeriodForm, {
      ...callbacks, initialPeriod: { ...band, price_chf_per_kwh: billingMode === 'energy' ? '0.20' : null, percentage: billingMode === 'energy' ? null : '80' },
      tariffs: [{ ...fee, billing_mode: billingMode, energy_type: 'grid' }], initialFocus: { field },
    }), cleanups)
    const input = container.querySelector<HTMLInputElement>(`input[name="${field}"]`)!
    expect(document.activeElement).toBe(input)
    expect(select.mock.contexts).toContain(input)
  })

  it.each(['fixed_price_chf', 'notes', 'valid_from'] as const)('focuses the matching version field (%s)', async field => {
    const { container } = await renderWithProviders(createElement(TariffForm, {
      ...callbacks, initialTariff: fee, selectedZevId: 'z', initialFocus: { field },
    }), cleanups)
    const control = container.querySelector(`[name="${field}"]:not([type="hidden"]), [data-focus-field="${field}"] button`)
    expect(control).not.toBeNull()
    expect(document.activeElement).toBe(control)
    if (field === 'notes') {
      const notes = control as HTMLTextAreaElement
      expect(notes.selectionStart).toBe(0)
      expect(notes.selectionEnd).toBe(notes.value.length)
    }
  })

  it('focuses the applicability selector when editing Gilt für', async () => {
    const { container } = await renderWithProviders(createElement(TariffPeriodForm, {
      ...callbacks, initialPeriod: band, tariffs: [{ ...fee, billing_mode: 'energy', energy_type: 'grid' }], initialFocus: { field: 'period_type' },
    }), cleanups)
    expect(document.activeElement).toBe(container.querySelector('select[name="period_type"]'))
  })

  it('focuses the allocation selector for a shared fee basis', async () => {
    const { container } = await renderWithProviders(createElement(TariffForm, {
      ...callbacks, initialTariff: { ...fee, billing_mode: 'shared_monthly_fee' }, selectedZevId: 'z', initialFocus: { field: 'split_key' },
    }), cleanups)
    expect(document.activeElement).toBe(container.querySelector('select[name="split_key"]'))
  })

  it('focuses a missing time endpoint directly when repairing coverage', async () => {
    const { container } = await renderWithProviders(createElement(TariffPeriodForm, {
      ...callbacks, initialPeriod: { ...band, period_type: 'low', time_from: '21:00', time_to: null },
      tariffs: [{ ...fee, billing_mode: 'energy' }], initialFocus: { field: 'time_to' },
    }), cleanups)
    expect(document.activeElement).toBe(container.querySelector('[data-focus-field="time_to"] input:not([type="hidden"])'))
  })
})

it('hides ignored flat-band weekday and time fields while preserving legacy values on save', async () => {
  const legacy: TariffPeriod = { ...band, time_from: '07:00', time_to: '21:00', weekdays: '0,1,2,3,4', months: '1,2,3' }
  const onSubmit = vi.fn()
  const { container } = await renderWithProviders(createElement(TariffPeriodForm, {
    ...callbacks, onSubmit, initialPeriod: legacy, tariffs: [{ ...fee, billing_mode: 'energy', periods: [legacy] }],
  }), cleanups)
  expect(container.querySelector('.tariff-time-row')).toBeNull()
  const groups = [...container.querySelectorAll('.recurrence-field')]
  expect(groups).toHaveLength(1)
  expect(groups[0].textContent).toContain('pages.tariffs.form.months')
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weekdays: legacy.weekdays, time_from: legacy.time_from, time_to: legacy.time_to, months: legacy.months }))
})
