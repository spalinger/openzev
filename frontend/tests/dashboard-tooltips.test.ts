import { describe, expect, it } from 'vitest'
import { formatProductionMixTooltip } from '../src/lib/dashboardTooltips'
describe('formatProductionMixTooltip', () => {
  it('formats the rate as percent when dataKey matches, even with a translated series name', () => {
    expect(
      formatProductionMixTooltip(45.25, 'Eigenverbrauch %', 'self_consumption_rate', 'Eigenverbrauch %'),
    ).toEqual(['45.3\u00a0%', 'Eigenverbrauch %'])
  })

  it('formats kWh series and keeps the passed series name', () => {
    expect(
      formatProductionMixTooltip(1234.56, 'Exportiert', 'exported_kwh', 'Eigenverbrauch %'),
    ).toEqual(['1234.56 kWh', 'Exportiert'])
  })

  it('formats small kWh buckets with two decimals', () => {
    expect(
      formatProductionMixTooltip(0.25, 'From grid', 'imported_kwh', 'Self-consumed %'),
    ).toEqual(['0.25 kWh', 'From grid'])
  })
})
