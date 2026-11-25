'use client'

/**
 * The phone's sheets: more periods (and "Escolher datas"), this device's
 * settings (notifications, sound, archived stores, sign out) and the alerts.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Chip, EmptyState, ErrorState, Icon, Skeleton } from '@/components/ui'
import { formatDate, formatRangeLabel, formatTimeInTz } from '@/lib/format'
import { checkPickedDates, MENU, pickerDates, normaliseDates, presetInfo, presetRange, preset, samePeriod, todayIn, type PeriodValue, type Preset } from '@/lib/period'
import type { AlertConfig, AlertsGetResponse, AlertsTestResponse } from '@/lib/alerts'
import type { MobileStoreOption } from '@/lib/views/mobile'

import { alertDeliveryText, alertRowTitle, pushBlockedText } from '../_lib/labels'
import type { usePush } from '../_lib/usePush'
import { Sheet, SoundIcon, Switch } from './Sheet'
import s from '../sheet.module.css'

// ─── Period ───────────────────────────────────────────────────────────────────

export function PeriodSheet({ period, tz, now, onPick, onClose }: {
  /** The period shown (a visit's or the saved one). */
  period: PeriodValue
  /** The clock the screen is resolved on (the store's own, or Brasília). */
  tz: string
  /** clientNow() in ms (lib/period/client/clock): previews and the max date. */
  now: number
  onPick: (p: PeriodValue) => void
  onClose: () => void
}) {
  const today = todayIn(tz, new Date(now || Date.parse('2000-01-01T12:00:00Z')))
  const [de, setDe] = useState(period.kind === 'dates' ? period.from : '')
  const [ate, setAte] = useState(period.kind === 'dates' ? period.to : '')
  // The same start and check as the desktop's date form (lib/period
  // pickerDates / checkPickedDates, R9): an asked end beyond today stays valid.
  const max = pickerDates(period, { from: today, to: today }, today).max
  const checked = de && ate ? checkPickedDates(de, ate, max) : null
  const preview = (p: Preset) => (now ? formatRangeLabel(presetRange(p, today), today) : '')

  return (
    <Sheet title="Período" lede="Dias completos no fuso da loja; com várias lojas, o mesmo dia de calendário em cada uma." onClose={onClose}>
      <div className={s.options}>
        {[...MENU.main, ...MENU.more].map(p => (
          <button key={p} type="button" className={s.option} aria-pressed={samePeriod(period, preset(p))}
            onClick={() => { onPick(preset(p)); onClose() }}>
            <span>{presetInfo(p).label}</span><small>{preview(p)}</small>
          </button>
        ))}
      </div>
      <div className={s.group}>
        <div className={s.groupTitle}>Escolher datas</div>
        <div className={s.dates}>
          <label>De
            <input type="date" className={`${s.input} ${s.dateInput}`} value={de} min="2000-01-01" max={max} onChange={e => setDe(e.target.value)} />
          </label>
          <label>Até
            <input type="date" className={`${s.input} ${s.dateInput}`} value={ate} min="2000-01-01" max={max} onChange={e => setAte(e.target.value)} />
          </label>
        </div>
        {checked && !checked.ok ? (
          <p className={`${s.msg} ${s.msgErr}`} style={{ padding: 0, marginTop: 8 }} role="alert">{checked.error}</p>
        ) : (
          <p className={s.lede} style={{ marginTop: 8 }}>
            {checked?.ok
              ? `Mostrar ${formatRangeLabel({ from: checked.value.from, to: checked.value.to }, today)}.`
              : 'Escolha as duas datas: até lá, o período atual continua na tela.'}
          </p>
        )}
        <Button variant="primary" disabled={!checked?.ok}
          onClick={() => {
            if (!checked?.ok) return
            onPick(normaliseDates(checked.value.from, checked.value.to).value ?? checked.value)
            onClose()
          }}>
          Aplicar datas
        </Button>
      </div>
    </Sheet>
  )
}

// ─── Device settings ──────────────────────────────────────────────────────────

const PUSH_TEXT: Record<ReturnType<typeof usePush>['status'], string> = {
  verificando: 'Verificando este aparelho…',
  sem_suporte: 'Este navegador não recebe notificações.',
  instalar: 'No iPhone, as notificações só chegam no app instalado: toque em Compartilhar → Adicionar à Tela de Início e abra o Opero por lá.',
  sem_chave: 'O servidor está sem a chave de notificações (VAPID): nada pode ser enviado a nenhum aparelho.',
  bloqueado: 'Bloqueadas nos ajustes. Para reativar: Ajustes do aparelho → Notificações → Opero (ou as permissões do site no navegador), depois volte aqui.',
  nao_inscrito: 'Este aparelho não está inscrito: vendas, alertas e o resumo do dia não chegam aqui.',
  inscrito: 'Este aparelho recebe as vendas, os alertas e o resumo do dia.',
}

function PushStatusChip({ status }: { status: ReturnType<typeof usePush>['status'] }) {
  if (status === 'inscrito') return <Chip tone="pos" icon="check">Inscrito</Chip>
  if (status === 'bloqueado') return <Chip tone="neg" icon="lock">Bloqueado</Chip>
  if (status === 'nao_inscrito') return <Chip tone="warn" icon="alert">Não inscrito</Chip>
  if (status === 'verificando') return <Chip tone="mut" icon="clock">Verificando</Chip>
  return <Chip tone="warn" icon="alert">Indisponível</Chip>
}

export function SettingsSheet({ push, soundOn, onSound, archived, onOpenStore, onAlerts, onClose }: {
  push: ReturnType<typeof usePush>
  soundOn: boolean
  onSound: (on: boolean) => void
  archived: MobileStoreOption[]
  onOpenStore: (id: string) => void
  onAlerts: () => void
  onClose: () => void
}) {
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  async function signOut() {
    setLeaving(true)
    setLeaveError(null)
    try {
      const res = await fetch('/api/mobile/unlock', { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`)
      window.location.reload()
    } catch (err) {
      setLeaving(false)
      setLeaveError((err as Error).message)
    }
  }

  return (
    <Sheet title="Ajustes deste aparelho" onClose={onClose}>
      <div className={s.group}>
        <div className={s.groupTitle}>Notificações</div>
        <div className={s.box}>
          <div className={s.status}><Icon name="bell" size={16} /> <span style={{ flex: 1 }}>Neste aparelho</span><PushStatusChip status={push.status} /></div>
          <p className={s.statusText}>
            {PUSH_TEXT[push.status]}
            {push.devices !== null && push.status !== 'verificando' && push.status !== 'sem_chave' && ` ${push.devices === 0 ? 'Nenhum aparelho inscrito no servidor: nada chega a lugar nenhum.' : `${push.devices} ${push.devices === 1 ? 'aparelho inscrito' : 'aparelhos inscritos'} no total.`}`}
          </p>
          {push.note && <p className={`${s.msg} ${s.msgOk}`} role="status">{push.note}</p>}
          {push.error && <p className={`${s.msg} ${s.msgErr}`} role="alert">{push.error}</p>}
          <div className={s.actions}>
            {push.status === 'nao_inscrito' && <Button variant="primary" icon="bell" pending={push.busy} onClick={() => void push.enable()}>Ativar neste aparelho</Button>}
            {push.status === 'inscrito' && <>
              <Button pending={push.busy} onClick={() => void push.test()}>Enviar teste</Button>
              <Button variant="ghost" disabled={push.busy} onClick={() => void push.disable()}>Desativar</Button>
            </>}
            {(push.status === 'bloqueado' || push.status === 'sem_chave') && <Button variant="ghost" icon="refresh" disabled={push.busy} onClick={() => void push.recheck()}>Verificar de novo</Button>}
          </div>
        </div>
      </div>

      <div className={s.group}>
        <div className={s.groupTitle}>Som</div>
        <div className={s.box}>
          <div className={s.field}>
            <span className={s.fieldLabel} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><SoundIcon on={soundOn} size={16} /> Som de venda</span>
            <Switch on={soundOn} onChange={onSound} label="Som de venda" />
            <span className={s.fieldHelp}>Toca quando entra uma venda nova da loja na tela, com o app aberto. Nunca ao trocar de loja.</span>
          </div>
        </div>
      </div>

      <div className={s.group}>
        <div className={s.groupTitle}>Alertas</div>
        <button type="button" className={s.option} style={{ width: '100%' }} onClick={onAlerts}>
          <span>Limites e resumo do dia</span><Icon name="chevRight" size={14} />
        </button>
      </div>

      {archived.length > 0 && (
        <div className={s.group}>
          <div className={s.groupTitle}>Lojas arquivadas</div>
          <p className={s.lede}>Fora de “Todas” e sem sincronização: só o histórico.</p>
          <div className={s.options}>
            {archived.map(a => (
              <button key={a.id} type="button" className={s.option} onClick={() => { onOpenStore(a.id); onClose() }}>
                <span>{a.name}</span><small>arquivada</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={s.group}>
        <Button variant="danger" icon="logout" pending={leaving} onClick={() => void signOut()}>Sair deste aparelho</Button>
        {leaveError && <p className={`${s.msg} ${s.msgErr}`} style={{ padding: '8px 0 0' }} role="alert">{leaveError}</p>}
      </div>
    </Sheet>
  )
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

type RuleKey = 'roasDrop' | 'spendNoSales' | 'marginDrop' | 'spendSpike' | 'scaleAlerts'
type NumKey = `${RuleKey}.threshold` | 'dailySummary.hour' | 'minSpend' | 'fromHour'

interface NumSpec {
  key: NumKey
  unit: string
  min: number
  max: number
  integer?: boolean
  /** Zero is refused (a ROAS target of 0 means "never"). */
  nonZero?: boolean
  get: (c: AlertConfig) => number
  patch: (v: number) => Record<string, unknown>
}

const RULE_RANGE: Record<RuleKey, [number, number]> = {
  roasDrop: [0, 100], spendNoSales: [0, 1_000_000], spendSpike: [0, 10_000], marginDrop: [-100, 100], scaleAlerts: [-100, 100],
}

const ruleNum = (rule: RuleKey, unit: string, extra: Partial<NumSpec> = {}): NumSpec => ({
  key: `${rule}.threshold`, unit, min: RULE_RANGE[rule][0], max: RULE_RANGE[rule][1],
  get: c => c[rule].threshold, patch: v => ({ [rule]: { threshold: v } }), ...extra,
})

const RULES: { rule: RuleKey; title: string; help: string; num: NumSpec }[] = [
  { rule: 'roasDrop', title: 'ROAS abaixo do empate', num: ruleNum('roasDrop', '×', { nonZero: true }),
    help: 'O ROAS do canal de anúncios da loja (Meta, Anúncios Shopify ou os dois), como nas telas, contra o próprio empate dos últimos 7 dias. O número ao lado vale só para lojas sem custos configurados.' },
  { rule: 'spendNoSales', title: 'Gasto sem nenhuma venda', num: ruleNum('spendNoSales', '$'),
    help: 'Avisa quando a loja gastou pelo menos este valor em anúncios hoje e não vendeu nada.' },
  { rule: 'marginDrop', title: 'Margem do dia abaixo de', num: ruleNum('marginDrop', '%'),
    help: 'Só lojas com custos configurados: sem custos a margem não diz nada.' },
  { rule: 'spendSpike', title: 'Gasto acima da média', num: ruleNum('spendSpike', '%'),
    help: 'Gasto em anúncios do dia (Meta e Anúncios Shopify) acima desta porcentagem da média dos últimos 7 dias.' },
  { rule: 'scaleAlerts', title: 'Campanhas para escalar ou cortar', num: ruleNum('scaleAlerts', '%'),
    help: 'Margem mínima para uma campanha merecer mais verba (a mesma régua da aba Campanhas).' },
]

const SUMMARY_HOUR: NumSpec = {
  key: 'dailySummary.hour', unit: 'h', min: 0, max: 23, integer: true,
  get: c => c.dailySummary.hour, patch: v => ({ dailySummary: { hour: v } }),
}
const MIN_SPEND: NumSpec = { key: 'minSpend', unit: '$', min: 0, max: 1_000_000, get: c => c.minSpend, patch: v => ({ minSpend: v }) }
const FROM_HOUR: NumSpec = { key: 'fromHour', unit: 'h', min: 0, max: 23, integer: true, get: c => c.fromHour, patch: v => ({ fromHour: v }) }

const showNum = (v: number) => String(v).replace('.', ',')

/** "1,5" → 1.5; null when it is not a number in range. */
function parseNum(raw: string, spec: NumSpec): number | string {
  const t = raw.trim().replace(',', '.')
  if (t === '') return 'Preencha um valor'
  const v = Number(t)
  if (!Number.isFinite(v)) return 'Use só números'
  if (spec.integer && !Number.isInteger(v)) return 'Use uma hora inteira'
  if (v < spec.min || v > spec.max) return `Entre ${showNum(spec.min)} e ${showNum(spec.max)}`
  if (spec.nonZero && v === 0) return 'Não pode ser 0'
  return v
}

export function AlertsSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<AlertsGetResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<NumKey, string>>>({})
  const [fieldMsg, setFieldMsg] = useState<Partial<Record<string, { ok: boolean; text: string }>>>({})
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const chain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/mobile/alerts', { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Sessão expirada neste aparelho' : `O servidor respondeu ${r.status}`)
        setData(await r.json() as AlertsGetResponse)
        setLoadError(null)
      })
      .catch(err => { if (!ctrl.signal.aborted) setLoadError((err as Error).message) })
    return () => ctrl.abort()
  }, [attempt])

  /** One POST per change, in order: a later edit never lands before an earlier one. */
  const save = useCallback((patch: Record<string, unknown>, field: string, onSaved?: () => void) => {
    setFieldMsg(m => ({ ...m, [field]: { ok: true, text: 'Salvando…' } }))
    chain.current = chain.current.then(async () => {
      try {
        const res = await fetch('/api/mobile/alerts', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: patch }),
        })
        const body = await res.json().catch(() => null) as { config?: AlertConfig; error?: string; problems?: string[] } | null
        if (!res.ok || !body?.config) {
          const text = body?.problems?.join('; ') || body?.error || `O servidor respondeu ${res.status}`
          setFieldMsg(m => ({ ...m, [field]: { ok: false, text: `Não salvou: ${text}` } }))
          return
        }
        const config = body.config
        setData(d => (d ? { ...d, config } : d))
        onSaved?.()
        setFieldMsg(m => ({ ...m, [field]: { ok: true, text: 'Salvo' } }))
      } catch {
        setFieldMsg(m => ({ ...m, [field]: { ok: false, text: 'Não salvou: sem conexão' } }))
      }
    })
  }, [])

  function commit(spec: NumSpec) {
    if (!data) return
    const raw = drafts[spec.key]
    if (raw === undefined) return
    const v = parseNum(raw, spec)
    if (typeof v === 'string') { setFieldMsg(m => ({ ...m, [spec.key]: { ok: false, text: v } })); return }
    if (v === spec.get(data.config)) {
      setDrafts(d => { const n = { ...d }; delete n[spec.key]; return n })
      setFieldMsg(m => { const n = { ...m }; delete n[spec.key]; return n })
      return
    }
    save(spec.patch(v), spec.key, () => setDrafts(d => { const n = { ...d }; delete n[spec.key]; return n }))
  }

  async function test() {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await fetch('/api/mobile/alerts', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`)
      const r = await res.json() as AlertsTestResponse
      if (r.pushKeys === false) setTestMsg({ ok: false, text: 'Sem chave de push neste servidor (VAPID): o teste não pode ser enviado a nenhum aparelho.' })
      else if (r.devices === 0) setTestMsg({ ok: false, text: 'Nenhum aparelho inscrito: o teste não chegou a lugar nenhum. Ative as notificações primeiro.' })
      else {
        const fired = r.alerts.length
        setTestMsg({
          ok: true,
          text: `${fired === 0 ? 'Nenhuma loja fora dos limites agora' : `${fired} ${fired === 1 ? 'alerta' : 'alertas'}`}; resumo ${r.summary.sent ? `enviado para ${r.summary.delivered} ${r.summary.delivered === 1 ? 'aparelho' : 'aparelhos'}` : 'não enviado'}.`,
        })
      }
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  // The switch's name is what it turns on; aria-checked says whether it is on.
  // A name ending in "ligado" was read "…: ligado, interruptor, desmarcado".
  const numField = (spec: NumSpec, label: string, help?: string, toggle?: { on: boolean; onChange: (v: boolean) => void; key: string; name: string }) => {
    const value = drafts[spec.key] ?? (data ? showNum(spec.get(data.config)) : '')
    const msg = fieldMsg[spec.key] ?? (toggle ? fieldMsg[toggle.key] : undefined)
    return (
      <div className={s.field} key={spec.key}>
        <span className={s.fieldLabel}>{label}</span>
        <span className={s.controls}>
          {spec.unit === '$' && <span className={s.unit}>$</span>}
          <input
            className={s.input} inputMode="decimal" aria-label={label} value={value}
            aria-invalid={msg && !msg.ok ? true : undefined}
            onChange={e => setDrafts(d => ({ ...d, [spec.key]: e.target.value }))}
            onBlur={() => commit(spec)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
          {spec.unit !== '$' && <span className={s.unit}>{spec.unit}</span>}
          {toggle && <Switch on={toggle.on} onChange={toggle.onChange} label={toggle.name} />}
        </span>
        {help && <span className={s.fieldHelp}>{help}</span>}
        {msg && <span className={msg.ok ? `${s.fieldHelp} ${s.fieldOk}` : s.fieldErr} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}
      </div>
    )
  }

  return (
    <Sheet title="Alertas" lede="Salvos no servidor: valem para todas as lojas ativas, mesmo com o app fechado." onClose={onClose}>
      {loadError ? (
        <ErrorState title="Não foi possível abrir os alertas" action={<Button onClick={() => setAttempt(a => a + 1)} icon="refresh">Tentar de novo</Button>}>{loadError}</ErrorState>
      ) : !data ? (
        <div className={s.box} style={{ padding: 14, display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={18} />)}
        </div>
      ) : (
        <>
          {pushBlockedText(data) && (
            <p className={`${s.msg} ${s.msgErr}`} style={{ padding: '0 0 8px' }}>{pushBlockedText(data)}</p>
          )}
          <div className={s.box}>
            {RULES.map(r => numField(r.num, r.title, r.help, {
              key: r.rule, name: `Alerta: ${r.title}`,
              on: data.config[r.rule].enabled,
              onChange: on => save({ [r.rule]: { enabled: on } }, r.rule),
            }))}
          </div>
          <div className={s.group}>
            <div className={s.groupTitle}>Quando</div>
            <div className={s.box}>
              {numField(SUMMARY_HOUR, 'Resumo do dia às', 'Horário de Brasília. Um push com o resultado de todas as lojas.', {
                key: 'dailySummary', name: 'Enviar o resumo do dia', on: data.config.dailySummary.enabled,
                onChange: on => save({ dailySummary: { enabled: on } }, 'dailySummary'),
              })}
              {numField(FROM_HOUR, 'Não alertar antes das', 'No relógio de cada loja: de manhã o gasto já entrou e as vendas ainda não.')}
              {numField(MIN_SPEND, 'Gasto mínimo para avaliar', 'Loja que gastou menos que isso hoje em anúncios (Meta + Shopify) não dispara alerta de ROAS ou margem.')}
            </div>
          </div>
          <div className={s.group}>
            <Button icon="bell" pending={testing} onClick={() => void test()}>Testar agora</Button>
            <p className={s.lede} style={{ marginTop: 6 }}>Avalia as lojas e envia o que estiver fora dos limites, mais o resumo, ignorando o envio único do dia.</p>
            {testMsg && <p className={`${s.msg} ${testMsg.ok ? s.msgOk : s.msgErr}`} style={{ padding: 0 }} role="status">{testMsg.text}</p>}
          </div>
          <div className={s.group}>
            {/* A row is an alert the server fired (its once-a-day claim), not a
                delivery receipt: each says what it reached, from the count
                stored when it was sent (lib/alerts deliveryOf). */}
            <div className={s.groupTitle}>Disparados nas últimas 24 h</div>
            {data.recent.length === 0 ? (
              <EmptyState compact title="Nenhum alerta disparado" />
            ) : (
              <ul className={`${s.box} ${s.recent}`}>
                {data.recent.map((r, i) => (
                  <li key={`${r.kind}-${r.storeId}-${r.sentAt}-${i}`}>
                    {alertRowTitle(r.kind, r.title)}
                    <small>{[r.store ?? (r.storeId ? null : 'Todas as lojas'), `${formatDate(r.day)} · ${formatTimeInTz(r.sentAt, 'America/Sao_Paulo')}`].filter(Boolean).join(' · ')}</small>
                    {/* An answer from a server older than the delivery field has none. */}
                    <small className={r.delivery?.state === 'delivered' ? s.deliveredOk : s.deliveredNo}>
                      {alertDeliveryText(r.delivery ?? { state: 'unknown' })}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
