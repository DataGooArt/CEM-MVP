import { useState, useEffect } from 'react'
import { fetchUsers, fetchRoles, createUser, updateUser, deactivateUser, activateUser } from './api'

interface User { id: string; email: string; name: string; roleId: string | null; isActive: boolean; createdAt: string; role: { id: string; name: string } | null }
interface Role  { id: string; name: string }

export default function UsersManager() {
  const [users, setUsers]         = useState<User[]>([])
  const [roles, setRoles]         = useState<Role[]>([])
  const [loading, setLoading]     = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser]   = useState<User | null>(null)
  const [error, setError]         = useState('')

  const [form, setForm] = useState({ email: '', password: '', name: '', roleId: '' })
  const [editForm, setEditForm] = useState({ name: '', roleId: '', password: '' })

  async function reload() {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([fetchUsers(), fetchRoles()])
      setUsers(u); setRoles(r)
    } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await createUser({ email: form.email, password: form.password, name: form.name, roleId: form.roleId || undefined })
      setForm({ email: '', password: '', name: '', roleId: '' })
      setShowCreate(false)
      reload()
    } catch (e: any) { setError(e.message) }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setError('')
    try {
      const data: any = {}
      if (editForm.name)    data.name = editForm.name
      if (editForm.roleId)  data.roleId = editForm.roleId
      if (editForm.password) data.password = editForm.password
      await updateUser(editUser.id, data)
      setEditUser(null)
      reload()
    } catch (e: any) { setError(e.message) }
  }

  function openEdit(u: User) {
    setEditUser(u)
    setEditForm({ name: u.name, roleId: u.roleId || '', password: '' })
    setError('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-slate-200 font-semibold">Usuarios</h3>
        <button onClick={() => { setShowCreate(true); setError('') }}
          className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg transition-colors">
          + Nuevo usuario
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Nuevo usuario</h4>
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <input required placeholder="Nombre completo" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <input required type="email" placeholder="Correo electrónico" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <input required type="password" placeholder="Contraseña (mín. 8 caracteres)" minLength={8} value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <select value={form.roleId} onChange={e => setForm(f => ({...f, roleId: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
              <option value="">— Sin rol —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
              <button type="submit" className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg">Crear</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form onSubmit={handleEdit} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h4 className="text-slate-200 font-semibold">Editar: {editUser.email}</h4>
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <input placeholder="Nuevo nombre" value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <input type="password" placeholder="Nueva contraseña (dejar vacío para no cambiar)" value={editForm.password} onChange={e => setEditForm(f => ({...f, password: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"/>
            <select value={editForm.roleId} onChange={e => setEditForm(f => ({...f, roleId: e.target.value}))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200">
              <option value="">— Sin rol —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEditUser(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
              <button type="submit" className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-slate-500 text-sm">Cargando usuarios...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Correo</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Rol</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-200">{u.name}</td>
                  <td className="px-4 py-3 text-slate-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">{u.role?.name ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${u.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-600/30 text-slate-500'}`}>
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEdit(u)} className="text-xs text-sky-400 hover:text-sky-300">Editar</button>
                      {u.isActive
                        ? <button onClick={() => deactivateUser(u.id).then(reload)} className="text-xs text-rose-400 hover:text-rose-300">Desactivar</button>
                        : <button onClick={() => activateUser(u.id).then(reload)} className="text-xs text-emerald-400 hover:text-emerald-300">Activar</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Sin usuarios registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
