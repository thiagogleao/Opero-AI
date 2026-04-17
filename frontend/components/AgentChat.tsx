'use client'
import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type ApiMessage = { role: 'user' | 'assistant'; content: unknown }

type Block =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string }
  | { kind: 'tool_run'; id: string; label: string; done: boolean }
  | { kind: 'confirm'; tool_use_id: string; name: string; preview: string; input: Record<string, unknown>; resolved?: 'approved' | 'rejected' }

interface Props {
  systemPrompt: string
}

const SUGGESTIONS = [
  'Quais são meus produtos mais vendidos?',
  'Mostre os últimos 10 pedidos',
  'Quais clientes compraram mais de R$500 no total?',
  'Crie um produto novo em rascunho',
]

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 4px' }}>
      {[0, 1, 2].map(i => (
        <motion.span key={i}
          style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B5CF6', display: 'inline-block' }}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  )
}

export default function AgentChat({ systemPrompt }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const toolCounterRef = useRef(0)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [blocks])

  async function runAgent(messages: ApiMessage[], confirm?: { tool_use_id: string; approved: boolean }) {
    setLoading(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, systemPrompt, confirm }),
      })

      if (!res.ok || !res.body) {
        setBlocks(prev => [...prev, { kind: 'text', role: 'assistant', content: 'Erro ao conectar com o agente.' }])
        setLoading(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentToolId: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          const event = JSON.parse(part.slice(6)) as Record<string, unknown>

          if (event.type === 'text') {
            setBlocks(prev => {
              const last = prev[prev.length - 1]
              if (last?.kind === 'text' && last.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: last.content + (event.delta as string) }]
              }
              return [...prev, { kind: 'text', role: 'assistant', content: event.delta as string }]
            })
          }

          if (event.type === 'tool_run') {
            const toolId = `tool-${toolCounterRef.current++}`
            currentToolId = toolId
            setBlocks(prev => [...prev, { kind: 'tool_run', id: toolId, label: event.label as string, done: false }])
          }

          if (event.type === 'tool_done' && currentToolId) {
            const doneId = currentToolId
            setBlocks(prev => prev.map(b => b.kind === 'tool_run' && b.id === doneId ? { ...b, done: true } : b))
            currentToolId = null
          }

          if (event.type === 'confirm_required') {
            setApiMessages(event.messages as ApiMessage[])
            setBlocks(prev => [...prev, {
              kind: 'confirm',
              tool_use_id: event.tool_use_id as string,
              name: event.name as string,
              preview: event.preview as string,
              input: event.input as Record<string, unknown>,
            }])
          }

          if (event.type === 'done') {
            setApiMessages(event.messages as ApiMessage[])
          }

          if (event.type === 'error') {
            setBlocks(prev => [...prev, { kind: 'text', role: 'assistant', content: `Erro: ${event.message as string}` }])
          }
        }
      }
    } catch {
      setBlocks(prev => [...prev, { kind: 'text', role: 'assistant', content: 'Erro de conexão.' }])
    }
    setLoading(false)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setBlocks(prev => [...prev, { kind: 'text', role: 'user', content: text }])
    const newMessages: ApiMessage[] = [...apiMessages, { role: 'user', content: text }]
    setApiMessages(newMessages)
    await runAgent(newMessages)
  }

  async function handleConfirm(block: Block & { kind: 'confirm' }, approved: boolean) {
    setBlocks(prev => prev.map(b => b === block ? { ...b, resolved: approved ? 'approved' : 'rejected' } : b))
    await runAgent(apiMessages, { tool_use_id: block.tool_use_id, approved })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {blocks.length === 0 && (
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Sugestões
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => setInput(s)}
                  style={{ textAlign: 'left', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#A78BFA', cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {blocks.map((block, i) => {
          if (block.kind === 'text') {
            const isUser = block.role === 'user'
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '90%',
                  background: isUser ? 'rgba(139,92,246,0.12)' : 'var(--bg-hover)',
                  border: `1px solid ${isUser ? 'rgba(139,92,246,0.25)' : 'var(--border)'}`,
                  borderRadius: isUser ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                  padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65,
                }}>
                  {isUser
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{block.content}</span>
                    : block.content
                      ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          p: ({ children }) => <p style={{ margin: '3px 0', lineHeight: 1.65 }}>{children}</p>,
                          strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
                          h2: ({ children }) => <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '10px 0 4px' }}>{children}</h2>,
                          h3: ({ children }) => <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '8px 0 3px' }}>{children}</h3>,
                          ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ul>,
                          ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ol>,
                          li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
                          table: ({ children }) => <div style={{ overflowX: 'auto', margin: '6px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>{children}</table></div>,
                          tr: ({ children }) => <tr style={{ borderBottom: '1px solid var(--border)' }}>{children}</tr>,
                          th: ({ children }) => <th style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap' }}>{children}</th>,
                          td: ({ children }) => <td style={{ padding: '4px 10px', color: 'var(--text-secondary)' }}>{children}</td>,
                          code: ({ children }) => <code style={{ background: 'rgba(139,92,246,0.15)', borderRadius: 4, padding: '1px 5px', fontSize: 11, color: '#A78BFA' }}>{children}</code>,
                        }}>{block.content}</ReactMarkdown>
                      : <TypingDots />
                  }
                </div>
              </motion.div>
            )
          }

          if (block.kind === 'tool_run') {
            return (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 8, fontSize: 11, color: '#10B981', alignSelf: 'flex-start' }}>
                {block.done
                  ? <span>✓</span>
                  : <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block' }}>⟳</motion.span>
                }
                <span>{block.label}</span>
              </motion.div>
            )
          }

          if (block.kind === 'confirm') {
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#F59E0B', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Confirmar ação
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 12, lineHeight: 1.5 }}>
                  {block.preview}
                </p>
                {block.resolved ? (
                  <p style={{ fontSize: 11, color: block.resolved === 'approved' ? '#10B981' : '#F43F5E', fontWeight: 600 }}>
                    {block.resolved === 'approved' ? '✓ Aprovado e executado' : '✗ Cancelado'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleConfirm(block, true)}
                      style={{ background: '#10B981', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                      Confirmar
                    </button>
                    <button onClick={() => handleConfirm(block, false)}
                      style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 6, padding: '6px 16px', fontSize: 12, color: '#F43F5E', cursor: 'pointer' }}>
                      Cancelar
                    </button>
                  </div>
                )}
              </motion.div>
            )
          }

          return null
        })}

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ display: 'flex', gap: 3, padding: '2px 4px', alignSelf: 'flex-start' }}>
            <TypingDots />
          </motion.div>
        )}

        <div ref={endRef} />
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Pergunte sobre sua loja ou peça uma ação..."
          style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '7px 11px', fontSize: 12, color: 'var(--text-secondary)', outline: 'none' }}
        />
        <button onClick={sendMessage} disabled={!input.trim() || loading}
          style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, color: '#fff', fontWeight: 700, cursor: !input.trim() || loading ? 'not-allowed' : 'pointer', opacity: !input.trim() || loading ? 0.4 : 1 }}>
          ↑
        </button>
      </div>
    </div>
  )
}
