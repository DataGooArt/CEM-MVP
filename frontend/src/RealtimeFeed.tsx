import { useStore } from './store'

export default function RealtimeFeed() {
  const events = useStore(s => s.events)
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 h-80 flex flex-col">
      <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">Live Telemetry</h3>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {events.map((evt, i) => (
          <div key={i} className="bg-slate-800/50 rounded-lg p-3 text-xs border border-slate-700/50">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-emerald-400">{evt.type}</span>
              <span className="text-slate-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>
            </div>
            <pre className="text-slate-400 overflow-x-auto">{JSON.stringify(evt.payload, null, 2).slice(0, 180)}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
