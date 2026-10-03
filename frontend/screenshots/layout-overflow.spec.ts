import { test, expect, type Page } from '@playwright/test'
import { API_BASE, getAdminToken, navigateTo } from './helpers'

const PROBE_PREFIX = 'Layout Probe '
const PROBE_COUNT = 10

async function prepareProbeZevs(page: Page) {
  const headers = { Authorization: `Bearer ${await getAdminToken(page)}` }
  const meResp = await page.request.get(`${API_BASE}/auth/me/`, { headers })
  expect(meResp.ok(), `Fetching /auth/me/ failed (${meResp.status()})`).toBeTruthy()
  const user = await meResp.json()
  const results = Array.from({ length: PROBE_COUNT }, (_, index) => ({
    id: `layout-probe-${index + 1}`,
    name: `${PROBE_PREFIX}${String(index + 1).padStart(2, '0')}`,
    owner: user.id,
  }))
  await page.route(/\/api\/v1\/zev\/zevs\/(?:\?.*)?$/, (route) => route.fulfill({
    json: { count: results.length, next: null, previous: null, results },
  }))
  // Selection stays local to this browser, including the saved preference.
  await page.route(/\/api\/v1\/auth\/me\/$/, (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    return route.fulfill({ json: { ...user, ...route.request().postDataJSON() } })
  })
}

async function openSwitcher(page: Page) {
  await page.locator('.sidebar-zev-menu .user-menu-trigger').click()
  await expect(page.locator('#zev-menu-list')).toBeVisible()
}

async function expectNavSurvives(page: Page) {
  const viewport = page.viewportSize()
  expect(viewport, 'no viewport size').not.toBeNull()
  const topBox = await page.locator('.sidebar-top').boundingBox()
  expect(topBox, 'sidebar nav has no box — it collapsed').not.toBeNull()
  expect(topBox!.height).toBeGreaterThanOrEqual(70)
  await expect(page.locator('.sidebar-top nav a').first()).toBeVisible()
  await page.locator('.sidebar').evaluate((el) => { el.scrollTop = el.scrollHeight })
  const footerBox = await page.locator('.sidebar-footer').boundingBox()
  expect(footerBox, 'sidebar footer has no box').not.toBeNull()
  expect(footerBox!.y, 'footer starts above the viewport').toBeGreaterThanOrEqual(0)
  expect(footerBox!.y + footerBox!.height, 'footer ends below the viewport').toBeLessThanOrEqual(viewport!.height)
}

async function expectListUsable(page: Page) {
  const listBox = await page.locator('#zev-menu-list .zev-dropdown-list').boundingBox()
  expect(listBox, 'community list has no box — it was crushed').not.toBeNull()
  expect(listBox!.height).toBeGreaterThanOrEqual(100)
}

async function selectLastProbe(page: Page) {
  const target = page.locator('.zev-dropdown-item', { hasText: `${PROBE_PREFIX}10` })
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await expect(page.locator('#zev-menu-list')).toBeHidden()
  await expect(page.locator('.sidebar-zev-menu .user-menu-trigger')).toContainText(`${PROBE_PREFIX}10`)
}

test('open community list never evicts the sidebar navigation', async ({ page }) => {
  await prepareProbeZevs(page)
  await navigateTo(page, '/account')
  let first = true
  for (const size of [
    { width: 1440, height: 600, drawer: false },
    { width: 1280, height: 400, drawer: false },
    { width: 740, height: 390, drawer: true },
    { width: 390, height: 600, drawer: true },
  ]) {
    await page.setViewportSize(size)
    if (size.drawer) {
      await page.locator('.mobile-menu-button').click()
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible()
    }
    await openSwitcher(page)
    if (first) {
      const scrollable = await page.evaluate(() => {
        const list = document.querySelector('#zev-menu-list .zev-dropdown-list')
        return list ? list.scrollHeight > list.clientHeight : null
      })
      expect(scrollable, 'community list should scroll internally').toBe(true)
      first = false
    }
    await expectListUsable(page)
    await expectNavSurvives(page)
    await selectLastProbe(page)
    if (size.drawer) await page.keyboard.press('Escape')
  }
})

async function prepareFocusPage(page: Page, width = 1366) {
  await page.setViewportSize({ width, height: 800 })
  await page.addInitScript(() => {
    localStorage.setItem('openzev.sidebarCollapsed', 'true')
    localStorage.setItem('openzev.language', 'en')
  })
  // Browser-local communities keep the switcher independent of seeded data.
  await page.route(/\/api\/v1\/zev\/zevs\/(?:\?.*)?$/, (route) => route.fulfill({ json: {
    count: 2, next: null, previous: null,
    results: [
      { id: 'focus-a', name: 'Focus A', owner: 0 },
      { id: 'focus-b', name: 'Focus B', owner: 0 },
    ],
  } }))
  await navigateTo(page, '/account')
}

test('breakpoint changes preserve body focus outside navigation', async ({ page }) => {
  await prepareFocusPage(page, 400)
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await page.setViewportSize({ width: 1366, height: 768 })
  await expect(page.locator('.shell-collapsed')).toBeVisible()
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
})

test('breakpoint changes recover focus from hidden navigation controls', async ({ page }) => {
  await prepareFocusPage(page)
  const collapse = page.locator('.sidebar-collapse-button')
  const hamburger = page.locator('.mobile-menu-button')
  const switcher = page.locator('.sidebar-zev-menu .user-menu-trigger')
  await collapse.focus()
  await page.setViewportSize({ width: 400, height: 800 })
  await expect(collapse).toBeHidden()
  await expect(hamburger).toBeFocused()
  await hamburger.press('Enter')
  await expect(page.locator('.sidebar.mobile-open')).toBeVisible()
  await expect(page.locator('#app-sidebar')).toBeInViewport({ ratio: 0.95 })
  await switcher.click()
  await expect(page.locator('.zev-dropdown-item').first()).toBeFocused()
  await page.setViewportSize({ width: 1366, height: 768 })
  await expect(switcher).toBeFocused()
  await expect(switcher).toBeVisible()
  await expect(page.locator('.zev-menu-dropdown')).toHaveCount(0)
  await expect(page.locator('.sidebar.mobile-open')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await collapse.focus()
  await page.setViewportSize({ width: 400, height: 800 })
  await expect(hamburger).toBeFocused()
  await expect(page.locator('#app-sidebar')).not.toBeInViewport()
  await hamburger.press('Enter')
  await expect(page.locator('#app-sidebar')).toBeInViewport({ ratio: 0.95 })
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('.sidebar-footer a')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(hamburger).toBeFocused()
  await expect(page.locator('#app-sidebar')).not.toBeInViewport()
  await page.setViewportSize({ width: 1366, height: 768 })
  await expect(switcher).toBeFocused()
  await expect(switcher).toBeVisible()
  await expect(page.locator('nav a[href="/admin/system-settings"]')).toHaveAccessibleName('Platform: Settings')
  expect(await page.evaluate(() => localStorage.getItem('openzev.sidebarCollapsed'))).toBe('true')
})

test('breakpoint changes preserve a textbox value, focus and selection', async ({ page }) => {
  await prepareFocusPage(page)
  const input = page.locator('input[name="first_name"]')
  await input.fill('Unsaved profile name')
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 8))
  for (const width of [400, 1366]) {
    await page.setViewportSize({ width, height: 800 })
    if (width === 400) await expect(page.locator('.sidebar-collapse-button')).toBeHidden()
    else await expect(page.locator('.sidebar-collapse-button')).toBeVisible()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Unsaved profile name')
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 8])
  }
})
