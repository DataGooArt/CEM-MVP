import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from './store'
import { useAuth, ROLE_META } from './auth'
import { fetchFindings, fetchSeverity, fetchStats } from './api'
import { connectWS, subOrg, onTelemetry } from './socket'
import RiskGauge from './RiskGauge'
import SeverityChart from './SeverityChart'
import FindingsTable from './FindingsTable'
import RealtimeFeed from './RealtimeFeed'
import AlertRules from './AlertRules'
import AssetsView from './AssetsView'
import RemediationView from './RemediationView'
import DomainsManager from './DomainsManager'
import ConfigView from './ConfigView'
import ScanReports from './ScanReports'
import ScanLogsView from './ScanLogsView'

const ORG = 'org_demo'
type Tab = 'dashboard' | 'assets' | 'remediation' | 'domains' | 'alerts' | 'config' | 'reports' | 'logs'

const ALL_TABS: {
  id: Tab
  label: string
  icon: string
  requireAdmin?: boolean
  viewerHidden?: boolean
  badge?: (s: any) => number | undefined
}[] = [
  { id: 'dashboard',   label: 'Dashboard',    icon: '▦' },
  { id: 'assets',      label: 'Activos',      icon: '◈',  viewerHidden: true },
  { id: 'remediation', label: 'Remediación',  icon: '⚑', badge: s => (s?.critical ?? 0) + (s?.high ?? 0) || undefined },
  { id: 'domains',     label: 'Dominios',     icon: '⊕',  requireAdmin: true },
  { id: 'reports',     label: 'Informes',     icon: '📋', requireAdmin: true },
  { id: 'alerts',      label: 'Alertas',      icon: '⚡', requireAdmin: true },
  { id: 'config',      label: 'Configuración',icon: '⚙', requireAdmin: true },
  { id: 'logs',        label: 'Logs',         icon: '📜', requireAdmin: true },
]

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const setFindings = useStore(s => s.setFindings)
  const setSeverity = useStore(s => s.setSeverity)
  const addEvent    = useStore(s => s.addEvent)
  const queryClient = useQueryClient()

  const user   = useAuth(s => s.user)
  const logout = useAuth(s => s.logout)
  const can    = useAuth(s => s.can)

  const fQuery     = useQuery({ queryKey: ['findings', ORG], queryFn: () => fetchFindings(ORG) })
  const sQuery     = useQuery({ queryKey: ['severity', ORG], queryFn: () => fetchSeverity(ORG) })
  const statsQuery = useQuery({ queryKey: ['stats', ORG],    queryFn: () => fetchStats(ORG) })

  useEffect(() => { if (fQuery.data) setFindings(fQuery.data.data) }, [fQuery.data, setFindings])
  useEffect(() => { if (sQuery.data) setSeverity(sQuery.data) },      [sQuery.data, setSeverity])

  useEffect(() => {
    connectWS()
    subOrg(ORG)
    const unsub = onTelemetry(evt => {
      addEvent(evt)
      queryClient.invalidateQueries({ queryKey: ['findings', ORG] })
      queryClient.invalidateQueries({ queryKey: ['severity', ORG] })
      queryClient.invalidateQueries({ queryKey: ['stats', ORG] })
      queryClient.invalidateQueries({ queryKey: ['assets', ORG] })
      queryClient.invalidateQueries({ queryKey: ['remediation', ORG] })
    })
    return () => { unsub() }
  }, [addEvent, queryClient])

  const stats    = statsQuery.data
  const roleMeta = user?.role ? ROLE_META[user.role] : null
  const readOnly = !can('editRemediation')

  const isViewer = user?.role === 'viewer'
  const visibleTabs = ALL_TABS.filter(t =>
    !(t.requireAdmin && user?.role !== 'admin') &&
    !(t.viewerHidden && isViewer)
  )

  // redirect viewer/supervisor away from admin-only or viewer-hidden tabs
  useEffect(() => {
    if (isViewer && (tab === 'assets' || tab === 'domains' || tab === 'alerts' || tab === 'config' || tab === 'reports')) {
      setTab('dashboard')
    }
    if (!isViewer && user?.role === 'supervisor' && (tab === 'domains' || tab === 'alerts' || tab === 'config' || tab === 'reports' || tab === 'logs')) {
      setTab('dashboard')
    }
  }, [isViewer, user?.role, tab])

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top navigation bar ── */}
      <header className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.126-.549-4.124-1.518-5.867"/>
            </svg>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-bold leading-none text-slate-100">CEM Platform</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Exposure Monitoring</p>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex gap-0.5 bg-slate-900 rounded-lg p-1 flex-wrap">
          {visibleTabs.map(({ id, label, icon, badge }) => {
            const count = badge?.(stats)
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === id
                    ? 'bg-slate-700 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span className="text-[11px] opacity-60">{icon}</span>
                {label}
                {count != null && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* User badge */}
        {user && roleMeta && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:block text-right">
              <p className="text-xs font-medium text-slate-200 leading-none">{user.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{user.email}</p>
            </div>
            <span className={`hidden lg:inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${roleMeta.badgeCls}`}>
              {roleMeta.label}
            </span>
            <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
              {user.initials}
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
            </button>
          </div>
        )}
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 p-4 md:p-6 space-y-5">
        {/* Stats row — visible in data tabs */}
        {tab !== 'alerts' && tab !== 'domains' && tab !== 'config' && tab !== 'reports' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Total Findings</p>
              <p className="text-3xl font-bold mt-1.5 tabular-nums text-slate-200">
                {stats?.total ?? <span className="text-slate-700">—</span>}
              </p>
            </div>
            <div className="bg-sky-500/10 border border-slate-700/50 rounded-xl p-4">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Abiertos</p>
              <p className="text-3xl font-bold mt-1.5 tabular-nums text-sky-400">
                {stats?.open ?? <span className="text-slate-700">—</span>}
              </p>
              {stats != null && (
                <p className="mt-1.5 text-[11px] text-slate-500 leading-tight">
                  <span className="text-emerald-400 font-semibold">{stats.newThisWeek} nuevos</span>
                  {' · '}
                  <span className="text-amber-400 font-semibold">{stats.recurring} recurrentes</span>
                </p>
              )}
            </div>
            <div className="bg-rose-500/10 border border-slate-700/50 rounded-xl p-4">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Críticos</p>
              <p className="text-3xl font-bold mt-1.5 tabular-nums text-rose-400">
                {stats?.critical ?? <span className="text-slate-700">—</span>}
              </p>
            </div>
            <div className="bg-orange-500/10 border border-slate-700/50 rounded-xl p-4">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Altos</p>
              <p className="text-3xl font-bold mt-1.5 tabular-nums text-orange-400">
                {stats?.high ?? <span className="text-slate-700">—</span>}
              </p>
            </div>
          </div>
        )}

        {/* Read-only notice for Viewer role */}
        {readOnly && (tab === 'remediation' || tab === 'alerts') && (
          <div className="flex items-center gap-2.5 bg-sky-500/10 border border-sky-500/25 rounded-xl px-4 py-3 text-sky-300 text-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Modo <strong className="font-semibold mx-1">solo lectura</strong> — el rol
            <span className={`ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${roleMeta?.badgeCls}`}>
              {roleMeta?.label}
            </span>
            &nbsp;no tiene permisos de modificación.
          </div>
        )}

        {/* ── Tab views ── */}
        {tab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <RiskGauge />
              <SeverityChart />
              <RealtimeFeed />
            </div>
            <FindingsTable orgId={ORG} />
          </>
        )}

        {tab === 'assets'      && <AssetsView      orgId={ORG} />}
        {tab === 'remediation' && <RemediationView orgId={ORG} readOnly={readOnly} />}
        {tab === 'domains'     && <DomainsManager  orgId={ORG} />}
        {tab === 'reports'     && <ScanReports />}
        {tab === 'alerts'      && <AlertRules readOnly={readOnly} />}
        {tab === 'config'      && <ConfigView />}
        {tab === 'logs'        && <ScanLogsView />}
      </main>
    </div>
  )
}

