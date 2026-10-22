import { useMutation, type QueryClient } from '@tanstack/react-query'
import { createTariffVersion, duplicateTariff, renameTariffSeries } from '../../lib/api/tariffs'
import { useAuth } from '../../lib/auth'
import { useWriteScope } from '../../lib/useWriteScope'
import { formatTariffError } from './errors'
import { invalidateTariffQueries } from './invalidate'
import type { Tariff, TariffSeries, TariffVersion, TariffVersionInput } from '../../types/api'

import type { TariffEditing, VersionTask } from './useTariffEditor'

export type VersionDialog = VersionTask | null

type Params = {
  editing: TariffEditing
  selectedZevId?: string
  canWrite?: boolean
  queryClient: QueryClient
  pushToast: (message: string, tone?: 'success' | 'error') => void
  t: (key: string, options?: Record<string, unknown>) => string
  /** The task finished and its form closed: select the version or tariff it produced. */
  onSaved?: (saved: Tariff, kind: 'new-version' | 'duplicate' | 'rename') => void
}

export function useTariffVersions({ editing, selectedZevId, canWrite = true, queryClient, pushToast, t, onSaved }: Params) {
  const { user } = useAuth()
  const { scope, isCurrent, assertWritable } = useWriteScope({ selectedZevId, canWrite, accountId: user?.id }, t('common.error'))
  const { task, id: session, setError: setSaveError, error: saveError } = editing
  const dialog = task?.kind === 'new-version' || task?.kind === 'duplicate' || task?.kind === 'rename' ? task : null

  type Submitted = { scope: typeof scope; session: number }

  async function complete(kind: 'new-version' | 'duplicate' | 'rename', message: string, saved: Tariff, variables: Submitted) {
    // Selecting what was saved needs the series to contain it.
    await invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
    if (!isCurrent(variables.scope)) return
    pushToast(message, 'success')
    if (variables.session !== session.current) return
    editing.close()
    onSaved?.(saved, kind)
  }

  function failed(message: string, error: unknown, variables: Submitted) {
    if (isCurrent(variables.scope) && variables.session === session.current) {
      setSaveError(formatTariffError(error, message, t))
    }
  }

  const newVersionMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id: string, payload: TariffVersionInput; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      return createTariffVersion(id, payload)
    },
    onSuccess: (saved, variables) => complete('new-version', t('pages.tariffs.messages.versionCreated'), saved, variables),
    onError: (error, variables) => failed(t('pages.tariffs.messages.versionFailed'), error, variables),
  })

  const duplicateMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id: string, payload: TariffVersionInput & { name: string }; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      return duplicateTariff(id, payload)
    },
    onSuccess: (saved, variables) => complete('duplicate', t('pages.tariffs.messages.duplicated'), saved, variables),
    onError: (error, variables) => failed(t('pages.tariffs.messages.duplicateFailed'), error, variables),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name, scope: submittingScope }: { id: string, name: string; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      return renameTariffSeries(id, name)
    },
    onSuccess: (saved, variables) => complete('rename', t('pages.tariffs.messages.renamed'), saved, variables),
    onError: (error, variables) => failed(t('pages.tariffs.messages.renameFailed'), error, variables),
  })

  return {
    dialog,
    saveError,
    closeDialog: editing.close,
    openNewVersion: (series: TariffSeries, source: TariffVersion, validFrom?: string) => editing.open({ kind: 'new-version', series, source, validFrom }),
    openDuplicate: (series: TariffSeries, source: TariffVersion) => editing.open({ kind: 'duplicate', series, source }),
    openRename: (series: TariffSeries, source: TariffVersion) => editing.open({ kind: 'rename', series, source }),
    submitNewVersion: (id: string, payload: TariffVersionInput) => {
      if (canWrite && selectedZevId && isCurrent(scope)) {
        setSaveError(null)
        newVersionMutation.mutate({ id, payload, scope, session: session.current })
      }
    },
    submitDuplicate: (id: string, payload: TariffVersionInput & { name: string }) => {
      if (canWrite && selectedZevId && isCurrent(scope)) {
        setSaveError(null)
        duplicateMutation.mutate({ id, payload, scope, session: session.current })
      }
    },
    submitRename: (id: string, name: string) => {
      if (canWrite && selectedZevId && isCurrent(scope)) {
        setSaveError(null)
        renameMutation.mutate({ id, name, scope, session: session.current })
      }
    },
    isPending: newVersionMutation.isPending || duplicateMutation.isPending || renameMutation.isPending,
  }
}
