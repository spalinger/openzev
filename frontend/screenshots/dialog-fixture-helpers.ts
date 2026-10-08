import type { Page } from '@playwright/test'

type DialogScene = 'stack' | 'tabbability' | 'nested' | 'simultaneous' | 'portals'

export async function mountDialogFixture(page: Page, scene: DialogScene = 'stack', strict = false) {
  await page.evaluate(async ({ scene, strict }) => {
    const fixture = await import(/* @vite-ignore */ '/screenshots/fixtures/confirmation.tsx')
    await fixture.mountConfirmation(scene, strict)
  }, { scene, strict })
}
