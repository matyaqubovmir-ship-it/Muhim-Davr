import { describe, expect, it } from 'vitest'
import { asksAboutMedicine } from './medicine.ts'

describe('asksAboutMedicine', () => {
  it.each([
    'Qaysi dorini ichsam bo‘ladi?',
    "qaysi dorini ichay",
    'Aspirinni ichishni davom ettiraymi?',
    'Temir tabletkasini ichyapman, to‘g‘rimi?',
    'Paratsetamol ichsa bo‘ladimi?',
    'Vitamin ichaymi',
    'ukol qilish kerakmi',
    'Og‘riq qoldiruvchi ichsam maylimi',
    "Og'riq qoldiruvchi ichsam maylimi", // ASCII apostrophe
    'Қайси дорини ичсам бўлади?', // Cyrillic Uzbek
    'Какое лекарство можно?', // Russian
    'Аспирин ичай ми?',
  ])('recognises %j', (text) => {
    expect(asksAboutMedicine(text)).toBe(true)
  })

  it.each([
    'Boshim og‘riyapti',
    'Qon ketyapti',
    'Bugun o‘zimni yaxshi his qilmayapman',
    'Bosim 130/85',
    'Qornim og‘riyapti, isitmam bor',
    'Doimo charchayman', // starts like "dori" but is not
  ])('does not fire on %j', (text) => {
    expect(asksAboutMedicine(text)).toBe(false)
  })
})
