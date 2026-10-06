'use client'

import { useState } from 'react'
import { Download, X, Loader2 } from 'lucide-react'
import type { StoreOption } from '@/lib/tenant'

/** Local YYYY-MM-DD; toISOString would shift the date in negative offsets. */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shift(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return iso(d)
}

const PERIODOS = [
  { label: '7 dias', from: () => shift(6) },
  { label: '14 dias', from: () => shift(13) },
  { label: '30 dias', from: () => shift(29) },
  { label: '90 dias', from: () => shift(89) },
  { label: '12 meses', from: () => shift(364) },
]

export default function ExportButton({ stores, activeStoreId }: {
  stores: StoreOption[]
  activeStoreId?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>(activeStoreId ? [activeStoreId] : [])
  const [from, setFrom] = useState(shift(29))
  const [to, setTo] = useState(iso(new Date()))
  const [comPedidos, setComPedidos] = useState(true)

  const nome = (s: StoreOption) =>
    s.shop_name ?? s.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja'

  const toggle = (id: string) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function baixar() {
    if (selected.length === 0) { setErro('Escolha pelo menos uma loja.'); return }
    if (from > to) { setErro('A data inicial é depois da final.'); return }
    setBusy(true); setErro(null)
    try {
      const qs = new URLSearchParams({ from, to, orders: comPedidos ? '1' : '0' })
      for (const id of selected) qs.append('store', id)
      const res = await fetch(`/api/export?${qs}`)
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `falhou (${res.status})`)
      }
      // Read the name the server chose rather than inventing one here.
      const cd = res.headers.get('Content-Disposition') ?? ''
      const nomeArquivo = /filename="([^"]+)"/.exec(cd)?.[1] ?? `opero-${from}-a-${to}.xlsx`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = nomeArquivo
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao gerar o arquivo')
    } finally {
      setBusy(false)
    }
  }

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px',
    fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
    border: '1px solid #2A2D38', background: '#13151A', color: '#A1A1AA',
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={btn} title="Exportar os dados para Excel">
        <Download size={14} /> Exportar
      </button>

      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.66)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
          <div style={{
            width: '100%', maxWidth: 460, maxHeight: '86vh', overflowY: 'auto',
            background: '#0B0D0F', border: '1px solid #2A2D38', borderRadius: 14, padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#E4E4E7' }}>Exportar dados</h2>
              <button onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: '#71717A', cursor: 'pointer', padding: 4 }}>
                <X size={17} />
              </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 11.5, color: '#52525B', lineHeight: 1.5 }}>
              Uma planilha com resumo, diário, pedidos, produtos, países, campanhas, estornos e
              a configuração de custos usada. Feita para ser lida por quem não tem acesso ao Opero.
            </p>

            <label style={{ fontSize: 11, color: '#71717A', fontWeight: 600 }}>Lojas</label>
            <div style={{ margin: '7px 0 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stores.map(s => (
                <label key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                  borderRadius: 7, cursor: 'pointer', fontSize: 12.5,
                  background: selected.includes(s.id) ? '#1A2E22' : '#13151A',
                  border: `1px solid ${selected.includes(s.id) ? '#2F6B45' : '#2A2D38'}`,
                  color: selected.includes(s.id) ? '#D4F4DD' : '#A1A1AA',
                }}>
                  <input type="checkbox" checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)} style={{ accentColor: '#10B981' }} />
                  {nome(s)}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={() => setSelected(stores.map(s => s.id))}
                style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>Todas</button>
              <button onClick={() => setSelected([])}
                style={{ ...btn, padding: '4px 10px', fontSize: 11 }}>Nenhuma</button>
            </div>

            <label style={{ fontSize: 11, color: '#71717A', fontWeight: 600 }}>Período</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '7px 0 10px' }}>
              {PERIODOS.map(p => (
                <button key={p.label}
                  onClick={() => { setFrom(p.from()); setTo(iso(new Date())) }}
                  style={{
                    ...btn, padding: '4px 10px', fontSize: 11,
                    background: from === p.from() ? '#1E293B' : '#13151A',
                    color: from === p.from() ? '#E4E4E7' : '#A1A1AA',
                  }}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateStyle} />
              <span style={{ color: '#52525B', fontSize: 12 }}>até</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateStyle} />
            </div>

            <label style={{
              display: 'flex', alignItems: 'center', gap: 9, fontSize: 12,
              color: '#A1A1AA', marginBottom: 16, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={comPedidos}
                onChange={e => setComPedidos(e.target.checked)} style={{ accentColor: '#10B981' }} />
              Incluir a aba de pedidos, linha por linha
            </label>

            {erro && (
              <p style={{
                margin: '0 0 12px', padding: '8px 11px', borderRadius: 7, fontSize: 12,
                background: '#2A1416', border: '1px solid #7F1D1D', color: '#FCA5A5',
              }}>{erro}</p>
            )}

            <button onClick={baixar} disabled={busy}
              style={{
                ...btn, width: '100%', justifyContent: 'center', padding: '10px',
                fontSize: 13, background: busy ? '#1E293B' : '#10B981',
                borderColor: busy ? '#2A2D38' : '#10B981',
                color: busy ? '#71717A' : '#04140C',
                cursor: busy ? 'default' : 'pointer',
              }}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Gerando…</> : <><Download size={14} /> Baixar planilha</>}
            </button>
            {busy && (
              <p style={{ margin: '9px 0 0', fontSize: 11, color: '#52525B', textAlign: 'center' }}>
                Períodos longos levam alguns minutos: cada pedido é precificado individualmente.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const dateStyle: React.CSSProperties = {
  flex: 1, padding: '6px 9px', fontSize: 12, borderRadius: 7,
  border: '1px solid #2A2D38', background: '#13151A', color: '#E4E4E7',
}
