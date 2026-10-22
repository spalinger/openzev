import { useLayoutEffect, useState } from 'react'
import type { TariffSeries, TariffVersion } from '../../types/api'
import { useEditingSession } from './useEditingSession'

export type VersionTask =
  | { kind: 'new-version'; series: TariffSeries; source: TariffVersion; validFrom?: string }
  | { kind: 'duplicate'; series: TariffSeries; source: TariffVersion }
  | { kind: 'rename'; series: TariffSeries; source: TariffVersion }

type Editor = VersionTask
  | { kind: 'create' }
  | { kind: 'edit'; tariffId: string }
  | { kind: 'period'; tariffId: string; periodId?: string }

/** One task owns the pane and its write session. */
export function useTariffEditor(scope: string) {
  const [task, setTask] = useState<Editor | null>(null)
  const session = useEditingSession(scope)
  useLayoutEffect(() => { setTask(null) }, [scope])

  function open(next: Editor | null) {
    session.start()
    setTask(next)
  }

  return { ...session, task, open, close: () => open(null) }
}

export type TariffEditing = ReturnType<typeof useTariffEditor>
