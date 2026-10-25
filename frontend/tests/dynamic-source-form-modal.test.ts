import MockAdapter from 'axios-mock-adapter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'pages.dynamicSources.versions.v2_0_0') return 'v2.0.0'
      return values?.version ? `${key}:${values.version}` : key
    },
  }),
}))

import { DynamicSourceFormModal } from '../src/features/tariffs/DynamicSourceFormModal'
import { api } from '../src/lib/api/client'
import { ToastProvider } from '../src/lib/toast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('DynamicSourceFormModal discovery wizard', () => {
  let apiMock: MockAdapter
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    apiMock = new MockAdapter(api)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    act(() => {
      root.render(createElement(
        QueryClientProvider,
        { client },
        createElement(ToastProvider, null, createElement(DynamicSourceFormModal, {
          isOpen: true,
          onClose,
        })),
      ))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    apiMock.restore()
  })

  it.each(['close', 'escape', 'scrim'])('guards a dirty draft dismissed through %s', async exit => {
    await act(async () => setInput(container.querySelector('input')!, 'Unsaved source'))
    const dismiss = () => {
      if (exit === 'close') container.querySelector<HTMLButtonElement>('[aria-label="common.close"]')!.click()
      if (exit === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (exit === 'scrim') container.querySelector<HTMLDivElement>('.dialog-scrim')!.click()
    }
    await act(async () => dismiss())
    expect(onClose).not.toHaveBeenCalled()
    const button = (text: string) => Array.from(container.querySelectorAll('button')).find(node => node.textContent === text)!
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await act(async () => button('common.unsavedChanges.keepEditing').click())
    expect(container.querySelector('input')?.value).toBe('Unsaved source')
    await act(async () => dismiss())
    await act(async () => button('common.unsavedChanges.discard').click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(apiMock.history.post).toHaveLength(0)
  })

  it('guards modal dismissal during discovery and ignores the abandoned result', async () => {
    let release!: (response: [number, object]) => void
    apiMock.onPost('/tariffs/dynamic-sources/discover/').reply(() => new Promise(resolve => { release = resolve }))
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0], 'Example prices')
      setInput(inputs[1], 'https://prices.example.test/tariffs')
      container.querySelector<HTMLFormElement>('form')!.requestSubmit()
    })
    await vi.waitFor(() => expect(apiMock.history.post).toHaveLength(1))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="common.close"]')!.click())
    expect(container.textContent).toContain('common.unsavedChanges.messageSaving')
    expect(onClose).not.toHaveBeenCalled()
    const leave = Array.from(container.querySelectorAll('button')).find(node => node.textContent === 'common.unsavedChanges.leave')!
    await act(async () => leave.click())
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => release([200, { api_version: 'v2_0_0', components: [{ tariff_type: 'grid', tariff_name: 'late' }] }]))
    expect(container.textContent).not.toContain('pages.dynamicSources.discovery.detected')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('requires the expected product for an empty v2 endpoint', async () => {
    apiMock.onPost('/tariffs/dynamic-sources/discover/').reply(200, {
      api_version: 'v2_0_0', version_detected: false, components_discovered: false,
      components: [{ tariff_type: 'grid', tariff_name: '', aggregated_tariff_types: [] }],
    })
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0], 'Example prices')
      setInput(inputs[1], 'https://prices.example.test/tariffs')
      container.querySelector<HTMLFormElement>('form')!.requestSubmit()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('pages.dynamicSources.form.v2TariffNameHint'))
    const product = Array.from(container.querySelectorAll('input')).find((input) => input.value === '')!
    expect(product.required).toBe(true)
    expect(product.checkValidity()).toBe(false)
  })

  it('asks for name and URL first, then renders discovered components', async () => {
    expect(container.textContent).toContain('pages.dynamicSources.discovery.step')
    const versionOptions = Array.from(container.querySelectorAll('option')).map((option) => option.value)
    expect(versionOptions).toEqual(['vse', 'bfe_rmp', 'auto', 'v1_0_5', 'v2_0_0'])
    expect(container.textContent).not.toContain('Groupe E')
    expect(container.textContent).not.toContain('BKW')

    apiMock.onPost('/tariffs/dynamic-sources/discover/').reply(200, {
      api_version: 'v2_0_0',
      version_detected: true,
      components_discovered: true,
      components: [
        { tariff_type: 'grid', tariff_name: 'standard', aggregated_tariff_types: [] },
        { tariff_type: 'feed_in', tariff_name: 'solar', aggregated_tariff_types: [] },
      ],
    })
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0], 'Example prices')
      setInput(inputs[1], 'https://prices.example.test/tariffs')
      container.querySelector<HTMLFormElement>('form')!.requestSubmit()
    })

    for (let attempt = 0; attempt < 20 && !container.textContent?.includes('standard'); attempt += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    }
    expect(container.textContent).toContain('pages.dynamicSources.discovery.detected:v2.0.0')
    expect(container.textContent).toContain('standard')
    expect(container.textContent).toContain('solar')
  })
})
