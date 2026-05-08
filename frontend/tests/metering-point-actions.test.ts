import { describe, expect, it } from 'vitest'
import { getScopedAndFilteredMeteringPoints } from '../src/features/meteringPoints/useMeteringPointActions'
import type { MeteringPoint } from '../src/types/api'

const meteringPoints = [
  {
    id: 'mp-1',
    zev: 'zev-1',
    meter_id: 'A-100',
    meter_type: 'consumption',
    is_active: true,
    location_description: 'Basement',
  },
  {
    id: 'mp-2',
    zev: 'zev-1',
    meter_id: 'B-200',
    meter_type: 'production',
    is_active: false,
    location_description: 'Roof',
  },
  {
    id: 'mp-3',
    zev: 'zev-2',
    meter_id: 'Solar-300',
    meter_type: 'bidirectional',
    is_active: true,
    location_description: 'Garage',
  },
] as MeteringPoint[]

describe('metering point action helpers', () => {
  it('scopes metering points to the selected ZEV when management is restricted', () => {
    const { scopedMeteringPoints } = getScopedAndFilteredMeteringPoints(meteringPoints, {
      selectedZevId: 'zev-1',
      canManageMeteringPoints: true,
      searchTerm: '',
      statusFilter: 'all',
      typeFilter: 'all',
    })

    expect(scopedMeteringPoints.map((point) => point.id)).toEqual(['mp-1', 'mp-2'])
  })

  it('filters by search term, status, and type', () => {
    const { meteringPoints: filteredMeteringPoints } = getScopedAndFilteredMeteringPoints(meteringPoints, {
      selectedZevId: null,
      canManageMeteringPoints: false,
      searchTerm: 'solar',
      statusFilter: 'active',
      typeFilter: 'bidirectional',
    })

    expect(filteredMeteringPoints).toHaveLength(1)
    expect(filteredMeteringPoints[0]).toMatchObject({
      id: 'mp-3',
      meter_id: 'Solar-300',
      meter_type: 'bidirectional',
      is_active: true,
    })
  })
})
