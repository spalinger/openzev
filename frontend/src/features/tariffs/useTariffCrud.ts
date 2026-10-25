import { useMutation, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  createTariff,
  createTariffPeriod,
  deleteTariff,
  deleteTariffPeriod,
  updateTariff,
  updateTariffPeriod,
} from '../../lib/api/tariffs'
import { useAuth } from '../../lib/auth'
import { useWriteScope } from '../../lib/useWriteScope'
import { formatTariffError } from './errors'
import { invalidateTariffQueries } from './invalidate'
import type { TariffEditing, TariffEditField, TariffPeriodEditField } from './useTariffEditor'
import type { AppSettings, Tariff, TariffInput, TariffPeriod, TariffPeriodInput, TariffVersion } from '../../types/api'

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  isDangerous: boolean
  onConfirm: () => void
}

type TariffCrudParams = {
  editing: TariffEditing
  settings?: AppSettings
  selectedZevId?: string
  canWrite?: boolean
  tariffs: TariffVersion[]
  periods: TariffPeriod[]
  tariffNameById: Map<string, string>
  queryClient: QueryClient
  pushToast: (message: string, tone?: 'success' | 'error') => void
  confirm: (options: ConfirmOptions) => void
  t: (key: string, options?: Record<string, unknown>) => string
  /** A tariff was created or changed and its form closed: select what was saved. */
  onTariffSaved?: (saved: Tariff, kind: 'created' | 'updated') => void
  /** A band was saved and its form closed. */
  onPeriodSaved?: (tariffId: string) => void
}

/** Tariff/band writes complete only for the submitting scope and task. */
export function useTariffCrud({
  editing,
  settings,
  selectedZevId,
  canWrite = true,
  tariffs,
  periods,
  tariffNameById,
  queryClient,
  pushToast,
  confirm,
  t,
  onTariffSaved,
  onPeriodSaved,
}: TariffCrudParams) {
  const { user } = useAuth()
  const { scope, isCurrent, assertWritable } = useWriteScope({ selectedZevId, canWrite, accountId: user?.id }, t('common.error'))
  const { task, id: session, setError: setSaveError, error: saveError } = editing
  const taskSession = task?.sessionId
  const tariffFormOpen = task?.kind === 'create' || task?.kind === 'edit'
  const periodFormOpen = task?.kind === 'period'
  const editingTariffId = task?.kind === 'edit' ? task.tariffId : null
  const editingPeriodId = task?.kind === 'period' ? task.periodId ?? null : null
  const periodTariffId = task?.kind === 'period' ? task.tariffId : undefined

  const editingTariff = useMemo(
    () => tariffs.find((tariff) => tariff.id === editingTariffId),
    [tariffs, editingTariffId],
  )

  const editingPeriod = useMemo(
    () => periods.find((period) => period.id === editingPeriodId),
    [periods, editingPeriodId],
  )

  const tariffMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope, session: submittingSession }: { id?: string; payload: TariffInput; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      if (!editing.isCurrent(submittingSession)) throw new Error(t('common.error'))
      if (id) {
        return updateTariff(id, payload)
      }
      return createTariff(payload)
    },
    onSuccess: async (saved, variables) => {
      // Refresh before selection; retain the saved URL if refresh fails.
      await invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope) || variables.session !== session.current) return
      pushToast(
        t(variables.id ? 'pages.tariffs.messages.updated' : 'pages.tariffs.messages.created'),
        'success',
      )
      editing.close()
      onTariffSaved?.(saved, variables.id ? 'updated' : 'created')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope) && variables.session === session.current) {
        setSaveError(formatTariffError(error, t('pages.tariffs.messages.saveFailed'), t, settings))
      }
    },
  })

  const deleteTariffMutation = useMutation({
    mutationFn: ({ id, scope: submittingScope }: { id: string; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return deleteTariff(id)
    },
    onSuccess: (_, variables) => {
      void invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      pushToast(t('pages.tariffs.messages.deleted'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatTariffError(error, t('pages.tariffs.messages.deleteFailed'), t, settings), 'error')
    },
  })

  const periodMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope, session: submittingSession }: { id?: string; payload: TariffPeriodInput; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      if (!editing.isCurrent(submittingSession)) throw new Error(t('common.error'))
      if (id) {
        return updateTariffPeriod(id, payload)
      }
      return createTariffPeriod(payload)
    },
    onSuccess: async (_, variables) => {
      await invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope) || variables.session !== session.current) return
      pushToast(
        variables.id ? t('pages.tariffs.messages.periodUpdated') : t('pages.tariffs.messages.periodCreated'),
        'success',
      )
      editing.close()
      onPeriodSaved?.(variables.payload.tariff)
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope) && variables.session === session.current) {
        setSaveError(formatTariffError(error, t('pages.tariffs.messages.periodSaveFailed'), t, settings))
      }
    },
  })

  const deletePeriodMutation = useMutation({
    mutationFn: ({ id, scope: submittingScope }: { id: string; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return deleteTariffPeriod(id)
    },
    onSuccess: (_, variables) => {
      void invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      pushToast(t('pages.tariffs.messages.periodDeleted'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatTariffError(error, t('pages.tariffs.messages.periodDeleteFailed'), t, settings), 'error')
    },
  })

  function submitTariff(payload: TariffInput) {
    if (!tariffFormOpen || taskSession === undefined || !editing.isCurrent(taskSession) || !isCurrent(scope)) return
    if (!selectedZevId || !canWrite) {
      pushToast(t('pages.tariffs.messages.selectZevBeforeSave'), 'error')
      return
    }
    setSaveError(null)
    tariffMutation.mutate({ id: editingTariffId || undefined, payload: { ...payload, zev: selectedZevId }, scope, session: taskSession })
  }

  function submitPeriod(payload: TariffPeriodInput) {
    if (!periodFormOpen || taskSession === undefined || !editing.isCurrent(taskSession) || !isCurrent(scope)) return
    if (!selectedZevId || !canWrite) {
      pushToast(t('pages.tariffs.messages.periodSaveFailed'), 'error')
      return
    }
    setSaveError(null)
    periodMutation.mutate({ id: editingPeriodId || undefined, payload, scope, session: taskSession })
  }

  function openCreateTariff() {
    if (!selectedZevId) {
      pushToast(t('pages.tariffs.messages.selectZevBeforeCreate'), 'error')
      return
    }
    editing.open({ kind: 'create' })
  }

  function openCreatePeriod(tariffId: string) {
    if (!tariffs.some(tariff => tariff.id === tariffId)) {
      pushToast(t('pages.tariffs.messages.createEnergyTariffFirst'), 'error')
      return
    }
    editing.open({ kind: 'period', tariffId })
  }

  function closeDeletedOwner(tariffId: string) {
    if (task && (('tariffId' in task && task.tariffId === tariffId) || ('source' in task && task.source.id === tariffId))) editing.close()
  }

  function confirmDeleteTariff(tariff: Tariff) {
    confirm({
      title: t('pages.tariffs.deleteTitle'),
      message: t('pages.tariffs.deleteMessage', { name: tariff.name }),
      confirmText: t('pages.tariffs.deleteConfirm'),
      isDangerous: true,
      onConfirm: () => {
        if (scope.canWrite && isCurrent(scope)) {
          closeDeletedOwner(tariff.id)
          deleteTariffMutation.mutate({ id: tariff.id, scope })
        }
      },
    })
  }

  function confirmDeletePeriod(period: TariffPeriod) {
    confirm({
      title: t('pages.tariffs.deletePeriodTitle'),
      message: t('pages.tariffs.deletePeriodMessage', { name: tariffNameById.get(period.tariff) ?? period.tariff }),
      confirmText: t('pages.tariffs.deletePeriodConfirm'),
      isDangerous: true,
      onConfirm: () => {
        if (scope.canWrite && isCurrent(scope)) {
          closeDeletedOwner(period.tariff)
          deletePeriodMutation.mutate({ id: period.id, scope })
        }
      },
    })
  }

  return {
    tariffFormOpen,
    periodFormOpen,
    editingTariffId,
    editingPeriodId,
    periodTariffId,
    editingTariff,
    editingPeriod,
    saveError,
    tariffPending: tariffMutation.isPending && tariffMutation.variables?.session === taskSession,
    periodPending: periodMutation.isPending && periodMutation.variables?.session === taskSession,
    deleteTariffPending: deleteTariffMutation.isPending,
    deletePeriodPending: deletePeriodMutation.isPending,
    submitTariff,
    submitPeriod,
    startTariffEdit: (tariff: Tariff, field?: TariffEditField) => editing.open({ kind: 'edit', tariffId: tariff.id, initialFocus: field ? { field } : undefined }),
    startPeriodEdit: (period: TariffPeriod, field?: TariffPeriodEditField) => editing.open({ kind: 'period', tariffId: period.tariff, periodId: period.id, initialFocus: field ? { field } : undefined }),
    openCreateTariff,
    closeTariffForm: editing.close,
    openCreatePeriod,
    confirmDeleteTariff,
    confirmDeletePeriod,
  }
}
