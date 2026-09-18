import { describe, expect, it } from 'vitest'
import { splitExtraction } from './extract.ts'

describe('splitExtraction', () => {
  it('keeps the three states of each known sign', () => {
    const { signs } = splitExtraction({
      vaginal_bleeding: false,
      convulsions: true,
      fever: null,
    })
    expect(signs).toEqual({ vaginal_bleeding: false, convulsions: true, fever: null })
  })

  it('drops unknown keys and values that are not a state', () => {
    const { signs } = splitExtraction({ made_up_sign: true, fever: 'true', convulsions: 1 })
    expect(signs).toEqual({})
  })

  it('returns a complete reading as a pair', () => {
    expect(splitExtraction({ bp_systolic: 142, bp_diastolic: 91 }).bp).toEqual({
      systolic: 142,
      diastolic: 91,
    })
  })

  it('drops half a reading, as the schema would', () => {
    expect(splitExtraction({ bp_systolic: 142, bp_diastolic: null }).bp).toBe(null)
    expect(splitExtraction({ bp_systolic: null, bp_diastolic: 91 }).bp).toBe(null)
  })

  it('drops a reading outside the range the schema accepts', () => {
    expect(splitExtraction({ bp_systolic: 1420, bp_diastolic: 91 }).bp).toBe(null)
    expect(splitExtraction({ bp_systolic: 142, bp_diastolic: 9 }).bp).toBe(null)
  })

  it('rounds a fractional reading to the integer the column holds', () => {
    expect(splitExtraction({ bp_systolic: 120.4, bp_diastolic: 79.6 }).bp).toEqual({
      systolic: 120,
      diastolic: 80,
    })
  })
})
