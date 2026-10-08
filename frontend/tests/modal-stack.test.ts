import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import { FormModal } from '../src/components/FormModal'
import { trapDialogTab } from '../src/components/useDialogBehavior'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('FormModal stacking', () => {
    it('restores background inertness without clearing existing inert attributes', () => {
        const background = document.createElement('button')
        const alreadyInert = document.createElement('div')
        alreadyInert.setAttribute('inert', '')
        document.body.append(background, alreadyInert)
        act(() => root.render(createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() }, 'form')))
        expect(background.hasAttribute('inert')).toBe(true)
        expect(container.querySelector('[role=dialog]')!.closest('[inert]')).toBeNull()
        act(() => root.render(null))
        expect(background.hasAttribute('inert')).toBe(false)
        expect(alreadyInert.hasAttribute('inert')).toBe(true)
        background.remove()
        alreadyInert.remove()
    })

    for (const strict of [false, true]) {
        it(`keeps a simultaneous nested child above its parent, StrictMode=${strict}`, () => {
            const closeParent = vi.fn(), closeChild = vi.fn()
            const parent = createElement(FormModal, { isOpen: true, title: 'Parent', onClose: closeParent },
                createElement(ConfirmDialog, { title: 'Child', message: 'Confirm', onConfirm: vi.fn(), onCancel: closeChild }))
            act(() => root.render(strict ? createElement(StrictMode, null, parent) : parent))
            const [outer, inner] = container.querySelectorAll<HTMLElement>('[role=dialog]')
            expect(inner.getAttribute('aria-modal')).toBe('true')
            expect(outer.getAttribute('aria-modal')).toBeNull()
            expect(document.activeElement).toBe(inner)
            expect(inner.closest('[inert]')).toBeNull()
            expect(outer.querySelector('.form-modal-close')!.closest('[inert]')).not.toBeNull()
            act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
            expect(closeChild).toHaveBeenCalledOnce()
            expect(closeParent).not.toHaveBeenCalled()
        })
    }

    it('rejects linked popup roots that contain the active dialog', () => {
        container.id = 'fixture-ancestor'
        act(() => root.render(createElement('div', null,
            createElement('button', { id: 'background' }, 'Background'),
            createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() },
                createElement('button', { 'aria-controls': container.id }, 'Control')))))
        expect(container.querySelector('#background')!.closest('[inert]')).not.toBeNull()
    })

    it('leaves retained inert branches untouched when dialog content changes', async () => {
        const background = document.createElement('button')
        document.body.append(background)
        const writes = vi.fn()
        const observer = new MutationObserver(writes)
        try {
            act(() => root.render(createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() }, 'form')))
            observer.observe(background, { attributes: true, attributeFilter: ['inert'] })
            await act(async () => {
                container.querySelector('[role=dialog]')!.append(document.createElement('span'))
            })
            expect(background.hasAttribute('inert')).toBe(true)
            expect(writes).not.toHaveBeenCalled()
            const late = document.createElement('button')
            await act(async () => { container.append(late) })
            expect(late.hasAttribute('inert')).toBe(true)
        } finally {
            observer.disconnect()
            background.remove()
        }
    })

    for (const kind of ['form', 'confirm']) {
        it(`${kind} wraps Shift+Tab from the initially focused root to its last control`, () => {
            act(() => root.render(kind === 'form'
                ? createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() }, createElement('button', null, 'last'))
                : createElement(ConfirmDialog, { title: 'Confirm', message: 'Confirm', onConfirm: vi.fn(), onCancel: vi.fn() })))
            const dialog = container.querySelector<HTMLElement>('[role=dialog]')!
            expect(document.activeElement).toBe(dialog)
            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
            act(() => document.dispatchEvent(event))
            expect(event.defaultPrevented).toBe(true)
            expect(document.activeElement).toBe(Array.from(dialog.querySelectorAll('button')).at(-1))
        })
    }

    it('keeps focus on the root when no controls are tabbable', () => {
        const outside = document.createElement('button')
        const dialog = document.createElement('div')
        dialog.tabIndex = -1
        dialog.innerHTML = '<input type="hidden"><fieldset disabled><button>Disabled</button></fieldset><input tabindex="-1">'
        container.append(outside, dialog)
        for (const shiftKey of [false, true]) {
            outside.focus()
            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })
            trapDialogTab(dialog, event)
            expect(event.defaultPrevented).toBe(true)
            expect(document.activeElement).toBe(dialog)
        }
    })

    it('ignores hidden inputs, disabled fieldsets, inert controls and negative tab indices', () => {
        const dialog = document.createElement('div')
        dialog.tabIndex = -1
        dialog.innerHTML = '<input type="hidden"><fieldset disabled><button>Disabled</button></fieldset><div inert><button>Inert</button></div><input tabindex="-1"><button id="real">Real</button><input type="hidden">'
        container.append(dialog)
        dialog.focus()
        trapDialogTab(dialog, new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }))
        expect(document.activeElement).toBe(dialog.querySelector('#real'))
        const outside = document.createElement('button')
        container.append(outside)
        outside.focus()
        trapDialogTab(dialog, new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
        expect(document.activeElement).toBe(dialog.querySelector('#real'))
    })

    it('keeps Tab inside after the focused submit button becomes disabled', () => {
        const dialog = document.createElement('div')
        dialog.innerHTML = '<button>Close</button><button>Submit</button>'
        container.append(dialog)
        const [close, submit] = dialog.querySelectorAll('button')
        submit.focus()
        submit.disabled = true
        const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
        trapDialogTab(dialog, event)
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(close)
    })

    it('updates rendered depth when an earlier sibling opens and a lower modal closes', () => {
        const render = (earlier: boolean, later: boolean) => act(() => root.render(createElement('div', null,
            createElement(FormModal, { isOpen: earlier, title: 'Earlier', onClose: vi.fn() }, 'earlier'),
            createElement(FormModal, { isOpen: later, title: 'Later', onClose: vi.fn() }, 'later'),
        )))
        render(false, true)
        render(true, true)
        const scrims = container.querySelectorAll<HTMLElement>('.dialog-scrim')
        expect(Number(scrims[0].style.zIndex)).toBeGreaterThan(Number(scrims[1].style.zIndex))
        const earlier = scrims[0].querySelector('[role=dialog]')
        render(true, false)
        expect(container.querySelector<HTMLElement>('.dialog-scrim')!.style.zIndex).toBe(scrims[1].style.zIndex)
        expect(document.activeElement).toBe(earlier)
    })

    function renderStacked(outerOpen: boolean, innerOpen: boolean, onCloseOuter: () => void, onCloseInner: () => void) {
        act(() => {
            root.render(createElement('div', null,
                createElement(FormModal, { isOpen: outerOpen, title: 'Outer', onClose: onCloseOuter }, 'outer'),
                createElement(FormModal, { isOpen: innerOpen, title: 'Inner', onClose: onCloseInner }, 'inner'),
            ))
        })
    }

    it('Escape cancels the overwrite confirmation without closing the import modal', () => {
        const onCloseModal = vi.fn()
        const onCancelConfirm = vi.fn()
        act(() => {
            root.render(createElement('div', null,
                createElement(FormModal, { isOpen: true, title: 'Import', onClose: onCloseModal }, 'import'),
                createElement(ConfirmDialog, {
                    title: 'Overwrite',
                    message: 'Confirm overwrite',
                    onConfirm: vi.fn(),
                    onCancel: onCancelConfirm,
                }),
            ))
        })

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })

        expect(onCancelConfirm).toHaveBeenCalledOnce()
        expect(onCloseModal).not.toHaveBeenCalled()
    })

    it('closing the inner dialog returns focus to the outer dialog', () => {
        const noop = () => undefined
        renderStacked(true, true, noop, noop)
        const dialogs = container.querySelectorAll('[role=dialog]')
        expect(document.activeElement).toBe(dialogs[1])
        renderStacked(true, false, noop, noop)
        expect(document.activeElement).toBe(dialogs[0])
    })

    it('returns a confirmation to the remaining modal if its opener was removed', () => {
        const render = (opener: boolean, confirmation: boolean) => act(() => root.render(createElement('div', null,
            createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() },
                opener && createElement('button', { id: 'opening-control' }, 'Open')),
            confirmation && createElement(ConfirmDialog, { title: 'Confirm', message: 'Confirm', onConfirm: vi.fn(), onCancel: vi.fn() }),
        )))
        render(true, false)
        container.querySelector<HTMLElement>('#opening-control')!.focus()
        render(true, true)
        render(false, true)
        render(false, false)
        expect(document.activeElement).toBe(container.querySelector('[role=dialog]'))
    })

    it('returns to the remaining dialog when the opener is disabled', () => {
        const render = (confirmation: boolean, disabled = false) => act(() => root.render(createElement('div', null,
            createElement(FormModal, { isOpen: true, title: 'Form', onClose: vi.fn() },
                createElement('button', { id: 'opener', disabled }, 'Open')),
            confirmation && createElement(ConfirmDialog, { title: 'Confirm', message: 'Confirm', onConfirm: vi.fn(), onCancel: vi.fn() }),
        )))
        render(false)
        container.querySelector<HTMLElement>('#opener')!.focus()
        render(true, true)
        render(false, true)
        expect(document.activeElement).toBe(container.querySelector('[role=dialog]'))
    })

    it('returns to the page heading when the opener cannot receive focus', () => {
        const opener = document.createElement('button')
        document.body.append(opener)
        opener.focus()
        const render = (open: boolean) => act(() => root.render(createElement('main', null,
            createElement('h1', { tabIndex: -1 }, 'Page'),
            open && createElement(ConfirmDialog, { title: 'Confirm', message: 'Confirm', onConfirm: vi.fn(), onCancel: vi.fn() }),
        )))
        render(true)
        opener.disabled = true
        render(false)
        expect(document.activeElement).toBe(container.querySelector('h1'))
        opener.remove()
    })

    it('returns focus to the wizard action after cancelling its confirmation', () => {
        const render = (confirmOpen: boolean) => act(() => {
            root.render(createElement(StrictMode, null,
                createElement(FormModal, { isOpen: true, title: 'Import', onClose: vi.fn() },
                    createElement('button', { id: 'start-import' }, 'Start')),
                confirmOpen && createElement(ConfirmDialog, {
                    title: 'Overwrite', message: 'Confirm', onConfirm: vi.fn(), onCancel: vi.fn(),
                }),
            ))
        })
        render(false)
        const opener = container.querySelector('#start-import') as HTMLButtonElement
        opener.focus()
        render(true)
        expect(container.querySelectorAll('[role=dialog]')[1].contains(document.activeElement)).toBe(true)
        render(false)
        expect(document.activeElement).toBe(opener)
    })

    it('only the top dialog traps Tab; background modal stays inert', () => {
        const noop = () => undefined
        act(() => {
            root.render(createElement('div', null,
                createElement(FormModal, {
                    isOpen: true, title: 'Outer', onClose: noop,
                }, createElement('button', { type: 'button' }, 'outer-btn')),
                createElement(FormModal, {
                    isOpen: true, title: 'Inner', onClose: noop,
                }, createElement('button', { type: 'button' }, 'inner-btn')),
            ))
        })
        const dialogs = container.querySelectorAll('[role=dialog]')
        const outerBtn = dialogs[0].querySelector('button') as HTMLButtonElement
        const innerBtn = dialogs[1].querySelector('button') as HTMLButtonElement
        outerBtn.focus()
        expect(document.activeElement).toBe(dialogs[1])
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(document.activeElement).toBe(innerBtn)
    })

    it('Shift+Tab from outside a newly opened modal wraps to its last control', () => {
        const noop = () => undefined
        act(() => {
            root.render(createElement('div', null,
                createElement('button', { type: 'button', id: 'behind' }, 'behind'),
                createElement(FormModal, {
                    isOpen: true, title: 'Top', onClose: noop,
                }, [
                    createElement('button', { type: 'button', key: 'a' }, 'first'),
                    createElement('button', { type: 'button', key: 'b' }, 'last'),
                ]),
            ))
        })
        const dialog = container.querySelector('[role=dialog]') as HTMLElement
        const buttons = Array.from(dialog.querySelectorAll('button'))
        const behind = container.querySelector('#behind') as HTMLButtonElement
        behind.focus()
        act(() => {
            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
            Object.defineProperty(event, 'shiftKey', { value: true })
            document.dispatchEvent(event)
        })
        expect(document.activeElement).toBe(buttons[buttons.length - 1])
    })

    it('overwrite confirmation traps focus and exposes dialog semantics', () => {
        act(() => {
            root.render(createElement('div', null,
                createElement(FormModal, { isOpen: true, title: 'Import', onClose: () => undefined },
                    createElement('button', { type: 'button' }, 'wizard-btn')),
                createElement(ConfirmDialog, {
                    title: 'Overwrite',
                    message: 'Confirm overwrite',
                    onConfirm: vi.fn(),
                    onCancel: vi.fn(),
                }),
            ))
        })
        const dialogs = container.querySelectorAll('[role=dialog]')
        expect(dialogs.length).toBe(2)
        const confirm = dialogs[1] as HTMLElement
        expect(confirm.getAttribute('aria-modal')).toBe('true')
        expect(confirm.getAttribute('aria-labelledby')).toBeTruthy()
        // Focus moved into the confirmation on open, not left in the wizard.
        expect(confirm.contains(document.activeElement as Node)).toBe(true)
        const buttons = Array.from(confirm.querySelectorAll('button'))
        buttons[buttons.length - 1].focus()
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(document.activeElement).toBe(buttons[0])
    })
})
