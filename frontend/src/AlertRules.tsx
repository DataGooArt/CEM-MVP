import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchAlertRules, createAlertRule, deleteAlertRule, updateAlertRule } from './api'

const SEVERITIES = ['CRITICAL', 'HIGH']
const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  LOW:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

export default function AlertRules({ readOnly = false }: { readOnly?: boolean }) {
  const qc = useQueryClient()
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['alertRules'], queryFn: fetchAlertRules })

  const [name, setName] = useState('')
  const [channel, setChannel] = useState<'email' | 'webhook'>('email')
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<string[]>(['CRITICAL', 'HIGH'])
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: () => createAlertRule({ name, severity: selected, channel, target }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] })
      setName(''); setTarget(''); setSelected(['CRITICAL', 'HIGH']); setError('')
    },
    onError: (e: any) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertRules'] }),
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateAlertRule(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertRules'] }),
  })

  const toggleSev = (s: string) =>
    setSelected(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !target.trim() || selected.length === 0) {
      setError('Fill in all fields and select at least one severity.'); return
    }
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('Enter a valid email address.'); return
    }
    if (channel === 'webhook' && !/^https?:\/\/.+/.test(target)) {
      setError('Webhook URL must start with http:// or https://.'); return
    }
    create.mutate()
  }

  return (
    <div className="space-y-6">
      {/* Create Rule — hidden for read-only roles */}
      {!readOnly && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-300 font-semibold mb-4">New Alert Rule</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Channel selector */}
            <div>
              <label className="text-slate-400 text-xs uppercase tracking-wider block mb-2">Channel</label>
              <div className="flex gap-2">
                {(['email', 'webhook'] as const).map(ch => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => { setChannel(ch); setTarget('') }}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      channel === ch
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {ch === 'email' ? '✉ Email' : '🔗 Webhook'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider block mb-1">Rule Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Critical alerts"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider block mb-1">
                  {channel === 'email' ? 'Email Address' : 'Webhook URL'}
                </label>
                <input
                  type={channel === 'email' ? 'email' : 'url'}
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder={channel === 'email' ? 'security@company.com' : 'https://hooks.slack.com/…'}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 text-xs uppercase tracking-wider block mb-2">Trigger on Severity</label>
              <div className="flex gap-2 flex-wrap">
                {SEVERITIES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSev(s)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-opacity ${SEV_COLOR[s]} ${selected.includes(s) ? 'opacity-100' : 'opacity-30'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-rose-400 text-xs">{error}</p>}

            <button
              type="submit"
              disabled={create.isPending}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {create.isPending ? 'Creating…' : 'Create Rule'}
            </button>
          </form>
        </div>
      )}

      {/* Rules List */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Active Alert Rules</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No alert rules configured yet.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {rules.map((r: any) => (
              <div key={r.id} className={`flex items-center justify-between px-4 py-3 transition-opacity ${!r.enabled ? 'opacity-50' : ''}` }>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-slate-200 text-sm font-medium">{r.name}</p>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      r.channel === 'webhook'
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        : 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                    }`}>
                      {r.channel === 'webhook' ? '🔗 webhook' : '✉ email'}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5 truncate max-w-xs">{r.target}</p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {(r.severity as string[]).map((s: string) => (
                    <span key={s} className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEV_COLOR[s] ?? ''}`}>{s}</span>
                  ))}
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => !readOnly && toggle.mutate({ id: r.id, enabled: !r.enabled })}
                    disabled={readOnly}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                      readOnly ? 'opacity-40 cursor-not-allowed' : ''
                    } ${
                      r.enabled ? 'bg-violet-600' : 'bg-slate-600'
                    }`}
                    title={readOnly ? 'Sin permiso para modificar' : r.enabled ? 'Deshabilitar regla' : 'Habilitar regla'}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      r.enabled ? 'translate-x-5' : 'translate-x-1'
                    }`} />
                  </button>
                  {!readOnly && (
                    <button
                      onClick={() => remove.mutate(r.id)}
                      className="text-slate-600 hover:text-rose-400 transition-colors ml-2"
                      title="Delete rule"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
