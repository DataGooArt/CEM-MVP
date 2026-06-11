import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchNotifications } from './api'

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  HIGH:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  MEDIUM:   'text-amber-400 bg-amber-500/10 border-amber-500/30',
  LOW:      'text-blue-400 bg-blue-500/10 border-blue-500/30',
}

function fmt(d: string) {
  return new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
}

export default function NotificationHistory() {
  const [status, setStatus] = useState<'' | 'SENT' | 'FAILED'>('')
  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications', status],
    queryFn: () => fetchNotifications(status ? { status } : {}),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">Historial de notificaciones enviadas</h3>
        <div className="flex gap-1.5">
          {(['', 'SENT', 'FAILED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                status === s
                  ? 'bg-slate-600 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {s === '' ? 'Todos' : s === 'SENT' ? 'Enviados' : 'Fallidos'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm py-8 text-center">Cargando…</p>
      ) : data.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-slate-500 text-sm">Sin notificaciones{status ? ` con estado ${status}` : ''}.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/60 text-slate-400 font-medium text-left">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Severidad</th>
                <th className="px-4 py-3">Hallazgo</th>
                <th className="px-4 py-3">Regla</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Destinatario</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((n, i) => (
                <tr
                  key={n.id}
                  className={`border-t border-slate-700/40 transition-colors hover:bg-slate-800/30 ${i % 2 === 0 ? '' : 'bg-slate-800/20'}`}
                >
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmt(n.sentAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold ${SEV_CLS[n.severity] ?? 'text-slate-400 bg-slate-700/40 border-slate-600'}`}>
                      {n.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 max-w-[220px] truncate" title={n.title}>{n.title}</td>
                  <td className="px-4 py-3 text-slate-400">{n.rule?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${n.channel === 'email' ? 'text-sky-400' : 'text-purple-400'}`}>
                      {n.channel === 'email' ? '✉' : '🔗'} {n.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[160px] truncate font-mono text-[11px]" title={n.target}>{n.target}</td>
                  <td className="px-4 py-3">
                    {n.status === 'SENT' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"/>Enviado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400 text-[11px] font-medium" title={n.errorMsg ?? ''}>
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block"/>Fallido
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
