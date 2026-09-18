import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { OFFSET_MAX_AGE_MS, botIdOf, readOffset, resumeOffset, writeOffset } from './offset.ts'

const NOW = Date.UTC(2026, 8, 18, 9, 0)
const BOT_ID = '8000000001'

describe('resumeOffset', () => {
  it('resumes a recent offset saved by this bot', () => {
    expect(resumeOffset({ botId: BOT_ID, offset: 4242, savedAt: NOW - 60_000 }, BOT_ID, NOW)).toBe(4242)
  })

  it('ignores an offset saved by another bot — its ids are unrelated', () => {
    expect(resumeOffset({ botId: '9', offset: 4242, savedAt: NOW }, BOT_ID, NOW)).toBe(0)
  })

  it('ignores an offset older than Telegram keeps updates', () => {
    expect(resumeOffset({ botId: BOT_ID, offset: 4242, savedAt: NOW - OFFSET_MAX_AGE_MS - 1 }, BOT_ID, NOW)).toBe(0)
  })

  it('ignores anything malformed, including a save from the future', () => {
    expect(resumeOffset(null, BOT_ID, NOW)).toBe(0)
    expect(resumeOffset('4242', BOT_ID, NOW)).toBe(0)
    expect(resumeOffset({ botId: BOT_ID, offset: -1, savedAt: NOW }, BOT_ID, NOW)).toBe(0)
    expect(resumeOffset({ botId: BOT_ID, offset: 1.5, savedAt: NOW }, BOT_ID, NOW)).toBe(0)
    expect(resumeOffset({ botId: BOT_ID, offset: 10, savedAt: NOW + 60_000 }, BOT_ID, NOW)).toBe(0)
  })
})

describe('reading and writing the file', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })
  const fileIn = () => {
    dir = mkdtempSync(join(tmpdir(), 'bot-offset-'))
    return pathToFileURL(join(dir, 'offset.json'))
  }

  it('round-trips', () => {
    const file = fileIn()
    writeOffset(BOT_ID, 77, NOW, file)
    expect(readOffset(BOT_ID, NOW + 1000, file)).toBe(77)
  })

  it('starts from zero with no file, or a torn one', () => {
    const file = fileIn()
    expect(readOffset(BOT_ID, NOW, file)).toBe(0)
    writeFileSync(file, '{"botId":"80')
    expect(readOffset(BOT_ID, NOW, file)).toBe(0)
  })
})

describe('botIdOf', () => {
  it('takes the part before the colon', () => {
    expect(botIdOf('8000000001:AAE-secret')).toBe('8000000001')
  })
})
