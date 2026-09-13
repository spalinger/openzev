import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MantineProvider } from '@mantine/core'
import { ZevGeneralSettingsFields } from '../src/components/ZevGeneralSettingsFields'
import type { ZevInput } from '../src/types/api'

/** ZEV settings payment section — client-side IBAN feedback. */
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string) => k,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}))

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function renderFields(form: Partial<ZevInput>) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => { act(() => root.unmount()); container.remove() })
    act(() => {
        root.render(
            createElement(
                MantineProvider,
                null,
                createElement(ZevGeneralSettingsFields, {
                    form: { name: 'Z', start_date: '2026-01-01', ...form } as ZevInput,
                    onChange: () => {},
                    group: 'billing',
                }),
            ),
        )
    })
    return container
}

describe('ZevGeneralSettingsFields IBAN feedback', () => {
    it('shows an inline error for a non-blank invalid IBAN', () => {
        const container = renderFields({ bank_iban: 'CH00' })
        const alert = container.querySelector('[role="alert"]')
        expect(alert?.textContent).toBe('pages.zevSettings.validation.invalidIban')
    })

    it('shows no error when the IBAN is blank', () => {
        const container = renderFields({ bank_iban: '' })
        expect(container.querySelector('[role="alert"]')).toBeNull()
    })

    it('shows no error for a valid IBAN', () => {
        const container = renderFields({ bank_iban: 'CH93 0076 2011 6238 5295 7' })
        expect(container.querySelector('[role="alert"]')).toBeNull()
    })
})
