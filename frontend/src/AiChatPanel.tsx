import { useState, useRef, useEffect } from 'react'
import { sendAiChat } from './api'

type Message = { role: 'user' | 'assistant'; content: string }

interface Props {
  context?: { type: 'finding' | 'report' | 'general'; id?: string; label?: string }
  onClose: () => void
}

const contextIcon = { finding: '🔍', report: '📋', general: '🛡️' }
const contextLabel = { finding: 'Hallazgo', report: 'Informe', general: 'CEM Platform' }

export default function AiChatPanel({ context, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [model, setModel] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const apiContext = context?.id
        ? context.type === 'finding' ? { findingId: context.id } : { scanId: context.id }
        : undefined
      const res = await sendAiChat(next, apiContext)
      setMessages(m => [...m, { role: 'assistant', content: res.reply }])
      if (res.model) setModel(res.model)
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Error al contactar el servicio de IA. Intenta de nuevo.' }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const ctxType = context?.type ?? 'general'

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col w-[360px] max-h-[520px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{contextIcon[ctxType]}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-200">{contextLabel[ctxType]}</p>
            {context?.label && (
              <p className="text-[10px] text-slate-500 truncate max-w-[240px]" title={context.label}>{context.label}</p>
            )}
          </div>
          {model && (
            <span className="ml-auto shrink-0 text-[9px] text-slate-600 font-mono border border-slate-700 rounded px-1.5 py-0.5">
              {model.split('/').pop()}
            </span>
          )}
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <span className="text-3xl opacity-30">🤖</span>
            <p className="text-slate-500 text-xs text-center">
              {ctxType === 'general'
                ? 'Pregúntame sobre hallazgos, remediaciones o la postura de seguridad.'
                : ctxType === 'finding'
                ? 'Puedo analizar este hallazgo, explicar el riesgo o sugerir remediaciones.'
                : 'Puedo interpretar los resultados de este informe de escaneo.'}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-sky-600 text-white rounded-br-sm'
                : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700/50 rounded-xl rounded-bl-sm px-4 py-2.5">
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"/>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"/>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"/>
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="border-t border-slate-700/60 p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribe tu consulta… (Enter para enviar)"
            rows={1}
            disabled={loading}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-colors disabled:opacity-50"
            style={{ maxHeight: '100px', overflowY: 'auto' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="shrink-0 w-8 h-8 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg flex items-center justify-center transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
          </button>
        </div>
        <p className="text-[9px] text-slate-600 mt-1.5 text-center">Shift+Enter para nueva línea</p>
      </div>
    </div>
  )
}
