import { useState } from 'react'
import { ROLE_META, type Role } from './auth'

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

const USERS_MOCK: { id: string; name: string; email: string; role: Role }[] = [
  { id: '1', name: 'Admin Sistema',        email: 'admin@cem.local',      role: 'admin'      },
  { id: '2', name: 'Supervisor Seguridad', email: 'supervisor@cem.local', role: 'supervisor' },
  { id: '3', name: 'Consultor Visor',      email: 'visor@cem.local',      role: 'viewer'     },
]

const ALL_NAV = [
  ...SYSTEM_SECTIONS.map(s => ({ id: s.id, title: s.title, icon: s.icon })),
  { id: 'users', title: 'Usuarios y roles', icon: '👥' },
]

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
        {section !== 'Usuarios y roles' && (
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
          {section === 'Usuarios y roles' ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300">Usuarios del sistema</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  {USERS_MOCK.length} usuarios
                </span>
              </div>

              {/* Role legend */}
              <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {(Object.entries(ROLE_META) as [Role, (typeof ROLE_META)[Role]][]).map(([role, meta]) => (
                    <div key={role} className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${meta.badgeCls}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-slate-500">{meta.description}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-slate-800">
                {USERS_MOCK.map(u => {
                  const meta     = ROLE_META[u.role]
                  const initials = u.name.split(' ').map(n => n[0]).join('').slice(0, 2)
                  return (
                    <div key={u.id} className="px-5 py-3.5 flex items-center gap-4">
                      <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${meta.badgeCls}`}>
                        {meta.label}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        Activo
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="px-5 py-3 bg-slate-800/40 border-t border-slate-800">
                <p className="text-xs text-slate-500 italic">
                  En esta versión demo los cambios de usuarios no persisten. La gestión completa de RBAC estará disponible en la versión de producción.
                </p>
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
