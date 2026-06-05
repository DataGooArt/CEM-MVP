import { useState } from 'react'
import { useAuth, ROLE_META } from './auth'

const DEMO_CREDS = [
  { email: 'admin@cem.local',      password: 'admin123', role: 'admin'      as const },
  { email: 'supervisor@cem.local', password: 'super123', role: 'supervisor' as const },
  { email: 'visor@cem.local',      password: 'visor123', role: 'viewer'     as const },
]

export default function LoginPage() {
  const login      = useAuth(s => s.login)
  const loginError = useAuth(s => s.loginError)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    login(email, password)
  }

  function fillDemo(cred: (typeof DEMO_CREDS)[number]) {
    setEmail(cred.email)
    setPassword(cred.password)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
      {/* Logo */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30">
          <svg className="w-7 h-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.126-.549-4.124-1.518-5.867"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">CEM Platform</h1>
        <p className="text-slate-500 text-sm">Continuous Exposure Monitoring</p>
      </div>

      <div className="w-full max-w-sm space-y-5">
        {/* Form card */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl shadow-black/40">
          <h2 className="text-slate-200 font-semibold text-base mb-5">Iniciar sesión</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="usuario@cem.local"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-colors"
              />
            </div>

            {loginError && (
              <p className="text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm mt-1"
            >
              Entrar
            </button>
          </form>
        </div>

        {/* Demo quick-access */}
        <div className="space-y-2.5">
          <p className="text-center text-[10px] text-slate-600 uppercase tracking-widest">
            Accesos de demostración
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_CREDS.map(cred => {
              const meta = ROLE_META[cred.role]
              return (
                <button
                  key={cred.role}
                  onClick={() => fillDemo(cred)}
                  className="bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl p-3 text-left transition-colors group"
                >
                  <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border mb-1.5 ${meta.badgeCls}`}>
                    {meta.label}
                  </span>
                  <p className="text-slate-400 text-[10px] truncate">{cred.email}</p>
                  <p className="text-slate-600 text-[10px] font-mono tracking-wide">{cred.password}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
