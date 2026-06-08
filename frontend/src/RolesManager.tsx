import { useState, useEffect } from 'react'
import { fetchRoles, createRole, updateRole, deleteRole } from './api'

interface Role { id: string; name: string; permissions: string[]; isDefault: boolean; organizationId: string | null }

const AVAILABLE_PERMISSIONS = [
  'findings:read', 'findings:write',
  'remediations:read', 'remediations:write',
  'domains:read', 'domains:write',
  'reports:read', 'reports:write',
  'alerts:read', 'alerts:write',
  'users:read', 'users:write',
  'roles:read', 'roles:write',
  'organizations:read', 'organizations:write',
  '*',
]

export default function RolesManager() {
  const [roles, setRoles]       = useState<Role[]>([])
  const [loading, setLoading]   = useState(true)
  const [editRole, setEditRole] = useState<Role | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm]         = useState({ name: '', permissions: [] as string[], isDefault: false })
  const [error, setError]       = useState('')

  async function reload() {
    setLoading(true)
    try { setRoles(await fetchRoles()) } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  function togglePerm(arr: string[], perm: string): string[] {
    return arr.includes(perm) ? arr.filter(p => p !== perm) : [...arr, perm]
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try { await createRole(form); setShowCreate(false); setForm({ name: '', permissions: [], isDefault: false }); reload() }
    catch (e: any) { setError(e.message) }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editRole) return
    setError('')
    try { await updateRole(editRole.id, { name: editRole.name, permissions: editRole.permissions }); setEditRole(null); reload() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-slate-200 font-semibold">Roles y Permisos</h3>
        <button onClick={() => { setShowCreate(true); setError('') }}
          className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg transition-colors">
          + Nuevo rol
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-8">
          <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Nuevo rol</h4>
            <input required placeholder="Nombre del rol" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <div>
              <p className="text-xs text-slate-400 mb-2">Permisos</p>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {AVAILABLE_PERMISSIONS.map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-slate-200">
                    <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => setForm(f => ({...f, permissions: togglePerm(f.permissions, p)}))}
                      className="accent-sky-500"/>
                    <span className={p === '*' ? 'text-rose-400 font-medium' : ''}>{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
              <button type="submit" className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg">Crear</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editRole && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto py-8">
          <form onSubmit={handleSave} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Editar rol</h4>
            <input required value={editRole.name} onChange={e => setEditRole(r => r ? {...r, name: e.target.value} : r)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"/>
            <div>
              <p className="text-xs text-slate-400 mb-2">Permisos</p>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {AVAILABLE_PERMISSIONS.map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-slate-200">
                    <input type="checkbox" checked={editRole.permissions.includes(p)}
                      onChange={() => setEditRole(r => r ? {...r, permissions: togglePerm(r.permissions, p)} : r)}
                      className="accent-sky-500"/>
                    <span className={p === '*' ? 'text-rose-400 font-medium' : ''}>{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEditRole(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
              <button type="submit" className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* Roles list */}
      {loading ? (
        <p className="text-slate-500 text-sm">Cargando roles...</p>
      ) : (
        <div className="space-y-2">
          {roles.map(r => (
            <div key={r.id} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-slate-200 font-medium">{r.name}</span>
                  {r.isDefault && <span className="text-xs px-1.5 py-0.5 bg-sky-500/15 text-sky-400 rounded">default</span>}
                  {r.permissions.includes('*') && <span className="text-xs px-1.5 py-0.5 bg-rose-500/15 text-rose-400 rounded">super-admin</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.permissions.map(p => (
                    <span key={p} className={`text-xs px-1.5 py-0.5 rounded border ${p === '*' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>{p}</span>
                  ))}
                  {r.permissions.length === 0 && <span className="text-xs text-slate-600">Sin permisos</span>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setEditRole(r); setError('') }} className="text-xs text-sky-400 hover:text-sky-300">Editar</button>
                <button onClick={() => deleteRole(r.id).then(reload)} className="text-xs text-rose-400 hover:text-rose-300">Eliminar</button>
              </div>
            </div>
          ))}
          {roles.length === 0 && <p className="text-slate-500 text-sm">Sin roles definidos.</p>}
        </div>
      )}
    </div>
  )
}
