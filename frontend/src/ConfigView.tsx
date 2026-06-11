import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import UsersManager from './UsersManager'
import RolesManager from './RolesManager'
import AlertRules from './AlertRules'
import NotificationHistory from './NotificationHistory'
import { fetchMyOrg, updateOrg, uploadOrgLogo, fetchMe, toggle2FA } from './api'

const SYSTEM_SECTIONS = [
  {
    id: 'org',
    title: 'Organización',
    icon: '🏢',
    fields: [
      { key: 'orgName',  label: 'Nombre de la organización', defaultValue: 'Demo Corp',       type: 'text'   },
      { key: 'orgId',    label: 'ID de organización',        defaultValue: 'org_demo',        type: 'text',   readonly: true },
      { key: 'timezone', label: 'Zona horaria',              defaultValue: 'America/Bogota',  type: 'text'   },
    ],
  },
  {
    id: 'scan',
    title: 'Recolección de datos',
    icon: '📡',
    fields: [
      { key: 'scanInterval',  label: 'Intervalo de escaneo (horas)',  defaultValue: '24', type: 'number' },
      { key: 'retentionDays', label: 'Retención de datos (días)',     defaultValue: '90', type: 'number' },
      { key: 'maxConcurrent', label: 'Escaneos concurrentes máx.',    defaultValue: '5',  type: 'number' },
    ],
  },
  {
    id: 'ai',
    title: 'Integración AI',
    icon: '🤖',
    fields: [
      { key: 'aiProvider', label: 'Proveedor AI', defaultValue: 'gemini', type: 'select', options: ['gemini', 'ollama', 'openai'] },
      { key: 'aiModel',    label: 'Modelo',       defaultValue: 'gemini-1.5-flash', type: 'text' },
    ],
  },
  {
    id: 'notify',
    title: 'Notificaciones',
    icon: '🔔',
    fields: [
      { key: 'emailAlerts',  label: 'Alertas por correo',    defaultValue: 'true',  type: 'toggle' },
      { key: 'slackWebhook', label: 'Webhook Slack',         defaultValue: '',      type: 'text', placeholder: 'https://hooks.slack.com/…' },
      { key: 'criticalOnly', label: 'Solo alertas críticas', defaultValue: 'false', type: 'toggle' },
    ],
  },
]

const ALL_NAV = [
  ...SYSTEM_SECTIONS.map(s => ({ id: s.id, title: s.title, icon: s.icon })),
  { id: 'empresa',   title: 'Empresa',        icon: '🏢' },
  { id: 'seguridad', title: 'Seguridad',       icon: '🔒' },
  { id: 'alertas',   title: 'Alertas',         icon: '🚨' },
  { id: 'users',     title: 'Usuarios',        icon: '👤' },
  { id: 'roles',     title: 'Roles',           icon: '🔑' },
]

// ─── Org settings form ────────────────────────────────────────────────────────
function OrgSettingsPanel() {
  const [org, setOrg]         = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)

  useEffect(() => {
    fetchMyOrg().then(setOrg).catch(() => setOrg(null)).finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!org) return
    setSaving(true); setError('')
    try {
      if (logoFile) {
        const r = await uploadOrgLogo(org.id, logoFile)
        setOrg((o: any) => ({ ...o, logoUrl: r.logoUrl }))
        setLogoFile(null)
      }
      await updateOrg(org.id, {
        name: org.name, legalName: org.legalName, nit: org.nit, sector: org.sector,
        address: org.address, city: org.city, country: org.country,
        phone: org.phone, contactEmail: org.contactEmail,
      })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading) return <p className="text-slate-500 text-sm">Cargando datos de la empresa...</p>

  const field = (label: string, key: string, type = 'text') => (
    <div key={key} className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      <input type={type} value={org?.[key] ?? ''} onChange={e => setOrg((o: any) => ({...o, [key]: e.target.value}))}
        className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"/>
    </div>
  )

  return (
    <form onSubmit={handleSave} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">🏢 Datos de la empresa</h3>
      </div>
      <div className="p-5 space-y-4">
        {error && <p className="text-rose-400 text-sm">{error}</p>}

        {/* Logo */}
        <div className="flex items-center gap-4">
          {org?.logoUrl
            ? <img src={org.logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-contain bg-slate-800 border border-slate-700 p-2"/>
            : <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl">🏢</div>
          }
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1">Logo de la empresa (PNG/JPG, máx. 2MB)</label>
            <input type="file" accept="image/*" onChange={e => setLogoFile(e.target.files?.[0] ?? null)}
              className="text-sm text-slate-400 file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-slate-700 file:text-slate-300 file:text-xs cursor-pointer"/>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('Nombre comercial', 'name')}
          {field('Razón social / Nombre legal', 'legalName')}
          {field('NIT / RUC / RFC', 'nit')}
          {field('Sector', 'sector')}
          {field('Dirección', 'address')}
          {field('Ciudad', 'city')}
          {field('País', 'country')}
          {field('Teléfono', 'phone', 'tel')}
          {field('Correo de contacto', 'contactEmail', 'email')}
        </div>

        <div className="flex justify-end pt-2">
          <button type="submit" disabled={saving}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${saved ? 'bg-emerald-600 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'} disabled:opacity-60`}>
            {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ─── Security / 2FA Panel ────────────────────────────────────────────────────
function SecurityPanel() {
  const qc = useQueryClient()
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: fetchMe })
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy]         = useState(false)
  const enabled = me?.twoFactorEnabled ?? false

  async function handleToggle() {
    if (!password.trim()) {
      setMsg({ text: 'Debes ingresar tu contraseña actual para confirmar.', ok: false })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await toggle2FA(!enabled, password)
      setMsg({
        text: enabled
          ? '2FA desactivado. El próximo inicio de sesión no requerirá código.'
          : '2FA activado. El próximo inicio de sesión enviará un código de 6 dígitos a tu correo.',
        ok: true,
      })
      setPassword('')
      qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e: any) {
      setMsg({ text: e.message || 'Contraseña incorrecta o error del servidor.', ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-lg">🔒</div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Verificación en dos pasos (2FA)</h3>
            <p className="text-slate-500 text-xs mt-0.5">Al activarla, cada inicio de sesión requerirá un código de 6 dígitos enviado a tu correo.</p>
          </div>
          <div className="ml-auto shrink-0">
            {isLoading ? (
              <span className="text-slate-500 text-xs">Cargando…</span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                enabled
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                  : 'text-slate-400 bg-slate-700/40 border-slate-600/40'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {enabled ? 'Activo' : 'Inactivo'}
              </span>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700/60 pt-4 space-y-3">
          <p className="text-xs text-slate-400 font-medium">
            {enabled ? 'Para desactivar 2FA, confirma tu contraseña:' : 'Para activar 2FA, confirma tu contraseña:'}
          </p>
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleToggle()}
              placeholder="Contraseña actual"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-colors"
            />
            <button
              onClick={handleToggle}
              disabled={busy || isLoading}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                enabled
                  ? 'bg-rose-700/40 hover:bg-rose-600/50 text-rose-300 border border-rose-600/30'
                  : 'bg-sky-700/40 hover:bg-sky-600/50 text-sky-300 border border-sky-600/30'
              }`}
            >
              {busy ? 'Guardando…' : enabled ? 'Desactivar 2FA' : 'Activar 2FA'}
            </button>
          </div>

          {msg && (
            <p className={`text-xs px-3 py-2 rounded-lg border ${
              msg.ok
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                : 'text-rose-400 bg-rose-500/10 border-rose-500/25'
            }`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-5">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Cómo funciona</h4>
        <ol className="space-y-2 text-xs text-slate-400">
          <li className="flex gap-2"><span className="text-sky-400 font-bold shrink-0">1.</span>Activa 2FA ingresando tu contraseña actual.</li>
          <li className="flex gap-2"><span className="text-sky-400 font-bold shrink-0">2.</span>Al hacer login, el sistema enviará un código de 6 dígitos a <span className="text-slate-300 font-mono">{me?.email ?? '…'}</span></li>
          <li className="flex gap-2"><span className="text-sky-400 font-bold shrink-0">3.</span>Ingresa el código en la pantalla de verificación. El código expira en 10 minutos.</li>
          <li className="flex gap-2"><span className="text-sky-400 font-bold shrink-0">4.</span>Si no recibes el correo, verifica la carpeta de spam o desactiva y reactiva 2FA.</li>
        </ol>
      </div>
    </div>
  )
}

export default function ConfigView() {
  const [section, setSection]   = useState('Organización')
  const [saved, setSaved]       = useState(false)
  const [toggles, setToggles]   = useState<Record<string, boolean>>({
    emailAlerts: true,
    criticalOnly: false,
  })

  const activeSection = SYSTEM_SECTIONS.find(s => s.title === section)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-200">Configuración del sistema</h2>
          <p className="text-slate-500 text-sm mt-0.5">Parámetros globales, integraciones y gestión de usuarios</p>
        </div>
        {!['Usuarios', 'Roles', 'Empresa', 'Seguridad', 'Alertas'].includes(section) && (
          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              saved ? 'bg-emerald-600 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {saved ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <nav className="flex flex-col gap-1">
          {ALL_NAV.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.title)}
              className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                section === s.title
                  ? 'bg-slate-700 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>{s.icon}</span>
              {s.title}
            </button>
          ))}
        </nav>

        {/* Content panel */}
        <div className="lg:col-span-3">
          {section === 'Usuarios' ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <UsersManager />
            </div>
          ) : section === 'Roles' ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <RolesManager />
            </div>
          ) : section === 'Empresa' ? (
            <OrgSettingsPanel />
          ) : section === 'Seguridad' ? (
            <SecurityPanel />
          ) : section === 'Alertas' ? (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                <AlertRules readOnly={false} />
              </div>
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                <NotificationHistory />
              </div>
            </div>
          ) : activeSection ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300">
                  {activeSection.icon} {activeSection.title}
                </h3>
              </div>
              <div className="p-5 space-y-5">
                {activeSection.fields.map(field => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400">{field.label}</label>
                    {field.type === 'toggle' ? (
                      <button
                        type="button"
                        onClick={() => setToggles(t => ({ ...t, [field.key]: !t[field.key] }))}
                        className="flex items-center gap-3 w-fit"
                      >
                        <div className={`relative w-10 h-5 rounded-full transition-colors ${
                          (toggles[field.key] ?? field.defaultValue === 'true') ? 'bg-sky-600' : 'bg-slate-700'
                        }`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            (toggles[field.key] ?? field.defaultValue === 'true') ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </div>
                        <span className="text-sm text-slate-300">
                          {(toggles[field.key] ?? field.defaultValue === 'true') ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </button>
                    ) : field.type === 'select' ? (
                      <select
                        defaultValue={field.defaultValue}
                        className="w-full max-w-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
                      >
                        {(field as any).options?.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        defaultValue={field.defaultValue}
                        readOnly={(field as any).readonly}
                        placeholder={(field as any).placeholder}
                        className={`w-full max-w-sm bg-slate-800 border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors ${
                          (field as any).readonly
                            ? 'border-slate-800 text-slate-500 cursor-not-allowed'
                            : 'border-slate-700 text-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20'
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
