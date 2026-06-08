import { create } from 'zustand'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export type Role = 'admin' | 'supervisor' | 'viewer' | string

export interface User {
  id: string
  name: string
  email: string
  role: Role
  orgId: string
  permissions: string[]
  initials: string
}

export const ROLE_META: Record<string, { label: string; badgeCls: string; description: string }> = {
  admin:      { label: 'Administrador', badgeCls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',    description: 'Acceso total + configuración del sistema' },
  supervisor: { label: 'Supervisor',    badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', description: 'Gestión de remediaciones y alertas'       },
  viewer:     { label: 'Visor',         badgeCls: 'bg-sky-500/15 text-sky-400 border-sky-500/30',       description: 'Solo lectura, sin modificaciones'         },
}

// ─── Token helpers ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'cem_access_token'
const REFRESH_KEY = 'cem_refresh_token'

export const getAccessToken = () => localStorage.getItem(TOKEN_KEY)
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY)

function saveTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

function decodeJwt(token: string): any {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

function tokenToUser(token: string, data: any): User {
  const payload = decodeJwt(token)
  const name = data?.user?.name || payload?.email || 'Usuario'
  const role = data?.user?.role || payload?.roleName || 'viewer'
  return {
    id: payload?.sub || '',
    email: payload?.email || '',
    name,
    role,
    orgId: payload?.orgId || '',
    permissions: data?.user?.permissions || payload?.permissions || [],
    initials: name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase(),
  }
}

// ─── Zustand store ────────────────────────────────────────────────────────────
type Action = 'editRemediation' | 'manageAlerts' | 'manageDomains' | 'accessConfig'

interface AuthState {
  user: User | null
  loginError: string | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refreshSession: () => Promise<boolean>
  can: (action: Action) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  user: (() => {
    // Restaurar sesión desde token guardado
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return null
    const payload = decodeJwt(token)
    if (!payload || payload.exp * 1000 < Date.now()) { clearTokens(); return null }
    return tokenToUser(token, { user: { role: payload.roleName, name: payload.name, permissions: payload.permissions } })
  })(),
  loginError: null,

  async login(email, password) {
    try {
      const res = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        set({ loginError: (err as any).message || 'Credenciales inválidas.' })
        return false
      }
      const data = await res.json()
      saveTokens(data.accessToken, data.refreshToken)
      const user = tokenToUser(data.accessToken, data)
      set({ user, loginError: null })
      return true
    } catch {
      set({ loginError: 'Error de conexión con el servidor.' })
      return false
    }
  },

  async logout() {
    const token = getAccessToken()
    if (token) {
      try {
        await fetch(`${API}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {}
    }
    clearTokens()
    set({ user: null, loginError: null })
  },

  async refreshSession() {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false
    try {
      const res = await fetch(`${API}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) { clearTokens(); set({ user: null }); return false }
      const data = await res.json()
      saveTokens(data.accessToken, data.refreshToken)
      const user = tokenToUser(data.accessToken, data)
      set({ user })
      return true
    } catch {
      return false
    }
  },

  can(action) {
    const { user } = get()
    if (!user) return false
    if (user.role === 'admin' || user.permissions.includes('*')) return true
    if (user.role === 'supervisor') {
      return action === 'editRemediation' || action === 'manageAlerts' || action === 'manageDomains'
    }
    return false
  },
}))

