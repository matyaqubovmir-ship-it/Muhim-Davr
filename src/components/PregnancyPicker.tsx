import { useEffect, useId, useRef, useState } from 'react'
import { PICKER_UI } from '../lib/labels'
import { searchPregnancies, type PregnancyChoice } from '../lib/patients'
import { getAuthedSupabase } from '../lib/supabase'

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
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border-input bg-surface px-3 py-2">
          <div>
            <div className="text-base font-semibold text-text-primary">{value.fullName}</div>
            <div className="text-xs text-slate-600">{describe(value)}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
            className="shrink-0 rounded-md border border-border-input px-2.5 py-1 text-sm font-semibold text-slate-700 hover:border-slate-500"
          >
            {PICKER_UI.change}
          </button>
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
          setText(event.target.value)
          setOpen(true)
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
            pick(active)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={[
          'min-h-11 w-full rounded-md border bg-surface px-3 text-base text-text-primary focus:border-brand focus:outline-none',
          invalid ? 'border-red-400' : 'border-border-input',
        ].join(' ')}
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-slate-300 bg-surface py-1 shadow-lg"
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
              className={['cursor-pointer px-3 py-2', index === active ? 'bg-slate-100' : ''].join(' ')}
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
              'cursor-pointer border-t border-slate-100 px-3 py-2 text-sm font-semibold text-text-primary',
              active === results.length ? 'bg-slate-100' : '',
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
