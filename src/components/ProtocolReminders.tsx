import { UI, WHO_PROTOCOL_REMINDERS } from '../lib/labels'

/**
 * Static WHO protocol reminders.
 *
 * Deliberately styled unlike everything else on the result screen. The zone
 * card and the factor list are things the system worked out about this woman;
 * this block is a fixed page from a guideline that happens to be shown next to
 * them. The dashed border, the neutral colour and the "a doctor must confirm"
 * heading all exist to stop it reading as a decision ONA made.
 *
 * No value here is computed, and no model can reach this component.
 */
export function ProtocolReminders() {
  return (
    <section className="mt-6 rounded-lg border-2 border-dashed border-slate-400 bg-slate-100 p-4">
      <h2 className="text-sm leading-snug font-bold text-slate-900">
        {UI.protocolTitle}
      </h2>

      <ul className="mt-3 space-y-2">
        {WHO_PROTOCOL_REMINDERS.map((reminder) => (
          <li
            key={reminder}
            className="flex gap-2.5 text-sm leading-snug text-slate-800"
          >
            <span aria-hidden="true" className="text-slate-500">
              §
            </span>
            <span>{reminder}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-slate-300 pt-2.5 text-xs leading-snug text-slate-600">
        {UI.protocolStaticNote}
      </p>
    </section>
  )
}
