import { useMutation, type QueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useState } from 'react'
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
import type { Tariff, TariffInput, TariffPeriod, TariffPeriodInput } from '../../types/api'

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  isDangerous: boolean
  onConfirm: () => void
}

type TariffCrudParams = {
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
}

export function resolvePeriodModalTariffId(bandableTariffs: Tariff[], tariffId?: string): string | undefined {
  return tariffId ?? bandableTariffs[0]?.id
}

export function useTariffCrud({
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
}: TariffCrudParams) {
  const { user } = useAuth()
  const { scope, isCurrent, assertWritable } = useWriteScope({ selectedZevId, canWrite, accountId: user?.id }, t('common.error'))
  const [editingTariffId, setEditingTariffId] = useState<string | null>(null)
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null)
  const [periodModalTariffId, setPeriodModalTariffId] = useState<string | undefined>(undefined)
  const [showTariffModal, setShowTariffModal] = useState(false)
  const [showPeriodModal, setShowPeriodModal] = useState(false)

  useLayoutEffect(() => {
    setShowTariffModal(false)
    setShowPeriodModal(false)
    setEditingTariffId(null)
    setEditingPeriodId(null)
    setPeriodModalTariffId(undefined)
  }, [scope])

  const editingTariff = useMemo(
    () => tariffs.find((tariff) => tariff.id === editingTariffId),
    [tariffs, editingTariffId],
  )

  const editingPeriod = useMemo(
    () => periods.find((period) => period.id === editingPeriodId),
    [periods, editingPeriodId],
  )

  const tariffMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id?: string; payload: TariffInput; scope: typeof scope }) => {
      assertWritable(submittingScope)
      if (id) {
        return updateTariff(id, payload)
      }
      return createTariff(payload)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      setEditingTariffId(null)
      setShowTariffModal(false)
      pushToast(
        variables.id ? t('pages.tariffs.messages.updated') : t('pages.tariffs.messages.created'),
        'success',
      )
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.saveFailed')), 'error')
    },
  })

  const deleteTariffMutation = useMutation({
    mutationFn: ({ id, scope: submittingScope }: { id: string; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return deleteTariff(id)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      pushToast(t('pages.tariffs.messages.deleted'), 'success')
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.deleteFailed')), 'error')
    },
  })

  const periodMutation = useMutation({
    mutationFn: ({ id, payload, scope: submittingScope }: { id?: string; payload: TariffPeriodInput; scope: typeof scope }) => {
      assertWritable(submittingScope)
      if (id) {
        return updateTariffPeriod(id, payload)
      }
      return createTariffPeriod(payload)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
      if (!isCurrent(variables.scope)) return
      setEditingPeriodId(null)
      setPeriodModalTariffId(undefined)
      setShowPeriodModal(false)
      pushToast(
        variables.id ? t('pages.tariffs.messages.periodUpdated') : t('pages.tariffs.messages.periodCreated'),
        'success',
      )
    },
    onError: (error, variables) => {
      if (isCurrent(variables.scope)) pushToast(formatApiError(error, t('pages.tariffs.messages.periodSaveFailed')), 'error')
    },
  })

  const deletePeriodMutation = useMutation({
    mutationFn: ({ id, scope: submittingScope }: { id: string; scope: typeof scope }) => {
      assertWritable(submittingScope)
      return deleteTariffPeriod(id)
    },
    onSuccess: (_, variables) => {
      invalidateTariffQueries(queryClient, variables.scope.selectedZevId)
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
    tariffMutation.mutate({ id: editingTariffId || undefined, payload: { ...payload, zev: selectedZevId }, scope })
  }

  function submitPeriod(payload: TariffPeriodInput) {
    if (!isCurrent(scope)) return
    if (!selectedZevId || !canWrite) {
      pushToast(t('pages.tariffs.messages.periodSaveFailed'), 'error')
      return
    }
    periodMutation.mutate({ id: editingPeriodId || undefined, payload, scope })
  }

  function startTariffEdit(tariff: Tariff) {
    setEditingTariffId(tariff.id)
    setShowTariffModal(true)
  }

  function startPeriodEdit(period: TariffPeriod) {
    setEditingPeriodId(period.id)
    setPeriodModalTariffId(period.tariff)
    setShowPeriodModal(true)
  }

  function openCreateTariffModal() {
    if (!selectedZevId) {
      pushToast(t('pages.tariffs.messages.selectZevBeforeCreate'), 'error')
      return
    }
    setEditingTariffId(null)
    setShowTariffModal(true)
  }

  function closeTariffModal() {
    setShowTariffModal(false)
    setEditingTariffId(null)
  }

  function openCreatePeriodModal(tariffId?: string) {
    const defaultTariffId = resolvePeriodModalTariffId(bandableTariffs, tariffId)

    if (!defaultTariffId) {
      pushToast(t('pages.tariffs.messages.createEnergyTariffFirst'), 'error')
      return
    }
    setEditingPeriodId(null)
    setPeriodModalTariffId(defaultTariffId)
    setShowPeriodModal(true)
  }

  function closePeriodModal() {
    setShowPeriodModal(false)
    setEditingPeriodId(null)
    setPeriodModalTariffId(undefined)
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
    showTariffModal,
    showPeriodModal,
    editingTariffId,
    editingPeriodId,
    periodModalTariffId,
    editingTariff,
    editingPeriod,
    tariffPending: tariffMutation.isPending,
    periodPending: periodMutation.isPending,
    deleteTariffPending: deleteTariffMutation.isPending,
    deletePeriodPending: deletePeriodMutation.isPending,
    submitTariff,
    submitPeriod,
    startTariffEdit,
    startPeriodEdit,
    openCreateTariffModal,
    closeTariffModal,
    openCreatePeriodModal,
    closePeriodModal,
    confirmDeleteTariff,
    confirmDeletePeriod,
  }
}
