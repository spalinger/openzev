import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import type { MeteringPointInput } from '../src/types/api'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { MeteringPointFormModal } from '../src/features/meteringPoints/MeteringPointFormModal'

// jsdom does not enable the React act() environment by default.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Harness({ initialActive }: { initialActive: boolean }) {
    const [form, setForm] = useState<MeteringPointInput>({
        zev: 'zev-1',
        meter_id: 'METER-1',
        meter_type: 'consumption',
        is_active: initialActive,
        location_description: '',
    })
    return createElement(MeteringPointFormModal, {
        isOpen: true,
        title: 'title',
        submitLabel: 'submit',
        form,
        isPending: false,
        onClose: () => undefined,
        onSubmit: (event) => event.preventDefault(),
        setForm,
    })
}

describe('MeteringPointFormModal active toggle', () => {
    let container: HTMLDivElement
    let root: ReturnType<typeof createRoot>

    beforeEach(() => {
        // MantineProvider reads prefers-color-scheme; jsdom has no matchMedia.
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
        act(() => {
            root.render(createElement(MantineProvider, null, createElement(Harness, { initialActive: true })))
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const activeSwitch = () => {
        // Resolve the control via its accessible label so the test does not
        // silently target the wrong element if another checkbox is added later.
        const label = Array.from(container.querySelectorAll('label')).find((element) =>
            element.textContent?.includes('pages.meteringPoints.form.active'),
        )
        expect(label, 'active Switch label not rendered').toBeTruthy()
        const input = label!.htmlFor
            ? (document.getElementById(label!.htmlFor) as HTMLInputElement | null)
            : label!.querySelector<HTMLInputElement>('input[type="checkbox"]')
        expect(input, 'active Switch checkbox not rendered').toBeTruthy()
        return input!
    }

    it('toggles is_active twice without throwing (regression: stale synthetic event)', async () => {
        // Regression: the handler used to read event.currentTarget inside the
        // setForm updater, but React nulls currentTarget after dispatch, so
        // the toggle threw and unmounted the page (blank full page).
        expect(activeSwitch().checked).toBe(true)

        await act(async () => {
            activeSwitch().click()
        })
        expect(activeSwitch().checked).toBe(false)

        await act(async () => {
            activeSwitch().click()
        })
        expect(activeSwitch().checked).toBe(true)

        // The modal content must still be mounted — no blank-page crash.
        expect(container.querySelector('form')).toBeTruthy()
    })
})
