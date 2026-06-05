import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAssetFindings } from './api'
import AiPanel from './AiPanel'

const SEV_BADGE: Record<string, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-400',
  HIGH:     'bg-orange-500/20 text-orange-400',
  MEDIUM:   'bg-amber-500/20 text-amber-400',
  LOW:      'bg-blue-500/20 text-blue-400',
  INFO:     'bg-slate-500/20 text-slate-400',
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? 'bg-rose-500' : score >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-xs text-slate-400">{score}</span>
    </div>
  )
}

export default function AssetsView({ orgId = 'org_demo' }: { orgId?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [aiPanel, setAiPanel]   = useState<{ id: string; title: string; severity: string } | null>(null)

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', orgId],
    queryFn: () => fetchAssetFindings(orgId),
    refetchInterval: 30_000,
  })

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-slate-400">
        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        Cargando activos…
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Superficie de Ataque</h2>
            <p className="text-slate-400 text-sm mt-0.5">{assets.length} activos monitoreados</p>
          </div>
        </div>

        {assets.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <p className="text-4xl mb-3">🔍</p>
            <p className="font-medium">Sin activos aún</p>
            <p className="text-sm mt-1">Ejecuta un scan desde Kali para comenzar</p>
          </div>
        )}

        <div className="space-y-3">
          {assets.map((asset: any) => {
            const label   = asset.domain ?? asset.ip ?? asset.id
            const isOpen  = expanded.has(asset.id)
            const sev     = asset.findingsBySeverity
            const hasCrit = sev.CRITICAL > 0
            const hasHigh = sev.HIGH > 0

            return (
              <div key={asset.id} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggle(asset.id)}
                  className="w-full flex flex-wrap items-center gap-4 p-4 text-left hover:bg-slate-800/50 transition-colors"
                >
                  {/* Domain + criticality indicator */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${hasCrit ? 'bg-rose-500' : hasHigh ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                    <span className="font-medium text-slate-100 truncate">{label}</span>
                    <span className="text-xs text-slate-500 shrink-0">{asset.assetType}</span>
                  </div>

                  {/* Severity counts */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {Object.entries(sev as Record<string, number>)
                      .filter(([, count]) => count > 0)
                      .map(([s, count]) => (
                        <span key={s} className={`text-xs px-2 py-0.5 rounded font-medium ${SEV_BADGE[s]}`}>
                          {count} {s}
                        </span>
                      ))}
                    {asset.findings.length === 0 && (
                      <span className="text-xs text-slate-500">Sin hallazgos abiertos</span>
                    )}
                  </div>

                  {/* Exposure score */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">Exposición</span>
                    <ScoreBar score={asset.exposureScore} />
                  </div>

                  <svg
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-700/60">
                    {asset.findings.length === 0 ? (
                      <p className="p-4 text-sm text-slate-500">Sin hallazgos abiertos para este activo.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-800/60 text-slate-400 text-xs">
                          <tr>
                            <th className="px-4 py-2 font-medium text-left">Severidad</th>
                            <th className="px-4 py-2 font-medium text-left">Hallazgo</th>
                            <th className="px-4 py-2 font-medium text-left">Categoría</th>
                            <th className="px-4 py-2 font-medium text-left">Herramienta</th>
                            <th className="px-4 py-2 font-medium text-left">Fecha</th>
                            <th className="px-4 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {asset.findings.map((f: any) => (
                            <tr key={f.id} className="border-t border-slate-700/40 hover:bg-slate-800/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEV_BADGE[f.severity]}`}>{f.severity}</span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-200 max-w-xs">
                                <div className="flex items-start gap-1.5">
                                  <span className="line-clamp-2 leading-snug">{f.title}</span>
                                  {f.seenCount > 1 && (
                                    <span title={`Detectado ${f.seenCount} veces`} className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400 border border-slate-600 mt-0.5">
                                      ×{f.seenCount}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{f.category}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{f.sourceTool}</td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">
                                {new Date(f.createdAt).toLocaleDateString('es-CO')}
                              </td>
                              <td className="px-4 py-2.5">
                                <button
                                  onClick={() => setAiPanel({ id: f.id, title: f.title, severity: f.severity })}
                                  className="text-xs px-2.5 py-1 rounded bg-violet-600/20 text-violet-400 border border-violet-500/25 hover:bg-violet-600/30 transition-colors"
                                >
                                  AI
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {aiPanel && (
        <AiPanel finding={aiPanel} onClose={() => setAiPanel(null)} />
      )}
    </>
  )
}
