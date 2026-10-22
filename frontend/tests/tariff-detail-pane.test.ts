import { createElement, type ReactElement } from 'react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TariffDetailPane } from '../src/features/tariffs/TariffDetailPane'
import { renderWithProviders } from './helpers/render'
import type { TariffSeries, TariffVersion } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }))
vi.mock('../src/lib/api/tariffs', () => ({ fetchDynamicTariffSources: vi.fn().mockResolvedValue([]) }))

// The detail pane is in flow beside the list, not an overlay (SPEC-2026-10-tariff-split-view §5, §6).

const settings = { date_format_short: 'dd.MM.yyyy', date_format_long: 'd MMMM yyyy', date_time_format: 'dd.MM.yyyy HH:mm', updated_at: '' }
const version = (id: string, valid_from: string, valid_to: string | null): TariffVersion => ({
    id, zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    valid_from, valid_to, fixed_price_chf: '10.00', split_key: 'equal', notes: '', periods: [],
}) as unknown as TariffVersion
const past = version('past', '2000-01-01', '2000-12-31')
const current = version('current', '2001-01-01', null)
const next = version('next', '2999-01-01', null)
const series = { zev: 'z', name: 'Grid', category: 'grid_fees', billing_mode: 'monthly_fee', energy_type: null,
    version_count: 3, active_version_id: 'current', gaps: [], versions: [next, current, past] } as unknown as TariffSeries

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const noop = () => undefined
const handlers = {
    onShowVersion: noop, deleteTariffDisabled: false, deletePeriodDisabled: false, onClose: noop, onEditTariff: noop,
    onDeleteTariff: noop, onOpenCreatePeriod: noop, onEditPeriod: noop, onDeletePeriod: noop, onNewVersion: noop,
    onDuplicate: noop, onRenameSeries: noop,
}
async function pane(props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const element = createElement(TariffDetailPane, { series, allSeries: [series], settings, shownVersionId: null, ...handlers, ...props } as never) as ReactElement
    const { container } = await renderWithProviders(element, cleanups)
    return container
}

describe('TariffDetailPane', () => {
    it('is a region named by its title and is not modal', async () => {
        const container = await pane()
        const region = container.querySelector('section.tariff-pane')!
        expect(region.getAttribute('aria-modal')).toBeNull()
        expect(region.getAttribute('role')).toBeNull()
        expect(container.querySelector(`#${region.getAttribute('aria-labelledby')}`)?.textContent).toBe('Grid')
        expect(container.querySelector('h2')?.getAttribute('tabindex')).toBe('-1')
    })

    it('shows current, scheduled and earlier versions together in a table without disclosures', async () => {
        const container = await pane()
        const dates = [...container.querySelectorAll('.tariff-version-window')].map((node) => node.textContent)
        expect(dates).toEqual(['01.01.2999 – pages.tariffs.openEnded', '01.01.2001 – pages.tariffs.openEnded', '01.01.2000 – 31.12.2000'])
        expect(container.querySelectorAll('.tariff-version-table tbody tr')).toHaveLength(3)
        expect(container.querySelector('.tariff-chart-section')).toBeNull()
        expect(container.querySelector('details')).toBeNull()
    })

    it('identifies a selected past version and selects another through its date', async () => {
        const onShowVersion = vi.fn()
        const container = await pane({ shownVersionId: 'past', onShowVersion })
        expect(container.querySelector('.tariff-version-row.is-shown.is-ended')).not.toBeNull()
        expect(container.querySelector('.tariff-pane-window .badge')?.textContent).toBe('pages.tariffs.versions.statusEnded')
        await act(async () => container.querySelector<HTMLButtonElement>('.tariff-version-select')!.click())
        expect(onShowVersion).toHaveBeenCalledWith('next')
    })

    it('keeps version context in the heading and labels the common tasks above pricing', async () => {
        const container = await pane({ series: { ...series, energy_type: 'grid' } })
        expect(container.querySelector('.tariff-pane-header .badge')?.textContent).toBe('pages.tariffs.workspace.current')
        expect(container.querySelector('.tariff-version-row.is-shown .tariff-version-status')?.textContent).toBe('pages.tariffs.workspace.current')
        expect(container.querySelector('.tariff-pane-window')?.textContent).toContain('01.01.2001')
        expect(container.querySelector('.tariff-pane-header [data-action-key="edit-current"]')).toBeNull()
        expect(container.querySelector('.tariff-pane-actions [data-action-key="edit-current"]')?.textContent).toContain('pages.tariffs.workspace.correct')
        expect(container.querySelector('.tariff-pane-meta')?.textContent).not.toContain('pages.tariffs.energyTypes.grid')
    })

    it.each([['levies', 'grid'], ['grid_fees', 'local']] as const)('preserves distinct energy context for %s / %s', async (category, energy_type) => {
        const container = await pane({ series: { ...series, category, energy_type } })
        expect(container.querySelector('.tariff-pane-meta')?.textContent).toContain(`pages.tariffs.energyTypes.${energy_type}`)
    })

    it('closes on Escape unless something inside already took it', async () => {
        const onClose = vi.fn()
        const container = await pane({ onClose })
        const title = container.querySelector('h2')!
        await act(async () => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
        expect(onClose).toHaveBeenCalledOnce()
        const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        title.addEventListener('keydown', (event) => event.preventDefault(), { once: true })
        await act(async () => { title.dispatchEvent(handled) })
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('offers a viewer the same facts and warnings with no write controls', async () => {
        const container = await pane({ readOnly: true })
        expect(container.querySelector('.tariff-pane-header [data-action-key^="edit-"]')).toBeNull()
        expect(container.querySelector('.tariff-pane-actions')).toBeNull()
        expect(container.querySelector('.tariff-version-row .button')).toBeNull()
        expect(container.querySelector('.tariff-version-select')).not.toBeNull()
    })

    it('replaces the body with the form being edited and keeps the tariff named', async () => {
        const container = await pane({ editor: { label: 'editing label', content: createElement('form', { className: 'the-form' }) } })
        expect(container.querySelector('h2')?.textContent).toBe('Grid')
        expect(container.querySelector('.tariff-editor-title')?.textContent).toBe('editing label')
        expect(container.querySelector('.tariff-pane-window')?.textContent).toContain('01.01.2001')
        expect(container.querySelector('.the-form')).not.toBeNull()
        expect(container.querySelector('.tariff-version-section')).toBeNull()
    })
})


it('marks an unpriced tariff incomplete and keeps the first-price action available', async () => {
    const onOpenCreatePeriod = vi.fn()
    const unpriced = { ...series, billing_mode: 'energy', versions: [{ ...current, billing_mode: 'energy', periods: [] }] }
    const container = await pane({ series: unpriced, onOpenCreatePeriod })
    expect(container.textContent).toContain('pages.tariffs.workspace.incompleteBody')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action-key="add-first-price"]')!.click())
    expect(onOpenCreatePeriod).toHaveBeenCalledWith('current')
})

it('repairs an interior gap using the preceding prices and the missing start date', async () => {
    const onNewVersion = vi.fn()
    const withGap = { ...series, gaps: [{ start: '2001-01-01', end: '2001-01-31' }], versions: [{ ...current, valid_from: '2001-02-01' }, past] }
    const container = await pane({ series: withGap, onNewVersion })
    const action = [...container.querySelectorAll<HTMLButtonElement>('.tariff-gap-warning button')][0]
    await act(async () => action.click())
    expect(onNewVersion).toHaveBeenCalledWith(withGap, past, '2001-01-01')
})
