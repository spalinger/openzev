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

test('next-price controls open the scheduled version and hide in split view', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs')
  const overview = page.locator('#tariff-overview-current')
  await expect(overview.locator('tbody tr')).toHaveCount(1)
  await expect(overview.locator('td.tariff-table-bands')).toContainText('0.295')
  await expect(overview.locator('td.tariff-table-bands .tariff-upcoming-price')).toHaveText('0.315')
  await expect(overview.locator('.tariff-price-headings')).toContainText('Today')
  await expect(overview.locator('.tariff-price-headings')).toContainText('01.01.2027')
  for (const key of ['Enter', 'Space']) {
    await overview.locator('.tariff-upcoming-price:visible').focus()
    await page.keyboard.press(key)
    await expect(page).toHaveURL(/version=next/)
    await expect(overview.locator('tr.is-selected .tariff-upcoming-price')).toBeHidden()
    await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.315')
    await expect(page.locator('.tariff-pane-window .badge')).toHaveText('Upcoming')
    await page.locator('.tariff-version-select').filter({ hasText: '01.01.2028' }).click()
    await expect(page).toHaveURL(/version=later/)
    await expect(overview.locator('tr.is-selected')).toHaveCount(1)
    await overview.locator('.tariff-select').click()
    await expect(page).toHaveURL(/version=current/)
    await expect(page.locator('.tariff-version-row.is-shown')).toContainText('0.295')
    await page.locator('.tariff-pane header').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.tariff-pane')).toBeHidden()
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
      await expect(page.locator('.tariff-pane')).toBeVisible()
      await expect(page.locator('.tariff-upcoming-price')).toBeVisible()
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
    await expect(tag).toHaveText('Prices and schedule change from 01.01.2027')
    await expect(tag).not.toContainText('dynamische Netznutzung')
    if (width === 1440) {
      await expect(tag).toBeVisible()
    } else await expect(tag).toBeHidden()
    await page.locator('.tariff-select').click()
    await expect(page).toHaveURL(/version=current/)
    if (width === 1440) {
      await expect(page.locator('.tariff-table-band-price:visible').first()).toBeVisible()
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
      await expect(page.locator('.tariff-pane')).toBeVisible()
    }
    const bands = page.locator('td.tariff-table-bands:visible .tariff-table-band:not(.tariff-price-headings)')
    await expect(bands).toHaveCount(2)
    for (const band of await bands.all()) {
      await expect(band.locator('.tariff-table-band-applies')).toHaveCSS('white-space', 'normal')
      expect(await band.locator('.tariff-table-band-applies').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
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
  await expect(page.locator('.tariff-pane-header')).toHaveCSS('background-color', 'rgb(13, 43, 29)')
  await expect(page.locator('.tariff-pane-heading h2')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.locator('.tariff-pane header').getByRole('button', { name: 'Close', exact: true }).click()
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
    const pane = page.locator('.tariff-pane')
    await expect(pane.locator('.tariff-period-table .tariff-period-meta').first()).toHaveText('07:00–21:00 · Mon–Fri · Jun–Aug')
    await expect(pane.locator('.tariff-period-table .tariff-period-meta').last()).toHaveText('time window not configured')
    await expect(pane.locator('.tariff-period-price').first()).toHaveText('0.295')
    await expect(pane.locator('.tariff-period-table thead th').first()).toHaveCSS('color', 'rgb(255, 255, 255)')

    const pastVersion = pane.locator('.tariff-version-select').filter({ hasText: '01.01.2025' })
    await expect(pastVersion).toBeVisible()
    await expect(pane.locator('.tariff-price-history')).toBeVisible()
    await expect(pane.locator('summary')).toHaveCount(0)
    await expect(page.locator('.tariff-overview-history')).toHaveCount(0)
    await pastVersion.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/version=past/)
    await expect(pastVersion).toHaveAttribute('aria-pressed', 'true')
    await pane.locator('.tariff-version-select').filter({ hasText: '01.01.2026' }).click()
    await expect(page).toHaveURL(/version=current/)
    await expect(pane.locator('h2')).toBeFocused()

    const actions = pane.getByRole('button', { name: 'Actions', exact: true })
    for (const action of ['Rename', 'Duplicate']) {
      await actions.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('menuitem', { name: action, exact: true }).click()
      await expect(pane.locator('form')).toBeVisible()
      if (action === 'Duplicate') {
        const rows = pane.locator('.tariff-version-price-row')
        await expect(rows.locator('.badge')).toHaveCount(0)
        const inputs = await rows.locator('input').evaluateAll(elements => elements.map(element => {
          const { x, width } = element.getBoundingClientRect()
          return { x, width }
        }))
        expect(inputs).toHaveLength(2)
        expect(inputs[0]).toEqual(inputs[1])
      }
      await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(actions).toBeFocused()
    }
    const editBand = pane.getByRole('button', { name: 'Edit: High (HT)', exact: true })
    await editBand.click()
    await expect(pane.locator('form')).toBeVisible()
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editBand).toBeFocused()
    await pane.getByRole('button', { name: 'Delete: High (HT)', exact: true }).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await pastVersion.click()
    await expect(pastVersion).toHaveAttribute('aria-pressed', 'true')
    await (width === 400 ? pane.locator('.tariff-pane-back') : pane.getByRole('button', { name: 'Close', exact: true })).click()
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toBeFocused()
  })
}

test('dynamic fetched prices are the visible history and source maintenance stays in details', async ({ page }) => {
  const dynamic = { ...current, dynamic_source: 'source', periods: [], valid_from: '2026-10-01', valid_to: null }
  await tariffs(page, [{ ...grid, versions: [dynamic], version_count: 1 }])
  await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [{
    id: 'source', label: 'Operator prices', url: 'https://example.test/prices', api_version: 'v1_0_5', tariff_type: 'electricity',
    tariff_name: '', enabled: false, last_fetch_status: 'ok', last_success_at: '2026-10-02T10:00:00Z',
    point_count: 2, covers_from: '2026-10-01T00:00:00Z', covers_to: '2026-10-02T00:00:00Z',
    linked_tariff_count: 1, linked_zev_count: 1,
  }] }))
  let pointCount = 2
  await page.route('**/api/v1/tariffs/dynamic-sources/source/prices/**', route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('date_from')).toBe('2026-10-01')
    expect(url.searchParams.get('date_to')).toBe('2026-10-02')
    return route.fulfill({ json: {
      source: 'source', date_from: '2026-10-01', date_to: '2026-10-02',
      gaps: [{ from: '2026-10-01T02:00:00Z', to: '2026-10-02T00:00:00Z' }],
      stats: { point_count: pointCount, minimum_chf_per_kwh: '0.05', maximum_chf_per_kwh: '0.07', average_chf_per_kwh: '0.06', negative_count: 0, gap_count: 0 },
      points: [
        { valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-10-01T01:00:00Z', price_chf_per_kwh: '0.05' },
        { valid_from: '2026-10-01T01:00:00Z', valid_to: '2026-10-01T02:00:00Z', price_chf_per_kwh: '0.07' },
      ].slice(0, pointCount),
    } })
  })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const pane = page.locator('.tariff-pane')
  await expect(pane.locator('.tariff-dynamic-chart')).toBeVisible()
  await expect(pane.locator('.tariff-source-section .warning-banner')).toHaveCount(0)
  await expect(pane.locator('.tariff-chart-section .warning-banner')).toBeVisible()
  await expect(pane.locator('.tariff-price-history')).toHaveCount(0)
  await expect(pane.locator('.tariff-source-status[data-status="ok"]')).toHaveText('Fetch successful · 02.10.2026 12:00')
  await expect(pane.getByText(/Last successful fetch:/)).toHaveCount(0)
  await expect(pane.locator('.tariff-source-status svg[data-icon="check"]')).toBeVisible()
  await expect(pane.getByText('Automatic fetching disabled', { exact: true })).toBeVisible()
  await expect(pane.locator('.tariff-source-status')).not.toHaveClass(/badge/)
  const adminLink = pane.getByRole('link', { name: 'Manage source in platform admin' })
  await expect(adminLink).toHaveCount(0)
  const sourceDetails = pane.locator('summary').filter({ hasText: 'Source details' })
  await expect(sourceDetails.locator('svg[data-icon="chevron-down"]')).toBeVisible()
  await sourceDetails.click()
  await expect(adminLink).toBeVisible()
  await expect(adminLink.locator('svg[data-icon="arrow-right"]')).toBeVisible()
  const records = pane.locator('summary').filter({ hasText: 'Fetched interval prices' })
  await records.click()
  await expect(pane.getByRole('columnheader', { name: 'Valid from', exact: true })).toBeVisible()
  pointCount = 1
  await page.reload()
  await expect(pane.locator('.tariff-dynamic-chart .recharts-dot')).toBeVisible()
  pointCount = 0
  await page.reload()
  await expect(pane.locator('.tariff-dynamic-chart')).toHaveCount(0)
  await expect(pane.getByText('No prices in this date range.', { exact: true })).toHaveCount(1)
  await expect(pane.locator('.tariff-chart-section .warning-banner')).toHaveCount(0)
  await expect(pane.locator('summary').filter({ hasText: 'Fetched interval prices' })).toHaveCount(0)
})

test('notes have room for multiple lines and fixed source fields are plain values', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const pane = page.locator('.tariff-pane')
  await expect(pane.locator('.tariff-pane-window .badge')).toHaveText('Current')
  await pane.locator('[data-action-key="edit-current"]').click()
  const notes = pane.locator('textarea[name="notes"]')
  await expect(notes).toBeVisible()
  const box = (await notes.boundingBox())!
  expect(box.height).toBeGreaterThan(110)
  expect(box.width).toBeGreaterThan(450)
  await expect(pane.locator('select[name="dynamic_source"]')).toHaveCount(0)
  await expect(pane.locator('.tariff-readonly-value')).toBeVisible()
  await notes.fill('First line\nSecond line')
  await expect(notes).toHaveValue('First line\nSecond line')
})

test('tariff rows toggle closed and the selected arrow points left', async ({ page }) => {
  await tariffs(page, [grid])
  await page.goto('/tariffs')
  const row = page.locator('#tariff-overview-current tbody tr')
  for (const target of [row.locator('.tariff-select'), row.locator('.tariff-table-open button'), row.locator('td.tariff-table-tariff')]) {
    await row.locator('.tariff-select').click()
    await expect(page.locator('.tariff-pane')).toBeVisible()
    await expect(row.locator('.tariff-table-open svg')).toHaveAttribute('data-icon', 'chevron-left')
    await target.click()
    await expect(page.locator('.tariff-pane')).toHaveCount(0)
    await expect(row.locator('.tariff-table-open svg')).toHaveAttribute('data-icon', 'chevron-right')
  }
  await row.locator('.tariff-upcoming-price').click()
  await expect(page).toHaveURL(/version=next/)
  await row.locator('.tariff-table-open button').click()
  await expect(page.locator('.tariff-pane')).toHaveCount(0)
})

for (const language of ['en', 'de', 'fr', 'it']) {
  test(`narrow bands retain explanations and accessible headers in ${language}`, async ({ page }) => {
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
    ])
    await page.addInitScript(lang => localStorage.setItem('openzev.language', lang), language)
    await page.goto('/tariffs')
    const table = page.locator('.tariff-table')
    const partial = table.locator('tbody tr').filter({ hasText: 'Local' })
    const qualification = { en: 'incomplete base average', de: 'unvollständiger Basisdurchschnitt', fr: 'moyenne de base incomplète', it: 'media di base incompleta' }[language]!
    for (const width of [360, 400]) {
      await page.setViewportSize({ width, height: 850 })
      await expect(partial.locator('.tariff-table-band-applies')).toContainText(qualification)
      await expect(partial.locator('.tariff-table-band:not(.tariff-price-headings) .tariff-table-band-price')).toBeVisible()
      expect(await partial.locator('.tariff-table-band:not(.tariff-price-headings)').getAttribute('title')).toContain('0.177')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(table.getByRole('columnheader')).toHaveCount(6)
      await expect(table.getByRole('columnheader').filter({ hasText: 'CHF' })).toHaveCount(1)
      const cell = partial.locator('td.tariff-table-bands')
      for (const id of (await cell.getAttribute('headers'))!.split(' ')) {
        const header = page.locator(`#${id}`)
        await expect(header).toHaveAttribute('scope', 'col')
        await expect(header).toHaveRole('columnheader')
      }
      await expect(table.locator('.tariff-table-band-price').last()).toContainText('-0.123 CHF')
    }
    const session = await page.context().newCDPSession(page)
    const { nodes } = await session.send('Accessibility.getFullAXTree')
    const headers = nodes.filter(node => !node.ignored && node.role?.value === 'columnheader')
    expect(headers).toHaveLength(6)
    expect(headers.filter(node => node.name?.value.includes('CHF'))).toHaveLength(1)
    await session.detach()

  })
}

for (const width of [1440, 400]) {
  test(`static tariff setup opens the first-price editor and remains visibly incomplete at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await tariffs(page, [])
    let created: TariffVersion | null = null
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: created ? [{
      ...grid, name: created.name, version_count: 1, versions: [created],
    }] : [] }))
    await page.route('**/api/v1/tariffs/tariffs/', route => {
      const payload = route.request().postDataJSON()
      created = { ...current, ...payload, id: 'new', periods: [] }
      return route.fulfill({ status: 201, json: created })
    })
    await page.route('**/api/v1/tariffs/periods/', route => {
      const payload = route.request().postDataJSON()
      expect(payload.tariff).toBe('new')
      const price = { ...band(`price-${created!.periods.length}`, payload.price_chf_per_kwh), ...payload }
      created!.periods.push(price)
      return route.fulfill({ status: 201, json: price })
    })
    await page.goto('/tariffs')
    await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
    const pane = page.locator('.tariff-pane')
    await pane.locator('input[name="name"]').fill('New energy')
    await pane.getByRole('button', { name: 'Continue to prices', exact: true }).click()
    await expect(pane.locator('select[name="period_type"]')).toBeVisible()
    await expect(pane.locator('h2')).toHaveText('New energy')
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pane).toContainText('Setup incomplete — add prices')
    await pane.getByRole('button', { name: 'Add first price', exact: true }).click()
    await pane.locator('select[name="period_type"]').selectOption('high')
    await pane.getByRole('spinbutton', { name: 'Time from: Hours', exact: true }).fill('07')
    await pane.getByRole('spinbutton', { name: 'Time from: Minutes', exact: true }).fill('00')
    await pane.getByRole('spinbutton', { name: 'Time to: Hours', exact: true }).fill('21')
    await pane.getByRole('spinbutton', { name: 'Time to: Minutes', exact: true }).fill('00')
    await pane.locator('input[name="price_chf_per_kwh"]').fill('0.25')
    await pane.getByRole('button', { name: 'Save band', exact: true }).click()
    await expect(pane.locator('.tariff-period-price')).toHaveText('0.250')
    await expect(pane).not.toContainText('Setup incomplete')
    await pane.locator('[data-action-key="add-period"]').click()
    await pane.locator('select[name="period_type"]').selectOption('low')
    await pane.getByRole('spinbutton', { name: 'Time from: Hours', exact: true }).fill('21')
    await pane.getByRole('spinbutton', { name: 'Time from: Minutes', exact: true }).fill('00')
    await pane.getByRole('spinbutton', { name: 'Time to: Hours', exact: true }).fill('07')
    await pane.getByRole('spinbutton', { name: 'Time to: Minutes', exact: true }).fill('00')
    await pane.locator('input[name="price_chf_per_kwh"]').fill('0.18')
    await pane.getByRole('button', { name: 'Save band', exact: true }).click()
    await expect(pane.locator('.tariff-period-price')).toHaveText(['0.250', '0.180'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('community switching preserves a tariff draft until discard is confirmed', async ({ page }) => {
  await mockApi(page, { zevs: [{ id: '42', name: 'North' }, { id: '43', name: 'South' }] })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('zev_id') === '42' ? [grid] : [] }))
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  const pane = page.locator('.tariff-pane')
  await pane.getByRole('button', { name: 'Correct this version', exact: true }).click()
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
