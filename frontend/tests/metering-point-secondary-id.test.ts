import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import type { MeteringPointInput } from '../src/types/api'
import {
    defaultMeteringPointForm,
    meteringPointFieldErrors,
    normalizeSecondaryMeterId,
    toMeteringPointPayload,
} from '../src/features/meteringPoints/useMeteringPointForms'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { MeteringPointFormModal } from '../src/features/meteringPoints/MeteringPointFormModal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('secondary meter ID normalization', () => {
    it('defaults the form alias to blank', () => {
        expect(defaultMeteringPointForm().secondary_meter_id).toBe('')
    })

    it('trims the alias and maps blank to null (clear)', () => {
        expect(normalizeSecondaryMeterId('  CH-SEC-1  ')).toBe('CH-SEC-1')
        expect(normalizeSecondaryMeterId('')).toBeNull()
        expect(normalizeSecondaryMeterId('   ')).toBeNull()
        expect(normalizeSecondaryMeterId(null)).toBeNull()
        expect(normalizeSecondaryMeterId(undefined)).toBeNull()
    })

    it('clears the alias on submit when the field is blank', () => {
        expect(toMeteringPointPayload({ ...defaultMeteringPointForm(), meter_id: 'M1' }).secondary_meter_id).toBeNull()
        expect(
            toMeteringPointPayload({ ...defaultMeteringPointForm(), meter_id: 'M1', secondary_meter_id: '  S1 ' }).secondary_meter_id,
        ).toBe('S1')
    })
})

describe('meteringPointFieldErrors', () => {
    it('extracts field-keyed 400 collision errors', () => {
        expect(
            meteringPointFieldErrors({ response: { data: { secondary_meter_id: ['Already used by another meter.'] } } }),
        ).toEqual({ secondary_meter_id: 'Already used by another meter.' })
        expect(
            meteringPointFieldErrors({ response: { data: { meter_id: 'Taken.' } } }),
        ).toEqual({ meter_id: 'Taken.' })
    })

    it('ignores non-field payloads so the generic toast path stays', () => {
        expect(meteringPointFieldErrors({ response: { data: { detail: 'Nope.' } } })).toEqual({})
        expect(meteringPointFieldErrors({ response: { data: 'gone' } })).toEqual({})
        expect(meteringPointFieldErrors(new Error('network'))).toEqual({})
    })
})

function Harness({ initial, fieldErrors }: { initial: MeteringPointInput; fieldErrors?: Record<string, string> }) {
    const [form, setForm] = useState<MeteringPointInput>(initial)
    return createElement(MeteringPointFormModal, {
        isOpen: true,
        title: 'title',
        submitLabel: 'submit',
        form,
        fieldErrors,
        isPending: false,
        onClose: () => undefined,
        onSubmit: (event) => event.preventDefault(),
        setForm,
    })
}

describe('MeteringPointFormModal secondary ID', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>

    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: (query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }),
        })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    function secondaryInput(): HTMLInputElement {
        const label = Array.from(container.querySelectorAll('label')).find((element) =>
            element.querySelector('span')?.textContent === 'pages.meteringPoints.form.secondaryMeterId',
        )
        expect(label, 'secondary ID label not rendered').toBeTruthy()
        return label!.querySelector('input') as HTMLInputElement
    }

    it('edits the existing alias and explains clearing', () => {
        act(() => {
            root.render(createElement(MantineProvider, null, createElement(Harness, {
                initial: { ...defaultMeteringPointForm(), meter_id: 'M1', secondary_meter_id: 'SEC-1' },
            })))
        })
        expect(secondaryInput().value).toBe('SEC-1')
        expect(container.textContent).toContain('pages.meteringPoints.form.secondaryMeterIdHint')
    })

    it('clears the alias to a blank value the payload maps to null', () => {
        act(() => {
            root.render(createElement(MantineProvider, null, createElement(Harness, {
                initial: { ...defaultMeteringPointForm(), meter_id: 'M1', secondary_meter_id: 'SEC-1' },
            })))
        })
        const input = secondaryInput()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        act(() => {
            setter.call(input, '')
            input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        expect(secondaryInput().value).toBe('')
    })

    it('shows the server collision error under the field', () => {
        act(() => {
            root.render(createElement(MantineProvider, null, createElement(Harness, {
                initial: { ...defaultMeteringPointForm(), meter_id: 'M1', secondary_meter_id: 'SEC-1' },
                fieldErrors: { secondary_meter_id: 'Already used by another meter.' },
            })))
        })
        expect(secondaryInput().getAttribute('aria-invalid')).toBe('true')
        expect(secondaryInput().getAttribute('aria-describedby')).toBe('metering-point-form-secondary_meter_id-error')
        expect(container.querySelector('#metering-point-form-secondary_meter_id-error')?.textContent)
            .toContain('Already used by another meter.')
    })
})
