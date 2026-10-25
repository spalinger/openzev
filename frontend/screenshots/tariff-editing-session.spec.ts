import type { Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { apiErrors, mockApi } from './page-anatomy-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })

const current = { id: 'current', zev: '42', name: 'Grid', category: 'energy', billing_mode: 'energy', energy_type: 'grid', valid_from: '2026-01-01', valid_to: '2026-12-31', fixed_price_chf: null, split_key: 'equal', notes: 'CURRENT VERSION NOTES', periods: [{ id: 'band', tariff: 'current', period_type: 'flat', label: '', price_chf_per_kwh: '0.295', percentage: null, time_from: null, time_to: null, weekdays: '', months: '' }] }
const past = { ...current, id: 'past', valid_from: '2025-01-01', valid_to: '2025-12-31', notes: 'PAST VERSION NOTES', periods: [{ ...current.periods[0], id: 'past-band', tariff: 'past', price_chf_per_kwh: '0.195' }] }
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

test('tariff scheduling uses current prices after cancelling a historical correction', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-past"]').click()
  await page.locator('.tariff-pane').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.tariff-schedule-action').click()
  await expect(page.locator('.tariff-band-price-input')).toHaveValue('0.295')
})

for (const saving of [false, true]) test(`confirmed collapse navigates back once (saving: ${saving})`, async ({ page }) => {
  await setup(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route('**/api/v1/tariffs/tariffs/current/', async route => {
    writes++
    await pending
    await route.fulfill({ json: current })
  })
  await page.goto('/tariffs')
  await page.locator('.tariff-select').click()
  await page.locator('[data-action-key="edit-current"]').click()
  await page.locator('textarea[name="notes"]').fill('Changed draft')
  if (saving) {
    await page.getByRole('button', { name: 'Save correction', exact: true }).click()
    await expect.poll(() => writes).toBe(1)
  }
  await page.locator('.tariff-table-open button').click()
  await page.getByRole('dialog').getByRole('button', { name: saving ? 'Leave form' : 'Discard', exact: true }).click()
  await expect(page).toHaveURL(/\/tariffs$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.tariff-pane')).toHaveCount(0)
  release()
})

for (const target of ['version', 'band']) test(`deleting an edited ${target} protects the draft and closes its task`, async ({ page }) => {
  await setup(page)
  let deletes = 0
  await page.route(target === 'version' ? '**/api/v1/tariffs/tariffs/current/' : '**/api/v1/tariffs/periods/band/', route => {
    expect(route.request().method()).toBe('DELETE')
    deletes++
    return route.fulfill({ status: 204 })
  })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-period-band"]').click()
  await page.locator('.tariff-band-price-input').fill('0.40')
  const openDelete = async () => {
    await page.locator('[data-action-key="version-actions-current"]').click()
    const actions = page.getByRole('menuitem').filter({ hasText: /^Delete/ })
    await (target === 'version' ? actions.last() : actions.first()).click()
  }
  await openDelete()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.locator('.tariff-band-price-input')).toHaveValue('0.40')
  expect(deletes).toBe(0)
  await openDelete()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Delete/ }).click()
  await expect(page.locator('.tariff-pane')).toHaveCount(0)
  expect(deletes).toBe(1)
})

test('import asks before leaving a dirty editing task', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-current"]').click()
  await page.locator('textarea[name="notes"]').fill('Draft')
  await page.locator('.page-header').getByRole('button', { name: /Import from/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('Draft')
  await page.locator('.page-header').getByRole('button', { name: /Import from/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.tariff-pane')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
})

for (const startsNarrow of [false, true]) test(`list position survives editing across breakpoints (starts narrow: ${startsNarrow})`, async ({ page }) => {
  await setup(page)
  const entries = Array.from({ length: 20 }, (_, i) => {
    const name = `Grid ${i.toString().padStart(2, '0')}`
    return { ...series, name, versions: [{ ...current, name, id: `version-${i}` }], version_count: 1 }
  })
  await page.setViewportSize({ width: startsNarrow ? 400 : 1440, height: 900 })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: entries }))
  await page.goto('/tariffs?tariff=42%3AGrid%2010&version=version-10')
  await page.locator('[data-action-key="edit-version-10"]').click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.tariff-split')).toHaveAttribute('data-layout', 'wide')
  await page.evaluate(() => window.scrollTo(0, 500))
  const before = await page.evaluate(() => window.scrollY)
  await page.setViewportSize({ width: 400, height: 900 })
  await expect(page.locator('.tariff-split')).toHaveAttribute('data-layout', 'narrow')
  await page.locator('.tariff-pane').getByRole('button', { name: 'Back to tariff', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)
})

test('keyboard focus retains an outline in forced colors', async ({ page }) => {
  await setup(page)
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-period-band"]').click()
  const price = page.locator('.tariff-band-price-input')
  await price.focus()
  await expect(price).toHaveCSS('outline-style', 'solid')
  await expect(price).not.toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)')
  expect(apiErrors.get(page)).toEqual([])
})
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
  await form.getByRole('combobox', { name: 'Source kind', exact: true }).selectOption('bfe_rmp')
  await form.getByRole('combobox', { name: 'Technology', exact: true }).selectOption('windenergie')
  await form.getByRole('combobox', { name: /^Publication series/ }).selectOption('monthly')
  await form.getByRole('combobox', { name: 'Technology', exact: true }).focus()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(form.getByRole('combobox', { name: 'Technology', exact: true })).toHaveValue('windenergie')
  await expect(form.getByRole('combobox', { name: /^Publication series/ })).toHaveValue('monthly')
  await form.getByRole('combobox', { name: 'Technology', exact: true }).focus()
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
  await form.getByRole('combobox', { name: 'Source kind', exact: true }).selectOption('bfe_rmp')
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
  await form.getByRole('combobox', { name: 'Source kind', exact: true }).selectOption('bfe_rmp')
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
  await page.locator('.tariff-band-price-input').fill('0.25')
  const date = page.locator('.tariff-validity-fields > label').first()
  await date.getByRole('button').nth(1).click()
  await page.getByRole('button', { name: 'Create Tariff', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await expect(date.getByRole('alert')).toHaveText('This field is required.')
  await expect(date.getByRole('button').first()).toHaveAttribute('aria-invalid', 'true')
})
test('X and Escape close correction and keep the inline tariff open', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
  await expect(page.locator('.tariff-configuration-form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.tariff-configuration-form')).toHaveCount(0)
  await expect(page.locator('.tariff-detail')).toBeVisible()
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
  await page.locator('.tariff-pane-close').click()
  await expect(page.locator('.tariff-pane')).toBeHidden()
})
test('same-series browser Back discards the editor as well as its version', async ({ page }) => {
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=past')
  await expect(page.locator('.tariff-detail')).toBeVisible()
  await page.evaluate(() => {
    history.replaceState({ ...history.state, idx: 0 }, '', '/tariffs?tariff=42%3AGrid&version=past')
    history.pushState({ ...history.state, idx: 1 }, '', '/tariffs?tariff=42%3AGrid&version=current')
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  await expect(page.locator('.tariff-version-row.is-shown .tariff-version-window')).toContainText('2026')
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
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
  await expect(page.locator('.tariff-version-row.is-shown .tariff-version-window')).toContainText('2025')
  await expect(page.locator('textarea[name="notes"]')).toHaveCount(0)
  await expect(page.locator('.tariff-summary-row.is-selected .tariff-select')).toBeFocused()
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
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
  await page.locator('textarea[name="notes"]').fill('DIRTY DRAFT TO RETAIN')
  renamed = true
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    window.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.tariff-pane h2')).toHaveText('Correct this version')
  await expect(page.locator('.tariff-pane-meta')).toContainText('Renamed Grid')
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

test('a saved tariff survives a failed refresh and Retry selects it without another write', async ({ page }) => {
  const state = { endpoint: '/tariffs/tariffs/series/', failed: false }
  await mockApi(page, state)
  let created = false
  let writes = 0
  const saved = { ...current, id: 'created', name: 'New tariff', periods: current.periods }
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
  await page.locator('.tariff-band-price-input').fill('0.25')
  await page.getByRole('button', { name: 'Create Tariff', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: 15000 })
  state.failed = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.tariff-summary-row.is-selected .tariff-select')).toHaveText('New tariff')
  await expect(page.locator('.is-shown .tariff-version-amount strong')).toHaveText('0.295')
  expect(writes).toBe(1)
})

test('Back to tariff on a narrow screen cancels the editor and keeps the selected tariff', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 })
  await setup(page)
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
  await page.getByRole('button', { name: 'Back to tariff', exact: true }).click()
  await expect(page.locator('.tariff-configuration-form')).toHaveCount(0)
  await expect(page.locator('.tariff-detail')).toBeVisible()
  await expect(page).toHaveURL(/version=current/)
})


for (const width of [1440, 400]) {
  test(`title and version pencils edit their own scope at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page)
    let stored = [current, past]
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, name: stored[0].name, versions: stored }] }))
    await page.route('**/api/v1/tariffs/tariffs/current/rename-series/', route => {
      stored = stored.map(version => ({ ...version, name: route.request().postDataJSON().name }))
      return route.fulfill({ json: stored[0] })
    })
    await page.route('**/api/v1/tariffs/tariffs/current/', route => {
      stored = stored.map(version => version.id === 'current' ? { ...version, ...route.request().postDataJSON() } : version)
      return route.fulfill({ json: stored[0] })
    })
    await page.goto('/tariffs?tariff=42%3AGrid&version=current')
    const pane = page.locator('.tariff-pane')
    const title = page.locator('.tariff-summary-row.is-selected .tariff-table-name')
    await title.locator('[data-action-key="series-actions"]').click()
    await page.getByRole('menuitem', { name: 'Rename tariff', exact: true }).click()
    const name = pane.locator('form input')
    await expect(name).toHaveValue('Grid')
    await expect(pane.locator('.tariff-pane-form')).toContainText('Renames all 2 versions')
    await name.fill('Solar credit')
    await pane.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(title.locator('.tariff-select')).toHaveText('Solar credit')
    expect(stored.map(version => version.name)).toEqual(['Solar credit', 'Solar credit'])
    await page.locator('.tariff-detail-row [data-action-key="edit-current"]').click()
    await expect(pane.locator('input[name="name"]')).toHaveCount(0)
    await pane.locator('textarea[name="notes"]').fill('Updated current notes')
    await pane.getByRole('button', { name: 'Save correction', exact: true }).click()
    await expect(pane.locator('form')).toHaveCount(0)
    expect(stored.map(version => version.notes)).toEqual(['Updated current notes', 'PAST VERSION NOTES'])
    expect((apiErrors.get(page) ?? [])).toEqual([])
  })
}

test('a dirty correction and its confirmation survive a failed series refresh', async ({ page }) => {
  await setup(page)
  let fail = false
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => fail
    ? route.fulfill({ status: 503, json: { detail: 'Refresh unavailable' } })
    : route.fulfill({ json: [series] }))
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-notes-current"]').click()
  const editor = page.locator('.tariff-pane')
  const notes = editor.locator('textarea[name="notes"]')
  await notes.fill('UNSAVED REFRESH DRAFT')
  fail = true
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
  })
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible({ timeout: 15000 })
  await expect(notes).toHaveValue('UNSAVED REFRESH DRAFT')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing', exact: true }).click()
  fail = false
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(notes).toHaveValue('UNSAVED REFRESH DRAFT')
})

test('a replacement correction is editable before an abandoned save finishes', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route('**/api/v1/tariffs/tariffs/current/', async route => {
    writes++
    await pending
    await route.fulfill({ json: { ...current, ...route.request().postDataJSON() } })
  })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.locator('[data-action-key="edit-current"]').click()
  await page.locator('textarea[name="notes"]').fill('OLD SAVE')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect.poll(() => writes).toBe(1)
  await page.locator('.tariff-pane-close').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Leave form', exact: true }).click()
  await page.locator('[data-action-key="edit-current"]').click()
  const note = page.locator('textarea[name="notes"]')
  await expect(note).toBeEditable()
  await expect(page.getByRole('button', { name: 'Save correction', exact: true })).toBeEnabled()
  await note.fill('REPLACEMENT DRAFT')
  release()
  await expect.poll(() => page.locator('.toast').count()).toBe(0)
  await expect(note).toHaveValue('REPLACEMENT DRAFT')
  expect(writes).toBe(1)
  expect(apiErrors.get(page)).toEqual([])
})

test('cleared scheduling date shows an associated error without a version request', async ({ page }) => {
  await setup(page)
  let writes = 0
  await page.route('**/api/v1/tariffs/tariffs/current/new-version/', route => { writes++; return route.fulfill({ json: current }) })
  await page.goto('/tariffs?tariff=42%3AGrid&version=current')
  await page.getByRole('button', { name: 'Schedule price change', exact: true }).click()
  const date = page.locator('.tariff-pane .tariff-version-effective-date').first()
  await date.locator('.mantine-InputClearButton-root').click()
  await expect(date.getByRole('alert')).toHaveText('This field is required.')
  await expect(date.locator('.mantine-DatePickerInput-input')).toHaveAttribute('aria-invalid', 'true')
  const errorId = await date.getByRole('alert').getAttribute('id')
  await expect(date.locator('.mantine-DatePickerInput-input')).toHaveAttribute('aria-describedby', errorId!)
  await expect(page.getByRole('button', { name: 'Schedule change', exact: true })).toBeDisabled()
  expect(writes).toBe(0)
})

test('source administration guards X while saving and suppresses abandoned completion', async ({ page }) => {
  await mockApi(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/tariffs/dynamic-sources/', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] })
    await pending
    return route.fulfill({ json: { id: 'source', label: 'Pending source', api_version: 'bfe_rmp', tariff_type: 'feed_in', tariff_name: 'pv' } })
  })
  await page.goto('/admin/dynamic-sources')
  await page.locator('section.tariff-toolbar').getByRole('button', { name: 'New source', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Create dynamic price source', exact: true })
  await form.getByRole('combobox', { name: 'Source kind', exact: true }).selectOption('bfe_rmp')
  await form.getByLabel('Display label', { exact: true }).fill('Pending source')
  await form.getByRole('button', { name: 'New source', exact: true }).click()
  await expect(form.getByLabel('Display label', { exact: true })).toBeDisabled()
  await form.getByRole('button', { name: 'Close', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Discard changes?', exact: true })
  await expect(confirmation).toContainText('may still complete')
  await confirmation.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: 'Close', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Leave form', exact: true }).click()
  await expect(form).toHaveCount(0)
  release()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0)
  expect(apiErrors.get(page)).toEqual([])
})
