import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listDomains, createDomain, updateDomain, deleteDomain, fetchScanSessions, triggerDomainScan } from './api'
import { onTelemetry } from './socket'

// Validates hostname or IPv4 (with optional CIDR)
const DOMAIN_OR_IP_RE =
  /^(([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?)$/

function isValidTarget(value: string): boolean {
  return DOMAIN_OR_IP_RE.test(value.trim())
}

const TOOLS_ALL = [
  'nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan', 'ffuf',
  'subfinder', 'httpx', 'testssl', 'katana', 'trufflehog',
  'dalfox', 'sqlmap', 'amass',
]

const PROFILE_META = {
  quick:    { label: '🔵 Rápido',   color: 'bg-sky-500/15 text-sky-400 border-sky-500/30',       est: '2–5 min'    },
  standard: { label: '🟡 Estándar', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', est: '10–20 min'  },
  deep:     { label: '🔴 Profundo', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30',    est: '30–120 min' },
} as const
type ScanProfile = keyof typeof PROFILE_META

const PROFILE_DEFAULT_TOOLS: Record<ScanProfile, string[]> = {
  quick:    ['nmap', 'nuclei', 'whatweb', 'gobuster'],
  standard: ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan',
             'subfinder', 'httpx', 'testssl', 'katana', 'trufflehog'],
  deep:     ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan', 'ffuf',
             'subfinder', 'httpx', 'testssl', 'katana', 'trufflehog',
             'dalfox', 'sqlmap', 'amass'],
}

const CRON_PRESETS = [
  { label: 'Diario (2am)',       value: '0 2 * * *'   },
  { label: 'Semanal (lunes 2am)', value: '0 2 * * 1'  },
  { label: 'Quincenal',          value: '0 2 1,15 * *' },
  { label: 'Mensual (día 1)',     value: '0 2 1 * *'   },
]

const CRON_LABEL: Record<string, string> = Object.fromEntries(CRON_PRESETS.map(p => [p.value, p.label]))

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ScanCommand({ domain, tools, profile = 'standard' }: { domain: string; tools: string[]; profile?: string }) {
  const [copied, setCopied] = useState(false)

  const skipped = TOOLS_ALL.filter(t => !tools.includes(t))
  const skipFlags = skipped.map(t => `--skip ${t}`).join(' ')
  const cmd = [
    `# Desde tu Kali (requiere full-scan.sh en $PATH o ./kali-scripts/)`,
    `./full-scan.sh \\`,
    `  --api http://YOUR_CEM_IP:3001 \\`,
    `  --id ${domain} \\`,
    `  --profile ${profile} \\`,
    skipFlags ? `  ${skipFlags} \\` : null,
    `  ${domain}`,
  ].filter(Boolean).join('\n')

  async function copy() {
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 bg-slate-950 border border-slate-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Comando Kali WSL</p>
        <button
          onClick={copy}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
        >
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">{cmd}</pre>
    </div>
  )
}

// ─── Scan History panel ───────────────────────────────────────────────────────
const TOOL_COLORS: Record<string, string> = {
  nmap:       'bg-sky-500/15 text-sky-400 border-sky-500/30',
  nuclei:     'bg-violet-500/15 text-violet-400 border-violet-500/30',
  nikto:      'bg-amber-500/15 text-amber-400 border-amber-500/30',
  whatweb:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  gobuster:   'bg-rose-500/15 text-rose-400 border-rose-500/30',
  sslscan:    'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ffuf:       'bg-orange-500/15 text-orange-400 border-orange-500/30',
  subfinder:  'bg-teal-500/15 text-teal-400 border-teal-500/30',
  httpx:      'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  testssl:    'bg-lime-500/15 text-lime-400 border-lime-500/30',
  katana:     'bg-pink-500/15 text-pink-400 border-pink-500/30',
  trufflehog: 'bg-red-500/15 text-red-400 border-red-500/30',
  dalfox:     'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  sqlmap:     'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  amass:      'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

type ScanState = {
  scanId: string
  status: 'running' | 'done' | 'error'
  currentTool?: string
  toolsDone: Array<{ tool: string; count: number }>
  totalFindings: number
}

export default function DomainsManager({ orgId = 'org_demo' }: { orgId?: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm]   = useState(false)
  const [showCmd, setShowCmd]     = useState<string | null>(null)
  const [scanStates, setScanStates] = useState<Record<string, ScanState>>({})
  const scanToDomain = useRef<Record<string, string>>({})
  const [newDomain,  setNewDomain]  = useState('')
  const [newTools,   setNewTools]   = useState(PROFILE_DEFAULT_TOOLS.standard)
  const [newCron,    setNewCron]    = useState('0 2 * * 1')
  const [newProfile, setNewProfile] = useState<ScanProfile>('standard')
  const [settingsCard, setSettingsCard] = useState<string | null>(null)
  const [editCfg, setEditCfg] = useState<{ profile: ScanProfile; tools: string[] } | null>(null)

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['domains', orgId],
    queryFn: listDomains,
    refetchInterval: 30_000,
  })

  const createMut = useMutation({
    mutationFn: () => createDomain({ domain: newDomain, tools: newTools, cronExpr: newCron, scanProfile: newProfile }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      setNewDomain('')
      setNewTools(PROFILE_DEFAULT_TOOLS.standard)
      setNewCron('0 2 * * 1')
      setNewProfile('standard')
      setShowForm(false)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateDomain>[1] }) =>
      updateDomain(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateDomain(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDomain(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  })

  const scanMut = useMutation({
    mutationFn: ({ domainId }: { domainId: string }) => triggerDomainScan(domainId),
    onSuccess: (result, { domainId }) => {
      scanToDomain.current[result.scanId] = domainId
      setScanStates(prev => ({
        ...prev,
        [domainId]: { scanId: result.scanId, status: 'running', toolsDone: [], totalFindings: 0 },
      }))
    },
    onError: (_err, { domainId }) => {
      // Limpiar estado de scan fallido para que el botón vuelva a estar activo
      setScanStates(prev => {
        const next = { ...prev }
        if (next[domainId]?.status === 'running') delete next[domainId]
        return next
      })
    },
  })

  useEffect(() => {
    const unsub = onTelemetry((event: any) => {
      if (event?.type !== 'scan:progress') return
      const { scanId, event: ev, tool, findingsCount } = event.payload ?? {}
      const domainId = scanToDomain.current[scanId]
      if (!domainId) return

      setScanStates(prev => {
        const cur = prev[domainId]
        if (!cur) return prev
        if (ev === 'tool:started') {
          return { ...prev, [domainId]: { ...cur, currentTool: tool } }
        }
        if (ev === 'tool:done' || ev === 'tool:error') {
          const toolName = tool ?? ''
          const existingIdx = cur.toolsDone.findIndex(t => t.tool === toolName)
          let toolsDone: Array<{ tool: string; count: number }>
          if (existingIdx >= 0) {
            // Deduplicate: update count if tool already registered
            toolsDone = cur.toolsDone.map((t, i) => i === existingIdx ? { ...t, count: findingsCount ?? t.count } : t)
          } else {
            toolsDone = [...cur.toolsDone, { tool: toolName, count: findingsCount ?? 0 }]
          }
          const addedFindings = existingIdx >= 0 ? 0 : (findingsCount ?? 0)
          return { ...prev, [domainId]: { ...cur, currentTool: undefined, toolsDone, totalFindings: cur.totalFindings + addedFindings } }
        }
        if (ev === 'scan:done') {
          const next = { ...cur, status: 'done' as const, currentTool: undefined }
          setTimeout(() => {
            setScanStates(s => { const c = { ...s }; delete c[domainId]; return c })
            delete scanToDomain.current[scanId]
          }, 8000)
          qc.invalidateQueries({ queryKey: ['scan-sessions'] })
          qc.invalidateQueries({ queryKey: ['domains'] })
          return { ...prev, [domainId]: next }
        }
        if (ev === 'scan:error') {
          return { ...prev, [domainId]: { ...cur, status: 'error' as const, currentTool: undefined } }
        }
        return prev
      })
    })
    return () => { unsub() }
  }, [])

  function toggleTool(tool: string) {
    setNewTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool])
  }

  function handleProfileChange(profile: ScanProfile) {
    setNewProfile(profile)
    setNewTools(PROFILE_DEFAULT_TOOLS[profile])
  }

  function openSettings(d: any) {
    if (settingsCard === d.id) {
      setSettingsCard(null); setEditCfg(null); return
    }
    setSettingsCard(d.id)
    setEditCfg({ profile: (d.scanProfile ?? 'standard') as ScanProfile, tools: [...d.tools] })
  }

  function handleEditProfileChange(profile: ScanProfile) {
    setEditCfg(prev => prev ? { profile, tools: [...PROFILE_DEFAULT_TOOLS[profile]] } : null)
  }

  function toggleEditTool(tool: string) {
    setEditCfg(prev => prev ? {
      ...prev,
      tools: prev.tools.includes(tool) ? prev.tools.filter(t => t !== tool) : [...prev.tools, tool],
    } : null)
  }

  function saveSettings(domainId: string) {
    if (!editCfg) return
    updateMut.mutate({ id: domainId, data: { scanProfile: editCfg.profile, tools: editCfg.tools } })
    setSettingsCard(null)
    setEditCfg(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Dominios Monitoreados</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {domains.length} dominios configurados · escaneos periódicos desde Kali WSL
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          + Agregar dominio
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300">Nuevo dominio a monitorear</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Dominio o IP</label>
              <input
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                placeholder="ejemplo.com · sub.ejemplo.co · 192.168.1.1"
                className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors ${
                  newDomain && !isValidTarget(newDomain)
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-slate-600 focus:border-violet-500'
                }`}
              />
              {newDomain && !isValidTarget(newDomain) && (
                <p className="mt-1 text-xs text-rose-400">Ingresa un hostname válido (ej. example.com) o una IP (ej. 192.168.1.1)</p>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Frecuencia de escaneo</label>
              <select
                value={newCron}
                onChange={e => setNewCron(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500"
              >
                {CRON_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Perfil de escaneo</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PROFILE_META) as ScanProfile[]).map(p => (
                <button
                  key={p}
                  onClick={() => handleProfileChange(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    newProfile === p
                      ? PROFILE_META[p].color
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {PROFILE_META[p].label} <span className="opacity-60">· {PROFILE_META[p].est}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              Herramientas <span className="text-slate-600">(ajustadas por perfil — puedes personalizar)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {TOOLS_ALL.map(tool => (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    newTools.includes(tool)
                      ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => createMut.mutate()}
              disabled={!newDomain.trim() || !isValidTarget(newDomain) || newTools.length === 0 || createMut.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
            >
              {createMut.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Domains table */}
      {isLoading ? (
        <div className="text-slate-500 py-8 text-center text-sm">Cargando…</div>
      ) : domains.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">🌐</p>
          <p className="font-medium">Sin dominios configurados</p>
          <p className="text-sm mt-1">Agrega un dominio para planificar sus escaneos periódicos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {domains.map((d: any) => {
          const scanState = scanStates[d.id]
          const isScanning = scanState?.status === 'running'
          const isScanDone = scanState?.status === 'done'
          const isScanPending = scanMut.isPending && scanMut.variables?.domainId === d.id
          return (
        <div key={d.id} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
              <div className="flex flex-wrap items-center gap-4 p-4">
                {/* Enable toggle */}
                <button
                  onClick={() => toggleMut.mutate({ id: d.id, enabled: !d.enabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${d.enabled ? 'bg-violet-600' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${d.enabled ? 'translate-x-4' : ''}`} />
                </button>

                {/* Domain */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-100">{d.domain}</p>
                    {/* Profile badge */}
                    {(() => {
                      const prof = (d.scanProfile ?? 'standard') as ScanProfile
                      const meta = PROFILE_META[prof] ?? PROFILE_META.standard
                      return (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${meta.color}`}>
                          {meta.label} · {meta.est}
                        </span>
                      )
                    })()}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Herramientas: {d.tools.join(', ')} · {CRON_LABEL[d.cronExpr] ?? d.cronExpr}
                  </p>
                </div>

                {/* Scan dates */}
                <div className="text-xs text-slate-500 shrink-0 space-y-0.5 text-right hidden md:block">
                  <p>Último scan: <span className="text-slate-400">{formatDate(d.lastScanned)}</span></p>
                  <p>Próximo scan: <span className={d.nextScan && new Date(d.nextScan) <= new Date() ? 'text-amber-400' : 'text-slate-400'}>{formatDate(d.nextScan)}</span></p>
                </div>

                {/* Status badge */}
                <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                  d.enabled ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-slate-700 text-slate-500 border-slate-600'
                }`}>
                  {d.enabled ? 'Activo' : 'Pausado'}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setShowCmd(showCmd === d.id ? null : d.id)}
                    className="text-xs px-2.5 py-1 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    Ver comando
                  </button>
                  <button
                    onClick={() => openSettings(d)}
                    title="Configurar perfil y herramientas"
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                      settingsCard === d.id
                        ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    ⚙️ Config
                  </button>
                  <button
                    onClick={() => !isScanning && !isScanPending && scanMut.mutate({ domainId: d.id })}
                    disabled={isScanning || isScanPending}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                      isScanDone
                        ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-400'
                        : (isScanning || isScanPending)
                        ? 'bg-violet-900/40 border-violet-700/40 text-violet-300 animate-pulse cursor-not-allowed'
                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {isScanDone ? '✓ Completado' : (isScanning || isScanPending) ? `Escaneando${scanState?.currentTool ? ` ${scanState.currentTool}` : ''}…` : '▶ Escanear'}
                  </button>                  {/* Error 409: límite global o cooldown por dominio */}
                  {scanMut.isError && scanMut.variables?.domainId === d.id && (
                    <span className="text-xs text-rose-400 border border-rose-700/40 bg-rose-900/20 rounded px-2 py-0.5 max-w-xs truncate" title={(scanMut.error as Error)?.message}>
                      {(() => {
                        const msg = (scanMut.error as Error)?.message ?? ''
                        const cooldown = msg.match(/Espera (\d+)s más/)
                        if (cooldown) return `⏱ Cooldown: ${cooldown[1]}s restantes`
                        if (msg.includes('Límite') || msg.includes('L\u00edmite')) return '⚠ Límite de scans alcanzado'
                        return '⚠ Error al iniciar scan'
                      })()}
                    </span>
                  )}                  <button
                    onClick={() => { if (confirm(`¿Eliminar ${d.domain}?`)) deleteMut.mutate(d.id) }}
                    className="text-xs px-2.5 py-1 rounded bg-rose-900/30 border border-rose-700/40 text-rose-400 hover:bg-rose-900/50 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {settingsCard === d.id && editCfg && (
                <div className="border-t border-slate-700/60 px-4 py-3 bg-slate-950/40 space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Perfil de escaneo</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(PROFILE_META) as ScanProfile[]).map(p => (
                        <button
                          key={p}
                          onClick={() => handleEditProfileChange(p)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            editCfg.profile === p
                              ? PROFILE_META[p].color
                              : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {PROFILE_META[p].label} <span className="opacity-60">· {PROFILE_META[p].est}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">
                      Herramientas activas
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {TOOLS_ALL.map(tool => (
                        <button
                          key={tool}
                          onClick={() => toggleEditTool(tool)}
                          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                            editCfg.tools.includes(tool)
                              ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                              : 'bg-slate-800 border-slate-600 text-slate-500'
                          }`}
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveSettings(d.id)}
                      disabled={updateMut.isPending}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
                    >
                      {updateMut.isPending ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                    <button
                      onClick={() => { setSettingsCard(null); setEditCfg(null) }}
                      className="px-3 py-1.5 rounded text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {showCmd === d.id && (
                <div className="border-t border-slate-700/60 px-4 pb-4">
                  <ScanCommand domain={d.domain} tools={d.tools} profile={d.scanProfile ?? 'standard'} />
                </div>
              )}

              {isScanning && scanState && (
                <div className="border-t border-slate-700/60 px-4 py-2 bg-slate-950/30">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-violet-400 animate-pulse">Escaneando…</span>
                    {scanState.toolsDone.map(t => (
                      <span key={t.tool} className={`text-[10px] px-1.5 py-0.5 rounded border ${TOOL_COLORS[t.tool] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                        ✓ {t.tool} ({t.count})
                      </span>
                    ))}
                    {scanState.currentTool && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-400 animate-pulse">
                        ⟳ {scanState.currentTool}
                      </span>
                    )}
                    {d.tools
                      .filter((t: string) => t !== scanState.currentTool && !scanState.toolsDone.find(td => td.tool === t))
                      .map((t: string) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-600">
                          {t}
                        </span>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>
          )})}
        </div>
      )}

      {/* Kali integration note */}
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-4 text-xs text-slate-500">
        <p className="font-semibold text-slate-400 mb-1">¿Cómo funciona la periodicidad?</p>
        <p>
          Los dominios aquí configurados establecen la frecuencia objetivo de escaneo.
          Ejecuta el comando mostrado en <strong className="text-slate-300">Kali WSL</strong> manualmente o programa un
          <code className="bg-slate-800 px-1 rounded mx-1">crontab</code> con el mismo.
          Al finalizar cada scan, el comando incluye una llamada a <code className="bg-slate-800 px-1 rounded">scan-complete</code> que
          actualiza la fecha del último y próximo escaneo.
        </p>
      </div>

      {/* Scan history */}
      <ScanHistory orgId={orgId} />
    </div>
  )
}

function ScanHistory({ orgId }: { orgId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['scan-sessions', orgId],
    queryFn: () => fetchScanSessions(orgId, 100),
    refetchInterval: 30_000,
  })

  // Agrupar por scanId
  const grouped = sessions.reduce<Record<string, typeof sessions>>((acc, s) => {
    if (!acc[s.scanId]) acc[s.scanId] = []
    acc[s.scanId].push(s)
    return acc
  }, {})

  const scanIds = Object.keys(grouped).sort((a, b) => {
    const aDate = grouped[a][0]?.createdAt ?? ''
    const bDate = grouped[b][0]?.createdAt ?? ''
    return bDate.localeCompare(aDate)
  })

  if (isLoading) return null
  if (scanIds.length === 0) return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
      <p className="text-sm font-semibold text-slate-300 mb-1">Historial de Scans</p>
      <p className="text-xs text-slate-500">Sin scans registrados todavía. Ejecuta <code className="bg-slate-800 px-1 rounded">full-scan.sh</code> desde Kali para ver el historial aquí.</p>
    </div>
  )

  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60">
        <p className="text-sm font-semibold text-slate-300">Historial de Scans</p>
        <span className="text-xs text-slate-500">{scanIds.length} sesiones</span>
      </div>
      <div className="divide-y divide-slate-800">
        {scanIds.slice(0, 20).map(scanId => {
          const rows = grouped[scanId]
          const date = rows[0]?.createdAt
          const collector = rows[0]?.collectorId ?? 'kali'
          const totalAccepted = rows.reduce((s, r) => s + r.findingsAccepted, 0)
          const totalErrors   = rows.reduce((s, r) => s + r.findingsErrors, 0)
          const isOpen = expanded === scanId

          return (
            <div key={scanId}>
              <button
                onClick={() => setExpanded(isOpen ? null : scanId)}
                className="w-full flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-800/40 transition-colors text-left"
              >
                {/* Arrow */}
                <span className={`text-slate-500 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>

                {/* Collector / domain */}
                <span className="text-sm text-slate-200 font-medium flex-1 min-w-0 truncate">{collector}</span>

                {/* Tools badges */}
                <div className="flex gap-1 flex-wrap">
                  {rows.map(r => (
                    <span key={r.id}
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        TOOL_COLORS[r.tool] ?? 'bg-slate-700 text-slate-400 border-slate-600'
                      }`}>
                      {r.tool}
                    </span>
                  ))}
                </div>

                {/* Findings accepted */}
                <span className="text-xs text-slate-400 shrink-0">
                  <span className="text-emerald-400 font-semibold">{totalAccepted}</span> hallazgos
                  {totalErrors > 0 && <span className="text-rose-400 ml-1">· {totalErrors} err</span>}
                </span>

                {/* Date */}
                <span className="text-xs text-slate-500 shrink-0 hidden sm:block">
                  {date ? new Date(date).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </button>

              {/* Expanded: per-tool breakdown */}
              {isOpen && (
                <div className="bg-slate-950/40 px-8 pb-3 pt-1">
                  <div className="text-[10px] text-slate-500 mb-2 font-mono">session: {scanId}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 text-left">
                        <th className="pb-1 font-medium">Herramienta</th>
                        <th className="pb-1 font-medium text-right">Aceptados</th>
                        <th className="pb-1 font-medium text-right">Errores</th>
                        <th className="pb-1 font-medium text-right hidden sm:table-cell">Hora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {rows.map(r => (
                        <tr key={r.id} className="text-slate-300">
                          <td className="py-1">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border mr-2 ${
                              TOOL_COLORS[r.tool] ?? 'bg-slate-700 text-slate-400 border-slate-600'
                            }`}>{r.tool}</span>
                          </td>
                          <td className="py-1 text-right text-emerald-400 font-semibold">{r.findingsAccepted}</td>
                          <td className="py-1 text-right text-rose-400">{r.findingsErrors || '—'}</td>
                          <td className="py-1 text-right text-slate-500 hidden sm:table-cell">
                            {new Date(r.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
