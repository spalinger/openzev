import { expect, test, type Page } from '@playwright/test'
import { apiErrors, mockApi } from './page-anatomy-fixtures'
import type { TariffPeriod, TariffSeries, TariffVersion } from '../src/types/api'

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })
test.afterEach(({ page }) => expect(apiErrors.get(page) ?? []).toEqual([]))

function band(id: string, price: string, overrides: Partial<TariffPeriod> = {}): TariffPeriod {
  return { id, tariff: 'current', period_type: 'flat', label: '', price_chf_per_kwh: price,
    percentage: null, time_from: null, time_to: null, weekdays: '', months: '', ...overrides }
}

const current: TariffVersion = {
  id: 'current', zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid',
  valid_from: '2026-01-01', valid_to: '2026-12-31', fixed_price_chf: null, split_key: 'equal', notes: '',
  periods: [band('flat', '0.295')],
}
const next: TariffVersion = { ...current, id: 'next', valid_from: '2027-01-01', valid_to: '2027-12-31',
  periods: [band('next-flat', '0.315', { tariff: 'next' })] }
const later: TariffVersion = { ...next, id: 'later', valid_from: '2028-01-01', valid_to: null,
  periods: [band('later-flat', '0.350', { tariff: 'later' })] }
const grid: TariffSeries = { zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy',
  energy_type: 'grid', version_count: 3, active_version_id: 'current', gaps: [], versions: [later, next, current] }

async function tariffs(page: Page, series: TariffSeries[]) {
  await mockApi(page)
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: series }))
}

test('next-price controls select scheduled versions within the expanded row', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs')
  const overview = page.locator('#tariff-overview-current')
  await expect(overview.locator('tbody tr')).toHaveCount(1)
  await expect(overview.locator('td.tariff-table-bands')).toContainText('0.295')
  await expect(overview.locator('td.tariff-table-bands .tariff-upcoming-price')).toHaveText('0.315')
  await expect(overview.locator('.tariff-table-open button')).toHaveAccessibleName('Show details for Grid')
  await expect(overview.locator('.tariff-upcoming-price')).toHaveAccessibleName('Show All hours: 0.315 CHF/kWh, from 01.01.2027')
  await expect(overview.locator('.tariff-price-headings')).toContainText('Today')
  await expect(overview.locator('.tariff-price-headings')).toContainText('01.01.2027')
  for (const key of ['Enter', 'Space']) {
    await overview.locator('.tariff-upcoming-price:visible').focus()
    await page.keyboard.press(key)
    await expect(page).toHaveURL(/version=next/)
    await expect(overview.locator('tr.is-selected .tariff-upcoming-price:visible')).toHaveCount(0)
    await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.315')
    await expect(page.locator('.tariff-version-row.is-shown .tariff-future-icon')).toHaveAttribute('aria-label', 'Upcoming')
    await page.locator('.tariff-version-select').filter({ hasText: '01.01.2028' }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(/version=later/)
    await expect(overview.locator('tr.is-selected')).toHaveCount(1)
    await page.locator('.tariff-version-select').filter({ hasText: '01.01.2026' }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(/version=current/)
    await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.295')
    await page.locator('.tariff-table-open button').click()
    await expect(page.locator('.tariff-detail-row')).toBeHidden()
  }
})

test('future-only tariffs keep their sole price in compact and split views', async ({ page }) => {
  await tariffs(page, [{ ...grid, versions: [next], version_count: 1, active_version_id: null }])
  for (const width of [1440, 400]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tariffs')
    await expect(page.locator('.tariff-upcoming-price')).toBeVisible()
    await expect(page.locator('.tariff-upcoming-price')).toHaveText('0.315')
    if (width === 1440) {
      await page.locator('.tariff-select').click()
      await expect(page.locator('.tariff-detail-row')).toBeVisible()
      await expect(page.locator('.tariff-version-amount strong')).toHaveText('0.315')
    }
  }
})

for (const width of [1440, 400]) {
  test(`long dynamic source names stay out of the future price tag at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const dynamic = { ...next, dynamic_source: 'source', periods: [] }
    await tariffs(page, [])
    let average: string | null = null
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...grid, versions: [{
      ...dynamic, dynamic_price_summary: { status: average == null ? 'unavailable' : 'complete',
        average_chf_per_kwh: average, reference_from: null, reference_to: null },
    }, current], version_count: 2 }] }))
    await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [{
      id: 'source', label: 'Demo – dynamische Netznutzung (synthetisch)', enabled: true,
    }] }))
    await page.goto('/tariffs')
    const tag = page.locator('.tariff-schedule-change')
    await expect(page.locator('.tariff-select')).toBeVisible()
    await expect(tag).toHaveCount(0)
    average = '0.00000'
    await page.reload()
    await expect(tag).toHaveText('New schedule from 01.01.2027')
    await expect(page.locator('.tariff-planned-summary')).toContainText('0.000')
    await expect(page.locator('.tariff-planned-summary')).not.toContainText('CHF/kWh')
    await expect(tag.locator('svg[data-icon="clock"]')).toHaveCount(1)
    await expect(tag).not.toContainText('dynamische Netznutzung')
    if (width === 1440) {
      await expect(tag).toBeVisible()
    } else await expect(tag).toBeHidden()
    await page.locator('.tariff-select').click()
    await expect(page).toHaveURL(/version=current/)
    if (width === 1440) {
      await expect(page.locator('.tariff-version-amount').first()).toBeVisible()
      await expect(tag).toBeHidden()
    }
    await expect(page.locator('.tariff-version-table')).not.toContainText('dynamische Netznutzung')

  })
}

test('a missing future band keeps current prices readable', async ({ page }) => {
  const periods = [
    band('tagged', '0.295', { period_type: 'band', label: 'Weekday daytime electricity rate', weekdays: '0,1,2,3,4', time_from: '07:00', time_to: '21:00' }),
    band('plain', '0.225', { period_type: 'band', label: 'Weekday daytime electricity rate', weekdays: '0,1,2,3,4', time_from: '07:00', time_to: '21:00' }),
  ]
  await tariffs(page, [{ ...grid, versions: [
    { ...next, periods: periods.map((period, index) => ({ ...period, id: `next-${period.id}`, price_chf_per_kwh: index ? null : '0.315' })) },
    { ...current, periods },
  ] }])
  for (const width of [1440, 1280, 400]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tariffs')
    if (width === 1280) {
      await page.locator('.tariff-select').click()
      await expect(page.locator('.tariff-detail-row')).toBeVisible()
    }
    const bands = page.locator('td.tariff-table-bands:visible .tariff-table-band:not(.tariff-price-headings), .tariff-version-row.is-shown .tariff-version-rate')
    await expect(bands).toHaveCount(2)
    for (const band of await bands.all()) {
      await expect(band.locator('.tariff-table-band-applies, .tariff-version-applies')).toHaveCSS('white-space', 'normal')
      expect(await band.locator('.tariff-table-band-applies, .tariff-version-applies').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('active clicks and a bare link use the current version despite a stale active ID', async ({ page }) => {
  await tariffs(page, [{ ...grid, active_version_id: 'later' }])
  await page.goto('/tariffs?tariff=42%3AGrid')
  await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.295')
  await expect(page.locator('.tariff-pane .info-banner')).toHaveCount(0)
  await expect(page.locator('.tariff-version-row').first()).toContainText('01.01.2028')
  await expect(page.locator('.tariff-version-row').last()).toContainText('01.01.2026')
  await expect(page.locator('.tariff-pane')).toHaveCount(0)
  await page.locator('.tariff-table-open button').click()
  await expect(page.locator('.tariff-detail-row')).toBeHidden()
  await page.locator('#tariff-overview-current .tariff-select').click()
  await expect(page).toHaveURL(/version=current/)
  await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.295')
})

for (const width of [1440, 400]) {
  test(`price editing and visible version history remain keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const past = { ...current, id: 'past', valid_from: '2025-01-01', valid_to: '2025-12-31' }
    const seasonal = { ...current, periods: [
      band('high', '0.29500', { period_type: 'high', weekdays: '0,1,2,3,4', months: '6,7,8', time_from: '07:00:00', time_to: '21:00:00' }),
      band('low', '0.22500', { period_type: 'low' }),
    ] }
    await tariffs(page, [{ ...grid, versions: [next, seasonal, past] }])
    await page.goto('/tariffs?tariff=42%3AGrid&version=current')
    const detail = page.locator('.tariff-detail-row')
    const editor = page.locator('.tariff-pane')
    await expect(detail.locator('.is-shown .tariff-version-applies').first()).toContainText('07:00–21:00')
    await expect(detail.locator('.is-shown .tariff-version-applies').last()).toContainText('time window not configured')
    await expect(detail.locator('.is-shown .tariff-version-amount strong').first()).toHaveText('0.295')

    const pastVersion = detail.locator('.tariff-version-select').filter({ hasText: '01.01.2025' })
    await expect(pastVersion).toBeVisible()
    for (const control of [pastVersion, detail.locator('.is-shown .tariff-version-amount button').first()]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    }
    await expect(detail.locator('.tariff-price-history')).toBeVisible()
    await expect(detail.locator('summary')).toHaveCount(0)
    await expect(page.locator('.tariff-overview-history')).toHaveCount(0)
    await pastVersion.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/version=past/)
    await expect(editor.locator('[data-focus-field="valid_from"] button').first()).toBeFocused()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pastVersion).toBeFocused()
    const currentVersion = detail.locator('.tariff-version-select').filter({ hasText: '01.01.2026' })
    await currentVersion.click()
    await expect(page).toHaveURL(/version=current/)
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(currentVersion).toBeFocused()

    const seriesMenu = page.locator('.tariff-table-name [data-action-key="series-actions"]')
    await seriesMenu.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
    await expect(editor.locator('form')).toBeVisible()
    const rows = editor.locator('.tariff-version-band')
    await expect(rows.locator('.badge')).toHaveCount(0)
    const inputs = await rows.locator('.tariff-band-price-input').evaluateAll(elements => elements.map(element => {
      const { x, width } = element.getBoundingClientRect()
      return { x, width }
    }))
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toEqual(inputs[1])
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(seriesMenu).toBeFocused()

    const editBand = detail.locator('[data-action-key="edit-period-high"]')
    await editBand.focus()
    await page.keyboard.press('Enter')
    await expect(editor.locator('form')).toBeVisible()
    await expect(editor.locator('input[name="price_chf_per_kwh"]')).toBeFocused()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editBand).toBeFocused()
    const versionMenu = detail.locator('[data-action-key="version-actions-current"]')
    await versionMenu.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Delete High (HT)', exact: true }).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(versionMenu).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.tariff-table-open button').click()
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toBeFocused()
  })
}

for (const width of [1440, 400]) {
  test(`unpublished future dynamic prices are not reported as missing at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 950 })
    const future = { ...next, valid_from: '2026-11-27', valid_to: null, dynamic_source: 'source', periods: [] }
    await tariffs(page, [{ ...grid, versions: [future, { ...current, valid_to: '2026-11-26' }], version_count: 2 }])
    await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [{
      id: 'source', label: 'Operator prices', api_version: 'v1_0_5', tariff_type: 'electricity',
      enabled: true, last_fetch_status: 'ok', point_count: 0, covers_from: null, covers_to: null,
    }] }))
    await page.route('**/api/v1/tariffs/dynamic-sources/source/prices/**', route => route.fulfill({ json: {
      points: [], gaps: [{ from: '2026-11-26T23:00:00Z', to: '2026-11-27T23:00:00Z' }],
      stats: { point_count: 0, gap_count: 1, average_chf_per_kwh: null, minimum_chf_per_kwh: null, maximum_chf_per_kwh: null, negative_count: 0 },
    } }))
    await page.goto('/tariffs?tariff=42%3AGrid&version=next')
    const history = page.locator('.tariff-chart-section')
    await expect(history).toContainText(/No prices in this date range|Prices for this future tariff/)
    await expect(history.getByText('Missing prices', { exact: true })).toHaveCount(0, { timeout: 1000 })
    await expect(history.getByText('Invoice generation stops if a required dynamic price is missing.', { exact: true })).toHaveCount(0)
    await expect(page.locator('#tariff-overview-current').getByRole('button', { name: 'Change from 27.11.2026', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`future-dynamic-prices-${width}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('dynamic fetched prices are the visible history and source maintenance stays in details', async ({ page }, testInfo) => {
  const dynamic = { ...current, dynamic_source: 'source', periods: [], valid_from: '2026-10-01', valid_to: null }
  await tariffs(page, [{ ...grid, versions: [dynamic], version_count: 1 }])
  await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [{
    id: 'source', label: 'Operator prices', url: 'https://example.test/prices', api_version: 'v1_0_5', tariff_type: 'electricity',
    tariff_name: '', enabled: false, last_fetch_status: 'ok', last_success_at: '2026-10-02T10:00:00Z',
    point_count: 2, covers_from: '2026-10-01T00:00:00Z', covers_to: '2026-10-02T00:00:00Z',
    linked_tariff_count: 1, linked_zev_count: 1,
  }] }))
  let pointCount = 2
  let gaps = [{ from: '2026-10-01T02:00:00Z', to: '2026-10-02T00:00:00Z' }]
  await page.route('**/api/v1/tariffs/dynamic-sources/source/prices/**', route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('date_from')).toBe('2026-10-01')
    expect(url.searchParams.get('date_to')).toBe('2026-10-02')
    return route.fulfill({ json: {
      source: 'source', date_from: '2026-10-01', date_to: '2026-10-02',
      gaps,
      stats: { point_count: pointCount, minimum_chf_per_kwh: '0.05', maximum_chf_per_kwh: '0.07', average_chf_per_kwh: '0.06', negative_count: 0, gap_count: 0 },
      points: [
        { valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-10-01T01:00:00Z', price_chf_per_kwh: '0.05' },
        { valid_from: '2026-10-01T01:00:00Z', valid_to: '2026-10-01T02:00:00Z', price_chf_per_kwh: '0.07' },
      ].slice(0, pointCount),
    } })
  })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const pane = page.locator('.tariff-detail-row')
  await expect(pane.locator('.tariff-dynamic-chart')).toBeVisible()
  await expect(pane.locator('.tariff-source-section .warning-banner')).toHaveCount(0)
  const notice = pane.locator('.tariff-dynamic-gaps')
  await expect(notice).toBeVisible()
  await expect(notice).not.toHaveClass(/warning-banner/)
  await expect(notice.locator('svg[data-icon="circle-info"]')).toBeVisible()
  await expect(notice).toContainText('Missing price intervals between 01.10.2026 and 02.10.2026.')
  await expect(notice.locator('li')).toHaveText('01.10.2026 04:00 – 02.10.2026 02:00')
  await expect(pane.getByText('Invoice generation stops if a required dynamic price is missing.', { exact: true })).toBeVisible()
  await expect(pane.locator('.tariff-price-history')).toHaveCount(0)
  await expect(pane.locator('.tariff-source-status[data-status="ok"]')).toHaveText('Fetch successful · 02.10.2026 12:00')
  await expect(pane.getByText(/Last successful fetch:/)).toHaveCount(0)
  await expect(pane.locator('.tariff-source-status svg[data-icon="check"]')).toBeVisible()
  await expect(pane.getByText('Automatic fetching disabled', { exact: true })).toBeVisible()
  await expect(pane.locator('.tariff-source-status')).not.toHaveClass(/badge/)
  const adminLink = pane.getByRole('link', { name: 'Manage source in platform admin' })
  await expect(pane.locator('.tariff-source-facts')).toBeVisible()
  await expect(adminLink).toBeVisible()
  await expect(adminLink.locator('svg[data-icon="arrow-right"]')).toBeVisible()
  await expect(pane.getByRole('columnheader', { name: 'Valid from', exact: true })).toBeVisible()
  pointCount = 1
  gaps = [{ from: '2026-10-01T02:00:00Z', to: '2026-10-01T03:00:00Z' },
    { from: '2026-10-01T04:00:00Z', to: '2026-10-01T05:00:00Z' }]
  await page.reload()
  await expect(pane.locator('.tariff-dynamic-chart .recharts-dot').first()).toBeVisible()
  await expect(notice.locator('p').first()).toHaveText('Missing price intervals on 01.10.2026.')
  await expect(notice.locator('p')).toHaveCount(3)
  const filters = (await pane.locator('.form-grid').first().boundingBox())!
  expect(filters.y + filters.height).toBeLessThan((await notice.boundingBox())!.y)
  await expect(notice).not.toContainText('01.10.2026–01.10.2026')
  await page.setViewportSize({ width: 400, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await notice.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('dynamic-missing-prices-400.png') })
  pointCount = 0
  await page.reload()
  await expect(pane.locator('.tariff-dynamic-chart')).toHaveCount(0)
  await expect(pane.getByText('No prices in this date range.', { exact: true })).toHaveCount(1)
  await expect(notice).toBeVisible()
  await expect(pane.locator('summary').filter({ hasText: 'Fetched interval prices' })).toHaveCount(0)
})

test('corrections show editable fields and series identity directly', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const detail = page.locator('.tariff-detail-row')
  const editor = page.locator('.tariff-pane')
  await detail.locator('[data-action-key="edit-current"]').click()
  const notes = editor.locator('textarea[name="notes"]')
  await expect(notes).toBeVisible()
  const box = (await notes.boundingBox())!
  expect(box.height).toBeGreaterThan(110)
  expect(box.width).toBeGreaterThan(450)
  await expect(editor.locator('select[name="dynamic_source"]')).toHaveCount(0)
  await expect(editor.locator('.tariff-readonly-value')).toHaveCount(0)
  const metadata = editor.locator('.tariff-version-identity')
  await expect(metadata).toBeVisible()
  await expect(metadata).toContainText('Energy · By energy (kWh) · Grid')
  await expect(editor.locator('details')).toHaveCount(0)
  await expect(metadata).toContainText('Rename the tariff from its title menu.')
  await notes.fill('First line\nSecond line')
  await expect(notes).toHaveValue('First line\nSecond line')
})

test('tariff rows toggle closed and the expanded chevron points up', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs')
  const row = page.locator('#tariff-overview-current .tariff-summary-row')
  for (const target of [row.locator('.tariff-select'), row.locator('.tariff-table-open button'), row.locator('td.tariff-table-tariff')]) {
    await row.locator('.tariff-select').click()
    await expect(page.locator('.tariff-detail-row')).toBeVisible()
    await expect(row.locator('.tariff-table-open svg')).toHaveAttribute('data-icon', 'chevron-up')
    await target.click()
    await expect(page.locator('.tariff-detail-row')).toHaveCount(0)
    await expect(row.locator('.tariff-table-open svg')).toHaveAttribute('data-icon', 'chevron-down')
  }
  await row.locator('.tariff-upcoming-price').click()
  await expect(page).toHaveURL(/version=next/)
  await row.locator('.tariff-table-open button').click()
  await expect(page.locator('.tariff-detail-row')).toHaveCount(0)
})

for (const language of ['en', 'de', 'fr', 'it']) {
  test(`rates retain currency, explanations and accessible headers in ${language}`, async ({ page }) => {
    const percentage: TariffVersion = { ...current, id: 'percentage', name: 'Local', billing_mode: 'percentage_of_energy', energy_type: 'local',
      periods: [band('share', '0.000', { percentage: '60', price_chf_per_kwh: null })],
      percentage_base_summary: { price_chf_per_kwh: '0.295', dynamic_status: 'partial', reference_date: '2026-06-15' } }
    const longBands: TariffVersion = { ...current, periods: [
      band('high', '123.45678', { period_type: 'high', weekdays: '0,1,2,3,4', months: '1,2,3,10,11,12', time_from: '07:00', time_to: '21:00' }),
      band('low', '0.180', { period_type: 'low', time_from: '21:00', time_to: '07:00' }),
    ] }
    const dynamic: TariffVersion = { ...current, id: 'dynamic', name: 'Dynamic', dynamic_source: 'source', periods: [],
      dynamic_price_summary: { average_chf_per_kwh: '-0.12345', status: 'partial', reference_from: '2026-06-01', reference_to: '2026-06-30' } }
    await tariffs(page, [
      { ...grid, versions: [longBands], version_count: 1 },
      { ...grid, name: 'Local', billing_mode: 'percentage_of_energy', energy_type: 'local', versions: [percentage], version_count: 1 },
      { ...grid, name: 'Dynamic', versions: [dynamic], version_count: 1 },
      ...(['monthly_fee', 'yearly_fee'] as const).map(billing_mode => ({
        ...grid, name: billing_mode, billing_mode, version_count: 1,
        versions: [{ ...current, id: billing_mode, name: billing_mode, billing_mode, periods: [], fixed_price_chf: '12.00' }],
      })),
    ])
    await page.addInitScript(lang => localStorage.setItem('openzev.language', lang), language)
    await page.goto('/tariffs')
    const table = page.locator('.tariff-table')
    const partial = table.locator('tbody tr').filter({ hasText: 'Local' })
    const qualification = { en: 'incomplete base average', de: 'unvollständiger Basisdurchschnitt', fr: 'moyenne de base incomplète', it: 'media di base incompleta' }[language]!
    for (const width of [1440, 360, 400]) {
      await page.setViewportSize({ width, height: 850 })
      await expect(partial.locator('.tariff-table-band-applies')).toContainText(qualification)
      await expect(partial.locator('.tariff-table-band:not(.tariff-price-headings) .tariff-table-band-price')).toBeVisible()
      expect(await partial.locator('.tariff-table-band:not(.tariff-price-headings)').getAttribute('title')).toContain('0.177')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(table.getByRole('columnheader')).toHaveCount(5)
      await expect(table.getByRole('columnheader').filter({ hasText: 'CHF' })).toHaveCount(0)
      const cell = partial.locator('td.tariff-table-bands')
      for (const id of (await cell.getAttribute('headers'))!.split(' ')) {
        const header = page.locator(`#${id}`)
        await expect(header).toHaveAttribute('scope', 'col')
        await expect(header).toHaveRole('columnheader')
      }
      await expect(table.locator('tbody tr').filter({ hasText: 'Dynamic' }).locator('.tariff-table-band-price')).toContainText('-0.123 CHF/kWh')
      await expect(partial.locator('.tariff-table-band-unit')).toHaveText('CHF/kWh')
      const units = { en: ['CHF/month', 'CHF/year'], de: ['CHF/Monat', 'CHF/Jahr'], fr: ['CHF/mois', 'CHF/an'], it: ['CHF/mese', 'CHF/anno'] }[language]!
      await expect(table.locator('tr[data-series-key="42:monthly_fee"] .tariff-table-band-unit')).toHaveText(units[0])
      await expect(table.locator('tr[data-series-key="42:yearly_fee"] .tariff-table-band-unit')).toHaveText(units[1])
    }
    const session = await page.context().newCDPSession(page)
    const { nodes } = await session.send('Accessibility.getFullAXTree')
    const headers = nodes.filter(node => !node.ignored && node.role?.value === 'columnheader')
    expect(headers).toHaveLength(5)
    expect(headers.filter(node => node.name?.value.includes('CHF'))).toHaveLength(0)
    await session.detach()

  })
}

for (const width of [1440, 400]) {
  test(`static HT/NT creation saves both bands atomically at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await tariffs(page, [])
    let created: TariffVersion | null = null
    let writes = 0
    let separateBandWrites = 0
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: created ? [{
      ...grid, name: created.name, version_count: 1, versions: [created],
    }] : [] }))
    await page.route('**/api/v1/tariffs/tariffs/', route => {
      const payload = route.request().postDataJSON()
      writes++
      expect(payload.initial_periods).toHaveLength(2)
      created = { ...current, ...payload, id: 'new', periods: payload.initial_periods.map((period: TariffPeriod, index: number) => ({ ...period, id: `band-${index}`, tariff: 'new' })) }
      return route.fulfill({ status: 201, json: created })
    })
    await page.route('**/api/v1/tariffs/periods/', route => { separateBandWrites++; return route.fulfill({ status: 500, json: {} }) })
    await page.goto('/tariffs')
    await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
    const pane = page.locator('.tariff-pane')
    const detail = page.locator('.tariff-detail-row')
    await pane.locator('input[name="name"]').fill('New energy')
    await pane.getByRole('combobox', { name: 'Initial price bands', exact: true }).selectOption('htnt')
    const bands = pane.locator('.tariff-band-draft')
    await bands.nth(0).getByRole('spinbutton', { name: 'CHF/kWh', exact: true }).fill('0.25')
    await bands.nth(1).getByRole('spinbutton', { name: 'CHF/kWh', exact: true }).fill('0.18')
    await expect(pane.locator('.tariff-band-coverage')).toContainText('covers all weekdays and months')
    await pane.getByRole('button', { name: 'Create Tariff', exact: true }).click()
    await expect(page.locator('.tariff-summary-row.is-selected .tariff-select')).toHaveText('New energy')
    await expect(detail.locator('.is-shown .tariff-version-amount strong')).toHaveText(['0.250', '0.180'])
    await expect(detail).not.toContainText('No prices configured')
    expect(writes).toBe(1)
    expect(separateBandWrites).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('community switching preserves a tariff draft until discard is confirmed', async ({ page }) => {
  await mockApi(page, { zevs: [{ id: '42', name: 'North' }, { id: '43', name: 'South' }] })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('zev_id') === '42' ? [grid] : [] }))
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const pane = page.locator('.tariff-pane')
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
  await pane.locator('textarea[name="notes"]').fill('Unsaved correction')
  await page.locator('.community-switch').click()
  await page.getByRole('menuitem', { name: 'South', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(pane.locator('textarea[name="notes"]')).toHaveValue('Unsaved correction')
  await expect(page.locator('.community-switch')).toHaveText('North')
  await page.locator('.community-switch').click()
  await page.getByRole('menuitem', { name: 'South', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.community-switch')).toHaveText('South')
  await expect(pane).toHaveCount(0)
  await expect(page).not.toHaveURL(/tariff=/)
})

test('mobile navigation keeps hidden links inert and contains keyboard focus while open', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 850 })
  await tariffs(page, [grid])
  await page.goto('/tariffs')
  const sidebar = page.locator('#app-sidebar')
  await expect(sidebar).toHaveAttribute('inert', '')
  await page.locator('.mobile-menu-button').first().click()
  await expect(sidebar).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('.content')).toHaveAttribute('inert', '')
  await expect(sidebar.locator('.mobile-sidebar-close')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await sidebar.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  await expect(sidebar.locator('.mobile-sidebar-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sidebar).toHaveAttribute('inert', '')
  await expect(page.locator('.mobile-bar .mobile-menu-button')).toBeFocused()
})

for (const width of [1440, 400]) {
  test(`new tariff choices update only their following fields at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    await tariffs(page, [grid])
    await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [
      { id: 'grid-source', label: 'Grid source', tariff_type: 'electricity', aggregated_tariff_types: [] },
      { id: 'feed-source', label: 'Feed-in source', tariff_type: 'feed_in', aggregated_tariff_types: [] },
    ] }))
    await page.goto('/tariffs')
    await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
    const pane = page.locator('.tariff-pane')
    const form = pane.locator('.tariff-configuration-form')
    await form.locator('input[name="name"]').fill('My tariff draft')
    const energyType = form.locator('select[name="energy_type"]')
    await expect(energyType).toHaveAccessibleDescription('Electricity produced and consumed within the ZEV.')
    await energyType.selectOption('grid')
    await expect(energyType).toHaveAccessibleDescription('Electricity drawn from the public grid.')
    const precedingFields = () => form.locator('input[name="name"], select[name="category"], select[name="billing_mode"]').evaluateAll(elements => elements.map(element => ({
      top: element.getBoundingClientRect().top + scrollY, left: element.getBoundingClientRect().left,
    })))
    const originalPositions = await precedingFields()
    const mode = form.locator('select[name="billing_mode"]')
    await mode.selectOption('shared_monthly_fee')
    await expect(form.locator('select[name="dynamic_source"]')).toHaveCount(0)
    await form.locator('input[name="fixed_price_chf"]').fill('42.50')
    const amountPosition = await form.locator('input[name="fixed_price_chf"]').evaluate(element => element.getBoundingClientRect().top + scrollY)
    await form.locator('select[name="split_key"]').selectOption('weight')
    expect(await form.locator('input[name="fixed_price_chf"]').evaluate(element => element.getBoundingClientRect().top + scrollY)).toBe(amountPosition)
    await expect(form.locator('select[name="split_key"]').locator('..')).toContainText('divided by the weight')
    expect(await precedingFields()).toEqual(originalPositions)

    await mode.selectOption('energy')
    await form.locator('select[name="dynamic_source"]').selectOption('feed-source')
    await expect(form.locator('select[name="energy_type"]')).toHaveCount(0)
    await expect(form.locator('.tariff-readonly-value')).toHaveText('Feed-in')
    await expect(form.getByText('Compensation for surplus electricity fed into the public grid.', { exact: true })).toBeVisible()
    await expect(form.locator('input[name="minimum_price_chf_per_kwh"]')).toBeVisible()
    const source = (await form.locator('select[name="dynamic_source"]').boundingBox())!
    const derived = (await form.locator('.tariff-readonly-value').boundingBox())!
    expect(derived.y).toBeGreaterThan(source.y + source.height)
    expect(await precedingFields()).toEqual(originalPositions)
    await expect(pane.locator('.warning-banner')).toHaveCount(0)

    await form.locator('select[name="dynamic_source"]').selectOption('')
    await expect(form.locator('select[name="energy_type"]')).toBeVisible()
    await expect(form.locator('input[name="minimum_price_chf_per_kwh"]')).toHaveCount(0)
    await mode.selectOption('percentage_of_energy')
    await expect(form.locator('select[name="dynamic_source"]')).toHaveCount(0)
    await expect(form.locator('input[name="initial_percentage"]')).toBeVisible()
    await mode.selectOption('shared_monthly_fee')
    await expect(form.locator('input[name="fixed_price_chf"]')).toHaveValue('42.50')
    await expect(form.locator('select[name="split_key"]')).toHaveValue('weight')
    await mode.selectOption('energy')
    await pane.getByRole('button', { name: 'Create a new dynamic source', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(pane.locator('.tariff-pane-section form')).toBeVisible()
    await expect(pane.locator('form form')).toHaveCount(0)
    await pane.locator('.tariff-pane-section').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(form).toBeVisible()
    await expect(form.locator('input[name="name"]')).toHaveValue('My tariff draft')
    await expect(pane.getByRole('button', { name: 'Create a new dynamic source', exact: true })).toBeFocused()
    await expect(pane.locator('.warning-banner')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [1440, 400]) {
  test(`tariff actions and notes stay with their context at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    await tariffs(page, [{ ...grid, versions: [{ ...current, notes: 'Comment about this tariff version' }] }])
    await page.addInitScript(() => localStorage.setItem('openzev.language', 'de'))
    await page.goto('/tariffs?tariff=42%3AGrid&version=current')
    const detail = page.locator('.tariff-detail-row')
    const editor = page.locator('.tariff-pane')
    const correct = detail.locator('[data-action-key="edit-current"]')
    await expect(correct).toBeVisible()
    await expect(correct).toHaveAttribute('title', 'Zeitraum bearbeiten')
    await expect(correct.locator('svg[data-icon="pen"]')).toBeVisible()
    await expect(page.locator('.tariff-table-name [data-action-key="new-version"]')).toBeVisible()
    await expect(page.locator('.tariff-summary-row.is-selected .tariff-shared-notes')).toHaveText('Comment about this tariff version')
    await expect(detail.locator('.tariff-version-note')).toHaveCount(0)
    const versionMenu = detail.locator('[data-action-key="version-actions-current"]')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`tariff-actions-${width}.png`), fullPage: true })
    await correct.click()
    await expect(editor.locator('textarea[name="notes"]')).toHaveValue('Comment about this tariff version')
    await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    await expect(correct).toBeFocused()
    await versionMenu.click()
    await page.getByRole('menuitem', { name: 'Preisband hinzufügen', exact: true }).click()
    await expect(editor.locator('select[name="period_type"]')).toBeVisible()
    await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    await expect(versionMenu).toBeFocused()
    await page.locator('.tariff-table-name [data-action-key="new-version"]').click()
    await expect(editor.locator('.tariff-change-preview')).toBeVisible()
    const form = editor.locator('form')
    const dateRow = form.locator('.tariff-version-effective-date')
    const label = dateRow.locator(':scope > span')
    const picker = dateRow.locator('button').first()
    await expect(label).toHaveText('Neue Preise gelten ab')
    const chosenDate = (await picker.innerText()).trim()
    expect(chosenDate).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
    expect((await form.innerText()).split(chosenDate)).toHaveLength(2)
    await expect(form).not.toContainText('Neue Version beginnt:')
    await expect(form).not.toContainText(`Ab ${chosenDate} gilt:`)
    const labelBox = (await label.boundingBox())!
    const pickerBox = (await picker.boundingBox())!
    expect(pickerBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width)
    expect(Math.abs(pickerBox.y + pickerBox.height / 2 - labelBox.y - labelBox.height / 2)).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`tariff-effective-date-${width}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}


for (const width of [1440, 400]) {
  test(`long version history flows with the page without clipping the newest row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const versions = Array.from({ length: 16 }, (_, index) => ({ ...current,
      id: `version-${index}`, valid_from: `${2041 - index}-01-01`, valid_to: `${2041 - index}-12-31`,
    }))
    await tariffs(page, [{ ...grid, versions, version_count: 16, active_version_id: 'version-15' }])
    await page.goto('/tariffs?tariff=42%3AGrid&version=version-15')
    const pane = page.locator('.tariff-detail-row')
    await expect(pane.locator('.tariff-version-row .badge')).toHaveCount(0)
    await expect(pane.locator('.tariff-detail > section').first()).toHaveClass('tariff-version-section')
    await expect(pane.locator('.tariff-version-row.is-shown .tariff-version-validity [data-action-key="edit-version-15"]')).toBeVisible()
    const list = pane.locator('.tariff-version-list')
    await expect(list.locator('.tariff-version-row')).toHaveCount(16)
    expect(await list.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    await expect(list.locator('.tariff-version-columns')).toHaveCSS('position', 'static')
    await expect(list.locator('.tariff-version-row').first()).toContainText('2041')
    await list.locator('.tariff-version-select').first().click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pane.locator('.tariff-version-validity [data-action-key="edit-version-0"]')).toBeVisible()
  })
}
