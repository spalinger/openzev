import { useLayoutEffect, useState } from 'react'
import type { TariffSeries, TariffVersion } from '../../types/api'
import { useEditingSession } from './useEditingSession'
import type { FormFocus } from './useFocusFirstField'

export type TariffEditField = 'valid_from' | 'valid_to' | 'fixed_price_chf' | 'notes' | 'split_key'
export type TariffPeriodEditField = 'price_chf_per_kwh' | 'percentage' | 'period_type' | 'time_from' | 'time_to'

export type VersionTask =
  | { kind: 'new-version'; series: TariffSeries; source: TariffVersion; validFrom?: string }
  | { kind: 'duplicate'; series: TariffSeries; source: TariffVersion }
  | { kind: 'rename'; series: TariffSeries; source: TariffVersion }

type Editor = VersionTask
  | { kind: 'create' }
  | { kind: 'edit'; tariffId: string; initialFocus?: FormFocus }
  | { kind: 'period'; tariffId: string; periodId?: string; initialFocus?: FormFocus }

/** One task owns the pane and its write session. */
export function useTariffEditor(scope: string) {
  const [task, setTask] = useState<(Editor & { sessionId: number }) | null>(null)
  const session = useEditingSession(scope)
  useLayoutEffect(() => { setTask(null) }, [scope])

  function open(next: Editor | null) {
    session.start()
    // A fresh task must reset its form even when it targets the same record.
    setTask(next ? { ...next, sessionId: session.id.current } : null)
  }

  return { ...session, task, open, close: () => open(null) }
}

export type TariffEditing = ReturnType<typeof useTariffEditor>
