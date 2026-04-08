'use client'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTr } from '@/lib/translations'

interface Insight {
  type: 'urgent' | 'warning' | 'opportunity' | 'tip'
  title: string
  detail: string
  action: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props { systemPrompt: string }

const TYPE_COLORS = {
  urgent:      { color: '#F43F5E', bg: 'rgba(244,63,94,0.08)',  border: 'rgba(244,63,94,0.25)'  },
  warning:     { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
  opportunity: { color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)' },
  tip:         { color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)' },
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const tr = useTr()
  const cfg = TYPE_COLORS[insight.type] ?? TYPE_COLORS.tip
  const labelMap = { urgent: tr.insight_urgent, warning: tr.insight_warning, opportunity: tr.insight_opportunity, tip: tr.insight_tip }
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, letterSpacing: '0.08em' }}>
          {labelMap[insight.type]}
        </span>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4 }}>{insight.title}</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>{insight.detail}</p>
      <p style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>→ {insight.action}</p>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <motion.div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}
      animate={{ opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }}>
      <div style={{ height: 10, width: '30%', background: 'var(--border-strong)', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 14, width: '70%', background: 'var(--border-strong)', borderRadius: 4, marginBottom: 6 }} />
      <div style={{ height: 11, width: '90%', background: 'var(--border)', borderRadius: 4, marginBottom: 4 }} />
      <div style={{ height: 11, width: '60%', background: 'var(--border)', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 10, width: '45%', background: 'var(--border-strong)', borderRadius: 4 }} />
    </motion.div>
  )
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0,1,2].map(i => (
        <motion.span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B5CF6', display: 'inline-block' }}
          animate={{ opacity: [0.3,1,0.3], y: [0,-3,0] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }} />
      ))}
    </span>
  )
}

export default function AiPanel({ systemPrompt }: Props) {
  const tr = useTr()
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadInsights() {
    setLoading(true); setInsights([]); setInsightError('')
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'insights', systemPrompt }) })
      const data = await res.json()
      if (data.error && (!data.insights || data.insights.length === 0)) {
        setInsightError(data.error)
      } else {
        setInsights(data.insights ?? [])
      }
    } catch (err: unknown) {
      setInsightError(err instanceof Error ? err.message : tr.refresh_error_conn)
    }
    setLoading(false)
  }

  useEffect(() => { loadInsights() }, [])

  async function sendMessage() {
    const text = input.trim()
    if (!text || chatLoading) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages([...newMessages, { role: 'assistant', content: '' }])
    setChatLoading(true)
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'chat', systemPrompt, messages: newMessages.map(m => ({ role: m.role, content: m.content })) }), signal: abortRef.current.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + chunk }
          return updated
        })
      }
    } catch {}
    setChatLoading(false)
  }

  const SUGGESTIONS = [tr.ai_suggestion_1, tr.ai_suggestion_2, tr.ai_suggestion_3, tr.ai_suggestion_4]

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.7 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>

      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(90deg,rgba(139,92,246,0.07),transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 14 }}>{tr.ai_title}</h3>
            <p style={{ color: 'var(--text-ghost)', fontSize: 11 }}>{tr.ai_subtitle}</p>
          </div>
        </div>
        <button onClick={loadInsights} disabled={loading} style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#A78BFA', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1, fontWeight: 500 }}>
          {loading ? tr.ai_refreshing : tr.ai_refresh}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 380 }}>
        <div style={{ padding: 16, borderRight: '1px solid var(--border)' }}>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            {tr.ai_insights_title}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {loading
              ? [0,1,2,3].map(i => <SkeletonCard key={i} />)
              : insightError
              ? <div style={{ gridColumn: '1/-1', padding: '20px 0', color: '#F43F5E', fontSize: 12 }}>
                  {tr.ai_error}: {insightError}
                  <button onClick={loadInsights} style={{ marginLeft: 10, color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>{tr.ai_retry}</button>
                </div>
              : insights.length === 0
              ? <div style={{ gridColumn: '1/-1', padding: '20px 0', color: 'var(--text-faint)', fontSize: 12 }}>
                  {tr.ai_no_insights} <button onClick={loadInsights} style={{ color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>{tr.ai_generate}</button>
                </div>
              : insights.map((ins, i) => <InsightCard key={i} insight={ins} index={i} />)
            }
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {tr.ai_chat_title}
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 260 }}>
            {messages.length === 0 ? (
              <div style={{ color: 'var(--text-ghost)', fontSize: 12, marginTop: 16 }}>
                <p style={{ marginBottom: 12, color: 'var(--text-faint)' }}>{tr.ai_suggestion_1.includes('?') ? 'Suggestions:' : 'Sugestões:'}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUGGESTIONS.map(q => (
                    <button key={q} onClick={() => setInput(q)} style={{ textAlign: 'left', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#A78BFA', cursor: 'pointer' }}>{q}</button>
                  ))}
                </div>
              </div>
            ) : messages.map((msg, i) => {
              const isUser = msg.role === 'user'
              const isStreaming = chatLoading && i === messages.length - 1 && !isUser
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                  <div style={{ maxWidth: '90%', background: isUser ? 'rgba(139,92,246,0.12)' : 'var(--bg-hover)', border: `1px solid ${isUser ? 'rgba(139,92,246,0.25)' : 'var(--border)'}`, borderRadius: isUser ? '10px 10px 3px 10px' : '10px 10px 10px 3px', padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {isStreaming && !msg.content
                      ? <TypingDots />
                      : isUser
                      ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                      : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          p: ({children}) => <p style={{ margin: '4px 0', lineHeight: 1.65 }}>{children}</p>,
                          strong: ({children}) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
                          h2: ({children}) => <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 4px' }}>{children}</h2>,
                          h3: ({children}) => <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', margin: '10px 0 3px' }}>{children}</h3>,
                          ul: ({children}) => <ul style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ul>,
                          ol: ({children}) => <ol style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ol>,
                          li: ({children}) => <li style={{ margin: '2px 0', lineHeight: 1.6 }}>{children}</li>,
                          hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />,
                          table: ({children}) => <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>{children}</table></div>,
                          thead: ({children}) => <thead>{children}</thead>,
                          tbody: ({children}) => <tbody>{children}</tbody>,
                          tr: ({children}) => <tr style={{ borderBottom: '1px solid var(--border)' }}>{children}</tr>,
                          th: ({children}) => <th style={{ padding: '5px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap' }}>{children}</th>,
                          td: ({children}) => <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{children}</td>,
                          code: ({children}) => <code style={{ background: 'rgba(139,92,246,0.15)', borderRadius: 4, padding: '1px 5px', fontSize: 11, color: '#A78BFA' }}>{children}</code>,
                        }}>{msg.content}</ReactMarkdown>
                    }
                  </div>
                </motion.div>
              )
            })}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={tr.ai_placeholder}
              style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '7px 11px', fontSize: 12, color: 'var(--text-secondary)', outline: 'none' }} />
            <button onClick={sendMessage} disabled={!input.trim() || chatLoading}
              style={{ background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, color: '#fff', fontWeight: 700, cursor: !input.trim() || chatLoading ? 'not-allowed' : 'pointer', opacity: !input.trim() || chatLoading ? 0.4 : 1 }}>↑</button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
