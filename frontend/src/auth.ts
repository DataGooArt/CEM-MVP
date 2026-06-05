import { create } from 'zustand'

export type Role = 'admin' | 'supervisor' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  initials: string
}

type DemoAccount = User & { password: string }

const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: '1', name: 'Admin Sistema',        email: 'admin@cem.local',      role: 'admin',      initials: 'AS', password: 'admin123' },
  { id: '2', name: 'Supervisor Seguridad', email: 'supervisor@cem.local', role: 'supervisor', initials: 'SS', password: 'super123' },
  { id: '3', name: 'Consultor Visor',      email: 'visor@cem.local',      role: 'viewer',     initials: 'CV', password: 'visor123' },
]

export const ROLE_META: Record<Role, { label: string; badgeCls: string; description: string }> = {
  admin:      { label: 'Administrador', badgeCls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',    description: 'Acceso total + configuración del sistema' },
  supervisor: { label: 'Supervisor',    badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', description: 'Gestión de remediaciones y alertas'       },
  viewer:     { label: 'Visor',         badgeCls: 'bg-sky-500/15 text-sky-400 border-sky-500/30',       description: 'Solo lectura, sin modificaciones'         },
}

type Action = 'editRemediation' | 'manageAlerts' | 'manageDomains' | 'accessConfig'

interface AuthState {
  user: User | null
  loginError: string | null
  login: (email: string, password: string) => boolean
  logout: () => void
  can: (action: Action) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loginError: null,

  login(email, password) {
    const found = DEMO_ACCOUNTS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password,
    )
    if (!found) {
      set({ loginError: 'Correo o contraseña incorrectos.' })
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...user } = found
    set({ user, loginError: null })
    return true
  },

  logout() {
    set({ user: null, loginError: null })
  },

  can(action) {
    const role = get().user?.role
    if (!role) return false
    if (role === 'admin') return true
    if (role === 'supervisor') {
      return action === 'editRemediation' || action === 'manageAlerts' || action === 'manageDomains'
    }
    return false // viewer: read-only
  },
}))
