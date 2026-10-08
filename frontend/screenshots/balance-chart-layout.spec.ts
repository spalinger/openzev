import { expect, test } from '@playwright/test'
import { mockApi } from './page-anatomy-fixtures'

test.use({ storageState: { cookies: [], origins: [] } })

test('balance charts fit their available panel width', async ({ page }, testInfo) => {
  const errors = await mockApi(page, { populated: true })
  await page.route('**/dashboard-summary/**', route => route.fulfill({ json: {
    summary_kind: 'zev', bucket: 'day',
    totals: { produced_kwh: 100, consumed_kwh: 80, imported_kwh: 20, exported_kwh: 40 },
    zev_totals: { produced_kwh: 100, consumed_kwh: 80, imported_kwh: 20, exported_kwh: 40 },
    timeline: [{ bucket: '2026-10-01', produced_kwh: 100, consumed_kwh: 80, imported_kwh: 20, exported_kwh: 40 }],
    participant_stats: [],
  } }))
  await page.goto('/dashboard')
  const grid = page.locator('.balance-chart-grid')
  await expect(grid).toBeVisible()
  for (const width of [1440, 1000, 400]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => grid.evaluate(el => {
      const style = getComputedStyle(el)
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      // Two 24rem columns from .balance-chart-grid, plus the gap.
      const expected = el.clientWidth >= 48 * rem + Number.parseFloat(style.columnGap) ? 2 : 1
      return style.gridTemplateColumns.split(' ').length === expected
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await grid.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`balance-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const threshold = await grid.evaluate(el =>
    48 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    + Number.parseFloat(getComputedStyle(el).columnGap))
  for (const delta of [-1, 1]) {
    await grid.evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px` }, threshold + delta)
    await expect.poll(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length))
      .toBe(delta < 0 ? 1 : 2)
  }
  expect(errors).toEqual([])
})
