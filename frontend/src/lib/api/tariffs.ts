import type {
  PaginatedResponse,
  Tariff,
  TariffInput,
  TariffPeriod,
  TariffPeriodInput,
  TariffPreset,
} from '../../types/api'
import { api } from './client'

export async function fetchTariffs(): Promise<PaginatedResponse<Tariff>> {
  const { data } = await api.get<PaginatedResponse<Tariff>>('/tariffs/tariffs/')
  return data
}

export async function fetchTariffPeriods(): Promise<PaginatedResponse<TariffPeriod>> {
  const { data } = await api.get<PaginatedResponse<TariffPeriod>>('/tariffs/periods/')
  return data
}

export async function createTariff(payload: TariffInput): Promise<Tariff> {
  const { data } = await api.post<Tariff>('/tariffs/tariffs/', payload)
  return data
}

export async function updateTariff(id: string, payload: Partial<TariffInput>): Promise<Tariff> {
  const { data } = await api.patch<Tariff>(`/tariffs/tariffs/${id}/`, payload)
  return data
}

export async function deleteTariff(id: string): Promise<void> {
  await api.delete(`/tariffs/tariffs/${id}/`)
}

export async function createTariffPeriod(payload: TariffPeriodInput): Promise<TariffPeriod> {
  const { data } = await api.post<TariffPeriod>('/tariffs/periods/', payload)
  return data
}

export async function updateTariffPeriod(id: string, payload: Partial<TariffPeriodInput>): Promise<TariffPeriod> {
  const { data } = await api.patch<TariffPeriod>(`/tariffs/periods/${id}/`, payload)
  return data
}

export async function deleteTariffPeriod(id: string): Promise<void> {
  await api.delete(`/tariffs/periods/${id}/`)
}

export async function exportTariffs(zevId: string): Promise<TariffPreset[]> {
  const { data } = await api.get<TariffPreset[]>('/tariffs/tariffs/export/', {
    params: { zev_id: zevId },
  })
  return data
}

export async function importTariffs(zevId: string, tariffs: TariffPreset[]): Promise<{ created: number; tariffs: Tariff[] }> {
  const { data } = await api.post<{ created: number; tariffs: Tariff[] }>('/tariffs/tariffs/import/', {
    zev_id: zevId,
    tariffs,
  })
  return data
}
