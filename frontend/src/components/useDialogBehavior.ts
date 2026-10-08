import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { tabbable } from 'tabbable'

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
    Array.from(listeners).forEach(listener => listener())
}

function restoreFocus(target: HTMLElement | null | undefined) {
    if (!target || !target.isConnected || target.matches(':disabled') || target.closest('[hidden], [inert]')) return false
    target.focus()
    return document.activeElement === target
}

export function trapDialogTab(node: HTMLElement, event: KeyboardEvent) {
    const items = tabbable(node)
    if (items.length === 0) {
        event.preventDefault()
        node.focus()
        return
    }
    const active = document.activeElement
    const inside = items.includes(active as HTMLElement)
    if (event.shiftKey && (!inside || active === items[0])) {
        event.preventDefault()
        items[items.length - 1].focus()
    } else if (!event.shiftKey && (!inside || active === items[items.length - 1])) {
        event.preventDefault()
        items[0].focus()
    }
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
        updateStack([...modals, { id, node }])
        return () => updateStack(modals.filter(modal => modal.id !== id))
    }, [id, isOpen])

    useEffect(() => {
        const node = dialogRef.current
        if (!isOpen || !node) return
        // StrictMode replays opening effects; keep the original opener.
        const opener = callbacks.current.returnFocusRef?.current ?? document.activeElement
        if (opener instanceof HTMLElement && !node.contains(opener)) restoreRef.current = opener
        node.focus()
        const onKeyDown = (event: KeyboardEvent) => {
            if (modals.at(-1)?.id !== id || event.defaultPrevented) return
            if (event.key === 'Escape') {
                event.preventDefault()
                callbacks.current.onClose()
            } else if (event.key === 'Tab') {
                trapDialogTab(node, event)
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
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
