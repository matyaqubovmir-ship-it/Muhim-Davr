import { UI } from '../lib/labels'

/**
 * Marks a field the model filled in, so the midwife can tell at a glance what
 * came from the note and what she typed herself. It stays on the field after
 * she edits it — the point is that the value started with the AI, which is
 * exactly the field worth a second look.
 */
export function AiBadge() {
  return (
    <span className="ml-2 rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-violet-700">
      {UI.aiBadge}
    </span>
  )
}
