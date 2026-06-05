import { create } from 'zustand'

interface State {
  findings: any[]
  severity: any[]
  events: any[]
  setFindings: (f: any[]) => void
  setSeverity: (s: any[]) => void
  addEvent: (e: any) => void
}

export const useStore = create<State>((set) => ({
  findings: [],
  severity: [],
  events: [],
  setFindings: (findings) => set({ findings }),
  setSeverity: (severity) => set({ severity }),
  addEvent: (e) => set((s) => ({ events: [e, ...s.events].slice(0, 100) })),
}))
