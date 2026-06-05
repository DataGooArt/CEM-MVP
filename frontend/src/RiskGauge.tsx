import { useStore } from './store'

export default function RiskGauge() {
  const severity = useStore(s => s.severity)
  const total = severity.reduce((a, b) => a + (b.count || 0), 0)
  const bad = severity.filter((x: any) => x.severity === 'CRITICAL' || x.severity === 'HIGH').reduce((a: number, b: any) => a + (b.count || 0), 0)
  const score = total === 0 ? 100 : Math.max(0, Math.round(100 - (bad / total) * 100))
  const color = score > 80 ? 'text-emerald-400' : score > 50 ? 'text-amber-400' : 'text-rose-400'

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 h-80 flex flex-col items-center justify-center">
      <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-4">Posture Score</h3>
      <div className={`text-7xl font-extrabold ${color}`}>{score}</div>
      <div className="text-slate-500 text-sm mt-2">of 100</div>
      <div className="mt-4 text-xs text-slate-500">{bad} critical/high of {total} open</div>
    </div>
  )
}
