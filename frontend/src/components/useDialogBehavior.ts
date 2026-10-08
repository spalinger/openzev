import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { tabbable } from 'tabbable'
import { dialogInteractiveRoots, setActiveDialog } from './dialogInertness'

type Modal = { id: string; node: HTMLElement }
let modals: Modal[] = []
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
const snapshot = () => modals
function updateStack(next: Modal[]) {
    modals = next
    setActiveDialog(modals.at(-1)?.node ?? null)
    Array.from(listeners).forEach(listener => listener())
}

function restoreFocus(target: HTMLElement | null | undefined) {
    if (!target || !target.isConnected || target.matches(':disabled') || target.closest('[hidden], [inert]')) return false
    target.focus()
    return document.activeElement === target
}

export function trapDialogTab(node: HTMLElement, event: KeyboardEvent, roots: HTMLElement[] = [node]) {
    // Dialog controls precede linked popup controls; positive tabindex is unsupported.
    const items = roots.flatMap(root => tabbable(root))
    if (items.length === 0) {
        event.preventDefault()
        node.focus()
        return
    }
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
        ? (index <= 0 ? items.length : index) - 1
        : (index + 1) % items.length
    items[next].focus()
}

export function useDialogBehavior({ isOpen = true, onClose, returnFocusRef }: {
    isOpen?: boolean
    onClose: () => void
    returnFocusRef?: RefObject<HTMLElement | null>
}) {
    const id = useId()
    const dialogRef = useRef<HTMLDivElement>(null)
    const restoreRef = useRef<HTMLElement | null>(null)
    const callbacks = useRef({ onClose, returnFocusRef })
    const stack = useSyncExternalStore(subscribe, snapshot, snapshot)
    const isTop = () => modals.at(-1)?.id === id

    useLayoutEffect(() => {
        callbacks.current = { onClose, returnFocusRef }
    }, [onClose, returnFocusRef])

    useLayoutEffect(() => {
        const node = dialogRef.current
        if (!isOpen || !node) return
        // Capture before inertness can make the opener lose focus.
        const opener = callbacks.current.returnFocusRef?.current ?? document.activeElement
        if (opener instanceof HTMLElement && !node.contains(opener)) restoreRef.current = opener
        // React mounts descendants first; keep an opening parent below them.
        const descendant = modals.findIndex(modal => node.contains(modal.node))
        const position = descendant === -1 ? modals.length : descendant
        updateStack([...modals.slice(0, position), { id, node }, ...modals.slice(position)])
        return () => updateStack(modals.filter(modal => modal.id !== id))
    }, [id, isOpen])

    useEffect(() => {
        const node = dialogRef.current
        if (!isOpen || !node) return
        if (modals.at(-1)?.id === id) node.focus()
        let popupEscape: KeyboardEvent | undefined
        const captureEscape = (event: KeyboardEvent) => {
            if (modals.at(-1)?.id !== id || event.key !== 'Escape') return
            // Linked widgets own popup dismissal before Escape can close the dialog.
            popupEscape = dialogInteractiveRoots(node).slice(1).some(root => root.getClientRects().length > 0) ? event : undefined
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (modals.at(-1)?.id !== id || event.defaultPrevented) return
            if (event.key === 'Escape') {
                event.preventDefault()
                if (popupEscape !== event) callbacks.current.onClose()
            } else if (event.key === 'Tab') {
                trapDialogTab(node, event, dialogInteractiveRoots(node))
            }
        }
        document.addEventListener('keydown', captureEscape, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', captureEscape, true)
            document.removeEventListener('keydown', onKeyDown)
            const active = document.activeElement
            if (active instanceof HTMLElement && active !== document.body && document.contains(active)) return
            const opener = restoreRef.current
            const top = modals.at(-1)?.node
            if ((!top || top.contains(opener)) && restoreFocus(opener)) return
            if (restoreFocus(top)) return
            restoreFocus(document.querySelector<HTMLElement>('main h1[tabindex="-1"]'))
        }
    }, [id, isOpen])

    return { dialogRef, depth: Math.max(0, stack.findIndex(modal => modal.id === id)), isTop }
}
