import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAuditLogs } from './api'

const TYPE_COLORS: Record<string, string> = {
  INGEST_RAW:  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  NORMALIZED:  'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  AI_ENQUEUED: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
}
const TYPE_LABELS: Record<string, string> = {
  INGEST_RAW:  'Crudo',
  NORMALIZED:  'Normalizado',
  AI_ENQUEUED: 'IA encolada',
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="text-[11px] text-emerald-300 bg-slate-950 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-96 overflow-y-auto border border-slate-700/50">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function LogRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false)
  const raw    = log.rawData    as any
  const parsed = log.parsedData as any
  const tool   = raw?.sourceTool ?? parsed?.sourceTool ?? '—'
  const asset  = raw?.assetId    ?? parsed?.assetId    ?? '—'
  const title  = raw?.title      ?? parsed?.title      ?? '—'
  const scanId = raw?.scanId     ?? '—'
  return (
    <div className="border border-slate-700/60 rounded-lg overflow-hidden">
      <button
        className="w-full grid grid-cols-[130px_110px_90px_180px_1fr_24px] gap-2 px-3 py-2 text-left hover:bg-slate-800/40 transition-colors items-center"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-slate-400 text-[11px] tabular-nums truncate">
          {new Date(log.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' })}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded w-fit ${TYPE_COLORS[log.type] ?? 'bg-slate-700 text-slate-300'}`}>
          {TYPE_LABELS[log.type] ?? log.type}
        </span>
        <span className="text-cyan-400 text-[11px] truncate">{tool}</span>
        <span className="text-slate-300 text-[11px] truncate">{asset}</span>
        <span className="text-slate-400 text-[11px] truncate">{title}</span>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 bg-slate-900/60 space-y-2">
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mb-2">
            <span>Scan: <span className="text-slate-300 font-mono">{scanId}</span></span>
            {log.findingId && <span>Finding: <span className="text-slate-300 font-mono">{log.findingId}</span></span>}
            {log.durationMs && <span>Duración: <span className="text-slate-300">{log.durationMs}ms</span></span>}
          </div>
          {log.rawData && (
            <div>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">rawData — enviado por el colector</p>
              <JsonBlock data={log.rawData} />
            </div>
          )}
          {log.parsedData && (
            <div>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">parsedData — tras normalización</p>
              <JsonBlock data={log.parsedData} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScanLogsView() {
  const [type,  setType]  = useState('')
  const [limit, setLimit] = useState('100')
  const [from,  setFrom]  = useState('')
  const [to,    setTo]    = useState('')

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', type, limit, from, to],
    queryFn: () => fetchAuditLogs({ type: type || undefined, limit: Number(limit), from: from || undefined, to: to || undefined }),
  })
  const logs = data as any[]
  const counts = logs.reduce<Record<string, number>>((acc, l) => { acc[l.type] = (acc[l.type] ?? 0) + 1; return acc }, {})
  const rawCount  = counts['INGEST_RAW']  ?? 0
  const normCount = counts['NORMALIZED']  ?? 0
  const dupRate   = rawCount > 0 ? Math.round(((rawCount - normCount) / rawCount) * 100) : 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Logs de Auditoría</h2>
          <p className="text-xs text-slate-500 mt-0.5">Registros brutos de ingestión, normalización y análisis IA — solo administrador</p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
        >
          ↻ Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <div key={key} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums text-slate-200">{counts[key] ?? 0}</p>
          </div>
        ))}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
          <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Tasa duplicados</p>
          <p className={`text-2xl font-bold mt-1 tabular-nums ${dupRate > 30 ? 'text-orange-400' : 'text-emerald-400'}`}>
            {rawCount > 0 ? `${dupRate}%` : '—'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Tipo</label>
          <select value={type} onChange={e => setType(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500">
            <option value="">Todos</option>
            <option value="INGEST_RAW">Crudo (INGEST_RAW)</option>
            <option value="NORMALIZED">Normalizado (NORMALIZED)</option>
            <option value="AI_ENQUEUED">IA encolada (AI_ENQUEUED)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Desde</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Hasta</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Límite</label>
          <select value={limit} onChange={e => setLimit(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500">
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-[130px_110px_90px_180px_1fr_24px] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        <span>Fecha</span><span>Tipo</span><span>Tool</span><span>Asset</span><span>Título</span><span></span>
      </div>

      <div className="space-y-1">
        {isLoading && <div className="text-center text-slate-500 text-sm py-12">Cargando logs...</div>}
        {error     && <div className="text-center text-rose-400 text-sm py-12">Error cargando logs</div>}
        {!isLoading && logs.length === 0 && <div className="text-center text-slate-600 text-sm py-12">No hay registros con los filtros seleccionados</div>}
        {logs.map((log: any) => <LogRow key={log.id} log={log} />)}
      </div>
    </div>
  )
}
