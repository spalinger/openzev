import { describe, expect, it } from 'vitest'
import { de } from '../src/i18n/locales/de'
import { en } from '../src/i18n/locales/en'
import { fr } from '../src/i18n/locales/fr'
import { it as itLocale } from '../src/i18n/locales/it'

const LOCALES = { de, en, fr, it: itLocale }

/** Entries rendered together without a group label between them. */
const UNGROUPED = ['overview', 'energyBalance', 'metering', 'billing', 'reports'] as const
const SETUP = ['participants', 'meteringPoints', 'tariffs', 'zevSettings', 'feasibility'] as const
const PLATFORM = ['adminOverview', 'adminAccounts', 'adminTemplates', 'adminSystemSettings'] as const
const PARTICIPANT = ['dashboard', 'myInvoices', 'annualStatement'] as const

function navOf(locale: (typeof LOCALES)[keyof typeof LOCALES]): Record<string, string> {
    return locale.nav as Record<string, string>
}

describe('sidebar labels', () => {
    for (const [name, locale] of Object.entries(LOCALES)) {
        it(`${name}: entries shown together have distinct labels`, () => {
            const nav = navOf(locale)
            for (const group of [UNGROUPED, SETUP, PLATFORM, PARTICIPANT]) {
                const labels = group.map((key) => {
                    expect(nav[key], `nav.${key} is missing`).toBeTypeOf('string')
                    return nav[key]
                })
                expect(new Set(labels).size, `duplicate label in the ${name} sidebar`).toBe(labels.length)
            }
        })

        it(`${name}: the charts tab does not repeat the metering nav label`, () => {
            const nav = navOf(locale)
            expect(nav.meteringCharts).toBeTypeOf('string')
            expect(nav.meteringCharts).not.toBe(nav.metering)
        })
    }
})
