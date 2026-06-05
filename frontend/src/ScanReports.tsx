import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchReports, fetchReport, generateReport, fetchAiReport, fetchAiReports, triggerAiReport, fetchJobs, cancelScan, cancelAllStaleScans,
  ScanReportSummary, ScanReportDetail, ScanFinding, AiScanReport, SegmentAnalysis,
} from './api'

const ORG = 'org_demo'

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-300 border border-red-500/30',
  HIGH:     'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  MEDIUM:   'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  LOW:      'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  INFO:     'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

const DOMAIN_SEGMENTS = [
  { key: 'network', icon: '🌐', label: 'Red / Perímetro',        tools: ['subfinder', 'amass', 'httpx'],                                       accent: 'border-blue-500/30'    },
  { key: 'ports',   icon: '🔌', label: 'Puertos / Servicios',     tools: ['nmap'],                                                               accent: 'border-violet-500/30'  },
  { key: 'web',     icon: '🌍', label: 'Web / Aplicación',        tools: ['nikto', 'gobuster', 'ffuf', 'nuclei', 'dalfox', 'katana', 'whatweb'], accent: 'border-orange-500/30'  },
  { key: 'tls',     icon: '🔒', label: 'TLS / Configuración',     tools: ['sslscan', 'testssl'],                                                  accent: 'border-emerald-500/30' },
  { key: 'secrets', icon: '🔑', label: 'Secretos / Credenciales', tools: ['trufflehog'],                                                          accent: 'border-rose-500/30'    },
] as const
type SegKey = typeof DOMAIN_SEGMENTS[number]['key']

function SevBadge({ s, count }: { s: string; count: number }) {
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEV_COLOR[s] ?? SEV_COLOR.INFO}`}>{s[0]}: {count}</span>
}

function RiskDelta({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.1) return <span className="text-slate-500 text-xs">sin cambio</span>
  const up = delta > 0
  return <span className={`text-xs font-medium ${up ? 'text-red-400' : 'text-emerald-400'}`}>{up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}</span>
}

function RiskLevelBadge({ level }: { level: string }) {
  const c: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/40', HIGH: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    MEDIUM: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', LOW: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    INFO: 'bg-slate-500/20 text-slate-400 border-slate-500/40', 'N/A': 'bg-slate-700/20 text-slate-500 border-slate-600/40',
  }
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${c[level] ?? c.INFO}`}>{level}</span>
}

function FindingRow({ f }: { f: ScanFinding }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-700/60 rounded-lg overflow-hidden">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40 transition-colors" onClick={() => setOpen(v => !v)}>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEV_COLOR[f.severity] ?? SEV_COLOR.INFO}`}>{f.severity}</span>
        <span className="text-slate-200 text-xs flex-1 truncate">{f.title}</span>
        {f.seenCount > 1 && <span className="text-slate-500 text-[10px] shrink-0">x{f.seenCount}</span>}
        {f.cve && <span className="text-cyan-400 text-[10px] shrink-0">{f.cve}</span>}
        <span className="text-slate-600 text-[10px] shrink-0">{f.sourceTool}</span>
        <span className="text-slate-500 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 bg-slate-900/50 space-y-1">
          {f.description && <p className="text-slate-400 text-xs leading-relaxed">{f.description}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="text-slate-500 text-[10px]">Categoría: <span className="text-slate-300">{f.category}</span></span>
            {f.cvss && <span className="text-slate-500 text-[10px]">CVSS: <span className="text-orange-300 font-bold">{f.cvss}</span></span>}
            {f.lastSeenAt && <span className="text-slate-500 text-[10px]">Visto: <span className="text-slate-300">{new Date(f.lastSeenAt).toLocaleDateString('es')}</span></span>}
          </div>
        </div>
      )}
    </div>
  )
}

function FindingsSection({ title, items, accent, defaultOpen = false }: { title: string; items: ScanFinding[]; accent: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (items.length === 0) return null
  return (
    <div className={`border ${accent} rounded-xl overflow-hidden`}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors">
        <span className="font-medium text-slate-200 text-sm">{title}</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">{SEV_ORDER.filter(s => items.some(f => f.severity === s)).map(s => <SevBadge key={s} s={s} count={items.filter(f => f.severity === s).length} />)}</div>
          <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 space-y-1.5">{items.map(f => <FindingRow key={f.id} f={f} />)}</div>}
    </div>
  )
}

function DomainSegmentCard({ icon, label, accent, analysis, newItems, recurringItems, staleItems }: {
  icon: string; label: string; accent: string; analysis?: SegmentAnalysis
  newItems: ScanFinding[]; recurringItems: ScanFinding[]; staleItems: ScanFinding[]
}) {
  const [open, setOpen] = useState(true)
  const total = newItems.length + recurringItems.length + staleItems.length
  if (total === 0 && !analysis?.summary) return null
  return (
    <div className={`border ${accent} rounded-xl overflow-hidden`}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="font-medium text-slate-200 text-sm">{label}</span>
          {analysis?.riskLevel && <RiskLevelBadge level={analysis.riskLevel} />}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {newItems.length > 0        && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">🔴 {newItems.length} nuevo{newItems.length !== 1 ? 's' : ''}</span>}
          {recurringItems.length > 0  && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">🔁 {recurringItems.length} recurrente{recurringItems.length !== 1 ? 's' : ''}</span>}
          {staleItems.length > 0      && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 border border-slate-600/30">⬜ {staleItems.length} sin confirmar</span>}
          {total === 0                && <span className="text-[10px] text-slate-500">Sin hallazgos</span>}
          <span className="text-slate-500 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {analysis?.summary && (
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 space-y-2">
              <p className="text-slate-300 text-xs leading-relaxed">{analysis.summary}</p>
              {analysis.deltaNote && analysis.deltaNote !== 'N/A' && <p className="text-amber-400/80 text-xs italic">↕ {analysis.deltaNote}</p>}
              {analysis.findings?.length > 0 && (
                <div className="pt-1">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Hallazgos clave de la IA</p>
                  <ul className="space-y-0.5">{analysis.findings.map((f, i) => <li key={i} className="text-slate-400 text-[11px] flex gap-1.5"><span className="text-slate-600 shrink-0">•</span>{f}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {(analysis?.recommendations?.length ?? 0) > 0 && (
            <div className="space-y-1">{(analysis!.recommendations ?? []).map((rec, i) => <p key={i} className="text-emerald-400/80 text-xs flex gap-1.5"><span className="shrink-0">→</span>{rec}</p>)}</div>
          )}
          <FindingsSection title={`Nuevos (${newItems.length})`}            items={newItems}       accent="border-red-500/20"   defaultOpen={newItems.length > 0 && newItems.length <= 5} />
          <FindingsSection title={`Recurrentes (${recurringItems.length})`} items={recurringItems} accent="border-amber-500/20" />
          <FindingsSection title={`Sin confirmar (${staleItems.length})`}   items={staleItems}     accent="border-slate-600/30" />
        </div>
      )}
    </div>
  )
}

const SCORE_COLOR = (s: number) => s >= 8 ? 'text-red-400' : s >= 5 ? 'text-amber-400' : 'text-emerald-400'
const SCORE_BG    = (s: number) => s >= 8 ? 'bg-red-500/15 border-red-500/30' : s >= 5 ? 'bg-amber-500/15 border-amber-500/30' : 'bg-emerald-500/15 border-emerald-500/30'
const RISK_SEV_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/40', HIGH: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-300 border-amber-500/40', LOW: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
}

function AiReportPanel({ report }: { report: AiScanReport }) {
  const roadmap = report.remediationRoadmap as any
  const phases = [{ key: 'immediate', label: '🔴 Inmediato' }, { key: 'shortTerm', label: '🟡 Corto plazo' }, { key: 'mediumTerm', label: '🟢 Medio plazo' }]
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <div className={`rounded-2xl border px-5 py-3 text-center ${SCORE_BG(report.score)}`}>
          <p className="text-slate-400 text-[10px] uppercase tracking-widest mb-1">Riesgo IA</p>
          <p className={`text-4xl font-black ${SCORE_COLOR(report.score)}`}>{report.score}<span className="text-lg text-slate-500">/10</span></p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-slate-300 text-sm font-semibold">{report.asset}</p>
          <p className="text-slate-500 text-xs mt-0.5">{new Date(report.createdAt).toLocaleString('es')} · {report.provider} / <code className="text-slate-400">{report.model}</code></p>
        </div>
      </div>
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Resumen ejecutivo</h3>
        <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{report.executiveSummary}</p>
      </div>
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Análisis técnico</h3>
        <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">{report.technicalSummary}</p>
      </div>
      {report.topRisks?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Top riesgos</h3>
          <div className="space-y-3">
            {report.topRisks.map((risk, i) => (
              <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start gap-2 mb-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${RISK_SEV_COLOR[risk.severity] ?? RISK_SEV_COLOR.MEDIUM}`}>{risk.severity}</span>
                  <p className="text-slate-200 text-sm font-medium">{risk.title}</p>
                  {risk.cvssEstimate && <span className="ml-auto text-xs text-slate-500 shrink-0">CVSS {risk.cvssEstimate}</span>}
                </div>
                <p className="text-slate-400 text-xs mb-1.5">{risk.businessImpact}</p>
                <p className="text-slate-500 text-xs mb-1.5">{risk.technicalContext}</p>
                <p className="text-emerald-400/80 text-xs">→ {risk.recommendedAction}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {report.attackSurface && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Superficie de ataque</h3>
          {report.attackSurface.perimeter && <p className="text-slate-300 text-xs mb-3">{report.attackSurface.perimeter}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {report.attackSurface.technologiesAtRisk?.length > 0 && (
              <div><p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Tecnologías en riesgo</p>
                <div className="flex flex-wrap gap-1">{report.attackSurface.technologiesAtRisk.map((t, i) => <span key={i} className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-md border border-slate-600">{t}</span>)}</div>
              </div>
            )}
            {report.attackSurface.dataExposureIndicators?.length > 0 && (
              <div><p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Exposición de datos</p>
                <ul className="space-y-0.5">{report.attackSurface.dataExposureIndicators.map((d, i) => <li key={i} className="text-amber-400/80 text-xs">⚠ {d}</li>)}</ul>
              </div>
            )}
          </div>
          {report.attackSurface.exposedServices?.length > 0 && (
            <div className="mt-3"><p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Servicios expuestos</p>
              <div className="flex flex-wrap gap-2">{report.attackSurface.exposedServices.map((svc, i) => (
                <div key={i} className="text-[10px] bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                  <span className="text-slate-300 font-mono">{svc.port}/{svc.service}</span>
                  {svc.risk && <span className="text-slate-500 ml-1">— {svc.risk}</span>}
                </div>
              ))}</div>
            </div>
          )}
        </div>
      )}
      {roadmap && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Hoja de ruta de remediación</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {phases.map(({ key, label }) => {
              const phase = roadmap[key]; if (!phase) return null
              return (
                <div key={key} className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
                  <p className="text-slate-300 text-xs font-semibold mb-1">{label}</p>
                  {phase.focus && <p className="text-slate-400 text-[11px] mb-2 italic">{phase.focus}</p>}
                  {phase.estimatedTime && <p className="text-slate-500 text-[10px] mb-2">⏱ {phase.estimatedTime}</p>}
                  <ul className="space-y-1">{(phase.actions ?? []).map((a: string, i: number) => <li key={i} className="text-slate-300 text-[11px] flex gap-1.5"><span className="text-slate-600 shrink-0">•</span>{a}</li>)}</ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {report.complianceFlags && report.complianceFlags.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-2">Indicadores de cumplimiento</h3>
          <div className="flex flex-wrap gap-2">{report.complianceFlags.map((f, i) => <span key={i} className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md">{f}</span>)}</div>
        </div>
      )}
    </div>
  )
}

function InlineReportPanel({ summary, onClose }: { summary: ScanReportSummary; onClose: () => void }) {
  const qc = useQueryClient()
  const [activeView, setActiveView] = useState<'domains' | 'delta' | 'ai'>('domains')

  const { data: report, isLoading } = useQuery({ queryKey: ['report', summary.scanId], queryFn: () => fetchReport(summary.scanId) })
  const { data: aiReport, isLoading: aiLoading } = useQuery({ queryKey: ['ai-report', summary.scanId], queryFn: () => fetchAiReport(summary.scanId), retry: false })
  const generate = useMutation({
    mutationFn: () => generateReport(summary.scanId, true),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['report', summary.scanId] }); qc.invalidateQueries({ queryKey: ['scan-reports'] }) },
  })

  const exportJson = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `informe-${report.domain}-${new Date(report.createdAt).toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url)
  }
  const exportTxt = () => {
    if (!report) return
    const detail = report as ScanReportDetail
    const lines = ['INFORME DE ESCANEO DE SEGURIDAD', '================================', '',
      `Dominio:       ${report.domain}`, `Fecha:         ${new Date(report.createdAt).toLocaleString('es')}`,
      `Herramientas:  ${report.tools.join(', ')}`, `Duración:      ${report.durationSec ? `${Math.round(report.durationSec / 60)} min` : 'N/A'}`, '',
      'RESUMEN EJECUTIVO', '-----------------',
      `Riesgo actual:      ${report.riskScore.toFixed(1)} / 100`, `Cambio vs anterior: ${report.riskScoreDelta > 0 ? '+' : ''}${report.riskScoreDelta.toFixed(1)}`, '',
      `Hallazgos totales abiertos: ${report.totalOpen}`, `  Nuevos:          ${report.newFindings}`, `  Recurrentes:     ${report.recurringFindings}`, `  Sin confirmar:   ${report.staleFindings}`, '',
      'NUEVOS HALLAZGOS CRITICOS Y ALTOS', '----------------------------------',
      ...(detail.newFindingsList ?? []).filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').map(f => `  [${f.severity}] ${f.title}${f.cve ? ` (${f.cve})` : ''}`),
      '', 'Generado por CEM Platform']
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `informe-gerencial-${report.domain}-${new Date(report.createdAt).toISOString().slice(0, 10)}.txt`; a.click(); URL.revokeObjectURL(url)
  }

  const detail = report && 'newFindingsList' in report ? report as ScanReportDetail : null
  const segmented = aiReport?.segmentedAnalysis as Record<SegKey, SegmentAnalysis> | null | undefined

  return (
    <div className="border-t border-slate-700/60 bg-slate-950/30 rounded-b-xl" onClick={e => e.stopPropagation()}>
      {report && (
        <div className="px-5 pt-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Score de riesgo', value: report.riskScore.toFixed(1), sub: <RiskDelta delta={report.riskScoreDelta} />, border: 'border-slate-700' },
            { label: '🔴 Nuevos',        value: report.newFindings,          sub: 'hallazgos nuevos',       border: 'border-red-500/40'   },
            { label: '🔁 Recurrentes',   value: report.recurringFindings,    sub: 'ya conocidos',           border: 'border-amber-500/40' },
            { label: '⬜ Sin confirmar',  value: report.staleFindings,        sub: 'verificar si resueltos', border: 'border-slate-600/40' },
          ].map(({ label, value, sub, border }) => (
            <div key={label} className={`bg-slate-900/70 rounded-xl p-3 border ${border}`}>
              <p className="text-slate-500 text-[10px] uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">{value}</p>
              <div className="text-slate-500 text-[10px] mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      )}
      <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {([{ id: 'domains' as const, label: '🌐 Por dominio' }, { id: 'delta' as const, label: '📊 Delta completo' }, { id: 'ai' as const, label: '🤖 Análisis IA' }]).map(v => (
            <button key={v.id} onClick={() => setActiveView(v.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeView === v.id ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          {report && (<>
            <button onClick={exportJson} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-600 transition-colors">↓ JSON</button>
            <button onClick={exportTxt}  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-600 transition-colors">↓ Gerencial</button>
          </>)}
          <button onClick={() => generate.mutate()} disabled={generate.isPending}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors disabled:opacity-50">
            {generate.isPending ? '⏳ Regenerando...' : '↻ Regenerar'}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-700 transition-colors">
            ✕ Cerrar
          </button>
        </div>
      </div>
      <div className="px-5 pb-5 space-y-3">
        {isLoading && <div className="py-8 text-center text-slate-400 text-sm">Cargando informe…</div>}
        {!isLoading && !report && (
          <div className="py-8 text-center space-y-3">
            <p className="text-slate-400 text-sm">El informe no ha sido generado aún.</p>
            <button onClick={() => generate.mutate()} disabled={generate.isPending}
              className="px-4 py-2 text-sm bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors disabled:opacity-50">
              {generate.isPending ? '⏳ Generando…' : 'Generar informe'}
            </button>
          </div>
        )}
        {activeView === 'domains' && report && (
          <div className="space-y-3">
            {!aiLoading && !segmented && (
              <div className="bg-slate-800/30 border border-slate-700/40 rounded-lg px-4 py-2 text-xs text-slate-500">
                ℹ El análisis IA segmentado aún no está disponible para este scan. Los hallazgos se muestran agrupados por dominio de seguridad.
              </div>
            )}
            {DOMAIN_SEGMENTS.map(seg => (
              <DomainSegmentCard key={seg.key} icon={seg.icon} label={seg.label} accent={seg.accent}
                analysis={segmented?.[seg.key as SegKey]}
                newItems={(detail?.newFindingsList ?? []).filter(f => (seg.tools as readonly string[]).includes(f.sourceTool))}
                recurringItems={(detail?.recurringFindingsList ?? []).filter(f => (seg.tools as readonly string[]).includes(f.sourceTool))}
                staleItems={(detail?.staleFindingsList ?? []).filter(f => (seg.tools as readonly string[]).includes(f.sourceTool))}
              />
            ))}
          </div>
        )}
        {activeView === 'delta' && detail && (<>
          {Object.keys(report?.newBySeverity ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-1">
              <span className="text-slate-500 text-xs self-center">Nuevos por severidad:</span>
              {SEV_ORDER.filter(s => report?.newBySeverity[s]).map(s => <SevBadge key={s} s={s} count={report!.newBySeverity[s]} />)}
            </div>
          )}
          <FindingsSection title={`Nuevos hallazgos (${detail.newFindingsList.length})`}                             items={detail.newFindingsList}       accent="border-red-500/30"    defaultOpen />
          <FindingsSection title={`Recurrentes — confirmados en este scan (${detail.recurringFindingsList.length})`} items={detail.recurringFindingsList} accent="border-amber-500/30" />
          <FindingsSection title={`Sin confirmar — verificar si están resueltos (${detail.staleFindingsList.length})`} items={detail.staleFindingsList}   accent="border-slate-600/50" />
          {detail.staleFindingsList.length > 0 && (
            <p className="text-slate-500 text-xs border border-slate-700 rounded-lg px-3 py-2">
              ℹ Los hallazgos "sin confirmar" estaban abiertos antes pero no aparecieron en este scan. Pueden estar resueltos o la herramienta no los detectó. Verificar antes de cerrarlos.
            </p>
          )}
        </>)}
        {activeView === 'ai' && (
          aiLoading ? <div className="py-8 text-center text-slate-400 text-sm">Cargando informe ejecutivo IA…</div>
          : !aiReport ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-3xl">🤖</p>
              <p className="text-slate-300 text-sm font-medium">Informe ejecutivo IA no disponible aún</p>
              <p className="text-slate-500 text-xs max-w-sm mx-auto">Se genera automáticamente al completar el escaneo.</p>
            </div>
          ) : <AiReportPanel report={aiReport} />
        )}
      </div>
    </div>
  )
}

function AiReportsList() {
  const qc = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)
  const { data: aiReports = [], isLoading, refetch } = useQuery({ queryKey: ['ai-reports-list', ORG], queryFn: () => fetchAiReports(ORG), refetchInterval: 20_000 })
  const { data: scanJobs = [] } = useQuery({ queryKey: ['scan-jobs', ORG], queryFn: () => fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/v1/reports/jobs?orgId=${ORG}`).then(r => r.json()) })
  const hasPendingJobs = (scanJobs as any[]).some((j: any) => j.status === 'RUNNING' || j.status === 'PENDING')
  const handleTrigger = async (scanId: string, e: React.MouseEvent) => {
    e.stopPropagation(); setTriggering(scanId)
    try { await triggerAiReport(scanId, ORG); setTimeout(() => { refetch(); qc.invalidateQueries({ queryKey: ['ai-reports-list'] }); setTriggering(null) }, 6000) }
    catch { setTriggering(null) }
  }
  if (isLoading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Cargando informes IA…</div>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">🤖 Informes Ejecutivos IA</h2>
          <p className="text-slate-400 text-sm mt-0.5">Análisis consolidado por IA: score de riesgo, top amenazas, hoja de ruta y análisis segmentado por dominio</p>
        </div>
        <button onClick={() => refetch()} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors">↻ Actualizar</button>
      </div>
      {aiReports.length === 0 ? (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-10 text-center space-y-3">
          <p className="text-3xl">🤖</p>
          <p className="text-slate-300 text-sm font-medium">No hay informes ejecutivos IA disponibles</p>
          <p className="text-slate-500 text-xs max-w-md mx-auto">Los informes se generan automáticamente al completar un escaneo.</p>
          {hasPendingJobs && <p className="text-amber-400 text-xs">⏳ Hay scans en curso — el informe aparecerá al finalizar</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {aiReports.map(r => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} className={`bg-slate-900 border rounded-xl transition-colors ${isExpanded ? 'border-rose-700/40' : 'border-slate-700 hover:border-slate-600'}`}>
                <div className="flex items-center justify-between gap-4 flex-wrap p-4 cursor-pointer" onClick={() => setExpandedId(v => v === r.id ? null : r.id)}>
                  <div className={`rounded-xl border px-4 py-2 text-center shrink-0 ${SCORE_BG(r.score)}`}>
                    <p className="text-slate-500 text-[9px] uppercase tracking-widest">Riesgo</p>
                    <p className={`text-2xl font-black ${SCORE_COLOR(r.score)}`}>{r.score}<span className="text-xs text-slate-500">/10</span></p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-100 text-sm font-semibold">{r.asset}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{new Date(r.createdAt).toLocaleString('es')} · <span className="text-slate-400">{r.provider} / {r.model}</span>
                      {r.segmentedAnalysis && <span className="ml-2 text-emerald-500/70 text-[10px]">✓ análisis segmentado</span>}
                    </p>
                    {r.topRisks?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {r.topRisks.slice(0, 3).map((risk, i) => <span key={i} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${RISK_SEV_COLOR[risk.severity] ?? RISK_SEV_COLOR.MEDIUM}`}>{risk.severity[0]}: {risk.title.slice(0, 30)}{risk.title.length > 30 ? '…' : ''}</span>)}
                        {r.topRisks.length > 3 && <span className="text-[10px] text-slate-500">+{r.topRisks.length - 3} más</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={e => handleTrigger(r.scanId, e)} disabled={triggering === r.scanId}
                      className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors disabled:opacity-50">
                      {triggering === r.scanId ? '⏳ Encolando…' : '↻ Regenerar'}
                    </button>
                    <span className="text-slate-500 text-xs">{isExpanded ? '▲ Cerrar' : '▼ Ver'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-slate-700/60 px-5 py-5" onClick={e => e.stopPropagation()}>
                    <AiReportPanel report={r} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TechnicalReportsList() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState('')
  const qc = useQueryClient()
  const { data: reports = [], isLoading: reportsLoading } = useQuery({ queryKey: ['scan-reports', ORG], queryFn: () => fetchReports(ORG), refetchInterval: 20_000 })
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({ queryKey: ['scan-jobs', ORG], queryFn: () => fetchJobs(ORG), refetchInterval: 15_000 })
  const genMut = useMutation({ mutationFn: (scanId: string) => generateReport(scanId, true), onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-reports', ORG] }) })
  const cancelMut = useMutation({ mutationFn: (scanId: string) => cancelScan(scanId), onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-jobs', ORG] }) })
  const cancelAllMut = useMutation({ mutationFn: () => cancelAllStaleScans(ORG), onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-jobs', ORG] }) })
  const isLoading = reportsLoading || jobsLoading
  const reportScanIds = new Set(reports.map(r => r.scanId))
  const pendingJobs = jobs.filter(j => j.status === 'DONE' && !reportScanIds.has(j.scanId))
  const runningJobs = jobs.filter(j => j.status === 'RUNNING')
  const domains = [...new Set([...reports.map(r => r.domain), ...pendingJobs.map(j => j.domain)])].sort()
  const filtered        = domainFilter ? reports.filter(r => r.domain === domainFilter)    : reports
  const filteredPending = domainFilter ? pendingJobs.filter(j => j.domain === domainFilter) : pendingJobs
  const filteredRunning = domainFilter ? runningJobs.filter(j => j.domain === domainFilter) : runningJobs
  const hasAny = filtered.length > 0 || filteredPending.length > 0 || filteredRunning.length > 0
  if (isLoading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Cargando informes…</div>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">📊 Delta técnico por escaneo</h2>
          <p className="text-slate-400 text-sm mt-0.5">Nuevos hallazgos, recurrentes y sin confirmar — organizados por dominio de seguridad</p>
        </div>
        {domains.length > 1 && (
          <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5">
            <option value="">Todos los dominios</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>
      {!hasAny ? (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-12 text-center">
          <p className="text-slate-400 text-sm">No hay informes disponibles.</p>
          <p className="text-slate-500 text-xs mt-2">Los informes se generan automáticamente al completar un escaneo.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRunning.length > 0 && (
            <div className="flex justify-end">
              <button onClick={() => cancelAllMut.mutate()} disabled={cancelAllMut.isPending}
                className="text-xs px-3 py-1.5 rounded border border-rose-700/40 text-rose-400 bg-rose-900/20 hover:bg-rose-900/40 disabled:opacity-40 transition-colors">
                {cancelAllMut.isPending ? 'Cancelando…' : '✕ Cancelar todos los scans activos'}
              </button>
            </div>
          )}
          {filteredRunning.map(j => (
            <div key={j.scanId} className="bg-slate-900 border border-violet-700/30 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-violet-400 text-xs animate-pulse font-medium">⟳ Escaneando…</span>
                  <span className="font-medium text-slate-200 text-sm">{j.domain}</span>
                  <span className="text-slate-500 text-xs">{new Date(j.startedAt).toLocaleString('es')}</span>
                  <div className="flex flex-wrap gap-1">{j.tools.map(t => <span key={t} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">{t}</span>)}</div>
                </div>
                <button onClick={() => cancelMut.mutate(j.scanId)} disabled={cancelMut.isPending}
                  className="text-xs px-2.5 py-1 rounded border border-rose-700/40 text-rose-400 bg-rose-900/20 hover:bg-rose-900/40 disabled:opacity-40 transition-colors shrink-0">
                  {cancelMut.isPending ? '…' : '✕ Cancelar'}
                </button>
              </div>
            </div>
          ))}
          {filteredPending.map(j => (
            <div key={j.scanId} className="bg-slate-900 border border-amber-700/30 rounded-xl p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-xs font-medium">✓ Completado sin informe</span>
                    <span className="font-medium text-slate-200 text-sm">{j.domain}</span>
                    <span className="text-slate-500 text-xs">{j.completedAt ? new Date(j.completedAt).toLocaleString('es') : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">{j.tools.map(t => <span key={t} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">{t}</span>)}</div>
                </div>
                <button onClick={() => genMut.mutate(j.scanId)} disabled={genMut.isPending}
                  className="text-xs px-3 py-1.5 rounded border border-amber-600/40 text-amber-400 bg-amber-900/20 hover:bg-amber-900/40 disabled:opacity-40 transition-colors">
                  {genMut.isPending ? 'Generando…' : 'Generar informe'}
                </button>
              </div>
            </div>
          ))}
          {filtered.map(r => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} className={`bg-slate-900 border rounded-xl transition-colors ${isExpanded ? 'border-rose-700/40' : 'border-slate-700 hover:border-slate-600'}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap p-4 cursor-pointer" onClick={() => setExpandedId(v => v === r.id ? null : r.id)}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-100 text-sm">{r.domain}</span>
                      <span className="text-slate-500 text-xs">{new Date(r.createdAt).toLocaleString('es')}</span>
                      {r.durationSec && <span className="text-slate-600 text-xs">{Math.round(r.durationSec / 60)} min</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">{r.tools.map(t => <span key={t} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">{t}</span>)}</div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 flex-wrap">
                    <div className="text-right">
                      <p className="text-slate-500 text-[10px] uppercase tracking-wide">Riesgo</p>
                      <p className="text-slate-100 text-base font-bold">{r.riskScore.toFixed(0)}</p>
                      <RiskDelta delta={r.riskScoreDelta} />
                    </div>
                    <div className="flex flex-col gap-1 text-xs">
                      {r.newFindings > 0       && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 shrink-0" /><span className="text-slate-300">{r.newFindings} nuevo{r.newFindings !== 1 ? 's' : ''}</span></span>}
                      {r.recurringFindings > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" /><span className="text-slate-400">{r.recurringFindings} recurrente{r.recurringFindings !== 1 ? 's' : ''}</span></span>}
                      {r.staleFindings > 0     && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" /><span className="text-slate-500">{r.staleFindings} sin confirmar</span></span>}
                      {r.newFindings === 0 && r.recurringFindings === 0 && r.staleFindings === 0 && <span className="text-slate-500 text-xs">Sin hallazgos</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 max-w-32">{SEV_ORDER.filter(s => r.bySeverity[s]).map(s => <SevBadge key={s} s={s} count={r.bySeverity[s]} />)}</div>
                    <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpanded && <InlineReportPanel summary={r} onClose={() => setExpandedId(null)} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ScanReports() {
  const [tab, setTab] = useState<'ai' | 'technical'>('ai')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1 w-fit">
        {([{ id: 'ai' as const, label: '🤖 Informe Ejecutivo IA' }, { id: 'technical' as const, label: '📊 Delta técnico' }]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${tab === t.id ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ai'        && <AiReportsList />}
      {tab === 'technical' && <TechnicalReportsList />}
    </div>
  )
}
