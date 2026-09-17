import { useState } from 'react'
import { EntryForm } from './components/EntryForm'
import { ResultScreen } from './components/ResultScreen'
import { UI } from './lib/labels'
import type { RiskResult } from './lib/risk'

interface Saved {
  result: RiskResult
  assessmentId: string
}

/** One route: the entry form, then the result for what was just saved. */
export default function App() {
  const [saved, setSaved] = useState<Saved | null>(null)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg px-4">
        <header className="pt-5 pb-1">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            {UI.appTitle}
          </h1>
          <p className="text-sm text-slate-500">{UI.appSubtitle}</p>
        </header>

        {saved ? (
          <ResultScreen
            result={saved.result}
            assessmentId={saved.assessmentId}
            onNewEntry={() => setSaved(null)}
          />
        ) : (
          <EntryForm
            onSaved={(result, assessmentId) => setSaved({ result, assessmentId })}
          />
        )}
      </div>
    </div>
  )
}
