import type { KeyboardEvent } from 'react'

/** Close an expanded popup through its toggle button, including a focused trigger. */
export function closePopupOnEscape(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Escape' || event.currentTarget.getAttribute('aria-expanded') !== 'true') return
    event.preventDefault()
    event.currentTarget.click()
}
