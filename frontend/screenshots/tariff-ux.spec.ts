import { test, expect } from '@playwright/test'
import { mockApi } from './page-anatomy-fixtures'

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })
const band = { id: 'band', tariff: 'current', period_type: 'low', label: '', price_chf_per_kwh: '0.20', percentage: null, time_from: null, time_to: null, weekdays: '', months: '' }
const current = { id: 'current', zev: '42', name: 'Repair tariff', category: 'energy', billing_mode: 'energy', energy_type: 'grid', valid_from: '2026-01-01', valid_to: '2026-12-31', fixed_price_chf: null, split_key: 'equal', notes: 'Secondary description belongs in the pane', periods: [band] }
const series = { zev: '42', name: current.name, category: current.category, billing_mode: current.billing_mode, energy_type: current.energy_type, version_count: 2, active_version_id: current.id, gaps: [], versions: [{ ...current, id: 'next', valid_from: '2027-01-01', valid_to: null }, current] }

for (const width of [1440, 400]) {
  test(`German tariff errors use the warning red and translate flat-band conflicts at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const consoleErrors: string[] = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await page.addInitScript(() => localStorage.setItem('openzev.language', 'de'))
    const high = { ...band, id: 'high', period_type: 'high', time_from: '07:00', time_to: '21:00' }
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: [high, band] }] }] }))
    await page.route('**/api/v1/tariffs/periods/band/', route => route.fulfill({ status: 400, json: {
      period_type: ['A flat band and a timed band cannot both apply in months 1,2,3,4,5,6,7,8,9,10,11,12: the flat price is used for every hour, so the timed bands would never apply. Give them different months, or make them all timed.'],
    } }))
    await page.goto('/tariffs?tariff=42%3ARepair%20tariff&version=current')
    await page.locator('[data-action-key="edit-period-band"]').click()
    const form = page.locator('.tariff-pane-form form')
    const save = page.getByRole('button', { name: 'Preisband speichern', exact: true })
    await save.click()
    const required = form.getByText('Dieses Feld ist erforderlich.', { exact: true }).first()
    await expect(required).toBeVisible()
    const red = await form.locator('.tariff-band-warning > svg').evaluate(node => getComputedStyle(node).color)
    expect(await required.evaluate(node => getComputedStyle(node).color)).toBe(red)
    await required.evaluate(node => node.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: testInfo.outputPath(`german-required-error-${width}.png`) })
    await form.locator('select[name="period_type"]').selectOption('flat')
    await save.click()
    await expect(page.getByRole('alert')).toContainText('Einheits- und Zeitbänder überschneiden sich in Jan.')
    await expect(page.getByRole('alert')).not.toContainText('period_type')
    await expect(page.getByRole('alert')).not.toContainText('A flat band')
    await page.getByRole('alert').evaluate(node => node.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: testInfo.outputPath(`german-tariff-error-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(consoleErrors.every(message => message.includes('status of 400'))).toBe(true)
  })

  test(`incomplete price windows stay open with field errors at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await mockApi(page)
    let saved = { ...band, time_from: null as string | null, time_to: null as string | null }
    let writes = 0
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: [saved] }] }] }))
    await page.route('**/api/v1/tariffs/periods/band/', route => {
      writes++
      saved = { ...saved, ...route.request().postDataJSON() }
      return route.fulfill({ json: saved })
    })
    await page.goto('/tariffs')
    await page.locator('.tariff-select').click()
    await page.getByRole('button', { name: 'Review time window', exact: true }).click()
    const form = page.locator('.tariff-pane-form form')
    const save = page.getByRole('button', { name: 'Save band', exact: true })
    await save.click()
    await expect(form.getByText('This field is required.', { exact: true })).toHaveCount(2)
    expect(writes).toBe(0)
    await form.getByText('This field is required.', { exact: true }).first().evaluate(node => node.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: testInfo.outputPath(`missing-window-${width}.png`) })
    const times = form.locator('.tariff-time-row').getByRole('spinbutton')
    await times.nth(0).fill('21')
    await times.nth(1).fill('00')
    await save.click()
    await expect(form.getByText('This field is required.', { exact: true })).toHaveCount(1)
    expect(writes).toBe(0)
    await times.nth(2).fill('07')
    await times.nth(3).fill('00')
    await save.click()
    await expect(form).toHaveCount(0)
    await expect(page.locator('.is-shown .tariff-version-rate')).toContainText('21:00–07:00')
    await expect(page.getByText('time window not configured', { exact: true })).toHaveCount(0)
    expect(writes).toBe(1)
    expect(saved.time_from).toBe('21:00')
    expect(saved.time_to).toBe('07:00')
    await page.locator('[data-action-key="edit-period-band"]').click()
    await form.getByRole('button', { name: 'Clear time', exact: true }).first().click()
    await save.click()
    await expect(form.getByText('This field is required.', { exact: true })).toHaveCount(1)
    expect(writes).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

for (const width of [1440, 400]) {
  test(`collapsed warning stays general and expanded details explain the HT/NT gap at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await page.addInitScript(() => localStorage.setItem('openzev.language', 'de'))
    const high = { ...band, id: 'high', period_type: 'high', time_from: '07:00:00', time_to: '21:00:00', price_chf_per_kwh: '0.30' }
    const low = { ...band, time_from: '22:00:00', time_to: '07:00:00' }
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: [high, low] }] }] }))
    await page.goto('/tariffs')
    const warning = page.locator('#tariff-overview-current .tariff-table-bands .tariff-band-warning')
    await expect(warning).toHaveText('Einige Stunden sind keinem Preisband zugeordnet.')
    await expect(warning.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zeitfenster prüfen', exact: true })).toHaveCount(0)
    await expect(warning.locator('svg[data-icon="circle-exclamation"]')).toBeVisible()
    await expect(page.locator('#tariff-overview-current .warning-banner')).toHaveCount(0)
    await expect(page.locator('#tariff-overview-current .tariff-table-tariff .tariff-band-warning')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`tariff-gap-${width}.png`), fullPage: true })
    await page.locator('.tariff-select').click()
    const detailWarning = page.locator('.tariff-detail-row .tariff-band-warning')
    await expect(detailWarning).toContainText('Für nicht abgedeckte Stunden (Jeden Monat · Jeden Tag · 21:00–22:00)')
    await expect(detailWarning).toContainText('Hochtarif (HT) 07:00–21:00 mit 0.300 CHF/kWh')
    await page.getByRole('button', { name: 'Zeitfenster prüfen', exact: true }).click()
    await expect(page.locator('select[name="period_type"]')).toHaveValue('high')
    await expect(page.locator('.tariff-pane-form .tariff-band-warning')).toContainText('0.300 CHF/kWh')
    expect(errors).toEqual([])
  })
}

test('German creation and overview warnings identify uncovered weekend hours', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 })
  await mockApi(page)
  await page.addInitScript(() => localStorage.setItem('openzev.language', 'de'))
  const high = { ...band, id: 'high', period_type: 'high', weekdays: '0,1,2,3,4', time_from: '07:00', time_to: '21:00' }
  const low = { ...band, time_from: '21:00', time_to: '07:00' }
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: [high, low] }] }] }))
  await page.goto('/tariffs')
  const schedule = 'Jeden Monat · Sa–So · 07:00–21:00'
  await expect(page.locator('.tariff-table-bands .tariff-band-warning')).toHaveText('Einige Stunden sind keinem Preisband zugeordnet.')
  await page.locator('.page-header').getByRole('button', { name: 'Neuer Tarif', exact: true }).click()
  const editor = page.locator('.tariff-pane')
  await editor.getByRole('combobox', { name: 'Erste Preisbänder', exact: true }).selectOption('htnt')
  const recurrence = editor.locator('.tariff-band-draft').first().locator('.tariff-band-recurrence')
  await recurrence.getByText('Sa', { exact: true }).click()
  await recurrence.getByText('So', { exact: true }).click()
  await expect(editor.locator('.tariff-band-warning')).not.toContainText('Einige Stunden sind keinem Preisband zugeordnet:')
  await expect(editor.locator('.tariff-band-warning')).toContainText(`Für nicht abgedeckte Stunden (${schedule})`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('fully covered tariffs have no overview coverage warning or repair action', async ({ page }) => {
  await mockApi(page)
  const high = { ...band, period_type: 'high', time_from: '07:00', time_to: '21:00' }
  const low = { ...band, time_from: '21:00', time_to: '07:00' }
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: [high, low] }] }] }))
  await page.goto('/tariffs')
  await expect(page.getByRole('button', { name: current.name, exact: true })).toBeVisible()
  await expect(page.locator('#tariff-overview-current .tariff-band-coverage')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review time window', exact: true })).toHaveCount(0)
})

test('viewers see a general collapsed warning and detailed fallback after expanding', async ({ page }) => {
  await mockApi(page, { role: 'viewer' })
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [current] }] }))
  await page.goto('/tariffs')
  await expect(page.locator('#tariff-overview-current .tariff-band-warning')).toHaveText('Some hours have no explicit price band.')
  await expect(page.locator('.tariff-band-warning button')).toHaveCount(0)
  await page.locator('.tariff-select').click()
  await expect(page.locator('#tariff-overview-current .tariff-band-warning')).toContainText('Low (NT)')
  await expect(page.locator('#tariff-overview-current .tariff-band-warning')).toContainText('0.200 CHF/kWh')
  await expect(page.getByRole('button', { name: 'Review time window', exact: true })).toHaveCount(0)
})

test('seasonal percentage tariffs name each fallback with its applicable months', async ({ page }) => {
  await mockApi(page)
  const winter = { ...band, id: 'winter', period_type: 'high', time_from: '07:00', time_to: '21:00', price_chf_per_kwh: null, percentage: '80', months: '1,2,3,10,11,12' }
  const summer = { ...winter, id: 'summer', percentage: '60', months: '4,5,6,7,8,9' }
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, billing_mode: 'percentage_of_energy', versions: [{ ...current, billing_mode: 'percentage_of_energy', periods: [winter, summer] }] }] }))
  await page.goto('/tariffs')
  await page.locator('.tariff-select').click()
  const warning = page.locator('.tariff-detail-row .tariff-band-warning')
  await expect(warning).toContainText('Uncovered hours (Oct–Mar · Every day · 00:00–07:00, 21:00–24:00) use High (HT) 07:00–21:00 at 80% of the grid tariff.')
  await expect(warning).toContainText('Uncovered hours (Apr–Sep · Every day · 00:00–07:00, 21:00–24:00) use High (HT) 07:00–21:00 at 60% of the grid tariff.')
})

for (const width of [1440, 400]) for (const missingBands of [true, false]) {
  test(`expanded tariff repair opens the ${missingBands ? 'first price' : 'missing window'} editor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [{ ...series, versions: [{ ...current, periods: missingBands ? [] : [band] }] }] }))
    await page.goto('/tariffs')
    await expect(page.getByRole('button', { name: missingBands ? 'Add prices' : 'Review time window', exact: true })).toHaveCount(0)
    await page.locator('.tariff-select').click()
    await page.getByRole('button', { name: missingBands ? 'Add prices' : 'Review time window', exact: true }).click()
    await expect(page.locator('select[name="period_type"]')).toBeVisible()
    await expect(page.locator('select[name="period_type"]')).toHaveValue(missingBands ? 'flat' : 'low')
    await expect(page.getByRole('button', { name: 'Save band', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator(missingBands ? '[data-action-key="add-period-current"]' : '[data-action-key="repair-version-current"]')).toBeFocused()
    if (missingBands) {
      const pane = page.locator('.tariff-detail-row')
      await expect(pane.getByRole('button', { name: 'Add prices', exact: true })).toHaveCount(1)
      await expect(pane.getByRole('button', { name: 'Add first price', exact: true })).toHaveCount(0)
      await pane.getByRole('button', { name: 'Add prices', exact: true }).click()
      await expect(page.locator('.tariff-pane select[name="period_type"]')).toBeVisible()
    }
  })
}

test('shared notes sit under the name while scheduled dates remain editable', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 })
  await mockApi(page)
  await page.addInitScript(() => localStorage.setItem('openzev.sidebarCollapsed', 'true'))
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [series] }))
  await page.goto('/tariffs')
  await page.getByRole('button', { name: current.name, exact: true }).click()
  const row = page.locator('#tariff-overview-current tr.is-selected')
  await expect(row.locator('.tariff-shared-notes')).toHaveText(current.notes)
  await expect(row.locator('.tariff-shared-notes button')).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Change from 01.01.2027', exact: true })).toHaveCount(0)
  const detail = page.locator('[data-detail-series-key="42:Repair tariff"]')
  await expect(detail.locator('.tariff-version-note')).toHaveCount(0)
  await expect(row.locator('.tariff-select')).toHaveCount(1)
  await expect(row.locator('table')).toHaveCount(0)
  await page.locator('.tariff-version-select').filter({ hasText: '01.01.2027' }).click()
  await expect(page).toHaveURL(/version=next/)
  const form = page.locator('.tariff-configuration-form')
  await expect(form).toBeVisible()
  await expect(form.locator('[data-focus-field="valid_from"] button').first()).toBeFocused()
  await expect(form.locator('textarea[name="notes"]')).toHaveValue(current.notes)
})

for (const language of ['en', 'de', 'fr', 'it']) {
  test(`six-band creation, scheduling and source forms remain usable at 400px in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 })
    await mockApi(page)
    await page.addInitScript(lang => localStorage.setItem('openzev.language', lang), language)
    let saved: typeof current | null = null
    let writes = 0
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: saved ? [{ ...series, name: saved.name, versions: [saved] }] : [] }))
    await page.route('**/api/v1/tariffs/tariffs/', route => {
      const payload = route.request().postDataJSON()
      writes++
      expect(payload.initial_periods).toHaveLength(6)
      saved = { ...current, ...payload, id: 'saved', periods: payload.initial_periods.map((band: object, index: number) => ({ ...band, id: `band-${index}`, tariff: 'saved' })) }
      return route.fulfill({ status: 201, json: saved })
    })
    await page.goto('/tariffs')
    await expect(page.locator('html')).toHaveAttribute('lang', `${language}-CH`)
    await page.locator('.page-header button.button-primary').click()
    const form = page.locator('.tariff-configuration-form')
    await form.locator('input[name="name"]').fill('Seasonal multi-band tariff with a long descriptive name')
    await form.locator('.tariff-band-editor > label select').selectOption('custom')
    await form.locator('.tariff-band-draft select').first().selectOption('band')
    for (let i = 1; i < 6; i++) await form.locator('.tariff-band-editor > button').click()
    for (let i = 0; i < 6; i++) {
      const row = form.locator('.tariff-band-draft').nth(i)
      await row.locator('.tariff-band-price-input').fill(`0.${20 + i}`)
      const fields = row.locator('.tariff-time-row').getByRole('spinbutton')
      await fields.nth(0).fill(String(i * 4).padStart(2, '0'))
      await fields.nth(1).fill('00')
      await fields.nth(2).fill(String((i * 4 + 4) % 24).padStart(2, '0'))
      await fields.nth(3).fill('00')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const footer = page.locator('.tariff-pane-form > .dialog-actions')
    await expect(footer).toBeInViewport()
    await expect(form.locator('.tariff-band-coverage')).not.toBeEmpty()
    await page.locator('.tariff-pane-form > .dialog-actions button[type="submit"]').click()
    await expect(page.locator('.is-shown .tariff-version-rate')).toHaveCount(6)
    expect(writes).toBe(1)
    await expect(page.locator('.tariff-summary-row.is-selected .tariff-select')).toBeFocused()
    await page.locator('[data-action-key="new-version"]').click()
    await expect(page.locator('.tariff-version-band')).toHaveCount(6)
    await expect(page.locator('.tariff-version-band legend').first()).toContainText('00:00–04:00')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.tariff-pane-form > .dialog-actions button[type="button"]').click()
    await page.locator('.page-header button.button-primary').click()
    await page.getByRole('button', { name: { en: 'Create a new dynamic source', de: 'Neue dynamische Quelle erstellen', fr: 'Créer une source dynamique', it: 'Crea una nuova fonte dinamica' }[language], exact: true }).click()
    const source = page.locator('.tariff-pane-section form')
    await source.locator('select').first().selectOption('bfe_rmp')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Tab')
    await expect(source.getByRole('textbox').first()).toBeFocused()
    const session = await page.context().newCDPSession(page)
    const { nodes } = await session.send('Accessibility.getFullAXTree')
    const fields = nodes.filter(node => !node.ignored && ['textbox', 'combobox', 'spinbutton'].includes(node.role?.value ?? ''))
    expect(fields.length).toBeGreaterThanOrEqual(4)
    expect(fields.every(node => Boolean(node.name?.value))).toBe(true)
    await session.detach()
  })
}

test('cancelling a complete creation draft writes nothing', async ({ page }) => {
  await mockApi(page)
  let writes = 0
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [] }))
  await page.route('**/api/v1/tariffs/tariffs/', route => { writes++; return route.fulfill({ json: {} }) })
  await page.goto('/tariffs')
  await page.locator('.page-header button.button-primary').click()
  await page.locator('.tariff-band-price-input').fill('0.25')
  await page.locator('.tariff-pane-form > .dialog-actions button[type="button"]').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.tariff-pane')).toBeHidden()
  expect(writes).toBe(0)
})


test('adding and removing a band keeps keyboard focus in the editor', async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [] }))
  await page.goto('/tariffs')
  await page.locator('.page-header button.button-primary').click()
  const add = page.locator('.tariff-band-editor > button')
  await add.focus()
  await page.keyboard.press('Space')
  const rows = page.locator('.tariff-band-draft')
  await expect(rows).toHaveCount(2)
  await expect(rows.last().getByRole('combobox')).toBeFocused()
  const remove = rows.last().getByRole('button', { name: 'Remove band 2', exact: true })
  expect(await remove.evaluate(button => parseFloat(getComputedStyle(button).borderTopWidth))).toBeGreaterThan(0)
  await remove.focus()
  await page.keyboard.press('Space')
  await expect(rows).toHaveCount(1)
  await expect(add).toBeFocused()
})

for (const partial of [false, true]) {
  test(`initial bands reject ${partial ? 'partial' : 'empty'} times without a write`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 })
    await mockApi(page)
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [] }))
    let writes = 0
    await page.route('**/api/v1/tariffs/tariffs/', route => {
      writes++
      return route.fulfill({ status: 500, json: {} })
    })
    await page.goto('/tariffs')
    await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
    const editor = page.locator('.tariff-pane')
    await editor.locator('input[name="name"]').fill('Invalid initial band')
    const band = editor.locator('.tariff-band-draft').first()
    await band.getByRole('combobox', { name: 'Band type', exact: true }).selectOption('band')
    await band.getByRole('spinbutton', { name: 'CHF/kWh', exact: true }).fill('0.25')
    const start = band.locator('[data-band-time="time_from"]')
    if (partial) await start.getByRole('spinbutton', { name: 'Band 1 Time from: Hours', exact: true }).fill('7')
    await editor.getByRole('button', { name: 'Create Tariff', exact: true }).click()
    await expect(start.getByText('This field is required.', { exact: true })).toBeVisible()
    const hours = start.getByRole('spinbutton', { name: 'Band 1 Time from: Hours', exact: true })
    await expect(hours).toBeFocused()
    await expect(hours).toHaveAttribute('aria-invalid', 'true')
    const errorId = await hours.getAttribute('aria-describedby')
    await expect(page.locator(`[id="${errorId}"]`)).toHaveText('This field is required.')
    expect(writes).toBe(0)
  })
}

test.describe('energy explanations', () => {
  test.use({ hasTouch: true })
  test('energy explanations open with keyboard and touch without expanding the tariff', async ({ page }) => {
    await mockApi(page)
    await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [series] }))
    await page.goto('/tariffs')
    const energyType = page.locator('.tariff-table-meta')
    await energyType.focus()
    await page.keyboard.press('Enter')
    await expect(energyType).toHaveAttribute('aria-expanded', 'true')
    const explanation = page.getByRole('dialog')
    await expect(explanation).toContainText('Electricity drawn from the public grid.')
    await expect(page.locator('.tariff-detail-row')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(energyType).toBeFocused()
    await page.setViewportSize({ width: 400, height: 900 })
    await energyType.tap()
    await expect(explanation).toBeVisible()
    await expect(page.locator('.tariff-detail-row')).toHaveCount(0)
  })
})

test('editing a preset schedule switches to Custom while price edits retain HT/NT', async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/v1/tariffs/tariffs/series/**', route => route.fulfill({ json: [] }))
  await page.goto('/tariffs')
  await page.locator('.page-header').getByRole('button', { name: 'New Tariff', exact: true }).click()
  const structure = page.getByRole('combobox', { name: /^Initial price bands/ })
  await structure.selectOption('htnt')
  const high = page.locator('[data-band-index="0"]')
  await high.getByRole('spinbutton', { name: 'CHF/kWh', exact: true }).fill('0.30')
  await expect(structure).toHaveValue('htnt')
  await high.getByRole('spinbutton', { name: 'Band 1 Time from: Hours', exact: true }).fill('08')
  await expect(structure).toHaveValue('custom')
})
