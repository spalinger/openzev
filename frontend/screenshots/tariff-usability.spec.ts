import { test, expect, type Page } from '@playwright/test'
import { mockApi, apiErrors } from './page-anatomy-fixtures'
import type { TariffPeriod, TariffSeries, TariffVersion } from '../src/types/api'

test.use({ storageState: { cookies: [], origins: [] } })

const flat: TariffPeriod = { id: 'flat', tariff: 'current', period_type: 'flat', price_chf_per_kwh: '0.30', time_from: null, time_to: null, months: '', weekdays: '' }
const current: TariffVersion = { id: 'current', zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid', valid_from: '2026-10-01', valid_to: '2026-12-31', split_key: 'equal', notes: '', periods: [flat] }
async function seed(page: Page, versions: TariffVersion[]) {
  await mockApi(page)
  const series: TariffSeries = { zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid', version_count: versions.length, active_version_id: 'current', gaps: [], versions }
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [series] }))
  await page.goto('/tariffs')
  await expect(page.locator('.tariff-select')).toBeVisible()
}
test.afterEach(({ page }) => { expect(apiErrors.get(page)).toEqual([]) })

test('finite seasonal validity does not warn about months outside that version', async ({ page }) => {
  await seed(page, [{ ...current, periods: [{ ...flat, months: '10,11,12' }] }])
  await expect(page.locator('.tariff-price-warning')).toHaveCount(0)
  await page.locator('.tariff-select').click()
  await expect(page.locator('.tariff-version-coverage .tariff-band-warning')).toHaveCount(0)
  await page.locator('[data-action-key="edit-current"]').click()
  await expect(page.locator('[data-focus-field="valid_from"] button').first()).toBeFocused()
})

test('preset replacement protects configured bands and preserves retained prices', async ({ page }) => {
  await seed(page, [current])
  await page.getByRole('button', { name: 'New Tariff', exact: true }).click()
  const editor = page.locator('.tariff-pane')
  await editor.locator('.tariff-band-price-input').fill('0.32')
  const structure = editor.getByRole('combobox', { name: 'Initial price bands', exact: true })
  await structure.selectOption('htnt')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await editor.locator('.tariff-band-price-input').last().fill('0.18')
  await structure.selectOption('flat')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor.locator('.tariff-band-draft')).toHaveCount(2)
  await expect(editor.locator('.tariff-band-price-input').last()).toHaveValue('0.18')
  await structure.selectOption('flat')
  await dialog.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(editor.locator('.tariff-band-draft')).toHaveCount(1)
  await expect(editor.locator('.tariff-band-price-input')).toHaveValue('0.32')
})

for (const width of [1440, 400]) test.describe(`${width}px comparison`, () => {
  test.use({ hasTouch: width === 400 })
  test(`planned prices align on desktop and use a clock tooltip on phones (${width}px)`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  const future: TariffVersion = { ...current, id: 'next', valid_from: '2027-01-01', valid_to: null, periods: [
    { ...flat, id: 'high', tariff: 'next', period_type: 'high', time_from: '07:00', time_to: '21:00', price_chf_per_kwh: '0.35', weekdays: '0,1,2,3,4' },
    { ...flat, id: 'low', tariff: 'next', period_type: 'low', time_from: '21:00', time_to: '07:00', price_chf_per_kwh: '0.20' },
  ] }
  await seed(page, [future, current])
  const title = (await page.locator('.tariff-category-title').boundingBox())!
  const table = (await page.locator('.tariff-category-body').boundingBox())!
  if (width === 1440) expect(title.x + title.width).toBeLessThan(table.x)
  else expect(title.y + title.height).toBeLessThan(table.y)
  const comparison = page.locator('.tariff-planned-summary')
  if (width === 1440) {
    await expect(comparison).toBeVisible()
    await expect(comparison.locator('.tariff-planned-rate').first()).toContainText('High (HT) Mon–Fri, 07:00–21:00')
    await expect(comparison.locator('.tariff-planned-rate').first()).toContainText('0.350')
    await expect(comparison).not.toContainText('CHF/kWh')
    await expect(page.locator('.tariff-current-rates')).toContainText('CHF/kWh')
    const textBounds = (element: Element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const { x, y } = range.getBoundingClientRect()
      return { x, y }
    }
    const futurePrice = await comparison.locator('.tariff-planned-rate strong').first().evaluate(textBounds)
    const todayPrice = await page.locator('.tariff-price-current').first().evaluate(textBounds)
    expect(Math.abs(futurePrice.y - todayPrice.y)).toBeLessThan(2)
    const currentSchedule = (await page.locator('.tariff-current-rates .tariff-table-band-applies').first().boundingBox())!
    expect(currentSchedule.x).toBeLessThan((await comparison.boundingBox())!.x)
    expect(futurePrice.x).toBeLessThan(todayPrice.x)
  } else {
    await expect(comparison).toBeHidden()
    const clock = page.locator('.tariff-planned-compact')
    await expect(clock).toBeVisible()
    await expect(clock).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await clock.tap()
    await expect(page.getByRole('tooltip')).toContainText('0.350 CHF/kWh')
    await expect(page.getByRole('tooltip')).toContainText('01.01.2027')
    await expect(page.locator('.tariff-detail-row')).toHaveCount(0)
    await clock.blur()
  }
  await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true })
  await page.locator('.tariff-select').click()
  await page.locator('[data-action-key="edit-next"]').click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-action-key="new-version"]').click()
  const editor = page.locator('.tariff-pane')
  await expect(editor.locator('[data-focus-field="valid_from"] button').first()).toBeFocused()
  const recurrence = editor.locator('.tariff-band-recurrence').first()
  const january = recurrence.getByRole('checkbox', { name: 'Jan', exact: true })
  await expect(january).toBeChecked()

  await recurrence.getByText('Jan', { exact: true }).click()
  await expect(january).not.toBeChecked()
  await expect(recurrence.getByRole('checkbox', { name: 'Feb', exact: true })).toBeChecked()
  await expect(editor.locator('.tariff-time-row [aria-invalid="true"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`schedule-${width}.png`) })
})
})

test('long version menus remain reachable and keep destructive actions last', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 400, height: 700 })
  const periods: TariffPeriod[] = Array.from({ length: 8 }, (_, index) => ({ ...flat, id: `band-${index}`, period_type: 'band', label: `Band ${index + 1}`, time_from: `${String(index * 3).padStart(2, '0')}:00`, time_to: `${String((index + 1) * 3 % 24).padStart(2, '0')}:00` }))
  await seed(page, [{ ...current, periods }])
  await page.locator('.tariff-select').click()
  const trigger = page.locator('[data-action-key="version-actions-current"]')
  await expect(trigger).toHaveCSS('opacity', '1')
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu).toHaveCSS('opacity', '1')
  const bounds = (await menu.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700)
  expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  const actions = await menu.getByRole('menuitem').allTextContents()
  const firstDelete = actions.findIndex(label => label.startsWith('Delete'))
  expect(actions.slice(firstDelete).every(label => label.startsWith('Delete'))).toBe(true)
  const last = menu.getByRole('menuitem', { name: 'Delete this version', exact: true })
  await last.focus()
  await expect(last).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('menu-400.png') })
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('opening the middle tariff rounds the adjacent sections', async ({ page }) => {
  await mockApi(page)
  const siblings: TariffSeries[] = ['First', 'Grid', 'Third'].map((name, index) => ({
    zev: '42', name, category: 'energy', billing_mode: 'energy', energy_type: 'grid',
    version_count: 1, active_version_id: `version-${index}`, gaps: [],
    versions: [{ ...current, name, id: `version-${index}` }],
  }))
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: siblings }))
  await page.goto('/tariffs')
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  const before = page.locator('.tariff-summary-row:has(+ tr.is-selected)')
  const detail = page.locator('.tariff-detail-row')
  const after = page.locator('.tariff-detail-row + .tariff-summary-row')
  for (const row of [before, detail, after]) {
    for (const side of ['borderLeftWidth', 'borderRightWidth']) {
      expect(await row.evaluate((element, property) => parseFloat(getComputedStyle(element)[property]), side)).toBeGreaterThan(0)
    }
  }
  for (const [row, corners] of [[before, ['borderBottomLeftRadius', 'borderBottomRightRadius']],
    [detail, ['borderBottomLeftRadius', 'borderBottomRightRadius']],
    [after, ['borderTopLeftRadius', 'borderTopRightRadius']]] as const) {
    await expect(row).toHaveCount(1)
    for (const corner of corners) expect(await row.evaluate((element, property) => parseFloat(getComputedStyle(element)[property]), corner)).toBeGreaterThan(0)
  }
})

test('planned date and matching prices form one connected green column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seed(page, [current, { ...current, id: 'next', valid_from: '2027-01-01', valid_to: null,
    periods: [{ ...flat, id: 'next-flat', tariff: 'next', price_chf_per_kwh: '0.35' }] }])
  const heading = page.locator('.tariff-price-planned-heading')
  const price = page.locator('.tariff-upcoming-price')
  const headingBox = (await heading.boundingBox())!
  const priceBox = (await price.boundingBox())!
  expect(Math.abs(headingBox.y + headingBox.height - priceBox.y)).toBeLessThan(1)
  expect(headingBox.x).toBe(priceBox.x)
  expect(headingBox.width).toBe(priceBox.width)
  expect(await heading.evaluate(el => getComputedStyle(el).backgroundColor))
    .toBe(await price.evaluate(el => getComputedStyle(el).backgroundColor))
})

test('changed HT/NT schedules keep both price columns aligned by band', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const periods: TariffPeriod[] = [
    { ...flat, id: 'high', period_type: 'high', time_from: '07:00', time_to: '21:00', price_chf_per_kwh: '0.295' },
    { ...flat, id: 'low', period_type: 'low', time_from: '21:00', time_to: '06:00', price_chf_per_kwh: '0.225' },
  ]
  await seed(page, [{ ...current, periods }, { ...current, id: 'next', valid_from: '2027-01-01', valid_to: null,
    periods: periods.map((band, index) => ({ ...band, id: `next-${band.id}`, tariff: 'next',
      time_to: index === 1 ? '07:00' : band.time_to, price_chf_per_kwh: index === 0 ? '0.290' : '0.220' })) }])
  const currentPrices = page.locator('.tariff-current-rates .tariff-price-current')
  const plannedPrices = page.locator('.tariff-planned-rate strong')
  const bounds = (element: Element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { right, y } = range.getBoundingClientRect()
    return { right, y }
  }
  const today = await currentPrices.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
  expect(Math.abs(today[0] - today[1])).toBeLessThan(1)
  for (let index = 0; index < 2; index++) {
    const currentPrice = await currentPrices.nth(index).evaluate(bounds)
    const plannedPrice = await plannedPrices.nth(index).evaluate(bounds)
    expect(Math.abs(currentPrice.y - plannedPrice.y)).toBeLessThan(2)
  }
  const planned = await plannedPrices.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
  expect(Math.abs(planned[0] - planned[1])).toBeLessThan(1)
  await expect(page.locator('.tariff-price-warning')).toBeVisible()
})
