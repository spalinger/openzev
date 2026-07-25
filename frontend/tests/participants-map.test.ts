import { describe, expect, it } from 'vitest'
import {
  countMissingBbox,
  groupParticipantsByBuilding,
  type ParticipantMapEntry,
} from '../src/features/participants/ParticipantsMap'

const footprintA = {
  type: 'Polygon' as const,
  coordinates: [[[8.54, 47.36], [8.541, 47.36], [8.5405, 47.3605], [8.54, 47.36]]],
}
const footprintB = {
  type: 'Polygon' as const,
  coordinates: [[[7.4, 46.9], [7.401, 46.9], [7.4005, 46.9005], [7.4, 46.9]]],
}

describe('groupParticipantsByBuilding', () => {
  it('groups participants that share the exact same building footprint into one entry', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Anna', address: 'Main St 1, 8000 Zurich', buildingFootprint: footprintA },
      { id: '2', displayName: 'Ben', address: 'Main St 1, 8000 Zurich', buildingFootprint: footprintA },
    ]

    const groups = groupParticipantsByBuilding(entries)

    expect(groups).toHaveLength(1)
    expect(groups[0].participants.map((p) => p.id)).toEqual(['1', '2'])
  })

  it('keeps participants at different buildings in separate groups', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Anna', address: 'Main St 1, 8000 Zurich', buildingFootprint: footprintA },
      { id: '2', displayName: 'Clara', address: 'Other St 2, 3000 Bern', buildingFootprint: footprintB },
    ]

    const groups = groupParticipantsByBuilding(entries)

    expect(groups).toHaveLength(2)
  })

  it('omits participants without a footprint entirely', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Anna', address: 'Main St 1, 8000 Zurich', buildingFootprint: footprintA },
      { id: '2', displayName: 'Dora', address: 'Unknown', buildingFootprint: null },
      { id: '3', displayName: 'Eve', address: 'Also unknown' },
    ]

    const groups = groupParticipantsByBuilding(entries)

    expect(groups).toHaveLength(1)
    expect(groups[0].participants.map((p) => p.id)).toEqual(['1'])
  })

  it('returns no groups when nothing is geocoded', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Dora', address: 'Unknown', buildingFootprint: null },
    ]

    expect(groupParticipantsByBuilding(entries)).toEqual([])
  })
})

describe('countMissingBbox', () => {
  it('counts participants with no footprint (null or undefined)', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Anna', address: 'a', buildingFootprint: footprintA },
      { id: '2', displayName: 'Dora', address: 'b', buildingFootprint: null },
      { id: '3', displayName: 'Eve', address: 'c' },
    ]

    expect(countMissingBbox(entries)).toBe(2)
  })

  it('is zero when every participant is geocoded', () => {
    const entries: ParticipantMapEntry[] = [
      { id: '1', displayName: 'Anna', address: 'a', buildingFootprint: footprintA },
    ]

    expect(countMissingBbox(entries)).toBe(0)
  })
})
