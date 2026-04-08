'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useSettings, type Theme, type Language, type Currency, type DateFormat, type AttributionWindow } from '@/contexts/SettingsContext'
import { getTranslations } from '@/lib/translations'
import Sidebar from '@/components/Sidebar'

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

const TIMEZONES = [
  'America/Sao_Paulo', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'Europe/London',
  'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'UTC',
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

export default function SettingsPage() {
  const s = useSettings()
  const tr = getTranslations(s.language)
  const [resetConfirm, setResetConfirm] = useState(false)

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

        {/* ── Store Information ── */}
        <Section title={tr.settings_store} delay={0.04}>
          <Row label={tr.settings_store_name}>
            <TextInput value={s.storeName} onChange={s.setStoreName} placeholder={tr.settings_store_name_ph} />
          </Row>
          <Row label={tr.settings_store_url}>
            <TextInput value={s.storeUrl} onChange={s.setStoreUrl} placeholder={tr.settings_store_url_ph} />
          </Row>
          <Row label={tr.settings_timezone} desc={tr.settings_timezone_desc} last>
            <select value={s.timezone} onChange={e => s.setTimezone(e.target.value)}
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
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
          <Row label={tr.settings_attr_window} desc={tr.settings_attr_window_desc} last>
            <ChipGroup options={attrOptions} value={s.attributionWindow} onChange={s.setAttributionWindow} />
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
        <Section title={tr.settings_integrations} delay={0.22}>
          <Row label={tr.settings_int_shopify} desc="REST Admin API">
            <StatusBadge connected={true} />
          </Row>
          <Row label={tr.settings_int_facebook} desc="Marketing API v21" last>
            <StatusBadge connected={true} />
          </Row>
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
