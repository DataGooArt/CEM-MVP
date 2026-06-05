import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchRemediationFindings, updateFindingTracking } from './api'
import DateRangeFilter, { DateRange, defaultRange } from './DateRangeFilter'

const ORG = 'org_demo'

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  HIGH:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  MEDIUM:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  INFO:     'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

const STATUS_OPTS = [
  { value: '',            label: '— Sin estado —' },
  { value: 'PENDIENTE',   label: 'Pendiente'   },
  { value: 'EN_TRAMITE',  label: 'En trámite'  },
  { value: 'PLAN_ACCION', label: 'Plan acción' },
  { value: 'PROCESADO',   label: 'Procesado'   },
]

function dateVal(v?: string | null) { return v ? v.slice(0, 10) : '' }
function fmtDate(v?: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(v?: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

interface EditState {
  responsible: string
  remediationEvidence: string
  closingNotes: string
  status: string
  startDate: string
  endDate: string
  postAnalysisDate: string
  closingDate: string
}

function buildEdit(f: any): EditState {
  return {
    responsible:         f.responsible         ?? '',
    remediationEvidence: f.remediationEvidence  ?? '',
    closingNotes:        f.closingNotes         ?? '',
    status:              f.remediationStatus    ?? '',
    startDate:           dateVal(f.remediationStartDate),
    endDate:             dateVal(f.remediationEndDate),
    postAnalysisDate:    dateVal(f.postAnalysisDate),
    closingDate:         dateVal(f.closingDate),
  }
}

function exportCsv(rows: any[]) {
  const HEADERS = [
    'No','Nombre Activo','Activos Afectados','Fecha Análisis','Hora',
    'Vulnerabilidad','Descripción','Remediación','Riesgo a Mitigar',
    'Fecha Inicio','Fecha Final','Fecha Análisis Post-Remediación',
    'Soporte Verificación','Responsable','Fecha Cierre','Estado',
  ]
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const data = rows.map((f, i) => {
    const asset = f.asset?.domain ?? f.asset?.ip ?? ''
    const ai    = f.aiAnalysis
    const plan  = ai?.remediationPlan
    const remText = plan
      ? [...(plan.immediate ?? []), ...(plan.shortTerm ?? []), ...(plan.longTerm ?? [])].join(' | ')
      : (ai?.remediation ?? '')
    return [
      i + 1, asset, asset,
      fmtDate(f.createdAt), fmtTime(f.createdAt),
      f.title ?? '', f.description ?? (ai?.summary ?? ''),
      remText, ai?.businessImpact ?? '',
      fmtDate(f.remediationStartDate), fmtDate(f.remediationEndDate),
      fmtDate(f.postAnalysisDate),
      f.remediationEvidence ?? '', f.responsible ?? '',
      fmtDate(f.closingDate), f.remediationStatus ?? '',
    ].map(esc).join(',')
  })
  const blob = new Blob([[HEADERS.map(esc).join(','), ...data].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `F-RI-25_${new Date().toISOString().slice(0, 10)}.csv`,
  })
  a.click(); URL.revokeObjectURL(url)
}

export default function RemediationTracker({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient()
  const [range, setRange] = useState<DateRange>(defaultRange(30))
  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['remediation', ORG, range.from, range.to],
    queryFn:  () => fetchRemediationFindings(ORG, { from: range.from || undefined, to: range.to || undefined }),
    refetchInterval: 30_000,
  })

  const [editing, setEditing]   = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving]     = useState(false)

  function openEdit(f: any) {
    setEditing(f.id)
    setEditState(buildEdit(f))
  }

  function closeEdit() { setEditing(null); setEditState(null) }

  const saveEdit = useCallback(async () => {
    if (!editing || !editState) return
    setSaving(true)
    try {
      await updateFindingTracking(editing, {
        status:              editState.status              || undefined,
        startDate:           editState.startDate           || undefined,
        endDate:             editState.endDate             || undefined,
        responsible:         editState.responsible         || undefined,
        postAnalysisDate:    editState.postAnalysisDate    || undefined,
        closingDate:         editState.closingDate         || undefined,
        remediationEvidence: editState.remediationEvidence || undefined,
        closingNotes:        editState.closingNotes        || undefined,
      })
      qc.invalidateQueries({ queryKey: ['remediation', ORG] })
      closeEdit()
    } finally { setSaving(false) }
  }, [editing, editState, qc])

  function setField(k: keyof EditState, v: string) {
    setEditState(s => s ? { ...s, [k]: v } : s)
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">F-RI-25 v02</span>
            <h2 className="text-base font-semibold text-slate-200">Análisis y Remediación de Vulnerabilidades</h2>
          </div>
          <p className="text-slate-500 text-xs mt-0.5">
            Identificar acciones necesarias para mitigar las vulnerabilidades detectadas en los escaneos técnicos
          </p>
        </div>
        <button
          onClick={() => exportCsv(findings)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          Exportar CSV
        </button>
      </div>

      {/* ── Date range filter ── */}
      <DateRangeFilter value={range} onChange={setRange} label="Período de análisis:" />

      {/* ── Table ── */}
      {isLoading ? (
        <div className="flex items-center gap-3 py-12 justify-center text-slate-400 text-sm">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Cargando registro…
        </div>
      ) : findings.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">✅</p>
          <p>Sin hallazgos críticos o altos abiertos para registrar</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                {/* Group header */}
              </tr>
              <tr className="bg-slate-800/60 text-slate-400 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2.5 text-center w-8 font-semibold">No</th>
                <th className="px-3 py-2.5 text-left font-semibold">Nombre Activo</th>
                <th className="px-3 py-2.5 text-left font-semibold">Fecha Análisis</th>
                <th className="px-3 py-2.5 text-left font-semibold">Vulnerabilidad / CVE</th>
                <th className="px-3 py-2.5 text-left font-semibold">Descripción</th>
                <th className="px-3 py-2.5 text-left font-semibold">Remediación</th>
                <th className="px-3 py-2.5 text-left font-semibold">Riesgo a mitigar</th>
                <th className="px-3 py-2.5 text-center font-semibold">F. Inicio</th>
                <th className="px-3 py-2.5 text-center font-semibold">F. Final</th>
                <th className="px-3 py-2.5 text-center font-semibold">F. Análisis Post</th>
                <th className="px-3 py-2.5 text-left font-semibold">Soporte verificación</th>
                <th className="px-3 py-2.5 text-left font-semibold">Responsable</th>
                <th className="px-3 py-2.5 text-center font-semibold">F. Cierre</th>
                <th className="px-3 py-2.5 text-center font-semibold">Estado</th>
                {!readOnly && <th className="px-3 py-2.5 text-center font-semibold">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {findings.map((f, idx) => {
                const ai      = f.aiAnalysis
                const asset   = f.asset?.domain ?? f.asset?.ip ?? 'N/A'
                const plan    = ai?.remediationPlan
                const remText = plan
                  ? [...(plan.immediate ?? []), ...(plan.shortTerm ?? [])].slice(0, 2).join(' · ')
                  : (ai?.remediation?.slice(0, 120) ?? '—')
                const isEditRow = editing === f.id && editState

                return (
                  <tr key={f.id} className={`hover:bg-slate-800/30 transition-colors ${f.remediationStatus === 'PROCESADO' ? 'opacity-60' : ''}`}>
                    {/* No */}
                    <td className="px-3 py-2 text-center text-slate-500 font-mono">{idx + 1}</td>

                    {/* Activo */}
                    <td className="px-3 py-2 min-w-[110px]">
                      <p className="font-medium text-slate-200 truncate max-w-[130px]" title={asset}>{asset}</p>
                      <p className="text-slate-500 text-[10px]">{f.sourceTool}</p>
                    </td>

                    {/* Fecha */}
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap min-w-[90px]">
                      <div>{fmtDate(f.createdAt)}</div>
                      <div className="text-slate-600 text-[10px]">{fmtTime(f.createdAt)}</div>
                    </td>

                    {/* Vuln */}
                    <td className="px-3 py-2 min-w-[160px]">
                      <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border mb-1 ${SEV_CLS[f.severity]}`}>
                        {f.severity}
                      </span>
                      <p className="text-slate-200 font-medium leading-snug line-clamp-2" title={f.title}>{f.title}</p>
                      {f.cve && <p className="text-sky-400 text-[10px] font-mono mt-0.5">{f.cve}{f.cvss ? ` · CVSS ${f.cvss}` : ''}</p>}
                    </td>

                    {/* Descripción */}
                    <td className="px-3 py-2 max-w-[180px] min-w-[140px]">
                      <p className="text-slate-400 line-clamp-3 text-[11px]" title={f.description ?? ai?.summary}>
                        {f.description ?? ai?.summary ?? '—'}
                      </p>
                    </td>

                    {/* Remediación */}
                    <td className="px-3 py-2 max-w-[180px] min-w-[140px]">
                      <p className="text-slate-400 line-clamp-3 text-[11px]" title={remText}>
                        {remText || '—'}
                      </p>
                    </td>

                    {/* Riesgo */}
                    <td className="px-3 py-2 max-w-[160px] min-w-[120px]">
                      <p className="text-slate-400 line-clamp-3 text-[11px]" title={ai?.businessImpact}>
                        {ai?.businessImpact ?? '—'}
                      </p>
                    </td>

                    {/* Dates */}
                    <td className="px-3 py-2 text-center whitespace-nowrap text-slate-400">
                      {isEditRow ? (
                        <input type="date" value={editState.startDate}
                          onChange={e => setField('startDate', e.target.value)}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : fmtDate(f.remediationStartDate)}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap text-slate-400">
                      {isEditRow ? (
                        <input type="date" value={editState.endDate}
                          onChange={e => setField('endDate', e.target.value)}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : fmtDate(f.remediationEndDate)}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap text-slate-400">
                      {isEditRow ? (
                        <input type="date" value={editState.postAnalysisDate}
                          onChange={e => setField('postAnalysisDate', e.target.value)}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : fmtDate(f.postAnalysisDate)}
                    </td>

                    {/* Soporte */}
                    <td className="px-3 py-2 min-w-[140px]">
                      {isEditRow ? (
                        <input value={editState.remediationEvidence}
                          onChange={e => setField('remediationEvidence', e.target.value)}
                          placeholder="URL, ticket, doc…"
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : (
                        <p className="text-slate-400 text-[11px] truncate" title={f.remediationEvidence}>
                          {f.remediationEvidence || '—'}
                        </p>
                      )}
                    </td>

                    {/* Responsable */}
                    <td className="px-3 py-2 min-w-[110px]">
                      {isEditRow ? (
                        <input value={editState.responsible}
                          onChange={e => setField('responsible', e.target.value)}
                          placeholder="Nombre / cargo"
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : (
                        <p className="text-slate-300 text-[11px]">{f.responsible || '—'}</p>
                      )}
                    </td>

                    {/* Cierre */}
                    <td className="px-3 py-2 text-center whitespace-nowrap text-slate-400">
                      {isEditRow ? (
                        <input type="date" value={editState.closingDate}
                          onChange={e => setField('closingDate', e.target.value)}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      ) : fmtDate(f.closingDate)}
                    </td>

                    {/* Estado */}
                    <td className="px-3 py-2 text-center">
                      {isEditRow ? (
                        <select value={editState.status}
                          onChange={e => setField('status', e.target.value)}
                          className="bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-500">
                          {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <StatusBadge status={f.remediationStatus} />
                      )}
                    </td>

                    {/* Acción */}
                    {!readOnly && (
                      <td className="px-3 py-2 text-center">
                        {isEditRow ? (
                          <div className="flex gap-1 justify-center">
                            <button onClick={saveEdit} disabled={saving}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors">
                              {saving ? '…' : 'Guardar'}
                            </button>
                            <button onClick={closeEdit}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => openEdit(f)}
                            className="p-1 rounded text-slate-500 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                            title="Editar registro">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-600 pt-1">
        <span className="font-mono">Código: F-RI-25</span>
        <span>Versión: 02</span>
        <span>Vigencia: 2024-05-31</span>
        <span>Clasificación: IPC</span>
        <span className="ml-auto">Registros: {findings.length}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: string | null }) {
  const map: Record<string, string> = {
    PENDIENTE:   'bg-slate-700 text-slate-300 border-slate-600',
    EN_TRAMITE:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
    PLAN_ACCION: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    PROCESADO:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }
  if (!status) return <span className="text-slate-600">—</span>
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${map[status] ?? 'bg-slate-700 text-slate-400'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
