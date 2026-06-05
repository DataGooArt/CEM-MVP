import { useState } from 'react'
import { useStore } from './store'
import { useQuery } from '@tanstack/react-query'
import { fetchFindings } from './api'
import AiPanel from './AiPanel'

const SEVERITIES = ['MEDIUM', 'LOW', 'INFO'] as const
const BADGE: Record<string, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  LOW:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  INFO:     'bg-slate-500/20 text-slate-400 border-slate-500/30',
}
const STATUS_BADGE: Record<string, string> = {
  OPEN:     'bg-sky-500/20 text-sky-400 border-sky-500/30',
  RESOLVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  IGNORED:  'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

export default function FindingsTable({ orgId = 'org_demo' }: { orgId?: string }) {
  const openFindings = useStore(s => s.findings)
  const [selected, setSelected] = useState<{ id: string; title: string; severity: string } | null>(null)
  const [sevFilter, setSevFilter] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const allQuery = useQuery({
    queryKey: ['findings-all', orgId],
    queryFn: () => fetchFindings(orgId, { status: 'ALL' }),
    enabled: showAll,
  })

  const source: any[] = showAll ? (allQuery.data?.data ?? []) : openFindings
  // CRITICAL and HIGH go to Remediación tab — exclude from dashboard table
  const filtered = source.filter((f: any) => f.severity !== 'CRITICAL' && f.severity !== 'HIGH')
  const critHighCount = source.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length
  const displayed = sevFilter ? filtered.filter((f: any) => f.severity === sevFilter) : filtered

  return (
    <>
      {/* Critical/High redirect banner */}
      {critHighCount > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs">
          <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
          <span className="text-rose-300">
            <span className="font-semibold">{critHighCount} hallazgo{critHighCount !== 1 ? 's' : ''} CRITICAL/HIGH</span>
            {' '}pendiente{critHighCount !== 1 ? 's' : ''} de remediación formal
          </span>
          <span className="ml-auto text-rose-400/60">→ ver en pestaña <span className="font-semibold text-rose-300">Remediación</span></span>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        {/* Filter bar */}
        <div className="p-4 border-b border-slate-700 flex flex-wrap items-center gap-3">
          <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mr-auto">Findings</h3>

          {/* Severity filter */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSevFilter(null)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                sevFilter === null ? 'bg-slate-600 text-slate-200' : 'text-slate-500 hover:text-slate-300'
              }`}
            >All</button>
            {SEVERITIES.map(s => (
              <button
                key={s}
                onClick={() => setSevFilter(prev => prev === s ? null : s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${BADGE[s]} ${
                  sevFilter === s ? 'opacity-100' : 'opacity-35 hover:opacity-70'
                }`}
              >{s}</button>
            ))}
          </div>

          {/* Status toggle */}
          <button
            onClick={() => setShowAll(v => !v)}
            className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
              showAll
                ? 'bg-slate-600 text-slate-200 border-slate-500'
                : 'text-slate-500 border-slate-600 hover:text-slate-300'
            }`}
          >
            {showAll ? 'All statuses' : 'Open only'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Tool</th>
                {showAll && <th className="px-4 py-3 font-medium">Status</th>}
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">AI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={showAll ? 7 : 6} className="px-4 py-8 text-center text-slate-500 text-sm">
                    {allQuery.isFetching ? 'Loading…' : 'No findings match the selected filters.'}
                  </td>
                </tr>
              )}
              {displayed.map((f: any) => (
                <tr key={f.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${BADGE[f.severity] || BADGE.INFO}`}>
                        {f.severity}
                      </span>
                      {f.seenCount > 1 && (
                        <span title={`Detectado ${f.seenCount} veces`} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400 border border-slate-600">
                          ×{f.seenCount}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-200 font-medium max-w-xs truncate">{f.title}</td>
                  <td className="px-4 py-3 text-slate-400">{f.asset?.domain || f.asset?.ip || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{f.sourceTool}</td>
                  {showAll && (
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_BADGE[f.status] || STATUS_BADGE.OPEN}`}>
                        {f.status}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(f.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelected({ id: f.id, title: f.title, severity: f.severity })}
                      className="text-violet-400 hover:text-violet-300 text-xs font-medium border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 px-2 py-1 rounded transition-colors"
                    >
                      Analyze
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-slate-800 text-xs text-slate-500">
          {displayed.length} finding{displayed.length !== 1 ? 's' : ''}
          {sevFilter && ` · ${sevFilter}`}
          {showAll ? ' · all statuses' : ' · open only'}
        </div>
      </div>

      {selected && <AiPanel finding={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

