import { test, expect } from '@playwright/test'
import { apiErrors, mockApi } from './page-anatomy-fixtures'
import type { TariffPeriod, TariffSeries, TariffVersion } from '../src/types/api'

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })

const high: TariffPeriod = { id: 'high', tariff: 'current', period_type: 'high', price_chf_per_kwh: '0.30', time_from: '07:00', time_to: '21:00' }
const low: TariffPeriod = { ...high, id: 'low', period_type: 'low', price_chf_per_kwh: '0.20', time_from: null, time_to: null }
const current: TariffVersion = { id: 'current', zev: '42', name: 'Grid schedule', category: 'energy', billing_mode: 'energy', energy_type: 'grid',
  valid_from: '2026-01-01', valid_to: '2026-12-31', split_key: 'equal', notes: 'The same notes apply to every version.', periods: [high, low] }
const past: TariffVersion = { ...current, id: 'past', valid_from: '2025-01-01', valid_to: '2025-12-31', periods: current.periods.map(band => ({ ...band, id: `past-${band.id}`, tariff: 'past' })) }
const series: TariffSeries = { ...current, version_count: 2, active_version_id: 'current', gaps: [], versions: [current, past] }
const next: TariffSeries = { ...series, name: 'Solar', version_count: 1, active_version_id: 'next', versions: [{ ...current, id: 'next', name: 'Solar', notes: '', periods: [] }] }

for (const width of [1440, 400]) {
  test(`tariff warnings, menus and task headers keep their context at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [series, next] }))
    let writes = 0
    await page.route('**/api/v1/tariffs/tariffs/current/new-version/', route => { writes++; return route.fulfill({ json: current }) })
    await page.goto('/tariffs')
    const row = page.locator('.tariff-summary-row[data-series-key="42:Grid schedule"]')
    const chevron = row.locator('.tariff-table-open button')
    if (width === 1440) {
      const background = await row.evaluate(element => getComputedStyle(element).backgroundColor)
      const cue = await chevron.evaluate(element => getComputedStyle(element).backgroundColor)
      await row.hover()
      expect(await row.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background)
      await expect.poll(() => chevron.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(cue)
    }
    const warning = row.locator('.tariff-table-bands .tariff-band-warning')
    await expect(warning).toContainText('Some hours have no explicit price band.')
    await expect(row.locator('.tariff-table-tariff .tariff-band-warning')).toHaveCount(0)
    expect(await page.locator('.tariff-category-body').evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0)
    if (width === 400) {
      const priceBox = (await row.locator('.tariff-table-bands').boundingBox())!
      const dates = (await row.locator('.tariff-table-valid').boundingBox())!
      expect(dates.y).toBeGreaterThanOrEqual(priceBox.y + priceBox.height)
    }
    await row.locator('.tariff-select').click()
    await expect(row.locator('.tariff-shared-notes')).toHaveText(current.notes!)
    await expect(row.locator('.tariff-shared-notes')).toBeVisible()
    await expect(row.locator('.tariff-shared-notes button')).toHaveCount(0)
    await expect(page.locator('.tariff-version-note')).toHaveCount(0)
    // Static invoice lines cannot prove finalized use of a version: keep both warnings.
    await expect(page.locator('.tariff-version-coverage .tariff-band-warning')).toHaveCount(2)
    const detailWarning = (await page.locator('.tariff-version-coverage .tariff-band-coverage').first().boundingBox())!
    const versionBox = (await page.locator('.tariff-version-row').first().boundingBox())!
    expect(detailWarning.width).toBeGreaterThan(versionBox.width * 0.8)
    const schedule = row.getByRole('button', { name: 'Schedule price change', exact: true })
    const menu = row.locator('[data-action-key="series-actions"]')
    expect((await menu.boundingBox())!.x).toBeGreaterThan((await schedule.boundingBox())!.x)
    const menuBox = (await menu.boundingBox())!
    const chevronBox = (await chevron.boundingBox())!
    expect(Math.abs(menuBox.y + menuBox.height / 2 - chevronBox.y - chevronBox.height / 2)).toBeLessThan(1)
    const detail = page.locator('.tariff-detail-row')
    expect(await detail.evaluate(element => parseFloat(getComputedStyle(element).borderBottomLeftRadius))).toBeGreaterThan(0)
    const nextRow = page.locator('.tariff-summary-row[data-series-key="42:Solar"]')
    expect(await nextRow.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath(`opened-tariff-${width}.png`), fullPage: true })
    await menu.click()
    await expect(page.getByRole('menuitem')).toHaveText(['Rename tariff', 'Duplicate'])
    await page.keyboard.press('Escape')
    const versionMenu = page.locator('[data-action-key="version-actions-current"]')
    await versionMenu.click()
    await expect(page.getByRole('menuitem', { name: 'Edit date range', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Edit band: Low (NT)', exact: true })).toBeVisible()
    const actions = await page.getByRole('menuitem').allTextContents()
    const firstDeletion = actions.findIndex(label => label.startsWith('Delete'))
    expect(firstDeletion).toBeGreaterThan(0)
    expect(actions.slice(firstDeletion).every(label => label.startsWith('Delete'))).toBe(true)
    await page.getByRole('menuitem', { name: 'Edit band: Low (NT)', exact: true }).click()
    const pane = page.locator('.tariff-pane')
    await expect(pane.getByRole('heading', { name: 'Edit price band', exact: true })).toBeVisible()
    await expect(pane.locator('.tariff-pane-meta')).toContainText('Grid schedule')
    await expect(pane.locator('.tariff-pane-meta')).toContainText('01.01.2026 – 31.12.2026')
    await expect(pane.locator('input[name="price_chf_per_kwh"]')).toBeFocused()
    if (width === 400) {
      await expect(page.locator('.page-header-actions')).toHaveCount(0)
      await expect(page.locator('.tariff-split-list')).toBeHidden()
    }
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(versionMenu).toBeFocused()
    await schedule.click()
    await expect(pane.locator('fieldset.tariff-band-draft')).toHaveCount(2)
    await expect(pane.getByText('This field is required.', { exact: true })).toHaveCount(0)
    if (width === 1440) await expect(row.locator('.tariff-shared-notes')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`schedule-cards-${width}.png`) })
    await pane.getByRole('button', { name: 'Schedule change', exact: true }).click()
    await expect(pane.getByText('This field is required.', { exact: true })).toHaveCount(2)
    const missingTime = pane.getByRole('spinbutton', { name: 'Band 2 Time from: Hours', exact: true })
    await expect(missingTime).toBeFocused()
    await expect(missingTime).toHaveAttribute('aria-invalid', 'true')
    const errorId = await missingTime.getAttribute('aria-describedby')
    await expect(page.locator(`[id="${errorId}"]`)).toHaveText('This field is required.')
    expect(writes).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(apiErrors.get(page)).toEqual([])
    await pane.getByRole('button', { name: 'Cancel', exact: true }).click()
    await nextRow.locator('.tariff-select').click()
    await expect(nextRow.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'true')
  })
}
