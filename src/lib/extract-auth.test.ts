/**
 * The extraction endpoint spends the Anthropic key, so it must only answer the
 * app's own sessions, and must refuse oversized text.
 */

import { describe, expect, it, vi } from 'vitest'
import handler, { MAX_TEXT_LENGTH, handleExtract, verifySession } from '../../api/extract'
import { extractFields } from './extract-client'

const ENV = { VITE_SUPABASE_URL: 'https://example.supabase.co/', VITE_SUPABASE_ANON_KEY: 'anon' }

function fakeFetch(status: number) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status }))
}

describe('verifySession', () => {
  it('accepts a bearer token Supabase recognises, asking Supabase itself', async () => {
    const fetchFn = fakeFetch(200)
    expect(await verifySession('Bearer abc.def.ghi', ENV, fetchFn as unknown as typeof fetch)).toBe(true)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://example.supabase.co/auth/v1/user')
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer abc.def.ghi')
  })

  it('refuses a token Supabase rejects — expired, revoked or forged', async () => {
    expect(await verifySession('Bearer nope', ENV, fakeFetch(401) as unknown as typeof fetch)).toBe(false)
  })

  it('fails closed: no header, a malformed header, no configuration, or no network', async () => {
    const ok = fakeFetch(200) as unknown as typeof fetch
    expect(await verifySession(undefined, ENV, ok)).toBe(false)
    expect(await verifySession('Basic abc', ENV, ok)).toBe(false)
    expect(await verifySession('Bearer abc', {}, ok)).toBe(false)
    const offline = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await verifySession('Bearer abc', ENV, offline)).toBe(false)
  })
})

describe('the HTTP handler', () => {
  function capture() {
    const out: { status?: number; body?: unknown } = {}
    const res = {
      status(code: number) {
        out.status = code
        return {
          json(body: unknown) {
            out.body = body
            return body
          },
        }
      },
    }
    return { res, out }
  }

  it('answers a request with no session with 401, before any model is called', async () => {
    const { res, out } = capture()
    await handler({ method: 'POST', body: { text: 'bosim 120/80' }, headers: {} }, res)
    expect(out).toEqual({ status: 401, body: { error: 'unauthorized' } })
  })
})

describe('handleExtract', () => {
  it('refuses text longer than any real note, before any model is called', async () => {
    const result = await handleExtract({ text: 'a'.repeat(MAX_TEXT_LENGTH + 1) })
    expect(result).toEqual({ status: 400, body: { error: 'text_too_long' } })
  })
})

describe('extractFields — the browser side', () => {
  it('sends the session token with the request', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ fields: { age: 24 }, raw: {} }), { status: 200 }),
    )
    const outcome = await extractFields('yoshi 24', async () => 'tok', fetchFn as unknown as typeof fetch)
    expect(outcome.ok).toBe(true)
    expect((fetchFn.mock.calls[0][1]?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer tok')
  })

  it('does not call the endpoint at all without a session', async () => {
    const fetchFn = vi.fn()
    expect(await extractFields('x', async () => null, fetchFn as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'no_session',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
