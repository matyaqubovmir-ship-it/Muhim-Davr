import { useEffect, useRef, useState } from 'react'

/**
 * An element's content width, tracked. Charts draw at real pixel size from it,
 * so their text stays the size it was set at instead of scaling with a viewBox.
 */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
