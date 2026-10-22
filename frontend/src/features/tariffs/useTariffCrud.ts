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
import { formatApiError } from '../../lib/api/errors'
import { invalidateTariffQueries } from './invalidate'
import type { TariffEditing } from './useTariffEditor'
import type { Tariff, TariffInput, TariffPeriod, TariffPeriodInput } from '../../types/api'

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  isDangerous: boolean
  onConfirm: () => void
}

type TariffCrudParams = {
  editing: TariffEditing
  selectedZevId?: string
  canWrite?: boolean
  tariffs: Tariff[]
  periods: TariffPeriod[]
  bandableTariffs: Tariff[]
  tariffNameById: Map<string, string>
  queryClient: QueryClient
  pushToast: (message: string, tone?: 'success' | 'error') => void
  confirm: (options: ConfirmOptions) => void
  t: (key: string, options?: Record<string, unknown>) => string
  /** A tariff was created or changed and its form closed: select what was saved. */
  onTariffSaved?: (saved: Tariff, kind: 'created' | 'updated') => void
  /** A band was saved and its form closed. */
  onPeriodSaved?: () => void
}

export function resolvePeriodTariffId(bandableTariffs: Tariff[], tariffId?: string): string | undefined {
  return tariffId ?? bandableTariffs[0]?.id
}

/** Tariff/band writes complete only for the submitting scope and task. */
export function useTariffCrud({
  editing,
  selectedZevId,
  canWrite = true,
  tariffs,
  periods,
  bandableTariffs,
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
    mutationFn: ({ id, payload, scope: submittingScope }: { id?: string; payload: TariffInput; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      if (id) {
        return updateTariff(id, payload)
      }
      return createTariff(payload)
    },
    onSuccess: async (saved, variables) => {
      // Selecting what was saved needs the series to contain it.
      await invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      pushToast(
        variables.id ? t('pages.tariffs.messages.updated') : saved.billing_mode === 'energy' && !saved.dynamic_source ? t('pages.tariffs.workspace.incomplete') : t('pages.tariffs.messages.created'),
        'success',
      )
      if (variables.session !== session.current) return
      editing.close()
      onTariffSaved?.(saved, variables.id ? 'updated' : 'created')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope) && variables.session === session.current) {
        setSaveError(formatApiError(error, t('pages.tariffs.messages.saveFailed')))
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
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.deleteFailed')), 'error')
    },
  })

  const periodMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id?: string; payload: TariffPeriodInput; scope: typeof scope; session: number }) => {
      assertWritable(submittingScope)
      if (id) {
        return updateTariffPeriod(id, payload)
      }
      return createTariffPeriod(payload)
    },
    onSuccess: async (_, variables) => {
      await invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      pushToast(
        variables.id ? t('pages.tariffs.messages.periodUpdated') : t('pages.tariffs.messages.periodCreated'),
        'success',
      )
      if (variables.session !== session.current) return
      editing.close()
      onPeriodSaved?.()
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope) && variables.session === session.current) {
        setSaveError(formatApiError(error, t('pages.tariffs.messages.periodSaveFailed')))
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
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.periodDeleteFailed')), 'error')
    },
  })

  function submitTariff(payload: TariffInput) {
    if (!isCurrent(scope)) return
    if (!selectedZevId || !canWrite) {
      pushToast(t('pages.tariffs.messages.selectZevBeforeSave'), 'error')
      return
    }
    setSaveError(null)
    tariffMutation.mutate({ id: editingTariffId || undefined, payload: { ...payload, zev: selectedZevId }, scope, session: session.current })
  }

  function submitPeriod(payload: TariffPeriodInput) {
    if (!isCurrent(scope)) return
    if (!selectedZevId || !canWrite) {
      pushToast(t('pages.tariffs.messages.periodSaveFailed'), 'error')
      return
    }
    setSaveError(null)
    periodMutation.mutate({ id: editingPeriodId || undefined, payload, scope, session: session.current })
  }

  function openCreateTariff() {
    if (!selectedZevId) {
      pushToast(t('pages.tariffs.messages.selectZevBeforeCreate'), 'error')
      return
    }
    editing.open({ kind: 'create' })
  }

  function openCreatePeriod(tariffId?: string) {
    const id = resolvePeriodTariffId(bandableTariffs, tariffId)
    if (!id) {
      pushToast(t('pages.tariffs.messages.createEnergyTariffFirst'), 'error')
      return
    }
    editing.open({ kind: 'period', tariffId: id })
  }

  function confirmDeleteTariff(tariff: Tariff) {
    confirm({
      title: t('pages.tariffs.deleteTitle'),
      message: t('pages.tariffs.deleteMessage', { name: tariff.name }),
      confirmText: t('pages.tariffs.deleteConfirm'),
      isDangerous: true,
      onConfirm: () => {
        if (scope.canWrite && isCurrent(scope)) deleteTariffMutation.mutate({ id: tariff.id, scope })
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
        if (scope.canWrite && isCurrent(scope)) deletePeriodMutation.mutate({ id: period.id, scope })
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
    tariffPending: tariffMutation.isPending,
    periodPending: periodMutation.isPending,
    deleteTariffPending: deleteTariffMutation.isPending,
    deletePeriodPending: deletePeriodMutation.isPending,
    submitTariff,
    submitPeriod,
    startTariffEdit: (tariff: Tariff) => editing.open({ kind: 'edit', tariffId: tariff.id }),
    startPeriodEdit: (period: TariffPeriod) => editing.open({ kind: 'period', tariffId: period.tariff, periodId: period.id }),
    openCreateTariff,
    closeTariffForm: editing.close,
    openCreatePeriod,
    confirmDeleteTariff,
    confirmDeletePeriod,
  }
}
