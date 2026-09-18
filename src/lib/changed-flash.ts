import { useCallback, useEffect, useRef, useState } from 'react'

/** Long enough to notice, gone before it becomes decoration. Matches .changed-flash in index.css. */
export const FLASH_MS = 2600

/**
 * Which keys are highlighted right now. flash(keys) highlights them for
 * FLASH_MS; a key flashed again restarts its highlight.
 */
export function useChangedFlash(): [ReadonlySet<string>, (keys: readonly string[]) => void] {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])

  const flash = useCallback((keys: readonly string[]) => {
    if (keys.length === 0) return
    setFlashing((current) => new Set([...current, ...keys]))
    for (const key of keys) {
      clearTimeout(timers.current.get(key))
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          setFlashing((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }, FLASH_MS),
      )
    }
  }, [])

  return [flashing, flash]
}
