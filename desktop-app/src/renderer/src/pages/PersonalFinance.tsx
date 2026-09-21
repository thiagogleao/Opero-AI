import { useEffect, useState, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
  name: string
  balance: number
  note: string
  share: number
}

interface Entry {
  id: string
  description: string
  amount: number
  date: string
  certainty: 'Certo' | 'Provável' | 'Incerto'
  note: string
}

interface HistoryPoint {
  date: string
  total: number
  projection: number
  note: string
}

interface FinanceData {
  updatedAt: string
  accounts: Account[]
  entries: Entry[]
  history: HistoryPoint[]
}

// ─── Goals ───────────────────────────────────────────────────────────────────

const GOALS = [
  { emoji: '🛡️', label: 'Reserva sólida',          target: 30000,  desc: '+1 ano de vida coberto' },
  { emoji: '🚗', label: 'Zona do carro',             target: 50000,  desc: 'Carro de ~$35-40k possível' },
  { emoji: '💯', label: 'Primeiros $100k',           target: 100000, desc: 'Marco psicológico — juros pesam' },
  { emoji: '🏡', label: 'Casa em Portugal',          target: 200000, desc: 'Casa no interior à vista' },
  { emoji: '🌱', label: 'Semi-independência',        target: 350000, desc: 'Renda passiva cobre metade dos gastos' },
  { emoji: '🕊️', label: 'Independência financeira', target: 600000, desc: 'Renda passiva $2k/mês para sempre' },
  { emoji: '🏆', label: 'Independência confortável',target: 750000, desc: 'Renda passiva $2.5k/mês — sem trabalhar' },
]

// ─── Seed data from spreadsheet ───────────────────────────────────────────────

const SEED: FinanceData = {
  updatedAt: '2026-07-12',
  accounts: [
    { name: 'Airwallex',       balance: 33291.15, note: 'Conta principal operacional',         share: 1 },
    { name: 'Wise',            balance: 17556.49, note: '',                                    share: 1 },
    { name: 'Relay Rodrigo',   balance: 34619.50, note: 'Saldo total — sua parte é 50%',       share: 0.5 },
    { name: 'Hotmart',         balance: 191.00,   note: 'Plataforma de vendas',                share: 1 },
    { name: 'TSG',             balance: 5000.00,  note: 'Saldo total — sua parte é 33%',       share: 1 / 3 },
    { name: 'Contas Paralelas',balance: 247.74,   note: '',                                    share: 1 },
  ],
  entries: [
    { id: '1', description: 'MOKOO 1',               amount: 2615.51, date: '2026-08-04', certainty: 'Certo',   note: '' },
    { id: '2', description: 'MOKOO 1 — parcela 2',   amount: 200.00,  date: '2027-04-04', certainty: 'Certo',   note: '' },
    { id: '3', description: 'Christmas Party Shopify',amount: 2500.00, date: '2026-10-15', certainty: 'Incerto', note: 'Risco máximo' },
    { id: '4', description: 'The Bubuverse',          amount: 1000.00, date: '2026-10-27', certainty: 'Incerto', note: '' },
    { id: '5', description: 'Caução aluguel',         amount: 2100.00, date: '',           certainty: 'Certo',   note: 'Sem data definida' },
    { id: '6', description: 'Bluehost',               amount: 130.00,  date: '',           certainty: 'Certo',   note: '' },
    { id: '7', description: 'Link Shopify',           amount: 1000.00, date: '',           certainty: 'Incerto', note: 'Aproximado' },
    { id: '8', description: 'Link TikTok',            amount: 90.00,   date: '',           certainty: 'Incerto', note: 'Aproximado' },
  ],
  history: [
    { date: '2026-04-03', total: 48759.09, projection: 61779.09, note: 'Primeiro registro' },
    { date: '2026-04-13', total: 45149.50, projection: 61185.01, note: '' },
    { date: '2026-04-22', total: 44621.36, projection: 60656.87, note: '' },
    { date: '2026-04-30', total: 45122.86, projection: 57608.37, note: '' },
    { date: '2026-06-08', total: 48813.00, projection: 58798.51, note: '' },
    { date: '2026-06-16', total: 55912.20, projection: 65897.71, note: '' },
    { date: '2026-06-22', total: 58789.20, projection: 68424.71, note: '' },
    { date: '2026-06-25', total: 62304.00, projection: 71939.45, note: '' },
    { date: '2026-06-28', total: 63871.25, projection: 73506.76, note: '' },
    { date: '2026-06-30', total: 66537.21, projection: 76172.72, note: '' },
    { date: '2026-07-02', total: 67463.46, projection: 77098.97, note: '' },
    { date: '2026-07-05', total: 68809.16, projection: 78444.67, note: '' },
    { date: '2026-07-07', total: 69829.72, projection: 79465.23, note: '' },
    { date: '2026-07-12', total: 70262.80, projection: 79898.31, note: 'Doação $1.082 Projeto Capa' },
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const usd = (v: number) =>
  '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const certaintyColor: Record<string, string> = {
  Certo:    '#22c55e',
  Provável: '#eab308',
  Incerto:  '#f97316',
}

// ─── Editable balance cell ────────────────────────────────────────────────────

function EditableBalance({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const start = () => {
    setRaw(String(value))
    setEditing(true)
    setTimeout(() => ref.current?.select(), 0)
  }
  const commit = () => {
    const n = parseFloat(raw.replace(',', '.'))
    if (!isNaN(n)) onChange(n)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          background: '#1e1e2a', border: '1px solid #22c55e', borderRadius: 6,
          color: '#22c55e', fontSize: 22, fontWeight: 700, width: 160,
          padding: '2px 8px', outline: 'none', textAlign: 'right'
        }}
      />
    )
  }
  return (
    <span
      onClick={start}
      title="Clique para editar"
      style={{ fontSize: 22, fontWeight: 700, color: '#22c55e', cursor: 'pointer',
               borderBottom: '1px dashed #22c55e44', paddingBottom: 1 }}
    >
      {usd(value)}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PersonalFinance() {
  const [data, setData] = useState<FinanceData | null>(null)
  const [saved, setSaved] = useState(false)
  const [newEntry, setNewEntry] = useState({ description: '', amount: '', date: '', certainty: 'Certo' as const, note: '' })
  const [addingEntry, setAddingEntry] = useState(false)

  // ── Load ──
  useEffect(() => {
    window.api.getState().then(state => {
      const stored = state.finance as FinanceData | undefined
      setData(stored ?? SEED)
    })
  }, [])

  // ── Save ──
  const save = async (updated: FinanceData) => {
    // Append history snapshot if it's a new day
    const today = new Date().toISOString().slice(0, 10)
    const myTotal = updated.accounts.reduce((s, a) => s + a.balance * a.share, 0)
    const proj = myTotal + updated.entries.reduce((s, e) => s + e.amount, 0)
    const lastEntry = updated.history.at(-1)
    const withHistory: FinanceData = lastEntry?.date === today
      ? { ...updated, history: [...updated.history.slice(0, -1), { ...lastEntry, total: myTotal, projection: proj }] }
      : { ...updated, history: [...updated.history, { date: today, total: myTotal, projection: proj, note: '' }] }

    await window.api.setState({ finance: withHistory })
    setData(withHistory)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!data) return <div style={{ color: '#888', padding: 40 }}>Carregando...</div>

  // ── Computed values ──
  const myTotal     = data.accounts.reduce((s, a) => s + a.balance * a.share, 0)
  const certainSum  = data.entries.filter(e => e.certainty === 'Certo').reduce((s, e) => s + e.amount, 0)
  const allEntries  = data.entries.reduce((s, e) => s + e.amount, 0)
  const garantido   = myTotal + certainSum
  const projecao    = myTotal + allEntries

  // ── Account update ──
  const updateAccount = (i: number, balance: number) => {
    const accounts = data.accounts.map((a, idx) => idx === i ? { ...a, balance } : a)
    const updated = { ...data, accounts, updatedAt: new Date().toISOString().slice(0, 10) }
    setData(updated)
    save(updated)
  }

  // ── Entry actions ──
  const addEntry = () => {
    const e: Entry = {
      id: Date.now().toString(),
      description: newEntry.description,
      amount: parseFloat(newEntry.amount) || 0,
      date: newEntry.date,
      certainty: newEntry.certainty,
      note: newEntry.note,
    }
    const updated = { ...data, entries: [...data.entries, e] }
    setData(updated)
    save(updated)
    setNewEntry({ description: '', amount: '', date: '', certainty: 'Certo', note: '' })
    setAddingEntry(false)
  }

  const removeEntry = (id: string) => {
    const updated = { ...data, entries: data.entries.filter(e => e.id !== id) }
    setData(updated)
    save(updated)
  }

  // ── Styles ──
  const card: React.CSSProperties = {
    background: '#13131c', border: '1px solid #1e1e2a', borderRadius: 12, padding: '16px 20px'
  }

  const section: React.CSSProperties = { marginBottom: 32 }

  const sectionTitle: React.CSSProperties = {
    color: '#888', fontSize: 11, fontWeight: 600, letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 12
  }

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Finanças Pessoais</div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>Atualizado em {data.updatedAt}</div>
        </div>
        {saved && <div style={{ color: '#22c55e', fontSize: 13 }}>✓ Salvo</div>}
      </div>

      {/* Resumo */}
      <div style={{ ...section }}>
        <div style={sectionTitle}>Resumo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Saldo Total (seu)', value: myTotal, color: '#22c55e', desc: 'Soma de todas as contas' },
            { label: 'Total Garantido',   value: garantido, color: '#60a5fa', desc: `Saldo + entradas certas (+${usd(certainSum)})` },
            { label: 'Projeção Total',    value: projecao, color: '#a78bfa', desc: `Saldo + todas as entradas (+${usd(allEntries)})` },
          ].map(c => (
            <div key={c.label} style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.color }}>{usd(c.value)}</div>
              <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{c.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contas */}
      <div style={section}>
        <div style={sectionTitle}>Saldos por Conta <span style={{ fontWeight: 400, color: '#444' }}>— clique no valor para editar</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {data.accounts.map((a, i) => (
            <div key={a.name} style={{ ...card }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 600, color: '#ccc', fontSize: 14 }}>{a.name}</div>
                {a.share < 1 && (
                  <div style={{ fontSize: 11, background: '#1e1e2a', color: '#888', padding: '2px 6px', borderRadius: 4 }}>
                    {a.share === 0.5 ? '÷2' : '÷3'}
                  </div>
                )}
              </div>
              {a.note && <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{a.note}</div>}
              <div style={{ marginTop: 8 }}>
                <EditableBalance value={a.balance} onChange={v => updateAccount(i, v)} />
                {a.share < 1 && (
                  <div style={{ fontSize: 12, color: '#22c55e88', marginTop: 4 }}>
                    Sua parte: {usd(a.balance * a.share)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Metas */}
      <div style={section}>
        <div style={sectionTitle}>Metas — régua: Total Garantido ({usd(garantido)})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GOALS.map(g => {
            const pct = Math.min((garantido / g.target) * 100, 100)
            const done = garantido >= g.target
            return (
              <div key={g.label} style={{ ...card, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{g.emoji}</span>
                    <span style={{ color: done ? '#22c55e' : '#ccc', fontWeight: 600, fontSize: 14 }}>{g.label}</span>
                    {done && <span style={{ fontSize: 11, background: '#22c55e22', color: '#22c55e', padding: '1px 6px', borderRadius: 4 }}>✅ Concluído</span>}
                  </div>
                  <div style={{ fontSize: 13, color: done ? '#22c55e' : '#888' }}>
                    {usd(g.target)}
                    {!done && <span style={{ color: '#444', marginLeft: 8 }}>faltam {usd(g.target - garantido)}</span>}
                  </div>
                </div>
                <div style={{ height: 6, background: '#1e1e2a', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 0.5s',
                    width: `${pct}%`,
                    background: done ? '#22c55e' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)'
                  }} />
                </div>
                {!done && (
                  <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{g.desc}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Entradas */}
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={sectionTitle}>Entradas Pendentes</div>
          <button
            onClick={() => setAddingEntry(v => !v)}
            style={{ background: '#1e1e2a', border: '1px solid #333', color: '#ccc',
                     borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {addingEntry ? 'Cancelar' : '+ Adicionar'}
          </button>
        </div>

        {addingEntry && (
          <div style={{ ...card, marginBottom: 12, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
            {[
              { label: 'Descrição', field: 'description', type: 'text' },
              { label: 'Valor ($)', field: 'amount', type: 'number' },
              { label: 'Data', field: 'date', type: 'date' },
            ].map(f => (
              <div key={f.field}>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{f.label}</div>
                <input
                  type={f.type}
                  value={(newEntry as any)[f.field]}
                  onChange={e => setNewEntry(p => ({ ...p, [f.field]: e.target.value }))}
                  style={{ background: '#1a1a26', border: '1px solid #333', borderRadius: 6,
                           color: '#ccc', padding: '6px 10px', width: '100%', boxSizing: 'border-box', fontSize: 13 }}
                />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Certeza</div>
              <select
                value={newEntry.certainty}
                onChange={e => setNewEntry(p => ({ ...p, certainty: e.target.value as any }))}
                style={{ background: '#1a1a26', border: '1px solid #333', borderRadius: 6,
                         color: '#ccc', padding: '6px 10px', width: '100%', fontSize: 13 }}
              >
                {['Certo', 'Provável', 'Incerto'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <button
              onClick={addEntry}
              disabled={!newEntry.description || !newEntry.amount}
              style={{ gridColumn: '1 / -1', background: '#22c55e22', border: '1px solid #22c55e44',
                       color: '#22c55e', borderRadius: 6, padding: '8px', fontSize: 13, cursor: 'pointer' }}
            >
              Salvar entrada
            </button>
          </div>
        )}

        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e2a' }}>
                {['Descrição', 'Valor', 'Data', 'Certeza', 'Nota', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontWeight: 500, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid #0e0e18' }}>
                  <td style={{ padding: '10px 14px', color: '#ddd' }}>{e.description}</td>
                  <td style={{ padding: '10px 14px', color: '#22c55e', fontWeight: 600 }}>{usd(e.amount)}</td>
                  <td style={{ padding: '10px 14px', color: '#888' }}>{e.date || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, color: certaintyColor[e.certainty],
                                   background: certaintyColor[e.certainty] + '22',
                                   padding: '2px 7px', borderRadius: 4 }}>
                      {e.certainty}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#555', fontSize: 12 }}>{e.note || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <button
                      onClick={() => removeEntry(e.id)}
                      style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer',
                               fontSize: 16, lineHeight: 1, padding: 2 }}
                      onMouseEnter={ev => (ev.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={ev => (ev.currentTarget.style.color = '#333')}
                    >×</button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#0e0e18' }}>
                <td style={{ padding: '10px 14px', color: '#888', fontWeight: 600 }}>Total</td>
                <td style={{ padding: '10px 14px', color: '#22c55e', fontWeight: 700 }}>{usd(allEntries)}</td>
                <td colSpan={4} style={{ padding: '10px 14px', color: '#555', fontSize: 12 }}>
                  Certo: {usd(certainSum)} · Provaveis+Incertos: {usd(allEntries - certainSum)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Histórico */}
      <div style={section}>
        <div style={sectionTitle}>Evolução Patrimonial</div>
        <div style={{ ...card, padding: '16px 8px' }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.history} margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
              <XAxis
                dataKey="date"
                tickFormatter={d => d.slice(5)}
                tick={{ fill: '#555', fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'}
                tick={{ fill: '#555', fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#13131c', border: '1px solid #1e1e2a', borderRadius: 8 }}
                labelStyle={{ color: '#888' }}
                formatter={(v: number) => usd(v)}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#888' }} />
              <ReferenceLine y={100000} stroke="#60a5fa22" strokeDasharray="4 4" label={{ value: '$100k', fill: '#3b82f6', fontSize: 11 }} />
              <Line type="monotone" dataKey="total" name="Saldo Seu" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="projection" name="Projeção Total" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Nota de reserva */}
      <div style={{ ...card, background: '#1a1200', borderColor: '#eab30822', marginBottom: 32 }}>
        <div style={{ fontSize: 12, color: '#eab308' }}>
          ⚠️ <strong>Reserva operacional:</strong> O total garantido inclui caixa das empresas.
          Mantenha sempre ~$15-20k intocáveis como reserva operacional antes de qualquer compra grande.
          Para decisões pessoais, use <strong>Total Garantido − $20k</strong>.
        </div>
      </div>
    </div>
  )
}
