import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VseTariffImportModal } from '../src/features/tariffs/VseTariffImportModal'
import { ZevImportModal } from '../src/features/zev/ZevImportModal'
import type { VseTariffImportResult, ZevArchiveImportResult } from '../src/types/api'

const mutations: Array<{ onSuccess: (result: unknown) => void }> = []
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined }),
  useMutation: (options: { onSuccess: (result: unknown) => void }) => {
    mutations.push(options)
    return { isPending: false, mutate: vi.fn() }
  },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ pushToast: vi.fn() }) }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  mutations.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('retains apply-time warnings under the created VSE tariff', () => {
  act(() => root.render(createElement(VseTariffImportModal, {
    isOpen: true, onClose: vi.fn(), zevId: 'zev', initialUrl: '',
  })))
  const result: VseTariffImportResult = {
    created: [{ name: 'Integrated', category: 'energy', billing_mode: 'energy',
      valid_from: '2026-01-01', valid_to: null, dynamic: true,
      dynamic_source_warnings: ['Includes grid fees.', 'Source is disabled.'] }],
    skipped: [], errors: [],
  }
  act(() => mutations[1].onSuccess(result))
  const row = Array.from(container.querySelectorAll('li')).find((item) => item.textContent?.includes('Integrated'))!
  expect(row.textContent).toContain('Includes grid fees.')
  expect(row.textContent).toContain('Source is disabled.')
})

it('keeps transfer warnings visible until the operator closes the result', () => {
  const onImported = vi.fn()
  act(() => root.render(createElement(ZevImportModal, { isOpen: true, onClose: vi.fn(), onImported })))
  const result: ZevArchiveImportResult = {
    zev_id: 'restored', zev_name: 'Restored', sections: ['zev'], counts: {},
    warnings: ['Destination source is disabled.'],
  }
  act(() => mutations[1].onSuccess(result))
  expect(container.textContent).toContain('Destination source is disabled.')
  expect(container.querySelector('input[type=file]')).toBeNull()
  expect(onImported).not.toHaveBeenCalled()
  const close = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'common.close')!
  act(() => close.click())
  expect(onImported).toHaveBeenCalledWith('restored')
})
