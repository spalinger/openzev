import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { availableScreens, designs, normalizeScope, roleIds } from '../src/design-lab/mockData.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'design/mockups/screenshots')
const url = pathToFileURL(path.join(root, 'design/mockups/index.html')).href
const browser = await chromium.launch({
  ...(process.env.DESIGN_LAB_BROWSER ? { executablePath: process.env.DESIGN_LAB_BROWSER } : {}),
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
await page.addInitScript(() => localStorage.setItem('openzev.design-lab.language', 'en'))
await mkdir(output, { recursive: true })

async function settle() {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function checkOverflow(label) {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  assert.ok(size.content <= size.viewport + 1, `${label} overflows the page by ${size.content - size.viewport}px`)
}

try {
  await page.goto(url)
  await page.locator('.gallery-card').last().waitFor()
  await settle()
  await page.screenshot({ path: path.join(output, 'gallery.png'), fullPage: true })

  for (const role of roleIds) for (const design of designs) {
    const link = (screen = 'overview', community) => `${url}#${new URLSearchParams({ design: design.id, role, screen, ...(community ? { community } : {}) })}`
    const prefix = `${design.number}-${design.id}-${role}`
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(link())
    await page.locator('.demo-shell').waitFor()
    await settle()
    await checkOverflow(`${design.id} ${role} desktop`)
    await page.locator('.demo-shell').screenshot({ path: path.join(output, `${prefix}-desktop.png`) })
    await page.getByRole('button', { name: 'Mobile', exact: true }).click()
    await settle()
    assert.ok((await page.locator('.demo-shell').boundingBox()).width <= 400, `${design.id} mobile preview is wider than 400px`)
    await checkOverflow(`${design.id} simulated mobile`)

    await page.setViewportSize({ width: 400, height: 860 })
    for (const screen of availableScreens(role, normalizeScope(role))) {
      await page.goto(link(screen))
      await page.locator('.demo-page-content').waitFor()
      await settle()
      await checkOverflow(`${design.id} ${role} ${screen} mobile`)
      if (screen === 'overview') await page.locator('.demo-shell').screenshot({ path: path.join(output, `${prefix}-mobile.png`) })
    }
    if (role === 'admin') {
      for (const screen of availableScreens(role, 'sonnenhof')) {
        await page.goto(link(screen, 'sonnenhof'))
        await page.locator('.demo-page-content').waitFor()
        await settle()
        await checkOverflow(`${design.id} admin ${screen} community mobile`)
      }
    }
    console.log(`Captured ${design.number} ${design.id} ${role}; checked all available screens at 400px.`)
  }
  assert.deepEqual(errors, [], 'Browser reported errors while rendering the concepts.')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
