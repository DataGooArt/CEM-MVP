import { useState } from 'react'

export interface DateRange {
  from: string  // 'YYYY-MM-DD' or ''
  to:   string
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: '7d',    days: 7   },
  { label: '30d',   days: 30  },
  { label: '90d',   days: 90  },
  { label: '1 año', days: 365 },
  { label: 'Todo',  days: null },
]

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function fromDays(days: number | null): DateRange {
  if (days === null) return { from: '', to: '' }
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: isoDate(from), to: isoDate(to) }
}

function activePreset(range: DateRange): number | null | undefined {
  if (!range.from && !range.to) return null  // "Todo"
  const days = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000)
  const match = PRESETS.find(p => p.days !== null && Math.abs((p.days ?? 0) - days) <= 1)
  return match?.days
}

interface Props {
  value: DateRange
  onChange: (r: DateRange) => void
  label?: string
}

export default function DateRangeFilter({ value, onChange, label }: Props) {
  const [custom, setCustom] = useState(false)
  const current = activePreset(value)

  function applyPreset(days: number | null) {
    setCustom(false)
    onChange(fromDays(days))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs text-slate-500 shrink-0">{label}</span>}

      {/* Preset pills */}
      <div className="flex items-center rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
        {PRESETS.map(p => {
          const active = !custom && (
            p.days === null ? current === null : current === p.days
          )
          return (
            <button
              key={String(p.days)}
              onClick={() => applyPreset(p.days)}
              className={`px-2.5 py-1.5 transition-colors border-r border-slate-700 last:border-0 ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          )
        })}
        <button
          onClick={() => setCustom(c => !c)}
          className={`px-2.5 py-1.5 transition-colors ${
            custom
              ? 'bg-sky-600 text-white'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          Rango
        </button>
      </div>

      {/* Custom date inputs */}
      {custom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={e => onChange({ ...value, from: e.target.value })}
            className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <span className="text-slate-500 text-xs">→</span>
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={e => onChange({ ...value, to: e.target.value })}
            className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      )}

      {/* Active range display */}
      {(value.from || value.to) && (
        <span className="text-[10px] text-slate-500 hidden md:inline">
          {value.from && value.to
            ? `${value.from} → ${value.to}`
            : value.from
            ? `desde ${value.from}`
            : `hasta ${value.to}`}
        </span>
      )}
    </div>
  )
}

/** Helper: returns today & 30 days ago as default range */
export function defaultRange(days = 30): DateRange {
  return {
    from: isoDate(new Date(Date.now() - days * 86400000)),
    to:   isoDate(new Date()),
  }
}
