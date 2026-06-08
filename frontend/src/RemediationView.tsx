import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchRemediationFindings, triggerAnalysis, updateFindingTracking, createManualFinding, importFindingsFromCsv, getFindingsImportTemplateUrl } from './api'
import RemediationTracker from './RemediationTracker'
import RemediationHistory from './RemediationHistory'

type SubTab = 'plan' | 'registro' | 'historial'

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  HIGH:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
}
const SEV_BORDER: Record<string, string> = {
  CRITICAL: 'border-l-rose-500',
  HIGH:     'border-l-orange-500',
}
const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDIENTE:   { label: 'Pendiente',   cls: 'bg-slate-700 text-slate-300 border-slate-600' },
  EN_TRAMITE:  { label: 'En trámite',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  PLAN_ACCION: { label: 'Plan acción', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  PROCESADO:   { label: 'Procesado',   cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
}

function toDateInputValue(val?: string | null): string {
  if (!val) return ''
  return val.slice(0, 10)
}

interface RemediationPlan {
  immediate: string[]
  immediateTime?: string
  shortTerm: string[]
  shortTermTime?: string
  longTerm: string[]
  longTermTime?: string
  observations?: string
}

function PlanPhase({ label, color, timeCls, items, time }: { label: string; color: string; timeCls: string; items: string[]; time?: string }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <p className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</p>
        {time && <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${timeCls}`}>⏱ {time}</span>}
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-300">
            <span className="text-slate-500 shrink-0 mt-0.5">→</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function exportReport(findings: any[]): string {
  const now = new Date().toLocaleString('es-CO')
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════',
    '  PLAN DE REMEDIACIÓN — CONTINUOUS EXPOSURE MONITORING',
    `  Generado: ${now}`,
    '═══════════════════════════════════════════════════════════',
    '',
  ]

  findings.forEach((f, idx) => {
    const ai = f.aiAnalysis
    const asset = f.asset?.domain ?? f.asset?.ip ?? 'N/A'
    lines.push(`[${idx + 1}] ${f.severity} — ${f.title}`)
    lines.push(`    Activo: ${asset}  |  Herramienta: ${f.sourceTool}  |  CVE: ${f.cve ?? 'N/A'}`)
    if (ai?.summary) lines.push(`\n    ANÁLISIS TÉCNICO:\n    ${ai.summary}`)
    if (ai?.businessImpact) lines.push(`\n    IMPACTO AL NEGOCIO:\n    ${ai.businessImpact}`)
    const plan: RemediationPlan | null = ai?.remediationPlan ?? null
    if (plan) {
      if (plan.immediate?.length) {
        lines.push(`\n    ACCIONES INMEDIATAS${plan.immediateTime ? ` (${plan.immediateTime})` : ' (0-24h)'}:`)
        plan.immediate.forEach(a => lines.push(`      • ${a}`))
      }
      if (plan.shortTerm?.length) {
        lines.push(`\n    CORTO PLAZO${plan.shortTermTime ? ` (${plan.shortTermTime})` : ' (1-7 días)'}:`)
        plan.shortTerm.forEach(a => lines.push(`      • ${a}`))
      }
      if (plan.longTerm?.length) {
        lines.push(`\n    LARGO PLAZO${plan.longTermTime ? ` (${plan.longTermTime})` : ' (1-4 semanas)'}:`)
        plan.longTerm.forEach(a => lines.push(`      • ${a}`))
      }
      if (plan.observations) lines.push(`\n    OBSERVACIONES:\n    ${plan.observations}`)
    } else if (ai?.remediation) {
      lines.push('\n    PLAN DE REMEDIACIÓN:')
      ai.remediation.split('\n').forEach((s: string) => lines.push(`      ${s}`))
    }
    lines.push('\n' + '─'.repeat(63) + '\n')
  })
  return lines.join('\n')
}

export default function RemediationView({ orgId = 'org_demo', readOnly = false }: { orgId?: string; readOnly?: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>('plan')
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [copied, setCopied]             = useState(false)
  const [filterSev, setFilterSev]       = useState<string | null>(null)
  const [reanalyzingCards, setReanalyzingCards] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  // ── Manual finding modal ──
  const [showManual, setShowManual] = useState(false)
  const [manualForm, setManualForm] = useState({ assetTarget: '', source: 'PENTEST', category: '', severity: 'HIGH', title: '', description: '', cve: '', responsible: '', remediationEndDate: '' })
  const [manualError, setManualError] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  // ── CSV import ──
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; error: string }[] } | null>(null)
  const [importLoading, setImportLoading] = useState(false)

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError(''); setManualSaving(true)
    try {
      await createManualFinding({ ...manualForm, organizationId: orgId })
      setShowManual(false)
      setManualForm({ assetTarget: '', source: 'PENTEST', category: '', severity: 'HIGH', title: '', description: '', cve: '', responsible: '', remediationEndDate: '' })
      queryClient.invalidateQueries({ queryKey: ['remediation', orgId] })
    } catch (e: any) { setManualError(e.message) } finally { setManualSaving(false) }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    if (!importFile) return
    setImportLoading(true); setImportResult(null)
    try {
      const result = await importFindingsFromCsv(importFile, orgId)
      setImportResult(result)
      queryClient.invalidateQueries({ queryKey: ['remediation', orgId] })
    } catch (e: any) { setImportResult({ imported: 0, errors: [{ row: 0, error: e.message }] }) }
    finally { setImportLoading(false) }
  }

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['remediation', orgId],
    queryFn: () => fetchRemediationFindings(orgId),
    refetchInterval: 30_000,
  })

  const displayed = filterSev ? findings.filter((f: any) => f.severity === filterSev) : findings

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  async function handleCopy() {
    const report = exportReport(displayed)
    await navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleDownload() {
    const report = exportReport(displayed)
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `plan-remediacion-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCardReanalyze = useCallback(async (id: string) => {
    setReanalyzingCards(prev => new Set(prev).add(id))
    try {
      await triggerAnalysis(id, 'gemini')
      // Poll for result: invalidate after short delay so the UI can show updated analysis
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['remediation', orgId] }), 4000)
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setReanalyzingCards(prev => { const s = new Set(prev); s.delete(id); return s }), 3000)
    }
  }, [orgId, queryClient])

  const handleTrackingChange = useCallback(async (
    id: string,
    field: 'status' | 'startDate' | 'endDate',
    value: string,
  ) => {
    try {
      await updateFindingTracking(id, { [field]: value || undefined })
      queryClient.invalidateQueries({ queryKey: ['remediation', orgId] })
    } catch {
      /* ignore */
    }
  }, [orgId, queryClient])

  const criticalCount = findings.filter((f: any) => f.severity === 'CRITICAL').length
  const highCount     = findings.filter((f: any) => f.severity === 'HIGH').length
  const withAI        = findings.filter((f: any) => f.aiAnalysis).length

  return (
    <div className="space-y-5">

      {/* ── Manual finding modal ── */}
      {showManual && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-8">
          <form onSubmit={handleManualSubmit} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Nuevo hallazgo manual</h4>
            {manualError && <p className="text-rose-400 text-sm">{manualError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Activo (IP o dominio) *</label>
                <input required value={manualForm.assetTarget} onChange={e => setManualForm(f => ({...f, assetTarget: e.target.value}))} placeholder="192.168.1.1 o app.example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Fuente *</label>
                <select required value={manualForm.source} onChange={e => setManualForm(f => ({...f, source: e.target.value}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
                  <option value="PENTEST">Pentesting</option>
                  <option value="COMPLIANCE">Cumplimiento normativo</option>
                  <option value="BUG_BOUNTY">Bug Bounty</option>
                  <option value="INTERNAL">Análisis interno</option>
                  <option value="EXTERNAL_CLIENT">Cliente externo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Severidad *</label>
                <select required value={manualForm.severity} onChange={e => setManualForm(f => ({...f, severity: e.target.value}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
                  {['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Categoría *</label>
                <input required value={manualForm.category} onChange={e => setManualForm(f => ({...f, category: e.target.value}))} placeholder="Ej: Autenticación"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">CVE (opcional)</label>
                <input value={manualForm.cve} onChange={e => setManualForm(f => ({...f, cve: e.target.value}))} placeholder="CVE-2024-1234"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Título *</label>
                <input required value={manualForm.title} onChange={e => setManualForm(f => ({...f, title: e.target.value}))} placeholder="Descripción breve del hallazgo"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Descripción</label>
                <textarea rows={2} value={manualForm.description} onChange={e => setManualForm(f => ({...f, description: e.target.value}))} placeholder="Detalles técnicos..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none"/>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Responsable</label>
                <input value={manualForm.responsible} onChange={e => setManualForm(f => ({...f, responsible: e.target.value}))} placeholder="Nombre o equipo"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Fecha límite remediación</label>
                <input type="date" value={manualForm.remediationEndDate} onChange={e => setManualForm(f => ({...f, remediationEndDate: e.target.value}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"/>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowManual(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
              <button type="submit" disabled={manualSaving} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg disabled:opacity-60">
                {manualSaving ? 'Guardando...' : 'Crear hallazgo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── CSV Import modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form onSubmit={handleImport} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Importar hallazgos desde CSV</h4>
            <a href={getFindingsImportTemplateUrl()} download className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 text-sm">
              ⬇ Descargar plantilla CSV
            </a>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Archivo CSV o Excel (máx. 5MB)</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null) }}
                className="text-sm text-slate-400 file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-slate-700 file:text-slate-300 file:text-xs cursor-pointer"/>
            </div>
            {importResult && (
              <div className={`text-sm p-3 rounded-lg ${importResult.errors.length > 0 ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                ✓ Importados: {importResult.imported}{importResult.errors.length > 0 && ` | Errores: ${importResult.errors.length}`}
                {importResult.errors.map(e => <p key={e.row} className="text-xs mt-1">Fila {e.row}: {e.error}</p>)}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cerrar</button>
              <button type="submit" disabled={!importFile || importLoading} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg disabled:opacity-60">
                {importLoading ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Sub-tab navigation ── */}
      <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1">
        {([
          { id: 'plan',      label: 'Plan Activo',    icon: '⚑' },
          { id: 'registro',  label: 'Registro F-RI-25', icon: '📋' },
          { id: 'historial', label: 'Historial',      icon: '🗂' },
        ] as { id: SubTab; label: string; icon: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              subTab === t.id
                ? 'bg-slate-700 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-[11px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      {!readOnly && (
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-slate-100 text-xs font-medium rounded-lg transition-colors">
            ⬆ Importar CSV
          </button>
          <button onClick={() => setShowManual(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg transition-colors">
            + Hallazgo manual
          </button>
        </div>
      )}
      </div>{/* end flex-wrap row */}

      {/* Historial & Registro rendered directly */}
      {subTab === 'historial' && <RemediationHistory />}
      {subTab === 'registro'  && <RemediationTracker readOnly={readOnly} />}

      {/* Plan Activo (existing UI) */}
      {subTab === 'plan' && (<>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Plan de Remediación</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {criticalCount} críticos · {highCount} altos · {withAI} con análisis AI
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
            {[null, 'CRITICAL', 'HIGH'].map(s => (
              <button
                key={s ?? 'all'}
                onClick={() => setFilterSev(s)}
                className={`px-3 py-1.5 transition-colors ${
                  filterSev === s
                    ? s === 'CRITICAL' ? 'bg-rose-600 text-white'
                      : s === 'HIGH'   ? 'bg-orange-600 text-white'
                      : 'bg-slate-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s ?? 'Todos'}
              </button>
            ))}
          </div>
          {/* Expand all */}
          <button
            onClick={() => setExpanded(displayed.length === expanded.size ? new Set() : new Set(displayed.map((f: any) => f.id)))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300 hover:text-slate-100 transition-colors"
          >
            {expanded.size > 0 ? 'Colapsar todo' : 'Expandir todo'}
          </button>
          {/* Export */}
          <button
            onClick={handleCopy}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${copied ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            {copied ? '✓ Copiado' : 'Copiar reporte'}
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-700 border border-violet-600 text-white hover:bg-violet-600 transition-colors"
          >
            Descargar .txt
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-12 justify-center text-slate-400">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Cargando hallazgos críticos y altos…
        </div>
      )}

      {!isLoading && displayed.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium">Sin hallazgos críticos ni altos abiertos</p>
        </div>
      )}

      <div className="space-y-3">
        {displayed.map((f: any) => {
          const ai = f.aiAnalysis
          const plan: RemediationPlan | null = ai?.remediationPlan ?? null
          const isOpen = expanded.has(f.id)
          const asset  = f.asset?.domain ?? f.asset?.ip ?? 'N/A'

          return (
            <div
              key={f.id}
              className={`bg-slate-900 border border-slate-700 rounded-xl border-l-4 ${SEV_BORDER[f.severity] ?? 'border-l-slate-600'} overflow-hidden`}
            >
              {/* Row header */}
              <button
                onClick={() => toggle(f.id)}
                className="w-full flex items-start justify-between gap-4 p-4 text-left hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className={`shrink-0 mt-0.5 text-xs font-bold px-2 py-0.5 rounded border ${SEV_COLOR[f.severity]}`}>
                    {f.severity}
                  </span>
                  <div className="min-w-0">
                    <p className="text-slate-100 font-medium text-sm leading-snug">{f.title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {asset} · {f.sourceTool} · {f.cve ?? 'Sin CVE'}
                      {f.cvss ? ` · CVSS ${f.cvss}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.remediationStatus && STATUS_META[f.remediationStatus] && (
                    <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_META[f.remediationStatus].cls}`}>
                      {STATUS_META[f.remediationStatus].label}
                    </span>
                  )}
                  {ai ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/25">AI ✓</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-500">Pendiente AI</span>
                  )}
                  {/* Per-card reanalyze button — hidden for read-only roles */}
                  {!readOnly && (
                    <button
                      onClick={e => { e.stopPropagation(); handleCardReanalyze(f.id) }}
                      disabled={reanalyzingCards.has(f.id)}
                      title="Re-analizar con IA"
                      className={`p-1 rounded transition-colors ${
                        reanalyzingCards.has(f.id)
                          ? 'text-sky-400 cursor-wait'
                          : 'text-slate-500 hover:text-sky-400'
                      }`}
                    >
                      <svg className={`w-4 h-4 ${reanalyzingCards.has(f.id) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                    </button>
                  )}
                  <svg
                    className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>
              </button>

              {/* Expanded content */}
              {isOpen && (
                <div className="px-4 pb-5 space-y-4 border-t border-slate-700/60 pt-4">
                  {/* Tracking bar */}
                  <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">Seguimiento</span>
                    <select
                      value={f.remediationStatus ?? ''}
                      onChange={e => !readOnly && handleTrackingChange(f.id, 'status', e.target.value)}
                      disabled={readOnly}
                      className={`border text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                        readOnly
                          ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                          : 'bg-slate-700 border-slate-600 text-slate-200'
                      }`}
                    >
                      <option value="">Sin estado</option>
                      <option value="PENDIENTE">Pendiente</option>
                      <option value="EN_TRAMITE">En trámite</option>
                      <option value="PLAN_ACCION">Plan acción</option>
                      <option value="PROCESADO">Procesado</option>
                    </select>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Inicio</span>
                      <input
                        type="date"
                        value={toDateInputValue(f.remediationStartDate)}
                        onChange={e => !readOnly && handleTrackingChange(f.id, 'startDate', e.target.value)}
                        readOnly={readOnly}
                        className={`border text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                          readOnly
                            ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-700 border-slate-600 text-slate-200'
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">Fin</span>
                      <input
                        type="date"
                        value={toDateInputValue(f.remediationEndDate)}
                        onChange={e => !readOnly && handleTrackingChange(f.id, 'endDate', e.target.value)}
                        readOnly={readOnly}
                        className={`border text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                          readOnly
                            ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-700 border-slate-600 text-slate-200'
                        }`}
                      />
                    </div>
                  </div>
                  {ai ? (
                    <>
                      {ai.summary && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Análisis técnico</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{ai.summary}</p>
                        </div>
                      )}
                      {ai.businessImpact && (
                        <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-3">
                          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Impacto al negocio</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{ai.businessImpact}</p>
                        </div>
                      )}
                      {plan ? (
                        <div className="space-y-3">
                          <div className="grid md:grid-cols-3 gap-4">
                            <PlanPhase label="Inmediato"   color="text-rose-400"  timeCls="bg-rose-500/15 text-rose-400"   items={plan.immediate} time={plan.immediateTime  ?? '0-24h'}   />
                            <PlanPhase label="Corto plazo" color="text-amber-400" timeCls="bg-amber-500/15 text-amber-400" items={plan.shortTerm} time={plan.shortTermTime ?? '1-7 días'} />
                            <PlanPhase label="Largo plazo" color="text-blue-400"  timeCls="bg-blue-500/15 text-blue-400"   items={plan.longTerm}  time={plan.longTermTime  ?? '1-4 sem'}  />
                          </div>
                          {plan.observations && (
                            <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3">
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Observaciones</p>
                              <p className="text-sm text-slate-300 leading-relaxed">{plan.observations}</p>
                            </div>
                          )}
                        </div>
                      ) : ai.remediation ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Plan de remediación</p>
                          <ul className="space-y-1">
                            {ai.remediation.split('\n').filter(Boolean).map((s: string, i: number) => (
                              <li key={i} className="flex gap-2 text-sm text-slate-300">
                                <span className="text-violet-400 shrink-0">•</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-slate-500 text-sm">
                      Análisis AI pendiente. Haz clic en "Analyze" en la tabla de Findings para generarlo.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </>)}
    </div>
  )
}
