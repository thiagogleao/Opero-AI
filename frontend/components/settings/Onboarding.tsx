'use client'

/**
 * Connect a new store: Shopify, then (optionally) the Meta ad account, then the
 * first import — rebuilt on the current APIs.
 *
 *  - Shopify: the three real ways in, each with its own form (A11): a Dev
 *    Dashboard app (Client ID + Secret, POST /api/shopify/connect — the
 *    secret never goes in a URL), a store's own app token (shpat_), or the
 *    Opero app through the signed OAuth.
 *  - Facebook: the signed OAuth for this store, or an account id + token.
 *  - Import: POST /api/refresh with the opening date the person typed (A10),
 *    then the real progress from /api/sync-status. "Concluído" only when the
 *    collector recorded a success after the import started; errors are shown
 *    as they are.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, ButtonLink, Callout, Chip } from '@/components/ui'
import { AnchorButton } from './AnchorButton'
import { FACEBOOK_ERROR, FB_RETURN_KEY, SHOPIFY_ERROR, callApi, nothingChanged } from './messages'
import { explainShopifyKey } from './ShopifyKeyForm'
import s from './settings.module.css'

export interface OnboardingStore { id: string; name: string; domain: string | null; timezone: string }

type Step = 'shopify' | 'facebook' | 'import'
type Method = 'dev' | 'token' | 'oauth'

const STATE_KEY = 'opero:onboarding'
interface Saved { storeId: string; startDate: string }

function readSaved(): Saved | null {
  try { return JSON.parse(window.sessionStorage.getItem(STATE_KEY) ?? 'null') as Saved | null } catch { return null }
}
function writeSaved(v: Saved) {
  try { window.sessionStorage.setItem(STATE_KEY, JSON.stringify(v)) } catch { /* storage disabled */ }
}

const MAX_DAYS_BACK = 399
const noopSubscribe = () => () => {}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function OnboardingWizard({ initialStore, initialStep, startDate: initialStartDate, shopifyError, fbError, fbConnected, isOwner }: {
  initialStore: OnboardingStore | null
  initialStep: Step
  startDate: string | null
  shopifyError: string | null
  fbError: string | null
  fbConnected: boolean
  isOwner: boolean
}) {
  const [step, setStep] = useState<Step>(initialStep)
  const [store, setStore] = useState<OnboardingStore | null>(initialStore)
  // The store was already in the account: the connect only refreshed its key.
  const [wasThere, setWasThere] = useState(false)
  // After an OAuth round trip the opening date comes back from this tab
  // (read as an external store: no hydration mismatch).
  const savedDate = useSyncExternalStore(noopSubscribe, () => {
    const saved = readSaved()
    return saved && store && saved.storeId === store.id ? saved.startDate || null : null
  }, () => null)
  const [dateEdit, setStartDate] = useState<string | null>(null)
  const startDate = dateEdit ?? initialStartDate ?? savedDate ?? ''

  const remember = useCallback((st: OnboardingStore, date: string) => writeSaved({ storeId: st.id, startDate: date }), [])

  return (
    <div className={s.wizardBody}>
      <ol className={s.steps} aria-label="Passos">
        {(['shopify', 'facebook', 'import'] as Step[]).map((k, i) => {
          const idx = ['shopify', 'facebook', 'import'].indexOf(step)
          const cls = i === idx ? s.stepOn : i < idx ? s.stepDone : ''
          return <li key={k} className={`${s.step} ${cls}`} aria-current={i === idx ? 'step' : undefined}>{i + 1}. {k === 'shopify' ? 'Loja Shopify' : k === 'facebook' ? 'Anúncios (opcional)' : 'Importar dados'}</li>
        })}
      </ol>

      {step === 'shopify' && (
        <ShopifyStep
          error={shopifyError}
          startDate={startDate}
          onStartDate={setStartDate}
          isOwner={isOwner}
          onConnected={(st, created) => { setStore(st); setWasThere(!created); remember(st, startDate); setStep('facebook') }}
        />
      )}
      {step === 'facebook' && store && (
        <FacebookStep
          store={store}
          wasThere={wasThere}
          error={fbError}
          onBeforeOAuth={() => { remember(store, startDate); try { window.sessionStorage.setItem(FB_RETURN_KEY, '/onboarding') } catch { /* ignore */ } }}
          onDone={() => setStep('import')}
        />
      )}
      {step === 'import' && store && <ImportStep store={store} startDate={startDate} fbConnected={fbConnected} />}
      {step !== 'shopify' && !store && (
        <Callout tone="neg" title="Loja não encontrada">Volte ao primeiro passo e conecte a loja de novo.</Callout>
      )}
    </div>
  )
}

// ─── 1. Shopify ───────────────────────────────────────────────────────────────

function ShopifyStep({ error, startDate, onStartDate, isOwner, onConnected }: {
  error: string | null; startDate: string; onStartDate: (v: string) => void; isOwner: boolean
  onConnected: (st: OnboardingStore, created: boolean) => void
}) {
  const [method, setMethod] = useState<Method>('dev')
  const [shop, setShop] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [fail, setFail] = useState<string | null>(error ? SHOPIFY_ERROR[error] ?? `Erro: ${error}` : null)

  const domain = shop.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const minDate = isoDaysAgo(MAX_DAYS_BACK)
  const hint = method === 'token' ? explainShopifyKey(token, 'token') : method === 'dev' ? explainShopifyKey(secret, 'secret') : null
  const ready = !!domain && (method === 'oauth' || (method === 'dev' ? !!clientId.trim() && !!secret.trim() : !!token.trim() && !hint))

  async function connect() {
    setPending(true)
    setFail(null)
    const body = method === 'dev'
      ? { shop: domain, mode: 'add', clientId: clientId.trim(), clientSecret: secret.trim() }
      : { shop: domain, mode: 'add', accessToken: token.trim() }
    const r = await callApi<{ created: boolean; store: { id: string; name: string; domain: string | null; timezone: string } }>(
      '/api/shopify/connect', { method: 'POST', body: JSON.stringify(body) }, SHOPIFY_ERROR)
    setPending(false)
    if (!r.ok || !r.data) { setFail(nothingChanged(r.error)); return }
    const st = r.data.store
    onConnected({ id: st.id, name: st.name, domain: st.domain, timezone: st.timezone }, r.data.created)
  }

  const oauthHref = `/api/shopify/auth?shop=${encodeURIComponent(domain)}&mode=add&return=/onboarding${startDate ? `&storeStartDate=${startDate}` : ''}`

  return (
    <div className={s.form}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Conectar a loja Shopify</div>
        <p className={s.sub}>O Opero só lê: pedidos, produtos e disputas. Nada é alterado na loja.</p>
      </div>
      {isOwner && (
        <Callout tone="neu">No modo dono, adicionar uma loja exige estar logado também com a conta de sócio que vai ser dona dela.</Callout>
      )}
      {fail && <Callout tone="neg" title="A loja não foi conectada">{fail}</Callout>}

      <div className={s.fields}>
        <label className={s.field}>
          <span className={s.label}>Endereço da loja</span>
          <input className={`${s.input} ${s.inputMono}`} value={shop} onChange={e => setShop(e.target.value)} placeholder="minhaloja.myshopify.com" autoComplete="off" spellCheck={false} />
          <span className={s.hint}>O endereço <b>.myshopify.com</b>, não o domínio próprio.</span>
        </label>
        <label className={s.field}>
          <span className={s.label}>Desde quando importar <span className="mut">(opcional)</span></span>
          <input className={`${s.input} ${s.date}`} type="date" value={startDate} min={minDate} max={isoDaysAgo(0)} onChange={e => onStartDate(e.target.value)} />
          <span className={s.hint}>Ex.: quando a loja abriu. Vazio: os últimos 90 dias. No máximo cerca de 13 meses para trás.</span>
        </label>
      </div>

      <div className={s.choice} role="radiogroup" aria-label="Como conectar">
        {([
          ['dev', 'App do Dev Dashboard', 'Client ID + Client Secret. O jeito atual de criar apps; o Opero renova o token a cada 24 h.'],
          ['token', 'Token de app próprio', 'Admin API access token (shpat_) de um app criado no admin da loja.'],
          ['oauth', 'App Opero', 'Autorizar o app do Opero na Shopify (lojas da mesma organização de parceiro).'],
        ] as [Method, string, string][]).map(([k, t, d]) => (
          <button key={k} type="button" role="radio" aria-checked={method === k} className={s.choiceBtn} onClick={() => { setMethod(k); setFail(null) }}>
            <b>{t}</b>{d}
          </button>
        ))}
      </div>

      {method === 'dev' && (
        <div className={s.fields}>
          <label className={s.field}>
            <span className={s.label}>Client ID</span>
            <input className={`${s.input} ${s.inputMono}`} value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className={s.field}>
            <span className={s.label}>Client Secret</span>
            <input className={`${s.input} ${s.inputMono}`} type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="shpss_…" autoComplete="off" spellCheck={false} />
          </label>
          <ol className={s.ol} style={{ gridColumn: '1 / -1' }}>
            <li>No <b>Dev Dashboard</b> da Shopify (dev.shopify.com), crie o app (ou abra o existente) e instale na loja com leitura de pedidos, produtos e disputas.</li>
            <li>Na página de credenciais do app, copie o <b>Client ID</b> e o <b>Client secret</b>.</li>
          </ol>
        </div>
      )}
      {method === 'token' && (
        <div className={s.fields}>
          <label className={s.field}>
            <span className={s.label}>Admin API access token</span>
            <input className={`${s.input} ${s.inputMono}`} type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="shpat_…" autoComplete="off" spellCheck={false} />
            <span className={s.hint}>Admin da loja → Configurações → Apps e canais de venda → Desenvolver apps → Credenciais da API.</span>
          </label>
        </div>
      )}
      {method === 'oauth' && (
        <p className={s.sub}>Você vai para a Shopify autorizar e volta para cá. Se a Shopify disser que o link de instalação não pode ser usado, a loja é de outra organização: use uma das outras opções.</p>
      )}
      {hint && <div className={s.warnText}>{hint}</div>}

      <div className={s.inline}>
        {method === 'oauth'
          ? (ready ? <AnchorButton href={oauthHref} variant="primary" size="md" icon="external">Autorizar na Shopify</AnchorButton> : <Button variant="primary" disabled>Autorizar na Shopify</Button>)
          : <Button variant="primary" pending={pending} disabled={!ready} onClick={connect}>Testar e conectar</Button>}
      </div>
    </div>
  )
}

// ─── 2. Facebook ──────────────────────────────────────────────────────────────

function FacebookStep({ store, wasThere, error, onBeforeOAuth, onDone }: {
  store: OnboardingStore; wasThere: boolean; error: string | null; onBeforeOAuth: () => void; onDone: () => void
}) {
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [fail, setFail] = useState<string | null>(error ? FACEBOOK_ERROR[error] ?? `Erro: ${error}` : null)

  async function link() {
    setPending(true)
    setFail(null)
    const id = account.trim().replace(/^act_/i, '')
    const r = await callApi('/api/facebook/accounts', {
      method: 'POST',
      body: JSON.stringify({ storeId: store.id, fb_ad_account_id: `act_${id}`, role: 'main', token: token.trim() }),
    }, FACEBOOK_ERROR)
    setPending(false)
    if (!r.ok) { setFail(nothingChanged(r.error)); return }
    onDone()
  }

  return (
    <div className={s.form}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Conta de anúncios do Meta <span className="mut" style={{ fontWeight: 400 }}>· opcional</span></div>
        <p className={s.sub}><Chip tone="pos" icon="check" size="sm">{store.name} conectada</Chip> Agora a conta de anúncios, para o lucro descontar o gasto com Meta.</p>
      </div>
      {wasThere && <Callout tone="info">{store.name} já estava na sua conta: só a conexão com a Shopify foi atualizada, nada mais mudou.</Callout>}
      {fail && <Callout tone="neg" title="A conta não foi ligada">{fail}</Callout>}
      <div className={s.inline}>
        <span onClickCapture={onBeforeOAuth}>
          <AnchorButton href={`/api/facebook/auth?store=${encodeURIComponent(store.id)}&mode=main&return=/onboarding`} variant="primary" size="md" icon="external">Conectar com o Facebook</AnchorButton>
        </span>
        <Button variant="ghost" onClick={onDone}>Pular por enquanto</Button>
      </div>
      <p className={s.sub}>Ou cole o ID da conta e um token de usuário do sistema (Business Manager), que não expira:</p>
      <div className={s.fields}>
        <label className={s.field}>
          <span className={s.label}>ID da conta de anúncio</span>
          <input className={`${s.input} ${s.inputMono}`} value={account} onChange={e => setAccount(e.target.value)} placeholder="act_123456789" />
        </label>
        <label className={s.field}>
          <span className={s.label}>Token de acesso</span>
          <input className={`${s.input} ${s.inputMono}`} type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="EAA…" autoComplete="off" />
          <span className={s.hint}>Permissão necessária: só <b>ads_read</b>.</span>
        </label>
      </div>
      <div className={s.inline}>
        <Button pending={pending} disabled={!account.trim() || !token.trim()} onClick={link}>Ligar conta</Button>
      </div>
    </div>
  )
}

// ─── 3. Import ────────────────────────────────────────────────────────────────

interface Lane { lastSuccessAt: string | null; lastAttemptAt: string | null; lastStatus: string | null; lastMessage: string | null; busy: boolean }
interface Freshness { storeId: string; lastOrderAt: string | null; shopify: Lane | null; facebook: Lane | null }
interface Job { source: string; state: string; from: string | null; note?: string }

type LaneState = { label: string; tone: 'run' | 'ok' | 'neg' | 'mut'; text: string }

function laneState(lane: Lane | null, startedAt: string, job: Job | undefined, what: string): LaneState {
  if (!job) return { label: what, tone: 'mut', text: 'não pedida' }
  if (job.state === 'skipped') return { label: what, tone: 'mut', text: job.note ?? 'nada a importar' }
  if (!lane) return { label: what, tone: 'run', text: 'aguardando o coletor…' }
  if (lane.lastSuccessAt && lane.lastSuccessAt >= startedAt) return { label: what, tone: 'ok', text: 'concluída' }
  if (lane.lastStatus === 'error' && lane.lastAttemptAt && lane.lastAttemptAt >= startedAt) return { label: what, tone: 'neg', text: `erro: ${lane.lastMessage ?? 'o coletor falhou'}` }
  return { label: what, tone: 'run', text: lane.busy || lane.lastStatus === 'running' ? 'importando…' : 'na fila…' }
}

function ImportStep({ store, startDate, fbConnected }: { store: OnboardingStore; startDate: string; fbConnected: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'refused'>('idle')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Freshness | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)

  const from = startDate && startDate < isoDaysAgo(MAX_DAYS_BACK) ? isoDaysAgo(MAX_DAYS_BACK) : startDate

  async function start() {
    setPhase('starting')
    const at = new Date().toISOString()
    const r = await callApi<{ started: boolean; jobs: Job[] }>('/api/refresh', {
      method: 'POST', body: JSON.stringify({ storeId: store.id, ...(from ? { dateFrom: from } : {}) }),
    })
    if (!r.ok || !r.data) { setRefusal(r.error); setPhase('refused'); return }
    setJobs(r.data.jobs)
    setStartedAt(at)
    setPhase('running')
  }

  const shopJob = jobs.find(j => j.source === 'shopify')
  const fbJob = jobs.find(j => j.source === 'facebook')
  const lanes = startedAt ? [laneState(fresh?.shopify ?? null, startedAt, shopJob, 'Shopify — pedidos e produtos'), laneState(fresh?.facebook ?? null, startedAt, fbJob, 'Meta — gasto com anúncios')] : []
  const finished = lanes.length > 0 && lanes.every(l => l.tone !== 'run')

  // Real progress: what the collector recorded, read every 5 s until both
  // lanes finished (or 15 minutes went by).
  useEffect(() => {
    if (phase !== 'running' || finished) return
    let stop = false
    const began = Date.now()
    const tick = async () => {
      const r = await callApi<{ stores: Freshness[] }>(`/api/sync-status?storeId=${encodeURIComponent(store.id)}`)
      if (stop) return
      if (!r.ok) { setPollError(r.error); return }
      setPollError(null)
      setFresh(r.data?.stores.find(x => x.storeId === store.id) ?? null)
    }
    const id = setInterval(() => { if (Date.now() - began > 15 * 60_000) { clearInterval(id); return } tick() }, 5000)
    const first = setTimeout(tick, 800)
    return () => { stop = true; clearInterval(id); clearTimeout(first) }
  }, [phase, finished, store.id])

  return (
    <div className={s.form}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Importar os dados de {store.name}</div>
        <p className={s.sub}>
          {from ? <>Pedidos e anúncios desde <b>{from.slice(8, 10)}/{from.slice(5, 7)}/{from.slice(0, 4)}</b>{from !== startDate ? ' (o máximo que dá para buscar)' : ''}.</> : <>Os últimos 90 dias de pedidos e anúncios.</>}
          {fbConnected && ' O Facebook foi conectado.'}
        </p>
      </div>

      {phase === 'idle' && <div className={s.inline}><Button variant="primary" onClick={start}>Começar a importação</Button></div>}
      {phase === 'starting' && <p className={s.sub}><span className={s.spin} />Pedindo a importação…</p>}
      {phase === 'refused' && (
        <Callout tone="warn" title="A importação não começou">
          {refusal} A loja está conectada; a sincronização agendada do servidor vai buscar os dados dela.
          <div className={s.inline} style={{ marginTop: 8 }}><Button size="sm" onClick={start}>Tentar de novo</Button></div>
        </Callout>
      )}
      {phase === 'running' && (
        <div className={s.progress} aria-live="polite">
          {lanes.map(l => (
            <div key={l.label} className={s.progRow}>
              <span>{l.label}</span>
              <span className={l.tone === 'ok' ? 'pos' : l.tone === 'neg' ? 'neg' : undefined}>
                {l.tone === 'run' && <span className={s.spin} />}{l.text}
              </span>
            </div>
          ))}
          {pollError && <p className={s.sub}>Não deu para ler o andamento agora ({pollError}); tentando de novo.</p>}
          {!finished && <p className={s.sub}>Pode levar alguns minutos. Você pode sair desta tela: a importação continua no servidor.</p>}
        </div>
      )}

      <div className={s.inline} style={{ marginTop: 4 }}>
        <ButtonLink href={`/profit?loja=${encodeURIComponent(store.id)}`} variant={finished ? 'primary' : 'secondary'} icon="coin">Configurar os custos</ButtonLink>
        <ButtonLink href={`/?loja=${encodeURIComponent(store.id)}`} variant="ghost">Ir para o Resumo</ButtonLink>
      </div>
      <p className={s.sub}>Sem os custos configurados, a loja aparece como <b>vendas − anúncios</b>, que não é lucro.</p>
    </div>
  )
}
