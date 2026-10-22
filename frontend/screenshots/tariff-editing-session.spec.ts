import type { Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { mockApi } from './page-anatomy-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })

const current = { id: 'current', zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid', valid_from: '2026-01-01', valid_to: '2026-12-31', fixed_price_chf: null, split_key: 'equal', notes: 'CURRENT VERSION NOTES', periods: [{ id: 'band', tariff: 'current', period_type: 'flat', label: '', price_chf_per_kwh: '0.295', percentage: null, time_from: null, time_to: null, weekdays: '', months: '' }] }
const past = { ...current, id: 'past', valid_from: '2025-01-01', valid_to: '2025-12-31', notes: 'PAST VERSION NOTES' }
const series = { zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid', version_count: 2, active_version_id: 'current', gaps: [], versions: [current, past] }
async function setup(page: Page) {
  await mockApi(page)
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [series] }))
  await page.route('**/api/v1/tariffs/dynamic-sources/', route => route.fulfill({ json: [] }))
}
async function create(page: Page) {
  await setup(page)
  await page.goto('/tariffs')
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  await expect(page.locator('input[name="name"]')).toBeFocused()
}
async function source(page: Page) {
  await page.getByRole('button', { name: 'Create a new dynamic source', exact: true }).click()
  return page.locator('.tariff-pane-section form')
}
test('source entry focuses the task and Cancel protects its draft', async ({ page }) => {
  await create(page)
  const form = await source(page)
  const focusInSource = await form.evaluate(element => element.contains(document.activeElement))
  expect(focusInSource).toBe(true)
  await form.getByLabel('Display label', { exact: true }).fill('Unsaved source')
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(form.getByLabel('Display label', { exact: true })).toHaveValue('Unsaved source')
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('changing only BFE settings is dirty and Keep editing preserves the selection', async ({ page }) => {
  await create(page)
  const form = await source(page)
  await form.locator('select').nth(0).selectOption('bfe_rmp')
  await form.locator('select').nth(2).selectOption('windenergie')
  await form.locator('select').nth(1).selectOption('monthly')
  await form.locator('select').nth(2).focus()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(form.locator('select').nth(2)).toHaveValue('windenergie')
  await expect(form.locator('select').nth(1)).toHaveValue('monthly')
  await form.locator('select').nth(2).focus()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.tariff-pane')).toBeHidden()
})
test('source saves lock fields and warn before Escape', async ({ page }) => {
  await create(page)
  const form = await source(page)
  let release!: () => void
  const wait = new Promise<void>(resolve => release = resolve)
  let completed = false
  const saved = { id: 'created', label: 'Source', api_version: 'bfe_rmp', tariff_type: 'feed_in', tariff_name: 'pv', url: 'https://example.test/source.csv' }
  await page.route('**/api/v1/tariffs/dynamic-sources/', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: completed ? [saved] : [] })
    await wait
    completed = true
    await route.fulfill({ json: saved })
  })
  await form.locator('select').nth(0).selectOption('bfe_rmp')
  await form.getByLabel('Display label', { exact: true }).fill('Source')
  await form.getByRole('button', { name: 'New source', exact: true }).click()
  await expect(form.getByRole('button', { name: 'New source', exact: true })).toBeDisabled()
  await expect(form.getByLabel('Display label', { exact: true })).toBeDisabled()
  await page.locator('.tariff-pane-close').focus()
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('may still complete')
  await expect(dialog.getByRole('button', { name: 'Leave form', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  release()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await expect(page.locator('select[name="dynamic_source"]')).toHaveValue('created')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('late source success after leaving does not modify a newly mounted tariff form', async ({ page }) => {
  await create(page)
  const form = await source(page)
  let release!: () => void
  const wait = new Promise<void>(resolve => release = resolve)
  let complete = false
  await page.route('**/api/v1/tariffs/dynamic-sources/', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: complete ? [{ id: 'created', label: 'Old source', api_version: 'bfe_rmp', tariff_type: 'feed_in', tariff_name: 'pv' }] : [] })
    await wait
    complete = true
    await route.fulfill({ json: { id: 'created', label: 'Old source', api_version: 'bfe_rmp', tariff_type: 'feed_in', tariff_name: 'pv', url: 'https://example.test/source.csv' } })
  })
  await form.locator('select').nth(0).selectOption('bfe_rmp')
  await form.getByLabel('Display label', { exact: true }).fill('Old source')
  await form.getByRole('button', { name: 'New source', exact: true }).click()
  await expect(form.getByRole('button', { name: 'New source', exact: true })).toBeDisabled()
  await page.locator('.tariff-pane-close').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').getByRole('button', { name: 'Leave form', exact: true }).click()
  await expect(page.locator('.tariff-pane')).toBeHidden()
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  await page.locator('input[name="name"]').fill('NEW DRAFT')
  release()
  await expect(page.locator('select[name="dynamic_source"] option[value="created"]')).toHaveCount(1)
  await expect(page.locator('input[name="name"]')).toHaveValue('NEW DRAFT')
  await expect(page.locator('select[name="dynamic_source"]')).toHaveValue('')
})
test('cleared start date has an associated error', async ({ page }) => {
  await create(page)
  await page.locator('input[name="name"]').fill('Valid name')
  const date = page.locator('.tariff-validity-fields > label').first()
  await date.getByRole('button').nth(1).click()
  await page.getByRole('button', { name: 'Continue to prices', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await expect(date.getByRole('alert')).toHaveText('This field is required.')
  await expect(date.getByRole('button').first()).toHaveAttribute('aria-invalid', 'true')
})
test('X closes correction, Escape returns to viewing', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.getByRole('button', { name: 'Correct this version', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.tariff-configuration-form')).toHaveCount(0)
  await expect(page.locator('.tariff-pane')).toBeVisible()
  await page.getByRole('button', { name: 'Correct this version', exact: true }).click()
  await page.locator('.tariff-pane-close').click()
  await expect(page.locator('.tariff-pane')).toBeHidden()
})
test('same-series browser Back discards the editor as well as its version', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=past')
  await expect(page.locator('.tariff-pane')).toBeVisible()
  await page.evaluate(() => {
    history.replaceState({ ...history.state, idx: 0 }, '', '/tariffs?tariff=42%3AGrid&version=past')
    history.pushState({ ...history.state, idx: 1 }, '', '/tariffs?tariff=42%3AGrid&version=current')
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  await expect(page.locator('.tariff-pane-window')).toContainText('2026')
  await page.getByRole('button', { name: 'Correct this version', exact: true }).click()
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('CURRENT VERSION NOTES')
  await page.locator('textarea[name="notes"]').fill('EDITED CURRENT NOTES')
  await page.goBack()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/version=current/)
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('EDITED CURRENT NOTES')
  await page.goBack()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(/version=past/)
  await expect(page.locator('.tariff-pane-window')).toContainText('2025')
  await expect(page.locator('textarea[name="notes"]')).toHaveCount(0)
  await expect(page.locator('.tariff-pane h2')).toBeFocused()
})
test('renamed-series refetch preserves a dirty correction without a discard prompt', async ({ page }) => {
  await setup(page)
  let renamed = false
  let updated: Record<string, unknown> | undefined
  await page.route('**/api/v1/tariffs/tariffs/current/', route => {
    updated = route.request().postDataJSON()
    return route.fulfill({ json: { ...current, ...updated } })
  })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, name: renamed ? 'Renamed Grid' : 'Grid', versions: [current,past].map(v => ({ ...v, name: renamed ? 'Renamed Grid' : 'Grid' })) }] }))
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.getByRole('button', { name: 'Correct this version', exact: true }).click()
  await page.locator('textarea[name="notes"]').fill('DIRTY DRAFT TO RETAIN')
  renamed = true
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    window.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.tariff-pane h2')).toHaveText('Renamed Grid')
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('DIRTY DRAFT TO RETAIN')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect.poll(() => updated?.name).toBe('Renamed Grid')
})

test('an API-version-only source edit is protected', async ({ page }) => {
  await create(page)
  const form = await source(page)
  await form.getByRole('combobox', { name: /API version/ }).selectOption('v1_0_5')
  await form.getByRole('combobox', { name: /API version/ }).focus()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(form.getByRole('combobox', { name: /API version/ })).toHaveValue('v1_0_5')
})

test('source saving warns before a community switch and cannot affect the next draft', async ({ page }) => {
  await mockApi(page, { zevs: [{ id: '42', name: 'Community A' }, { id: '43', name: 'Community B' }] })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [] }))
  let release!: () => void
  const pending = new Promise<void>(resolve => release = resolve)
  let completed = false
  const saved = { id: 'source', label: 'Old source', api_version: 'bfe_rmp', tariff_type: 'feed_in', tariff_name: 'pv' }
  await page.route('**/api/v1/tariffs/dynamic-sources/', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: completed ? [saved] : [] })
    await pending
    completed = true
    await route.fulfill({ json: saved })
  })
  await page.goto('/tariffs')
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  const form = await source(page)
  await form.getByRole('combobox', { name: 'Source kind', exact: true }).selectOption('bfe_rmp')
  await form.getByLabel('Display label', { exact: true }).fill('Old source')
  await form.getByRole('button', { name: 'New source', exact: true }).click()
  await expect(form.getByLabel('Display label', { exact: true })).toBeDisabled()
  const switchCommunity = async () => {
    await page.locator('.page-header .community-switch').click()
    await page.getByRole('menuitem', { name: /Community B/ }).click()
  }
  await switchCommunity()
  await expect(page.getByRole('dialog')).toContainText('may still complete')
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.locator('.page-header .community-switch')).toContainText('Community A')
  await switchCommunity()
  await page.getByRole('dialog').getByRole('button', { name: 'Leave form', exact: true }).click()
  await expect(page.locator('.page-header .community-switch')).toContainText('Community B')
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  await page.locator('input[name="name"]').fill('Community B draft')
  release()
  await expect(page.locator('select[name="dynamic_source"] option[value="source"]')).toHaveCount(1)
  await expect(page.locator('input[name="name"]')).toHaveValue('Community B draft')
  await expect(page.locator('select[name="dynamic_source"]')).toHaveValue('')
})

test('a saved tariff survives a failed refresh and Retry continues to prices without another write', async ({ page }) => {
  const state = { endpoint: '/tariffs/tariffs/series/', failed: false }
  await mockApi(page, state)
  let created = false
  let writes = 0
  const saved = { ...current, id: 'created', name: 'New tariff', periods: [] }
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => state.failed ? route.fallback() : route.fulfill({ json: created ? [{ ...series, name: saved.name, versions: [saved], version_count: 1 }] : [series] }))
  await page.route('**/api/v1/tariffs/tariffs/', route => {
    writes++
    created = true
    state.failed = true
    return route.fulfill({ status: 201, json: saved })
  })
  await page.goto('/tariffs')
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  await page.locator('input[name="name"]').fill('New tariff')
  await page.getByRole('button', { name: 'Continue to prices', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 15000 })
  state.failed = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save band', exact: true })).toBeVisible()
  expect(writes).toBe(1)
})

test('Back to tariff on a narrow screen cancels the editor and keeps the selected tariff', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 })
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.getByRole('button', { name: 'Correct this version', exact: true }).click()
  await page.getByRole('button', { name: 'Back to tariff', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toHaveCount(0)
  await expect(page.locator('.tariff-pane')).toBeVisible()
  await expect(page).toHaveURL(/version=current/)
})
