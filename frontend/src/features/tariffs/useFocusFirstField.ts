import { useEffect, type RefObject } from 'react'
import { missingBandTimes, type BandDraft } from './bandDrafts'

export type FormFocus = { field: string }

export function focusMissingBandTime(form: HTMLElement | null, bands: BandDraft[]) {
  const index = bands.findIndex(band => missingBandTimes(band).length > 0)
  if (index < 0) return false
  const field = missingBandTimes(bands[index])[0]
  form?.querySelector<HTMLInputElement>(`[data-band-index="${index}"] [data-band-time="${field}"] input`)?.focus()
  return true
}

/** Follow the clicked value into its form; otherwise focus the first editable field. */
export function useFocusFirstField(ref: RefObject<HTMLElement | null>, initialFocus?: FormFocus) {
  const field = initialFocus?.field
  useEffect(() => {
    const editable = 'input:not([type="hidden"]):not([readonly]):not(:disabled), select:not(:disabled), textarea:not([readonly]):not(:disabled)'
    const target = (field && ref.current?.querySelector<HTMLElement>(`[name="${field}"]:not([type="hidden"]):not([readonly]):not(:disabled), [data-focus-field="${field}"] :is(${editable}, button:not(:disabled))`))
      || ref.current?.querySelector<HTMLElement>(editable)
    target?.focus()
    if (field && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.select()
  }, [ref, field])
}
