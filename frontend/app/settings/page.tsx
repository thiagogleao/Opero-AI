'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { useUser } from '@clerk/nextjs'
import { useSettings, type Theme, type Language, type Currency, type DateFormat, type AttributionWindow } from '@/contexts/SettingsContext'
import { getTranslations } from '@/lib/translations'
import Sidebar from '@/components/Sidebar'

type StoreRow = {
  id: string
  shopify_domain: string | null
  shopify_access_token: string | null
  fb_access_token: string | null
  fb_ad_account_id: string | null
}

const LANGUAGES: { value: Language; label: string; flag: string }[] = [
  { value: 'pt', label: 'Português (BR)', flag: '🇧🇷' },
  { value: 'en', label: 'English',        flag: '🇺🇸' },
  { value: 'es', label: 'Español',        flag: '🇪🇸' },
]

const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'USD', label: 'US Dollar',      symbol: '$'  },
  { value: 'BRL', label: 'Real (BRL)',     symbol: 'R$' },
  { value: 'EUR', label: 'Euro',           symbol: '€'  },
  { value: 'GBP', label: 'Pound Sterling', symbol: '£'  },
]

const DATE_FORMATS: { value: DateFormat; example: string }[] = [
  { value: 'DD/MM/YYYY', example: '25/12/2024' },
  { value: 'MM/DD/YYYY', example: '12/25/2024' },
  { value: 'YYYY-MM-DD', example: '2024-12-25' },
]

const TIMEZONES: { group: string; zones: string[] }[] = [
  { group: 'América do Sul', zones: ['America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Belem', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Buenos_Aires'] },
  { group: 'América do Norte', zones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City'] },
  { group: 'Europa', zones: ['Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm'] },
  { group: 'Ásia / Pacífico', zones: ['Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'] },
  { group: 'Outros', zones: ['UTC', 'Africa/Johannesburg', 'Africa/Lagos'] },
]

function Section({ title, delay = 0, children }: { title: string; delay?: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(139,92,246,0.04)' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</p>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </motion.div>
  )
}

function Row({ label, desc, last, children }: { label: string; desc?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--border)', gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</p>
        {desc && <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{desc}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)} style={{
      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', padding: 2,
      background: enabled ? '#8B5CF6' : 'var(--border-strong)', transition: 'background 0.2s', position: 'relative',
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'transform 0.2s',
        transform: enabled ? 'translateX(18px)' : 'translateX(0)',
      }} />
    </button>
  )
}

function NumberInput({ value, onChange, min, max, step = 0.1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: 80, background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: 'var(--text-primary)', textAlign: 'right', outline: 'none' }}
    />
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: 220, background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' }}
    />
  )
}

function ChipGroup<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          background: value === o.value ? 'rgba(139,92,246,0.2)' : 'transparent',
          color: value === o.value ? '#A78BFA' : 'var(--text-faint)',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
      background: connected ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
      color: connected ? '#10B981' : '#F43F5E',
      border: `1px solid ${connected ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`,
    }}>
      {connected ? '● Connected' : '○ Disconnected'}
    </span>
  )
}

type ExtraAccount = { id: number; fb_ad_account_id: string; nickname: string | null; is_active: boolean }

function SettingsContent() {
  const s = useSettings()
  const tr = getTranslations(s.language)
  const { user } = useUser()
  const userId = user?.id
  const [resetConfirm, setResetConfirm]       = useState(false)
  const [fbConnected, setFbConnected]         = useState<boolean | null>(null)
  const [fbAccountId, setFbAccountId]         = useState<string | null>(null)
  const [fbAccountIdDraft, setFbAccountIdDraft] = useState('')
  const [fbAccountIdSaving, setFbAccountIdSaving] = useState(false)
  const [shopifyDomain, setShopifyDomain]     = useState<string | null>(null)
  const [extraAccounts, setExtraAccounts]     = useState<ExtraAccount[]>([])
  const [stores, setStores]                   = useState<StoreRow[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId]           = useState<string | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    fetch('/api/tenant')
      .then(r => r.json())
      .then(d => {
        setFbConnected(!!d.tenant?.fb_access_token)
        setFbAccountId(d.tenant?.fb_ad_account_id || null)
        setFbAccountIdDraft(d.tenant?.fb_ad_account_id || '')
        setShopifyDomain(d.tenant?.shopify_domain || null)
        if (d.tenant?.timezone) s.setTimezone(d.tenant.timezone)
      })
      .catch(() => setFbConnected(false))

    fetch('/api/facebook/extra-accounts')
      .then(r => r.json())
      .then(d => setExtraAccounts(d.accounts || []))
      .catch(() => {})

    fetch('/api/stores')
      .then(r => r.json())
      .then(d => setStores(d.stores || []))
      .catch(() => {})
  }, [])

  async function saveFbAccountId() {
    if (!fbAccountIdDraft.trim()) return
    setFbAccountIdSaving(true)
    const id = fbAccountIdDraft.trim().replace(/^act_/, '')
    const normalized = `act_${id}`
    await fetch('/api/tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fb_ad_account_id: normalized }),
    })
    setFbAccountId(normalized)
    setFbAccountIdDraft(normalized)
    setFbAccountIdSaving(false)
  }

  async function handleDeleteStore(id: string) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return }
    setDeletingId(id)
    setConfirmDeleteId(null)
    await fetch(`/api/stores/${id}`, { method: 'DELETE' })
    setStores(prev => prev.filter(s => s.id !== id))
    setDeletingId(null)
  }

  async function toggleExtraAccount(id: number, is_active: boolean) {
    setExtraAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active } : a))
    await fetch(`/api/facebook/extra-accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    })
  }

  async function removeExtraAccount(id: number) {
    setExtraAccounts(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/facebook/extra-accounts/${id}`, { method: 'DELETE' })
  }

  function handleTimezoneChange(tz: string) {
    s.setTimezone(tz)
    fetch('/api/tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
  }

  // Show banner if just connected via OAuth
  const justConnected      = searchParams.get('fb_connected') === 'true'
  const justExtraConnected = searchParams.get('fb_extra_connected') === 'true'
  const fbError            = searchParams.get('fb_error')

  const attrOptions: { value: AttributionWindow; label: string }[] = [
    { value: '1d',  label: tr.settings_attr_1d  },
    { value: '7d',  label: tr.settings_attr_7d  },
    { value: '28d', label: tr.settings_attr_28d },
  ]

  function handleReset() {
    if (!resetConfirm) { setResetConfirm(true); return }
    localStorage.removeItem('opero_settings')
    window.location.reload()
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      <Sidebar active="/settings" />

      {/* Main */}
      <main style={{ marginLeft: 56, flex: 1, padding: '32px 40px', maxWidth: 760 }}>

        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>{tr.settings_title}</h1>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 4 }}>{tr.settings_subtitle}</p>
        </motion.div>

        {/* ── Minhas Lojas ── */}
        <Section title="Minhas Lojas" delay={0.02}>
          {stores.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 16 }}>Carregando lojas...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {stores.map((store, idx) => {
                const isPrimary = store.id === userId
                const isDeleting = deletingId === store.id
                const isConfirming = confirmDeleteId === store.id
                return (
                  <div key={store.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 0', gap: 16,
                    borderBottom: idx < stores.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                          {store.shopify_domain || store.id}
                        </p>
                        {isPrimary && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: 'rgba(139,92,246,0.12)', color: '#A78BFA', border: '1px solid rgba(139,92,246,0.25)' }}>
                            Principal
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          background: store.shopify_access_token ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.08)',
                          color: store.shopify_access_token ? '#10B981' : '#F43F5E',
                          border: `1px solid ${store.shopify_access_token ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.2)'}` }}>
                          Shopify {store.shopify_access_token ? '✓' : '✗'}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          background: store.fb_access_token ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.08)',
                          color: store.fb_access_token ? '#10B981' : '#F43F5E',
                          border: `1px solid ${store.fb_access_token ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.2)'}` }}>
                          Facebook {store.fb_access_token ? '✓' : '✗'}
                        </span>
                        {store.fb_ad_account_id && (
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            Conta: {store.fb_ad_account_id}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {store.shopify_domain && (
                        <a href={`/api/shopify/auth?shop=${store.shopify_domain}&reconnect=1`}
                          style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 7,
                            border: '1px solid var(--border-strong)', background: 'var(--bg-input)',
                            color: 'var(--text-muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          Shopify ↻
                        </a>
                      )}
                      {!isPrimary && (
                        <button
                          disabled={isDeleting}
                          onClick={() => handleDeleteStore(store.id)}
                          style={{
                            padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: isDeleting ? 'default' : 'pointer',
                            border: `1px solid ${isConfirming ? '#F43F5E' : 'rgba(244,63,94,0.35)'}`,
                            background: isConfirming ? 'rgba(244,63,94,0.15)' : 'rgba(244,63,94,0.06)',
                            color: '#F43F5E', whiteSpace: 'nowrap', opacity: isDeleting ? 0.5 : 1,
                          }}>
                          {isDeleting ? 'Removendo...' : isConfirming ? 'Confirmar?' : 'Remover'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ marginTop: stores.length > 0 ? 16 : 0, borderTop: stores.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: stores.length > 0 ? 16 : 0 }}>
            <a href="/onboarding?addStore=true"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                borderRadius: 8, border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#A78BFA',
                textDecoration: 'none', cursor: 'pointer' }}>
              + Adicionar nova loja
            </a>
          </div>
        </Section>

        {/* ── Store Information ── */}
        <Section title={tr.settings_store} delay={0.04}>
          <Row label={tr.settings_store_name}>
            <TextInput value={s.storeName} onChange={s.setStoreName} placeholder={tr.settings_store_name_ph} />
          </Row>
          <Row label={tr.settings_store_url}>
            <TextInput value={s.storeUrl} onChange={s.setStoreUrl} placeholder={tr.settings_store_url_ph} />
          </Row>
          <Row label={tr.settings_timezone} desc={tr.settings_timezone_desc} last>
            <select value={s.timezone} onChange={e => handleTimezoneChange(e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', minWidth: 220 }}>
              {TIMEZONES.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.zones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </optgroup>
              ))}
            </select>
          </Row>
        </Section>

        {/* ── Appearance ── */}
        <Section title={tr.settings_appearance} delay={0.07}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>{tr.settings_theme}</p>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['dark', 'light'] as Theme[]).map(t => {
                const active = s.theme === t
                const isDark = t === 'dark'
                return (
                  <button key={t} onClick={() => s.setTheme(t)} style={{ flex: 1, padding: 0, border: `2px solid ${active ? '#8B5CF6' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', background: 'transparent', transition: 'border-color 0.15s' }}>
                    <div style={{ height: 72, borderRadius: '8px 8px 0 0', background: isDark ? '#0B0D0F' : '#F4F4F5', display: 'flex', flexDirection: 'column', gap: 6, padding: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {['#8B5CF6','#10B981','#38BDF8'].map(c => (
                          <div key={c} style={{ flex: 1, height: 18, borderRadius: 4, background: isDark ? '#111318' : '#FFFFFF', border: `1px solid ${isDark ? '#1E2028' : '#E4E4E7'}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ height: 9, borderRadius: 3, background: isDark ? '#111318' : '#FFFFFF', border: `1px solid ${isDark ? '#1E2028' : '#E4E4E7'}` }} />
                      <div style={{ height: 9, borderRadius: 3, width: '70%', background: isDark ? '#1E2028' : '#E4E4E7' }} />
                    </div>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: '0 0 8px 8px', textAlign: 'left' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: active ? '#8B5CF6' : 'var(--text-primary)', marginBottom: 2 }}>
                        {isDark ? tr.settings_theme_dark : tr.settings_theme_light}
                        {active && <span style={{ marginLeft: 8, fontSize: 10, color: '#8B5CF6' }}>✓</span>}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isDark ? tr.settings_theme_dark_desc : tr.settings_theme_light_desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>{tr.settings_language}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {LANGUAGES.map(l => (
                <button key={l.value} onClick={() => s.setLanguage(l.value)} style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: `1px solid ${s.language === l.value ? '#8B5CF6' : 'var(--border)'}`,
                  background: s.language === l.value ? 'rgba(139,92,246,0.12)' : 'var(--bg-input)',
                  color: s.language === l.value ? '#A78BFA' : 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{l.flag}</span><span>{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* ── Regional ── */}
        <Section title={tr.settings_regional} delay={0.1}>
          <Row label={tr.settings_currency} desc={tr.settings_currency_desc}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CURRENCIES.map(c => (
                <button key={c.value} onClick={() => s.setCurrency(c.value)} style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                  border: `1px solid ${s.currency === c.value ? '#8B5CF6' : 'var(--border)'}`,
                  background: s.currency === c.value ? 'rgba(139,92,246,0.12)' : 'var(--bg-input)',
                  color: s.currency === c.value ? '#A78BFA' : 'var(--text-muted)', cursor: 'pointer',
                }}>
                  <span style={{ fontWeight: 700 }}>{c.symbol}</span> {c.value}
                </button>
              ))}
            </div>
          </Row>
          <Row label={tr.settings_date_format} desc={tr.settings_date_format_desc} last>
            <div style={{ display: 'flex', gap: 6 }}>
              {DATE_FORMATS.map(f => (
                <button key={f.value} onClick={() => s.setDateFormat(f.value)} style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                  border: `1px solid ${s.dateFormat === f.value ? '#8B5CF6' : 'var(--border)'}`,
                  background: s.dateFormat === f.value ? 'rgba(139,92,246,0.12)' : 'var(--bg-input)',
                  color: s.dateFormat === f.value ? '#A78BFA' : 'var(--text-muted)', cursor: 'pointer',
                }}>
                  {f.example}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* ── Attribution & Data ── */}
        <Section title={tr.settings_attribution} delay={0.13}>
          <Row label={tr.settings_attr_window} desc={tr.settings_attr_window_desc}>
            <ChipGroup options={attrOptions} value={s.attributionWindow} onChange={s.setAttributionWindow} />
          </Row>
          <Row label="Atualização automática" desc="Sincroniza novos dados periodicamente em segundo plano" last>
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
              {([0, 15, 30, 60, 120] as const).map(mins => (
                <button key={mins} onClick={() => s.setAutoRefreshInterval(mins)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: s.autoRefreshInterval === mins ? 'rgba(139,92,246,0.2)' : 'transparent',
                  color: s.autoRefreshInterval === mins ? '#A78BFA' : 'var(--text-faint)',
                }}>
                  {mins === 0 ? 'Off' : mins < 60 ? `${mins}min` : `${mins / 60}h`}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* ── Goals & KPIs ── */}
        <Section title={tr.settings_goals} delay={0.16}>
          <Row label={tr.settings_goal_roas} desc={tr.settings_goal_roas_desc}>
            <NumberInput value={s.goals.targetRoas} onChange={v => s.setGoals({ targetRoas: v })} min={0} max={20} step={0.1} />
          </Row>
          <Row label={tr.settings_goal_margin} desc={tr.settings_goal_margin_desc}>
            <NumberInput value={s.goals.targetMargin} onChange={v => s.setGoals({ targetMargin: v })} min={0} max={100} step={1} />
          </Row>
          <Row label={tr.settings_goal_revenue} desc={tr.settings_goal_revenue_desc}>
            <NumberInput value={s.goals.targetDailyRevenue} onChange={v => s.setGoals({ targetDailyRevenue: v })} min={0} step={100} />
          </Row>
          <Row label={tr.settings_goal_cac} desc={tr.settings_goal_cac_desc} last>
            <NumberInput value={s.goals.targetCac} onChange={v => s.setGoals({ targetCac: v })} min={0} step={1} />
          </Row>
        </Section>

        {/* ── Alerts & Notifications ── */}
        <Section title={tr.settings_alerts} delay={0.19}>
          <Row label={tr.settings_alert_roas_drop} desc={tr.settings_alert_roas_drop_d}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{tr.settings_alert_threshold}:</span>
              <NumberInput value={s.alerts.roasDropThreshold} onChange={v => s.setAlerts({ roasDropThreshold: v })} min={0} max={10} step={0.1} />
              <Toggle enabled={s.alerts.roasDropEnabled} onChange={v => s.setAlerts({ roasDropEnabled: v })} />
            </div>
          </Row>
          <Row label={tr.settings_alert_spend_spike} desc={tr.settings_alert_spend_spike_d}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{tr.settings_alert_threshold}:</span>
              <NumberInput value={s.alerts.spendSpikeThreshold} onChange={v => s.setAlerts({ spendSpikeThreshold: v })} min={0} max={1000} step={10} />
              <Toggle enabled={s.alerts.spendSpikeEnabled} onChange={v => s.setAlerts({ spendSpikeEnabled: v })} />
            </div>
          </Row>
          <Row label={tr.settings_alert_margin_drop} desc={tr.settings_alert_margin_drop_d} last>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{tr.settings_alert_threshold}:</span>
              <NumberInput value={s.alerts.marginDropThreshold} onChange={v => s.setAlerts({ marginDropThreshold: v })} min={0} max={100} step={1} />
              <Toggle enabled={s.alerts.marginDropEnabled} onChange={v => s.setAlerts({ marginDropEnabled: v })} />
            </div>
          </Row>
        </Section>

        {/* ── Integrations ── */}
        {(justConnected || justExtraConnected || fbError) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 500,
              background: (justConnected || justExtraConnected) ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
              border: `1px solid ${(justConnected || justExtraConnected) ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`,
              color: (justConnected || justExtraConnected) ? '#10B981' : '#F43F5E' }}>
            {justExtraConnected ? '✓ Conta extra do Facebook Ads adicionada com sucesso!'
              : justConnected  ? '✓ Facebook Ads conectado com sucesso!'
              : `✗ Erro ao conectar Facebook: ${fbError}`}
          </motion.div>
        )}
        <Section title={tr.settings_integrations} delay={0.22}>
          <Row label={tr.settings_int_shopify} desc={shopifyDomain || 'REST Admin API'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusBadge connected={!!shopifyDomain} />
              {shopifyDomain && (
                <a href={`/api/shopify/auth?shop=${shopifyDomain}&reconnect=1`}
                  style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 7, border: '1px solid #8B5CF6',
                    background: 'rgba(139,92,246,0.12)', color: '#A78BFA', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Reconectar
                </a>
              )}
            </div>
          </Row>
          <div style={{ padding: '12px 0', borderBottom: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fbConnected ? 10 : 0 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{tr.settings_int_facebook}</p>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Marketing API v20</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StatusBadge connected={fbConnected === true} />
                <a href="/api/facebook/auth"
                  style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 7, border: '1px solid #8B5CF6',
                    background: 'rgba(139,92,246,0.12)', color: '#A78BFA', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  {fbConnected ? 'Reconectar' : 'Conectar'}
                </a>
              </div>
            </div>
            {fbConnected && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
                  <input
                    value={fbAccountIdDraft}
                    onChange={e => setFbAccountIdDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveFbAccountId()}
                    placeholder="act_123456789 (ID da conta de anúncios)"
                    style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={saveFbAccountId}
                  disabled={fbAccountIdSaving || !fbAccountIdDraft.trim()}
                  style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 7, border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#A78BFA', cursor: 'pointer', whiteSpace: 'nowrap', opacity: fbAccountIdSaving ? 0.5 : 1 }}>
                  {fbAccountIdSaving ? 'Salvando...' : fbAccountId === fbAccountIdDraft ? '✓ Salvo' : 'Salvar'}
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* ── Extra Facebook Accounts ── */}
        <Section title="Contas Extras do Facebook Ads" delay={0.24}>
          {extraAccounts.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 16 }}>
              Nenhuma conta extra adicionada ainda.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {extraAccounts.map((acc, idx) => (
                <div key={acc.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0', gap: 12,
                  borderBottom: idx < extraAccounts.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {acc.nickname || acc.fb_ad_account_id}
                    </p>
                    {acc.nickname && (
                      <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>{acc.fb_ad_account_id}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: acc.is_active ? '#10B981' : 'var(--text-faint)' }}>
                      {acc.is_active ? 'Ativa' : 'Pausada'}
                    </span>
                    <Toggle enabled={acc.is_active} onChange={v => toggleExtraAccount(acc.id, v)} />
                    <button onClick={() => removeExtraAccount(acc.id)} style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.08)', color: '#F43F5E',
                    }}>
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: extraAccounts.length > 0 ? 16 : 0 }}>
            <a href="/api/facebook/auth?mode=add_extra"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600,
                borderRadius: 8, border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#A78BFA',
                textDecoration: 'none', cursor: 'pointer' }}>
              + Adicionar conta extra
            </a>
          </div>
        </Section>

        {/* ── Danger Zone ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 12, overflow: 'hidden', marginBottom: 32 }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(244,63,94,0.15)', background: 'rgba(244,63,94,0.04)' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,63,94,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{tr.settings_danger}</p>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{tr.settings_reset}</p>
                <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{tr.settings_reset_desc}</p>
                {resetConfirm && <p style={{ fontSize: 11, color: '#F43F5E', marginTop: 6 }}>{tr.settings_reset_confirm}</p>}
              </div>
              <button onClick={handleReset} style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                background: resetConfirm ? '#F43F5E' : 'transparent',
                border: `1px solid ${resetConfirm ? '#F43F5E' : 'rgba(244,63,94,0.4)'}`,
                color: resetConfirm ? '#fff' : '#F43F5E',
                transition: 'all 0.15s',
              }}>
                {resetConfirm ? tr.settings_reset_confirm.split('?')[0] + '?' : tr.settings_reset_btn}
              </button>
            </div>
          </div>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginBottom: 40 }}>
          ✓ {tr.settings_saved}
        </motion.p>

      </main>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
