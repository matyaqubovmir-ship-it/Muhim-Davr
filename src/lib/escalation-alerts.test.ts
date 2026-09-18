import { describe, expect, it } from 'vitest'
import { MAX_TOASTS, pushToast, toastFromChange, type EscalationToast } from './escalation-alerts'
import { ROLE_TABS, homeFor, readStoredRole } from './role'

describe('toastFromChange', () => {
  const row = { id: 'e-1', status: 'ochiq', source: 'telegram', reason: 'Bemor Telegram orqali…' }

  it('toasts a newly raised open escalation', () => {
    expect(toastFromChange({ event: 'INSERT', row })).toEqual({
      id: 'e-1',
      reason: 'Bemor Telegram orqali…',
      source: 'telegram',
    })
  })

  it('does not toast an update — acknowledging one is not a new alarm', () => {
    expect(toastFromChange({ event: 'UPDATE', row })).toBe(null)
  })

  it('does not toast a row that is not open, or a catch-up re-read', () => {
    expect(toastFromChange({ event: 'INSERT', row: { ...row, status: 'bekor' } })).toBe(null)
    expect(toastFromChange(null)).toBe(null)
  })

  it('treats any source it does not know as the clinic', () => {
    expect(toastFromChange({ event: 'INSERT', row: { ...row, source: undefined } })?.source).toBe('clinic')
  })
})

describe('pushToast', () => {
  const toast = (id: string): EscalationToast => ({ id, reason: id, source: 'clinic' })

  it('puts the newest first and keeps at most MAX_TOASTS', () => {
    let list: EscalationToast[] = []
    for (const id of ['a', 'b', 'c', 'd']) list = pushToast(list, toast(id))
    expect(list.map((t) => t.id)).toEqual(['d', 'c', 'b'].slice(0, MAX_TOASTS))
  })

  it('never shows the same escalation twice', () => {
    expect(pushToast([toast('a'), toast('b')], toast('a')).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('the demo role switch', () => {
  it('gives the midwife her forms and the specialist the registry and queue', () => {
    expect(ROLE_TABS.midwife).toEqual(['entry', 'new_patient', 'visits'])
    expect(ROLE_TABS.specialist).toEqual(['dashboard', 'registry', 'escalations', 'visits', 'patients'])
    expect(homeFor('specialist')).toEqual({ name: 'dashboard' })
    expect(homeFor('midwife')).toEqual({ name: 'entry' })
  })

  it('falls back to midwife when storage cannot be read', () => {
    expect(readStoredRole()).toBe('midwife')
  })
})
