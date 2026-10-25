import { expect, test } from '@playwright/test'
import { apiErrors, mockApi } from './page-anatomy-fixtures'

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })

for (const width of [1440, 400]) {
  test(`one tariff stays open through editing and browser history at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 950 })
    await mockApi(page)
    const versions = ['Grid', 'Solar'].map((name, index) => ({
      id: `v${index}`, zev: '42', name, category: 'energy', billing_mode: 'energy', energy_type: index ? 'local' : 'grid',
      valid_from: '2026-01-01', valid_to: null, fixed_price_chf: null, split_key: 'equal', notes: `${name} notes`,
      periods: [{ id: `band${index}`, tariff: `v${index}`, period_type: 'flat', label: '', price_chf_per_kwh: '0.25',
        percentage: null, time_from: null, time_to: null, weekdays: '', months: '' }],
    }))
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: versions.map(version => ({
      zev: '42', name: version.name, category: version.category, billing_mode: version.billing_mode, energy_type: version.energy_type,
      version_count: 1, active_version_id: version.id, gaps: [], versions: [version],
    })) }))
    await page.route('**/api/v1/tariffs/tariffs/v0/', route => {
      Object.assign(versions[0], route.request().postDataJSON())
      return route.fulfill({ json: versions[0] })
    })
    await page.goto('/tariffs?keep=1')
    const grid = page.locator('.tariff-summary-row').filter({ has: page.getByRole('button', { name: 'Grid', exact: true }) })
    const solar = page.locator('.tariff-summary-row').filter({ has: page.getByRole('button', { name: 'Solar', exact: true }) })
    await grid.locator('.tariff-select').click()
    await expect(page.locator('.tariff-pane')).toHaveCount(0)
    await expect(grid.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'true')
    const controls = await grid.locator('.tariff-select').getAttribute('aria-controls')
    await expect(page.locator(`[id="${controls}"] .tariff-version-list`)).toBeVisible()
    const detailBox = (await page.locator('[data-detail-series-key="42:Grid"]').boundingBox())!
    const nextBox = (await solar.boundingBox())!
    expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(nextBox.y + 1)
    await solar.locator('.tariff-select').click()
    await expect(page.locator('.tariff-detail')).toHaveCount(1)
    await expect(grid.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'false')
    await expect(solar.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.tariff-summary-row')).toHaveCount(2)
    await expect(page.locator('.tariff-summary-row table')).toHaveCount(0)
    await expect(page.locator('.tariff-detail h2')).toHaveCount(0)
    await expect(page.locator('.tariff-pane')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`tariffs-expanded-${width}.png`), fullPage: true })

    await grid.locator('.tariff-select').click()
    await expect(solar.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'false')
    await page.locator('[data-detail-series-key="42:Grid"] [data-action-key="edit-v0"]').click()
    await expect(page.locator('.tariff-pane')).toBeVisible()
    await expect(page.locator('.tariff-pane textarea[name="notes"]')).toHaveValue('Grid notes')
    if (width === 400) await expect(page.locator('.tariff-split-list')).toBeHidden()
    else await expect(page.locator('.tariff-split-list')).toBeVisible()
    await page.locator('.tariff-pane textarea[name="notes"]').fill('Updated grid notes')
    await page.locator(width === 400 ? '.tariff-pane-back' : '.tariff-pane-close').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.locator('.tariff-pane textarea[name="notes"]')).toHaveValue('Updated grid notes')
    await page.locator('.tariff-pane').getByRole('button', { name: 'Save correction', exact: true }).click()
    await expect(page.locator('.tariff-pane')).toHaveCount(0)
    await expect(page.locator('.tariff-detail')).toHaveCount(1)
    await expect(grid.locator('.tariff-shared-notes')).toHaveText('Updated grid notes')
    await expect(page.locator('[data-detail-series-key="42:Grid"] .tariff-version-note')).toHaveCount(0)
    await expect(page).toHaveURL(/keep=1/)
    await page.goBack()
    await expect(page.locator('.tariff-detail')).toHaveCount(0)
    await expect(solar.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'false')
    await expect(grid.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'false')
    await page.goForward()
    await expect(page.locator('.tariff-detail')).toHaveCount(1)
    await expect(grid.locator('.tariff-select')).toHaveAttribute('aria-expanded', 'true')
    await page.reload()
    await expect(page.locator('.tariff-detail')).toHaveCount(1)
    await expect(page.locator('.tariff-pane')).toHaveCount(0)
    await expect(page.locator('[data-detail-series-key="42:Grid"]')).toBeVisible()
    await grid.locator('.tariff-table-open button').click()
    await expect(page.locator('.tariff-detail')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.tariff-detail')).toHaveCount(0)
    expect(errors).toEqual([])
    expect(apiErrors.get(page) ?? []).toEqual([])
  })
}
