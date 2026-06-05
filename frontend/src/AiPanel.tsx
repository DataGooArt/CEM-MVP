import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAnalysis, triggerAnalysis } from './api'

const RISK_COLOR: Record<string, string> = {
  CRITICAL: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  HIGH:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  MEDIUM:   'text-amber-400 bg-amber-500/10 border-amber-500/30',
  LOW:      'text-blue-400 bg-blue-500/10 border-blue-500/30',
  INFO:     'text-slate-400 bg-slate-500/10 border-slate-500/30',
}

interface Props {
  finding: { id: string; title: string; severity: string }
  onClose: () => void
}

export default function AiPanel({ finding, onClose }: Props) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<'ollama' | 'gemini'>('ollama')
  const [reanalyzing, setReanalyzing] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analysis', finding.id],
    queryFn: () => fetchAnalysis(finding.id),
    retry: 3,
    retryDelay: 3000,
  })

  const mutation = useMutation({
    mutationFn: () => triggerAnalysis(finding.id, provider),
    onSuccess: async () => {
      setReanalyzing(true)
      // Poll until new analysis is ready (up to 120s)
      let attempts = 0
      const poll = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ['analysis', finding.id] })
        attempts++
        if (attempts >= 24) {
          clearInterval(poll)
          setReanalyzing(false)
        }
      }, 5000)
    },
  })

  const steps = data?.remediation?.split('\n').filter(Boolean) ?? []
  const isGemini = data?.model?.startsWith('gemini')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-700 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-violet-400 text-xs font-semibold uppercase tracking-wider bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded">
                AI Analysis
              </span>
            </div>
            <h2 className="text-slate-100 font-semibold text-base leading-snug max-w-lg">{finding.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors ml-4 shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 min-h-0">

        {/* Provider selector + Re-analyze */}
        <div className="flex items-center gap-3 px-6 pt-4">
          <span className="text-slate-500 text-xs">Re-analyze with:</span>
          <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
            <button
              onClick={() => setProvider('ollama')}
              className={`px-3 py-1.5 transition-colors ${provider === 'ollama' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              Local (Ollama)
            </button>
            <button
              onClick={() => setProvider('gemini')}
              className={`px-3 py-1.5 transition-colors ${provider === 'gemini' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
            >
              Cloud (Gemini)
            </button>
          </div>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || reanalyzing}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 transition-colors"
          >
            {(mutation.isPending || reanalyzing) ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Analyzing…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-analyze
              </>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="p-6 pt-4 space-y-5">
          {(isLoading || reanalyzing) && (
            <div className="flex flex-col items-center py-8 gap-3 text-slate-400">
              <svg className="animate-spin w-8 h-8 text-violet-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span className="text-sm">
                {reanalyzing ? `Waiting for ${provider === 'gemini' ? 'Gemini' : 'Ollama'} analysis…` : 'Waiting for AI analysis…'}
              </span>
            </div>
          )}

          {isError && !reanalyzing && (
            <div className="text-center py-6 text-slate-400 text-sm">
              Analysis not available yet. The AI worker will process this finding shortly.
            </div>
          )}

          {data && !reanalyzing && (
            <>
              {/* Risk Level */}
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm">Risk Level</span>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${RISK_COLOR[data.riskLevel] ?? RISK_COLOR.INFO}`}>
                  {data.riskLevel}
                </span>
                <span className={`text-xs ml-auto flex items-center gap-1.5 ${isGemini ? 'text-blue-400' : 'text-violet-400'}`}>
                  {isGemini ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2h-1" />
                    </svg>
                  )}
                  {data.model}
                </span>
              </div>

              {/* Summary */}
              <div>
                <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Resumen</h3>
                <p className="text-slate-200 text-sm leading-relaxed bg-slate-800 rounded-lg p-4">{data.summary}</p>
              </div>

              {/* Business Impact */}
              {data.businessImpact && (
                <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-4">
                  <h3 className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Impacto al Negocio</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{data.businessImpact}</p>
                </div>
              )}

              {/* Remediation — structured 3-phase if available */}
              {data.remediationPlan ? (
                <div className="space-y-3">
                  <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Plan de Remediación</h3>
                  {[
                    { key: 'immediate',  label: 'Inmediato',    timeKey: 'immediateTime',  defaultTime: '0–24h',    color: 'border-rose-500/40 bg-rose-500/5',     dot: 'bg-rose-500',  timeCls: 'bg-rose-500/15 text-rose-400'   },
                    { key: 'shortTerm',  label: 'Corto Plazo',  timeKey: 'shortTermTime',  defaultTime: '1–7 días', color: 'border-amber-500/40 bg-amber-500/5',   dot: 'bg-amber-400', timeCls: 'bg-amber-500/15 text-amber-400' },
                    { key: 'longTerm',   label: 'Largo Plazo',  timeKey: 'longTermTime',   defaultTime: '1–4 sem',  color: 'border-blue-500/40 bg-blue-500/5',     dot: 'bg-blue-400',  timeCls: 'bg-blue-500/15 text-blue-400'   },
                  ].map(({ key, label, timeKey, defaultTime, color, dot, timeCls }) => {
                    const items: string[] = (data.remediationPlan as any)[key] ?? []
                    const time: string = (data.remediationPlan as any)[timeKey] ?? defaultTime
                    if (!items.length) return null
                    return (
                      <div key={key} className={`border rounded-lg p-3 ${color}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                          <p className="text-xs font-semibold text-slate-300">{label}</p>
                          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${timeCls}`}>⏱ {time}</span>
                        </div>
                        <ul className="space-y-1.5">
                          {items.map((item, i) => (
                            <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
                              <span className="shrink-0 mt-0.5 text-slate-500">›</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                  {(data.remediationPlan as any).observations && (
                    <div className="bg-slate-800/60 border border-slate-600/40 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Observaciones</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{(data.remediationPlan as any).observations}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Pasos de Remediación</h3>
                  <ol className="space-y-2">
                    {steps.map((step: string, i: number) => (
                      <li key={i} className="flex gap-3 text-sm text-slate-200">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 text-xs font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{step.replace(/^\d+\.\s*/, '')}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
        </div>{/* end scrollable wrapper */}
      </div>
    </div>
  )
}
