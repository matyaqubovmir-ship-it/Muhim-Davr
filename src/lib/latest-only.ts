import { useCallback, useRef } from 'react'

/**
 * For screens that re-read on every live change: loads overlap when changes
 * arrive in a burst, or a search is typed faster than it is answered, and the
 * last to finish is not always the last to start. An older read landing last
 * would put an acknowledged alert back as open, or show the results of a
 * search she has already corrected.
 *
 * Call begin() as a load starts; the check it returns says whether that load is
 * still the latest, and only then may it set state.
 */
export function useLatestOnly(): () => () => boolean {
  const latest = useRef(0)
  return useCallback(() => {
    const request = ++latest.current
    return () => request === latest.current
  }, [])
}
