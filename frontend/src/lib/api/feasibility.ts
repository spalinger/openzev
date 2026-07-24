import type { FeasibilityInput, FeasibilityResult } from '../../types/api'
import { api } from './client'

export async function calculateFeasibility(payload: FeasibilityInput): Promise<FeasibilityResult> {
  const { data } = await api.post<FeasibilityResult>('/feasibility/calculate/', payload)
  return data
}
