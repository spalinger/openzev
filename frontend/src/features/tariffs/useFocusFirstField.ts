import { useEffect, type RefObject } from 'react'

export type FormFocus = { field: string }

/** Follow the clicked value into its form; otherwise focus the first editable field. */
export function useFocusFirstField(ref: RefObject<HTMLElement | null>, initialFocus?: FormFocus) {
  useEffect(() => {
    const target = (initialFocus && ref.current?.querySelector<HTMLElement>(`[name="${initialFocus.field}"]:not([type="hidden"]):not(:disabled), [data-focus-field="${initialFocus.field}"] button:not(:disabled)`))
      || ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    target?.focus()
    if (initialFocus && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.select()
  }, [ref, initialFocus])
}
