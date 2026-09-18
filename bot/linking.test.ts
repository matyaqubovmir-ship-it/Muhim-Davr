import { describe, expect, it } from 'vitest'
import { createFakeStore } from './fake-store.ts'
import { LinkAttemptLimiter, MAX_FAILED_LINKS, handleStart, startArgument } from './linking.ts'
import { BOT } from './messages.ts'

describe('startArgument', () => {
  it.each([
    ['/start', ''],
    ['/start A3F91C', 'A3F91C'],
    ['/start   a3f 91c ', 'a3f 91c'],
    ['/start@MuhimDavr_bot A3F91C', 'A3F91C'],
  ])('reads %j as %j', (text, argument) => {
    expect(startArgument(text)).toBe(argument)
  })

  it.each(['A3F91C', 'start A3F91C', '/started', '/help', 'Salom'])('%j is not /start', (text) => {
    expect(startArgument(text)).toBe(null)
  })
})

describe('handleStart', () => {
  it('links the chat to the one active pregnancy with that code', async () => {
    const store = createFakeStore()
    store.pregnanciesByCode.set('A3F91C', ['preg-1'])
    const reply = await handleStart(store, new LinkAttemptLimiter(), 42, 'a3f 91c')
    expect(reply).toBe(BOT.linkOk)
    expect(store.channels.get(42)).toBe('preg-1')
  })

  it('re-points a chat that sends a second code, rather than following two women', async () => {
    const store = createFakeStore()
    store.pregnanciesByCode.set('AAAAAA', ['preg-1'])
    store.pregnanciesByCode.set('BBBBBB', ['preg-2'])
    const limiter = new LinkAttemptLimiter()
    await handleStart(store, limiter, 42, 'AAAAAA')
    await handleStart(store, limiter, 42, 'BBBBBB')
    expect(store.channels.get(42)).toBe('preg-2')
    expect(store.channels.size).toBe(1)
  })

  it('refuses an ambiguous code instead of guessing between two women', async () => {
    const store = createFakeStore()
    store.pregnanciesByCode.set('A3F91C', ['preg-1', 'preg-2'])
    expect(await handleStart(store, new LinkAttemptLimiter(), 42, 'A3F91C')).toBe(BOT.linkAmbiguous)
    expect(store.channels.size).toBe(0)
  })

  it('says so when no pregnancy has the code', async () => {
    const store = createFakeStore()
    expect(await handleStart(store, new LinkAttemptLimiter(), 42, 'A3F91C')).toBe(BOT.linkNotFound)
  })

  it('rejects a malformed code without a lookup', async () => {
    const store = createFakeStore()
    store.failing.add('findActivePregnancyIdsByCode')
    expect(await handleStart(store, new LinkAttemptLimiter(), 42, 'hello')).toBe(BOT.linkBadCode)
  })

  it('asks for the code on a bare /start, and gives help to a chat already linked', async () => {
    const store = createFakeStore()
    expect(await handleStart(store, new LinkAttemptLimiter(), 42, '')).toBe(BOT.startNoCode)
    store.channels.set(42, 'preg-1')
    expect(await handleStart(store, new LinkAttemptLimiter(), 42, '')).toBe(BOT.linkedHelp)
  })

  it('stops a chat guessing codes after too many misses, then forgives it', async () => {
    const store = createFakeStore()
    store.pregnanciesByCode.set('A3F91C', ['preg-1'])
    const limiter = new LinkAttemptLimiter()
    const start = 1_000_000

    for (let i = 0; i < MAX_FAILED_LINKS; i++) {
      expect(await handleStart(store, limiter, 42, '000000', start + i)).toBe(BOT.linkNotFound)
    }
    // Even the right code is refused while blocked.
    expect(await handleStart(store, limiter, 42, 'A3F91C', start + 10)).toBe(BOT.linkTooManyAttempts)
    // Another chat is unaffected.
    expect(await handleStart(store, limiter, 43, 'A3F91C', start + 10)).toBe(BOT.linkOk)
    // An hour later the chat may try again.
    expect(await handleStart(store, limiter, 42, 'A3F91C', start + 60 * 60 * 1000 + 10)).toBe(BOT.linkOk)
  })
})
