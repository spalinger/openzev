import type { FeasibilityInput, FeasibilityPrefill, FeasibilityResult } from '../../types/api'
import { api } from './client'

export async function calculateFeasibility(payload: FeasibilityInput): Promise<FeasibilityResult> {
  const { data } = await api.post<FeasibilityResult>('/feasibility/calculate/', payload)
  return data
}

export async function fetchFeasibilityPrefill(zevId: string): Promise<FeasibilityPrefill> {
  const { data } = await api.get<FeasibilityPrefill>(`/feasibility/prefill/${zevId}/`)
  return data
}
