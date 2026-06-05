import { io, Socket } from 'socket.io-client'

const WS = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/realtime'

let socket: Socket | null = null
const listeners = new Set<(evt: any) => void>()

export function connectWS() {
  if (socket?.connected) return
  socket = io(WS, { transports: ['websocket'] })
  socket.on('connect', () => console.log('[WS] Connected'))
  socket.on('telemetry', (evt) => listeners.forEach(cb => cb(evt)))
  socket.on('disconnect', () => console.log('[WS] Disconnected'))
}

export function subOrg(orgId: string) {
  socket?.emit('subscribe:organization', orgId)
}

export function onTelemetry(cb: (evt: any) => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
