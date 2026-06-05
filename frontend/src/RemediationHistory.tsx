import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchRemediationHistory, archiveFindings } from './api'
import DateRangeFilter, { DateRange } from './DateRangeFilter'
import { useAuth } from './auth'

const ORG = 'org_demo'

function fmtDate(v?: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  HIGH:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  MEDIUM:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  INFO:     'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

function exportCsv(rows: any[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const COLS = ['No','Activo','Vulnerabilidad','Severidad','Herramienta','CVE','Responsable',
    'F. Inicio','F. Final','F. Análisis Post','F. Cierre','Soporte','Observaciones']
  const data = rows.map((f, i) => [
    i + 1,
    f.asset?.domain ?? f.asset?.ip ?? '',
    f.title,
    f.severity,
    f.sourceTool,
    f.cve ?? '',
    f.responsible ?? '',
    fmtDate(f.remediationStartDate),
    fmtDate(f.remediationEndDate),
    fmtDate(f.postAnalysisDate),
    fmtDate(f.closingDate),
    f.remediationEvidence ?? '',
    f.closingNotes ?? '',
  ].map(esc).join(','))
  const blob = new Blob([[COLS.map(esc).join(','), ...data].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `historial-remediaciones-${new Date().toISOString().slice(0,10)}.csv` })
  a.click(); URL.revokeObjectURL(url)
}

export default function RemediationHistory() {
  const qc  = useQueryClient()
  const can = useAuth(s => s.can)
  const [range, setRange]       = useState<DateRange>({ from: '', to: '' })
  const [showArchived, setShowArchived] = useState(false)
  const [archiving, setArchiving]       = useState(false)
  const [archiveMsg, setArchiveMsg]     = useState<string | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['remediation-history', ORG, range.from, range.to, showArchived],
    queryFn:  () => fetchRemediationHistory(ORG, {
      from:     range.from || undefined,
      to:       range.to   || undefined,
      archived: showArchived || undefined,
    }),
    refetchInterval: 60_000,
  })

  async function handleArchive() {
    setArchiving(true)
    setArchiveMsg(null)
    try {
      const res = await archiveFindings(ORG, 90)
      setArchiveMsg(`${res.archived} registro${res.archived !== 1 ? 's' : ''} archivado${res.archived !== 1 ? 's' : ''} (cierre anterior a ${new Date(res.cutoff).toLocaleDateString('es-CO')})`)
      qc.invalidateQueries({ queryKey: ['remediation-history'] })
    } catch {
      setArchiveMsg('Error al archivar. Intenta de nuevo.')
    } finally {
      setArchiving(false)
    }
  }

  // Stats
  const bySeverity = items.reduce((acc: Record<string, number>, f: any) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc
  }, {})

  const avgDays = (() => {
    const valid = items.filter((f: any) => f.remediationStartDate && f.closingDate)
    if (!valid.length) return null
    const sum = valid.reduce((s: number, f: any) => {
      const diff = new Date(f.closingDate).getTime() - new Date(f.remediationStartDate).getTime()
      return s + diff / 86400000
    }, 0)
    return Math.round(sum / valid.length)
  })()

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-200">Historial de Remediaciones</h2>
          <p className="text-slate-500 text-xs mt-0.5">Vulnerabilidades marcadas como <span className="text-emerald-400 font-medium">Procesadas</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length > 0 && (
            <button
              onClick={() => exportCsv(items)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Exportar historial
            </button>
          )}
          {/* Archive action — admin only */}
          {can('accessConfig') && (
            <button
              onClick={handleArchive}
              disabled={archiving}
              title="Mover remediaciones procesadas hace +90 días al archivo histórico"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 border border-slate-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
              </svg>
              {archiving ? 'Archivando…' : 'Archivar +90d'}
            </button>
          )}
        </div>
      </div>

      {/* Archive feedback */}
      {archiveMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${archiveMsg.startsWith('Error') ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
          {archiveMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangeFilter value={range} onChange={setRange} label="Cierre:" />
        <button
          onClick={() => setShowArchived(a => !a)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            showArchived
              ? 'bg-violet-600 border-violet-500 text-white'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
          </svg>
          {showArchived ? 'Datos archivados' : 'Ver archivados'}
        </button>
      </div>

      {/* Summary cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4">
            <p className="text-emerald-400 text-xs font-medium uppercase tracking-wider">Total resueltos</p>
            <p className="text-3xl font-bold text-emerald-400 mt-1 tabular-nums">{items.length}</p>
          </div>
          {(['CRITICAL','HIGH','MEDIUM'] as const).map(sev => (
            <div key={sev} className={`${SEV_CLS[sev].split(' ').map(c => c.replace('text-','bg-').replace('/15','/')).join(' ')} border rounded-xl p-4`}
              style={{ background: undefined }}>
              <div className={`bg-slate-900 border border-slate-700 rounded-xl p-4`}>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">{sev}</p>
                <p className={`text-3xl font-bold mt-1 tabular-nums ${SEV_CLS[sev].split(' ')[1]}`}>{bySeverity[sev] ?? 0}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MTTR */}
      {avgDays !== null && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">MTTR — Tiempo promedio de remediación</p>
            <p className="text-2xl font-bold text-violet-400 tabular-nums mt-0.5">{avgDays} <span className="text-sm font-normal text-slate-400">días</span></p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-3 py-12 justify-center text-slate-400 text-sm">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Cargando historial…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-400 font-medium">Sin remediaciones procesadas aún</p>
          <p className="text-slate-600 text-sm mt-1">
            Cuando marques un hallazgo como <span className="text-emerald-400">Procesado</span>, aparecerá aquí con su historial completo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((f: any, i: number) => {
            const asset = f.asset?.domain ?? f.asset?.ip ?? 'N/A'
            const ai    = f.aiAnalysis
            const daysToClose = f.remediationStartDate && f.closingDate
              ? Math.round((new Date(f.closingDate).getTime() - new Date(f.remediationStartDate).getTime()) / 86400000)
              : null

            return (
              <div key={f.id} className="bg-slate-900 border border-emerald-500/20 border-l-4 border-l-emerald-500 rounded-xl p-4">
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  {/* Left */}
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-slate-600 text-xs font-mono shrink-0 mt-0.5">#{i + 1}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEV_CLS[f.severity]}`}>
                          {f.severity}
                        </span>
                        <span className="text-emerald-400 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10">
                          ✓ PROCESADO
                        </span>
                      </div>
                      <p className="text-slate-200 font-medium text-sm mt-1 leading-snug">{f.title}</p>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {asset} · {f.sourceTool}
                        {f.cve ? ` · ${f.cve}` : ''}
                        {f.cvss ? ` · CVSS ${f.cvss}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Right: dates/MTTR */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 shrink-0">
                    {f.remediationStartDate && (
                      <span>Inicio: <span className="text-slate-300">{fmtDate(f.remediationStartDate)}</span></span>
                    )}
                    {f.closingDate && (
                      <span>Cierre: <span className="text-slate-300">{fmtDate(f.closingDate)}</span></span>
                    )}
                    {daysToClose !== null && (
                      <span className="text-violet-400 font-semibold">{daysToClose}d</span>
                    )}
                  </div>
                </div>

                {/* Detail grid */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  {f.responsible && (
                    <div className="bg-slate-800/50 rounded-lg p-2.5">
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Responsable</p>
                      <p className="text-slate-300">{f.responsible}</p>
                    </div>
                  )}
                  {f.postAnalysisDate && (
                    <div className="bg-slate-800/50 rounded-lg p-2.5">
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Análisis post-remediación</p>
                      <p className="text-slate-300">{fmtDate(f.postAnalysisDate)}</p>
                    </div>
                  )}
                  {f.remediationEvidence && (
                    <div className="bg-slate-800/50 rounded-lg p-2.5 sm:col-span-2">
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Soporte de verificación</p>
                      <p className="text-slate-300 break-all">{f.remediationEvidence}</p>
                    </div>
                  )}
                  {f.closingNotes && (
                    <div className="bg-slate-800/50 rounded-lg p-2.5 sm:col-span-2 md:col-span-4">
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Observaciones de cierre</p>
                      <p className="text-slate-300">{f.closingNotes}</p>
                    </div>
                  )}
                  {ai?.summary && (
                    <div className="bg-slate-800/50 rounded-lg p-2.5 sm:col-span-2 md:col-span-4">
                      <p className="text-slate-500 uppercase tracking-wide text-[10px] mb-0.5">Análisis técnico (AI)</p>
                      <p className="text-slate-400 line-clamp-2">{ai.summary}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
