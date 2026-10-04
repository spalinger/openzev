import { useMutation, type QueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createTariffVersion, duplicateTariff, renameTariffSeries } from '../../lib/api/tariffs'
import { useAuth } from '../../lib/auth'
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
  const scope = useMemo(() => ({ selectedZevId, canWrite, accountId: user?.id }), [selectedZevId, canWrite, user?.id])
  const currentScope = useRef<typeof scope | null>(scope)
  const [dialog, setDialog] = useState<VersionDialog>(null)

  useLayoutEffect(() => {
    currentScope.current = scope
    setDialog(null)
    return () => { currentScope.current = null }
  }, [scope])

  const newVersionMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string, payload: TariffVersionInput; scope: typeof scope }) =>
      createTariffVersion(id, payload),
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (currentScope.current !== variables.scope) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.versionCreated'), 'success')
    },
    onError: (error, variables) => {
      if (currentScope.current === variables.scope) pushToast(formatApiError(error, t('pages.tariffs.messages.versionFailed')), 'error')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string, payload: TariffVersionInput & { name: string }; scope: typeof scope }) =>
      duplicateTariff(id, payload),
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (currentScope.current !== variables.scope) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.duplicated'), 'success')
    },
    onError: (error, variables) => {
      if (currentScope.current === variables.scope) pushToast(formatApiError(error, t('pages.tariffs.messages.duplicateFailed')), 'error')
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string, name: string; scope: typeof scope }) => renameTariffSeries(id, name),
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (currentScope.current !== variables.scope) return
      setDialog(null)
      pushToast(t('pages.tariffs.messages.renamed'), 'success')
    },
    onError: (error, variables) => {
      if (currentScope.current === variables.scope) pushToast(formatApiError(error, t('pages.tariffs.messages.renameFailed')), 'error')
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
      if (canWrite) newVersionMutation.mutate({ id, payload, scope })
    },
    submitDuplicate: (id: string, payload: TariffVersionInput & { name: string }) => {
      if (canWrite) duplicateMutation.mutate({ id, payload, scope })
    },
    submitRename: (id: string, name: string) => {
      if (canWrite) renameMutation.mutate({ id, name, scope })
    },
    isPending: newVersionMutation.isPending || duplicateMutation.isPending || renameMutation.isPending,
  }
}
