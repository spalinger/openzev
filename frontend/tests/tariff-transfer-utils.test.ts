import { describe, expect, it } from 'vitest'
import { parseTariffImportContent } from '../src/features/tariffs/useTariffTransfer'

describe('parseTariffImportContent', () => {
  it('returns parsed tariffs when json contains an array', () => {
    const parsed = parseTariffImportContent('[{"name":"Energy"}]')

    expect(parsed).toEqual([{ name: 'Energy' }])
  })

  it('throws an invalid format error when json is not an array', () => {
    expect(() => parseTariffImportContent('{"name":"Energy"}')).toThrow('INVALID_IMPORT_FORMAT_ERROR')
  })

  it('throws a syntax error for malformed json', () => {
    expect(() => parseTariffImportContent('{')).toThrow()
  })
})
