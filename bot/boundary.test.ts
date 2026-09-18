/**
 * The token stays server-side.
 *
 * Vite inlines VITE_-prefixed variables into the browser bundle and bundles
 * whatever src/ imports. So the token is safe exactly as long as nothing under
 * src/ imports the bot and nothing anywhere names a VITE_ copy of the token.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('the bot token cannot reach the browser', () => {
  it('nothing under src/ imports from bot/', () => {
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const source = readFileSync(file, 'utf8')
      expect(/from\s+['"][^'"]*\/bot\//.test(source), `${file} imports from bot/`).toBe(false)
    }
  })

  it('no client code reads the token', () => {
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('TELEGRAM_BOT_TOKEN')
    }
  })

  it('the example environment has no VITE_ copy of the token', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8')
    expect(example).not.toMatch(/^VITE_TELEGRAM_BOT_TOKEN/m)
    expect(example).toMatch(/^TELEGRAM_BOT_TOKEN=/m)
  })
})
