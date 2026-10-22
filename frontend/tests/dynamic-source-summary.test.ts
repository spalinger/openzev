import { createElement } from 'react'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamicSourceSummary } from '../src/features/tariffs/DynamicSourceSummary'
import { renderWithProviders } from './helpers/render'
import type { AppSettings, DynamicTariffSource } from '../src/types/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/lib/appSettings', () => ({ formatDateTime: (value: string) => value }))

const source: DynamicTariffSource = {
    id: 'source-1', label: 'Shared source', url: 'https://prices.example.test',
    api_version: 'v1_0_5', tariff_type: 'grid', tariff_name: 'Standard', enabled: true,
    last_fetch_status: 'ok', last_fetch_at: null, last_success_at: null, last_fetch_error: '',
    covers_from: null, covers_to: null, point_count: 0, linked_tariff_count: 2, linked_zev_count: 1,
    supports_backfill: true, empty_on_not_found: false, aggregated_tariff_types: [], created_at: '', updated_at: '',
}

function render(overrides: Partial<DynamicTariffSource> = {}, canOperate = true) {
    return renderToStaticMarkup(createElement(MemoryRouter, null,
        createElement(DynamicSourceSummary, { source: { ...source, ...overrides }, settings: {} as AppSettings, canOperate })))
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

// The source's address and coverage sit in a disclosure, mounted when opened.
async function renderDetails(overrides: Partial<DynamicTariffSource> = {}, canOperate = true) {
    const { container } = await renderWithProviders(
        createElement(DynamicSourceSummary, { source: { ...source, ...overrides }, settings: {} as AppSettings, canOperate }), cleanups)
    await act(async () => { container.querySelector('summary')!.click() })
    return container.innerHTML
}

describe('DynamicSourceSummary', () => {
    it('keeps the address and coverage behind the source details until they are opened', () => {
        const html = render({ point_count: 12, covers_from: '2026-09-01', covers_to: '2026-10-01' })
        expect(html).toContain('pages.dynamicSources.sourceDetails')
        expect(html).not.toContain('prices.example.test')
        expect(html).not.toContain('pages.dynamicSources.history.coverage')
    })

    it('shows no stored coverage without warning about gaps in an empty source', async () => {
        const html = await renderDetails()
        expect(html).toContain('pages.dynamicSources.noCoverage')
        expect(html).not.toContain('pages.dynamicSources.coverageHint')
        expect(html).not.toContain('pages.dynamicSources.history.coverage')
    })

    it('combines successful status and its timestamp without a repeated last-success line', () => {
        const time = '2026-10-01T12:00:00Z'
        expect(render()).not.toContain('pages.dynamicSources.lastSuccess')
        const html = render({ last_success_at: time })
        expect(html).toContain('pages.dynamicSources.status.ok')
        expect(html.split(time)).toHaveLength(2)
        expect(html).not.toContain('pages.dynamicSources.lastSuccess')
    })

    it('retains the earlier successful fetch when the latest fetch fails', () => {
        const html = render({ last_fetch_status: 'failed', last_success_at: '2026-10-01T12:00:00Z', last_fetch_error: 'Source unavailable' })
        expect(html).toContain('pages.dynamicSources.status.failed')
        expect(html).toContain('pages.dynamicSources.lastSuccess')
        expect(html).toContain('Source unavailable')
    })

    it('explains that a disabled source has automatic fetching disabled', () => {
        const html = render({ enabled: false })
        expect(html).toContain('pages.dynamicSources.details.automaticDisabled')
        expect(html).not.toContain('pages.dynamicSources.status.disabled')
    })

    it('labels source configuration and separates stored prices from coverage and usage', async () => {
        const html = await renderDetails({ point_count: 12, covers_from: '2026-09-01', covers_to: '2026-10-01' })
        expect(html).toContain('<dl class="tariff-source-facts">')
        expect(html).toContain('pages.dynamicSources.form.apiVersion')
        expect(html).toContain('pages.dynamicSources.form.tariffType')
        expect(html).toContain('pages.dynamicSources.form.tariffName')
        expect(html).toContain('pages.dynamicSources.details.storedPrices')
        expect(html).toContain('>12</dd>')
        expect(html).toContain('pages.dynamicSources.details.coverage')
        expect(html).toContain('2026-09-01')
        expect(html).toContain('2026-10-01')
        expect(html).toContain('pages.dynamicSources.columns.reuse')
        expect(html).toContain('pages.dynamicSources.coverageHint')
        expect(html).not.toContain('pages.dynamicSources.noCoverage')
    })

    it('keeps the maintenance link inside source details and limits it to operation permission', async () => {
        expect(render()).not.toContain('pages.dynamicSources.manageSource')
        expect(await renderDetails()).toContain('/admin/dynamic-sources?source=source-1')
        expect(await renderDetails()).toContain('data-icon="arrow-right"')
        expect(await renderDetails({}, false)).not.toContain('pages.dynamicSources.manageSource')
    })
})
