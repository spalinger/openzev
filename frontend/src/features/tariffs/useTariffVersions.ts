import { useMutation, type QueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useState } from 'react'
import { createTariffVersion, duplicateTariff, renameTariffSeries } from '../../lib/api/tariffs'
import { useAuth } from '../../lib/auth'
import { useWriteScope } from '../../lib/useWriteScope'
import { formatApiError } from '../../lib/api/errors'
import { invalidateTariffQueries } from './invalidate'
import type { TariffSeries, TariffVersion, TariffVersionInput } from '../../types/api'

/** Which dialog the versioning flow currently has open, and against what. */
export type VersionDialog =
  | { kind: 'new-version', series: TariffSeries, source: TariffVersion }
  | { kind: 'duplicate', series: TariffSeries, source: TariffVersion }
  | { kind: 'rename', series: TariffSeries, source: TariffVersion }
  | null

type Params = {
  selectedZevId?: string
  canWrite?: boolean
  queryClient: QueryClient
  pushToast: (message: string, tone?: 'success' | 'error') => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function useTariffVersions({ selectedZevId, canWrite = true, queryClient, pushToast, t }: Params) {
  const { user } = useAuth()
  const { scope, isCurrent, assertWritable } = useWriteScope({ selectedZevId, canWrite, accountId: user?.id }, t('common.error'))
  const [dialog, setDialog] = useState<VersionDialog>(null)

  useLayoutEffect(() => {
    setDialog(null)
  }, [scope])

  const newVersionMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id: string, payload: TariffVersionInput; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return createTariffVersion(id, payload)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.versionCreated'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.versionFailed')), 'error')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id: string, payload: TariffVersionInput & { name: string }; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return duplicateTariff(id, payload)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.duplicated'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.duplicateFailed')), 'error')
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name, scope: submittingScope }: { id: string, name: string; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return renameTariffSeries(id, name)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.renamed'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.renameFailed')), 'error')
    },
  })

  return {
    dialog,
    closeDialog: () => setDialog(null),
    openNewVersion: (series: TariffSeries, source: TariffVersion) =>
      setDialog({ kind: 'new-version', series, source }),
    openDuplicate: (series: TariffSeries, source: TariffVersion) =>
      setDialog({ kind: 'duplicate', series, source }),
    openRename: (series: TariffSeries, source: TariffVersion) =>
      setDialog({ kind: 'rename', series, source }),
    submitNewVersion: (id: string, payload: TariffVersionInput) => {
      if (canWrite && selectedZevId && isCurrent(scope)) newVersionMutation.mutate({ id, payload, scope })
    },
    submitDuplicate: (id: string, payload: TariffVersionInput & { name: string }) => {
      if (canWrite && selectedZevId && isCurrent(scope)) duplicateMutation.mutate({ id, payload, scope })
    },
    submitRename: (id: string, name: string) => {
      if (canWrite && selectedZevId && isCurrent(scope)) renameMutation.mutate({ id, name, scope })
    },
    isPending: newVersionMutation.isPending || duplicateMutation.isPending || renameMutation.isPending,
  }
}
