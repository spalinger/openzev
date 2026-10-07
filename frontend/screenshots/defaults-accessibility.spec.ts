import { expect, test, type Page } from '@playwright/test'
import { apiErrors, mockApi } from './page-anatomy-fixtures'

test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-CH' })

test.afterEach(async ({ page }) => {
  expect(apiErrors.get(page) ?? []).toEqual([])
})

const meterSelect = (page: Page) => page.getByRole('combobox', { name: 'Metering Point *', exact: true })

async function expectHeadingFocused(page: Page, title: string) {
  const heading = page.locator('main h1')
  await expect(heading).toHaveText(title)
  await expect(heading).toBeFocused()
}

test('the skip link is the first tab stop and moves to the main content', async ({ page }) => {
  await mockApi(page, { role: 'manager', populated: true })
  await page.goto('/tariffs')
  await expect(page.locator('main h1')).toHaveText('Tariffs')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
  await expect(page).toHaveURL(/\/tariffs$/)
  // The next tab stop is inside the page, past the navigation.
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true)
})

test('navigation focuses the new page title and names the browser tab', async ({ page }) => {
  await mockApi(page, { role: 'manager', populated: true })
  await page.goto('/tariffs')
  await expect(page).toHaveTitle('Tariffs · Review ZEV – OpenZEV')
  const participants = page.locator('aside').getByRole('link', { name: 'Participants' })
  await participants.focus()
  await page.keyboard.press('Enter')
  await expectHeadingFocused(page, 'Participants')
  await expect(page).toHaveTitle('Participants · Review ZEV – OpenZEV')

  // A page whose module is still loading receives focus once it arrives.
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let intercepted = false
  await page.route('**/src/pages/ReportsPage.tsx*', async route => {
    intercepted = true
    await held
    await route.continue()
  })
  await page.locator('aside').getByRole('link', { name: 'Reports' }).click()
  await expect.poll(() => intercepted).toBe(true)
  // While the module is held back, the previous page stays.
  await expect(page.locator('main h1')).toHaveText('Participants')
  release()
  await expectHeadingFocused(page, 'Reports')

  await page.goBack()
  await expectHeadingFocused(page, 'Participants')
})

test('routed hub tabs keep focus on the tab', async ({ page }) => {
  await mockApi(page, { role: 'manager', populated: true })
  await page.goto('/billing/invoices')
  const emails = page.getByRole('tab', { name: 'Emails' })
  await emails.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/billing\/emails/)
  await expect(emails).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/billing\/invoices/)
  await expect(page.getByRole('tab', { name: 'Invoices' })).toBeFocused()
})

test('drawer navigation at 400px closes the drawer and focuses the page title', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await mockApi(page, { role: 'manager', populated: true })
  await page.goto('/tariffs')
  await page.getByRole('button', { name: 'Menu' }).click()
  // Click only once the drawer has opened, not while it slides in.
  await expect(page.locator('aside')).toHaveClass(/mobile-open/)
  await page.locator('aside').getByRole('link', { name: 'Participants' }).click()
  await expect(page.locator('aside')).not.toHaveClass(/mobile-open/)
  await expectHeadingFocused(page, 'Participants')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // Skipping from an open drawer closes it and unlocks scrolling.
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.locator('aside')).toHaveClass(/mobile-open/)
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await skip.focus()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
  await expect(page.locator('aside')).not.toHaveClass(/mobile-open/)
  await expect(page.locator('.sidebar-overlay')).not.toHaveClass(/visible/)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

// One management role here; the unit tests cover admin, manager and viewer.
for (const role of ['viewer'] as const) {
  test(`metering opens the whole-community total for a ${role}`, async ({ page }) => {
    await mockApi(page, { role, populated: true, meterCount: 2 })
    const chart = page.waitForRequest(request => request.url().includes('/chart-data/'))
    await page.goto('/metering/chart')
    const params = new URL((await chart).url()).searchParams
    expect(params.get('zev_id')).toBe('42')
    expect(params.has('metering_point')).toBe(false)
    const select = meterSelect(page)
    await expect(select).toHaveValue('__zev_total__')
    await expect(page).toHaveURL(/\/metering\/chart$/)
  })
}

test('metering opens a participant\'s only meter', async ({ page }) => {
  await mockApi(page, { role: 'participant', populated: true, meterCount: 1 })
  const chart = page.waitForRequest(request => request.url().includes('/chart-data/'))
  await page.goto('/metering/chart')
  expect(new URL((await chart).url()).searchParams.get('metering_point')).toBe('mp42')
  await expect(meterSelect(page)).toHaveValue('mp42')
  await expect(page.locator('main .eyebrow')).toHaveText('Review ZEV')
})

test('a participant with several meters chooses one, at desktop and 400px', async ({ page }) => {
  await mockApi(page, { role: 'participant', populated: true, meterCount: 2 })
  let chartRequests = 0
  page.on('request', request => { if (request.url().includes('/chart-data/')) chartRequests += 1 })
  await page.goto('/metering/chart')
  await expect(page.locator('main .empty-state h3')).toHaveText('No metering point selected')
  await page.waitForLoadState('networkidle')
  expect(chartRequests).toBe(0)
  const select = meterSelect(page)
  await expect(select).toHaveValue('')
  await page.setViewportSize({ width: 400, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await select.selectOption('mp42-2')
  await expect(page).toHaveURL(/metering_point=mp42-2/)
  await expect(select).toHaveValue('mp42-2')
})

test('metering explains a community without metering points', async ({ page }) => {
  await mockApi(page, { role: 'viewer', populated: false })
  await page.goto('/metering/chart')
  await expect(page.locator('main .empty-state h3')).toHaveText('No metering points yet')
  await expect(page.locator('main .empty-state').getByRole('link', { name: 'Metering points' })).toHaveAttribute('href', '/metering/points')
  // Nothing to choose, and no chart behind the empty state.
  await expect(meterSelect(page)).toHaveCount(0)
  await expect(page.locator('main .recharts-wrapper, main .stat-grid')).toHaveCount(0)
})

test('the chart names the selected community for a participant with several memberships', async ({ page }) => {
  await mockApi(page, {
    zevs: [{ id: '42', name: 'Review ZEV' }, { id: '43', name: 'Second ZEV' }],
    roleByZev: { '42': 'manager', '43': 'participant' },
    preferred: '43',
    role: 'participant',
    populated: true,
  })
  await page.goto('/metering/chart')
  await expect(page.locator('main .eyebrow')).toHaveText('Second ZEV')
  await expect(page).toHaveTitle('Metering Data · Second ZEV – OpenZEV')
  // Loading the page directly leaves focus alone.
  await expect(page.locator('main h1')).not.toBeFocused()
})
