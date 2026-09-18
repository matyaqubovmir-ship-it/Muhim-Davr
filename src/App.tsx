import { useState } from 'react'
import { EntryForm } from './components/EntryForm'
import { EscalationQueue } from './components/EscalationQueue'
import { ResultScreen } from './components/ResultScreen'
import { QUEUE_UI, UI } from './lib/labels'
import type { SavedVisit } from './lib/visit-followup'

type Tab = 'entry' | 'queue'

/**
 * Two views: the midwife's entry form (then the result for what was just
 * saved), and the doctor's escalation queue.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('entry')
  const [saved, setSaved] = useState<SavedVisit | null>(null)

  const tabClass = (active: boolean) =>
    [
      'min-h-10 flex-1 rounded-md text-sm font-semibold',
      active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-300',
    ].join(' ')

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg px-4">
        <header className="pt-5 pb-1">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            {UI.appTitle}
          </h1>
          <p className="text-sm text-slate-500">{UI.appSubtitle}</p>
        </header>

        <nav className="mt-2 flex gap-2">
          <button type="button" className={tabClass(tab === 'entry')} onClick={() => setTab('entry')}>
            {QUEUE_UI.tabEntry}
          </button>
          <button type="button" className={tabClass(tab === 'queue')} onClick={() => setTab('queue')}>
            {QUEUE_UI.tabQueue}
          </button>
        </nav>

        {/* Hidden rather than unmounted, so a half-typed visit survives a look at the queue. */}
        <div className={tab === 'entry' ? '' : 'hidden'}>
          {saved ? (
            <ResultScreen saved={saved} onNewEntry={() => setSaved(null)} />
          ) : (
            <EntryForm onSaved={setSaved} />
          )}
        </div>

        {/* Mounted on open, so the queue is fetched fresh each time it is viewed. */}
        {tab === 'queue' ? <EscalationQueue /> : null}
      </div>
    </div>
  )
}
