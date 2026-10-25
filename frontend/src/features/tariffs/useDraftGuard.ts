import { useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react'
import { useBlocker } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  cancelText: string
  isDangerous: boolean
  onConfirm: () => void
  onCancel: () => void
}

type DraftGuardParams = {
  /** The open form has unsaved changes. */
  dirty: boolean
  /** A save is in flight: leaving does not stop it. */
  saving: boolean
  confirm: (options: ConfirmOptions) => void
  /** Raised while the page performs a navigation of its own, which must not be asked about. */
  bypass: RefObject<boolean>
}

/** Let `change` navigate without the guard asking; the guard resumes right after. */
export function allowNavigation(bypass: RefObject<boolean>, change: () => void) {
  bypass.current = true
  try {
    change()
  } finally {
    queueMicrotask(() => { bypass.current = false })
  }
}

export function useDiscardConfirmation(confirm: DraftGuardParams['confirm']) {
  const { t } = useTranslation()
  return (saving: boolean, onDiscard: () => void, onStay?: () => void) => confirm({
    title: t('common.unsavedChanges.title'),
    message: t(saving ? 'common.unsavedChanges.messageSaving' : 'common.unsavedChanges.message'),
    confirmText: t(saving ? 'common.unsavedChanges.leave' : 'common.unsavedChanges.discard'),
    cancelText: t('common.unsavedChanges.keepEditing'),
    isDangerous: true,
    onConfirm: onDiscard,
    onCancel: () => onStay?.(),
  })
}

/** Protect action, router and browser exits from unsaved or in-flight edits. */
export function useDraftGuard({ dirty, saving, confirm, bypass }: DraftGuardParams) {
  const askDiscard = useDiscardConfirmation(confirm)
  const active = dirty || saving
  const activeRef = useRef(active)
  const savingRef = useRef(saving)

  useLayoutEffect(() => {
    activeRef.current = active
    savingRef.current = saving
  }, [active, saving])

  function ask(onDiscard: () => void, onStay?: () => void) {
    askDiscard(savingRef.current, () => allowNavigation(bypass, onDiscard), onStay)
  }

  /** Run `action` now, or once the user has agreed to discard the draft. */
  function run(action: () => void) {
    if (activeRef.current) ask(action)
    else allowNavigation(bypass, action)
  }

  const blocker = useBlocker(() => activeRef.current && !bypass.current)
  const askNavigation = useEffectEvent(() => {
    if (blocker.state === 'blocked') ask(() => blocker.proceed(), () => blocker.reset())
  })
  // A later blocked POP has a new continuation even if React batches the reset.
  useEffect(() => { askNavigation() }, [blocker])

  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  return { run, active }
}
