import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DemoWorkspace } from '../src/design-lab/DemoWorkspace'
import { DesignLab } from '../src/design-lab/DesignLab'
import { designs } from '../src/design-lab/mockData'
import type { DemoRole, DesignId, Screen } from '../src/design-lab/mockData'
import { designLabLocales } from '../src/i18n/locales/designLab'

const i18n = createInstance()
const cleanup: (() => void)[] = []

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: designLabLocales.en } }, interpolation: { escapeValue: false } })
  // jsdom has no native dialog API; the tests cover its contents and actions.
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
})

afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  window.history.replaceState(null, '', '/')
})

function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(createElement(I18nextProvider, { i18n }, element)))
  cleanup.push(() => { act(() => root.unmount()); container.remove() })
  return container
}

function workspace(role: DemoRole, design: DesignId, screen: Screen = 'invoices', communityId?: string) {
  return mount(createElement(DemoWorkspace, { role, design, screen, communityId }))
}

function click(element: Element | null) {
  expect(element).not.toBeNull()
  act(() => (element as HTMLElement).click())
}

function button(container: Element, label: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === label) ?? null
}

describe('design mockup access and scope', () => {
  it.each(designs)('$id: participants see only their issued invoices and cannot change their status', ({ id }) => {
    const container = workspace('participant', id)
    expect(container.textContent).toContain('Maya Roth')
    expect(container.textContent).not.toContain('Nina Keller')
    expect(container.textContent).not.toContain('Atelier Nord')
    expect(container.querySelector('.demo-navigation')?.textContent).not.toContain('Participants')
    expect(button(container, 'Approve drafts')).toBeNull()
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    click(container.querySelector('.invoice-code'))
    expect(container.querySelector('.demo-invoice-detail')?.textContent).toContain('Maya Roth')
    expect(button(container, 'Record payment')).toBeNull()
    expect(button(container, 'Send invoice')).toBeNull()
  })

  it.each(designs)('$id: read-only managers can inspect drafts without approval controls', ({ id }) => {
    const container = workspace('viewer', id)
    expect(container.textContent).toContain('Nina Keller')
    expect(container.querySelector('.read-only-label')?.textContent).toBe('Read only')
    expect(button(container, 'Approve')).toBeNull()
    expect(button(container, 'Approve drafts')).toBeNull()
    click(container.querySelector('.invoice-code'))
    expect(container.querySelector('.demo-invoice-detail')?.textContent).toContain('OZ-2026-091')
    expect(button(container, 'Approve')).toBeNull()
    expect(button(container, 'Send invoice')).toBeNull()
  })

  it('approves only selected, visible drafts and retains other invoice states', () => {
    const container = workspace('owner', 'alpine')
    click(container.querySelector('input[aria-label="Select OZ-2026-092"]'))
    click(button(container, 'Approve selected'))
    const rows = [...container.querySelectorAll('.demo-table tbody tr')]
    expect(rows.find((row) => row.textContent?.includes('Reto Meier'))?.querySelector('.demo-status')?.textContent).toBe('Approved')
    expect(rows.find((row) => row.textContent?.includes('Nina Keller'))?.querySelector('.demo-status')?.textContent).toBe('Draft')
    expect(rows.find((row) => row.textContent?.includes('Maya Roth'))?.querySelector('.demo-status')?.textContent).toBe('Sent')
  })

  it('blocks draft approval while a community has missing metering data', () => {
    const container = workspace('owner', 'alpine', 'invoices', 'limmatblick')
    expect(container.textContent).toContain('Anna Huber')
    expect(container.textContent).not.toContain('Nina Keller')
    expect(button(container, 'Approve drafts')).toBeNull()
    expect(button(container, 'Approve')).toBeNull()
    click(container.querySelector('.invoice-code'))
    expect(container.querySelector('.demo-invoice-detail')?.textContent).toContain('LB-2026-041')
    expect(button(container, 'Approve')).toBeNull()
  })

  it('starts admins in platform scope and opens the chosen community explicitly', () => {
    const onScopeChange = vi.fn()
    const container = mount(createElement(DemoWorkspace, { role: 'admin', design: 'ledger', screen: 'overview', onScopeChange }))
    expect(container.querySelector('.demo-page-heading')?.textContent).toContain('Platform administration')
    expect(container.querySelector('.demo-navigation')?.textContent).toContain('Accounts')
    const row = [...container.querySelectorAll('.communities-table tbody tr')].find((item) => item.textContent?.includes('Bergacker'))!
    click(button(row, 'Open community'))
    expect(onScopeChange).toHaveBeenCalledWith('bergacker')
  })

  it('lets a manager resolve missing readings before approving the affected drafts', () => {
    window.history.replaceState(null, '', '/design-lab.html?design=alpine&role=owner&screen=energy&community=limmatblick')
    const container = mount(createElement(DesignLab))
    expect(container.querySelector('.metering-quality')?.textContent).toContain('Missing data')
    click(button(container, 'Load sample readings'))
    expect(container.querySelector('.metering-quality')?.textContent).not.toContain('Missing data')
    click(button(container.querySelector('.demo-navigation')!, 'Billing'))
    click(button(container, 'Approve drafts'))
    const rows = [...container.querySelectorAll('.demo-table tbody tr')]
    expect(rows.find((row) => row.textContent?.includes('Anna Huber'))?.querySelector('.demo-status')?.textContent).toBe('Approved')
    expect(rows.find((row) => row.textContent?.includes('Felix Graf'))?.querySelector('.demo-status')?.textContent).toBe('Approved')
  })

  it('keeps viewer settings read-only', () => {
    const container = workspace('viewer', 'folio', 'settings')
    expect(container.querySelector('input[readonly]')).not.toBeNull()
    expect(button(container, 'Save')).toBeNull()
  })

  it('rejects participant links to management pages and other communities', () => {
    window.history.replaceState(null, '', '/design-lab.html?design=alpine&role=participant&screen=accounts&community=bergacker')
    const container = mount(createElement(DesignLab))
    expect(container.querySelector('.demo-shell')?.getAttribute('data-scope')).toBe('sonnenhof')
    expect(container.querySelector('h1')?.textContent).toBe('My overview')
    expect(container.textContent).not.toContain('Daniel Frei')
    expect(container.textContent).not.toContain('Nina Keller')
  })

  it('keeps the complete admin menu while switching between community and platform destinations', () => {
    window.history.replaceState(null, '', '/design-lab.html?design=alpine&role=admin')
    const container = mount(createElement(DesignLab))
    click(button(container.querySelector('.nav-group-setup')!, 'Tariffs'))
    expect(container.querySelector('.demo-shell')?.getAttribute('data-scope')).toBe('sonnenhof')
    expect(container.querySelector('h1')?.textContent).toBe('Tariffs')
    expect(container.querySelector('.demo-page-content')?.childElementCount).toBe(0)
    expect(container.querySelector('.nav-group-platform')).not.toBeNull()
    expect(window.location.search).toContain('screen=tariffs')
    click(button(container.querySelector('.nav-group-platform')!, 'Templates'))
    expect(container.querySelector('.demo-shell')?.getAttribute('data-scope')).toBe('platform')
    expect(container.querySelector('h1')?.textContent).toBe('Templates')
    expect(container.querySelector('.demo-page-content')?.childElementCount).toBe(0)
    expect(container.querySelector('.nav-group-setup')).not.toBeNull()
    click(button(container.querySelector('.nav-group-setup')!, 'Settings'))
    expect(container.querySelector('.demo-shell')?.getAttribute('data-scope')).toBe('sonnenhof')
    expect(container.querySelector('.demo-navigation [aria-current="page"]')?.closest('[data-nav-group]')?.getAttribute('data-nav-group')).toBe('setup')
    click(button(container.querySelector('.nav-group-platform')!, 'Settings'))
    expect(container.querySelector('.demo-shell')?.getAttribute('data-scope')).toBe('platform')
    expect(container.querySelector('.demo-navigation [aria-current="page"]')?.closest('[data-nav-group]')?.getAttribute('data-nav-group')).toBe('platform')
  })

  it('opens an empty annual-statement preview without exposing community records', () => {
    window.history.replaceState(null, '', '/design-lab.html?design=canvas&role=participant')
    const container = mount(createElement(DesignLab))
    click(button(container.querySelector('.demo-navigation')!, 'Annual statement'))
    expect(container.querySelector('h1')?.textContent).toBe('Annual statement')
    expect(container.querySelector('.demo-page-content')?.childElementCount).toBe(0)
    expect(container.textContent).not.toContain('Nina Keller')
    expect(container.querySelector('.nav-group-setup')).toBeNull()
    expect(container.querySelector('.nav-group-platform')).toBeNull()
    click(container.querySelector('.topbar-account[aria-label="Account"]'))
    expect(container.querySelector('.profile-details')?.textContent).toContain('Maya Roth')
  })

  it('provides matching copy and interpolation in every language', () => {
    function leaves(object: Record<string, unknown>, prefix = ''): [string, string][] {
      return Object.entries(object).flatMap(([key, value]) => typeof value === 'object' && value !== null ? leaves(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, value as string]])
    }
    const english = new Map(leaves(designLabLocales.en))
    const placeholders = (value: string) => [...value.matchAll(/\{\{\s*(\w+)/g)].map((match) => match[1]).sort()
    for (const locale of Object.values(designLabLocales)) {
      const strings = new Map(leaves(locale))
      expect([...strings.keys()]).toEqual([...english.keys()])
      for (const [key, value] of strings) {
        expect(value.trim()).not.toBe('')
        expect(placeholders(value)).toEqual(placeholders(english.get(key)!))
      }
    }
  })
})
