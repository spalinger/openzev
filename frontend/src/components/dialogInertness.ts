let activeDialog: HTMLElement | null = null
let observer: MutationObserver | undefined
const originalInert = new Map<HTMLElement, boolean>()

export function dialogInteractiveRoots(dialog: HTMLElement) {
    const roots = [dialog]
    // Dropdowns can share a portal host; preserve only the controlled popup.
    for (const root of roots) {
        for (const control of root.querySelectorAll('[aria-controls], [aria-owns]')) {
            const ids = `${control.getAttribute('aria-controls') ?? ''} ${control.getAttribute('aria-owns') ?? ''}`
            for (const id of ids.trim().split(/\s+/)) {
                const target = document.getElementById(id)
                if (target && target !== document.body && target !== document.documentElement
                    && !target.contains(dialog) && !roots.some(candidate => candidate.contains(target))) roots.push(target)
            }
        }
    }
    return roots
}

// This manager exclusively owns these attributes while their branches are inert.
function reconcileInertness(next: Set<HTMLElement>) {
    for (const [node, inert] of originalInert) {
        if (!next.has(node)) {
            node.toggleAttribute('inert', inert)
            originalInert.delete(node)
        }
    }
    for (const node of next) {
        if (originalInert.has(node)) continue
        originalInert.set(node, node.hasAttribute('inert'))
        if (!node.hasAttribute('inert')) node.setAttribute('inert', '')
    }
}

function syncInertness() {
    const next = new Set<HTMLElement>()
    if (activeDialog?.isConnected) {
        const roots = dialogInteractiveRoots(activeDialog)
        roots[0] = activeDialog.closest<HTMLElement>('.dialog-scrim') ?? activeDialog
        // Global feedback can announce updates without joining the keyboard cycle.
        roots.push(...document.querySelectorAll<HTMLElement>('.toast-stack'))
        const branches = new Set<Element>()
        for (const root of roots) {
            for (let node: Element | null = root; node && node !== document.body; node = node.parentElement) branches.add(node)
        }
        const visit = (parent: Element) => {
            for (const child of parent.children) {
                if (!(child instanceof HTMLElement) || roots.includes(child)) continue
                if (branches.has(child)) visit(child)
                else next.add(child)
            }
        }
        visit(document.body)
    }
    reconcileInertness(next)
}

function containFocus(event: FocusEvent) {
    const target = event.target
    if (activeDialog?.isConnected && target instanceof Node
        && !dialogInteractiveRoots(activeDialog).some(root => root.contains(target))) activeDialog.focus()
}

export function setActiveDialog(node: HTMLElement | null) {
    activeDialog = node
    if (node && !observer) {
        observer = new MutationObserver(syncInertness)
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-controls', 'aria-owns'] })
        document.addEventListener('focusin', containFocus)
    } else if (!node) {
        observer?.disconnect()
        observer = undefined
        document.removeEventListener('focusin', containFocus)
    }
    syncInertness()
}
