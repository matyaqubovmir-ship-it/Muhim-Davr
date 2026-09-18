import { useEffect, useId, useRef, useState } from 'react'
import { PICKER_UI } from '../lib/labels'
import { searchPregnancies, type PregnancyChoice } from '../lib/patients'
import { getAuthedSupabase } from '../lib/supabase'
import { Button } from './Button'

const SEARCH_DELAY_MS = 250

function describe(choice: PregnancyChoice): string {
  return [choice.district, choice.village].filter(Boolean).join(' · ')
}

/**
 * Who this visit is for: search by name among active pregnancies, or add a new
 * patient. Replaces typing a raw pregnancy id, which only worked for someone
 * who already knew it. A pasted id still resolves.
 *
 * A combobox in the WAI-ARIA sense: the input owns a listbox, arrow keys move
 * through the options, Enter picks, Escape closes.
 */
export function PregnancyPicker({
  value,
  onChange,
  onCreateNew,
  invalid,
}: {
  value: PregnancyChoice | null
  onChange: (choice: PregnancyChoice | null) => void
  /** Called with whatever was typed, so the new-patient form can start from it. */
  onCreateNew: (typed: string) => void
  invalid: boolean
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [results, setResults] = useState<PregnancyChoice[]>([])
  /**
   * The text the results were found for. Only results for exactly what is in
   * the box now may be picked: pressing Enter on "Alimova" while the list
   * still showed "Ali"'s results picked Aliyeva — and a visit saved against
   * the wrong woman cannot be removed (assessments are append-only).
   */
  const [resultsFor, setResultsFor] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  // One option past the results: "add a new patient".
  const optionCount = results.length + 1

  useEffect(() => {
    if (value !== null) return
    const query = text.trim()
    let cancelled = false
    const timer = setTimeout(() => {
      if (query.length < 2) {
        setResults([])
        setStatus('idle')
        return
      }
      setStatus('searching')
      getAuthedSupabase()
        .then((client) => searchPregnancies(client, query))
        .then((found) => {
          if (cancelled) return
          setResults(found)
          setResultsFor(query)
          setActive(0)
          setStatus('idle')
        })
        .catch(() => {
          if (!cancelled) setStatus('error')
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, value])

  const current = text.trim()
  const fresh = resultsFor === current && status === 'idle'

  function pick(index: number) {
    if (index < results.length) {
      onChange(results[index])
      setText('')
      setOpen(false)
    } else {
      onCreateNew(text.trim())
    }
  }

  if (value !== null) {
    return (
      <div className="py-2">
        <div className="mb-1.5 text-sm leading-snug text-slate-800">{PICKER_UI.label}</div>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-brand/40 bg-brand-soft/50 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div>
            <div className="text-base font-semibold text-text-primary">{value.fullName}</div>
            <div className="text-xs text-slate-600">{describe(value)}</div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              onChange(null)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
          >
            {PICKER_UI.change}
          </Button>
        </div>
      </div>
    )
  }

  const showList = open && text.trim().length >= 2

  return (
    <div className="relative py-2">
      <label htmlFor={`${id}-input`} className="mb-1.5 block text-sm leading-snug text-slate-800">
        {PICKER_UI.label}
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder={PICKER_UI.placeholder}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          setOpen(true)
          // Whatever was listed belongs to the old text: clear it at once.
          setResults([])
          setResultsFor(null)
          setActive(0)
          setStatus(next.trim().length >= 2 ? 'searching' : 'idle')
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!showList) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((a) => (a + 1) % optionCount)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((a) => (a - 1 + optionCount) % optionCount)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            // Not until the list is for exactly what is typed — otherwise
            // Enter picks from the last search, or lands on "new patient"
            // for a woman who already exists.
            if (fresh) pick(active)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={[
          'min-h-11 w-full rounded-lg border bg-surface px-3 text-base text-text-primary shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] focus:border-brand focus:ring-3 focus:ring-brand/15 focus:outline-none',
          invalid ? 'border-red-400' : 'border-border-input',
        ].join(' ')}
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 z-20 mt-1.5 max-h-72 overflow-auto rounded-xl border border-border bg-surface py-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]"
        >
          {status === 'searching' ? (
            <li className="px-3 py-2 text-sm text-text-muted">{PICKER_UI.searching}</li>
          ) : null}
          {status === 'error' ? <li className="px-3 py-2 text-sm text-red-700">{PICKER_UI.searchFailed}</li> : null}
          {status === 'idle' && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">{PICKER_UI.noMatch}</li>
          ) : null}
          {results.map((choice, index) => (
            <li
              key={choice.pregnancyId}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: a click lands after the input's blur has closed the list.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(index)
              }}
              onMouseEnter={() => setActive(index)}
              className={['mx-1 cursor-pointer rounded-lg px-3 py-2', index === active ? 'bg-brand-soft' : ''].join(' ')}
            >
              <div className="text-sm font-semibold text-text-primary">{choice.fullName}</div>
              <div className="text-xs text-slate-600">{describe(choice)}</div>
            </li>
          ))}
          <li
            id={`${id}-opt-${results.length}`}
            role="option"
            aria-selected={active === results.length}
            onMouseDown={(event) => {
              event.preventDefault()
              pick(results.length)
            }}
            onMouseEnter={() => setActive(results.length)}
            className={[
              'mx-1 mt-1 cursor-pointer rounded-lg border-t border-slate-100 px-3 py-2 text-sm font-semibold text-brand',
              active === results.length ? 'bg-brand-soft' : '',
            ].join(' ')}
          >
            + {PICKER_UI.createNew}
          </li>
        </ul>
      ) : null}

      {invalid ? <p className="mt-1 text-sm text-red-700">{PICKER_UI.required}</p> : null}
    </div>
  )
}
