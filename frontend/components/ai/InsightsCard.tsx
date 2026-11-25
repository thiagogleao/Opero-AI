'use client'

/**
 * InsightsCard — the AI's reading of one store over the window on screen
 * (/api/ai): what changed and what to do, each conclusion with its sample.
 *
 *   <InsightsCard storeId={ctx.store.id} from={ctx.range.from} to={ctx.range.to} split={ctx.split} />
 *
 * Props: { storeId: string   — one store (the AI reads one store's books)
 *          from: string      — window start, YYYY-MM-DD (store's timezone)
 *          to: string        — window end, YYYY-MM-DD
 *          split: boolean    — partner view: the money stays whole-store and a
 *                              "Sua parte (50%)" line comes from the API
 *          notStarted?: { storeName, firstSale } | null
 *                            — the window ends before the store's first sale
 *                              (the verdict's beforeStart): the card says so and
 *                              neither offers a generation nor asks the server
 *          nothingToRead?: NothingToRead | null
 *                            — the store existed but the window has nothing to
 *                              read (archived after its archive day, or this
 *                              window and the one before it empty): the same,
 *                              in its own words }
 *
 * Generated only on click; on load it only shows a reading already cached for
 * this exact store + window + split, with its age. The server reads closed
 * days only, so a window that includes today is cut at yesterday (said on
 * screen) and "Hoje" alone cannot be read.
 */

import { useEffect, useState } from 'react'
import type { InsightsHeadline, InsightsResult } from '@/lib/ai/insights/run'
import type { InsightCard } from '@/lib/ai/insights/result'
import { Block, Button, Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card'
import { Badge, Chip } from '@/components/ui/Chip'
import { Count, Money, Pct } from '@/components/ui/Display'
import { Icon } from '@/components/ui/Icon'
import { RoasGauge } from '@/components/ui/RoasGauge'
import { formatRelativeTime, plural } from '@/lib/format'
import {
  adChannelOf, channelRoas, CONFIDENCE, KIND, notStartedText, nothingToReadText, PHASE_TEXT, ROAS_LABEL, TARGET, windowNote,
  type NothingToRead, type NotStarted,
} from './insightsModel'
import { useInsights, type InsightsState } from './useInsights'
import s from './Insights.module.css'

export interface InsightsCardProps {
  storeId: string
  from: string
  to: string
  split: boolean
  /** Set by the page when the window ends before the store's first sale and
   *  has nothing in it (components/campaigns/storeStart isBeforeStart). */
  notStarted?: NotStarted | null
  /** Set by the page when the store existed but nothing in the window (nor,
   *  for a quiet window, in the one before it) can be read: the server would
   *  refuse the generation with no_data. */
  nothingToRead?: NothingToRead | null
}

const HOW_TO = 'O que mudou e o que fazer, escrito pela IA a partir dos números do Opero — os mesmos desta página. Só é gerada quando você pede.'

const INFO = (
  <>
    A IA recebe uma planilha de fatos montada pelo motor de lucro (vendas, custos, anúncios, produtos, países e
    clientes do período, só dias completos) e escreve até 6 conclusões, cada uma com a amostra em que se apoia.
    Cada número que ela cita é conferido contra essa planilha; o que não bate aparece como “não conferido”.
    A leitura fica guardada por 6 horas para esta loja, este período e esta visão.
  </>
)

const UNVERIFIED_TIP = 'Este número não aparece na planilha de fatos que a IA recebeu. Confira na tela antes de agir.'

/** One short sentence per state change for screen readers (the card itself
 *  is too long to be a live region). The region is always in the DOM, empty
 *  while checking or idle, so a screen reader hears each later change. */
function liveMessage(state: InsightsState): string {
  switch (state.kind) {
    case 'generating': return PHASE_TEXT[state.phase] ?? 'Gerando a leitura…'
    case 'ready': return state.cached ? 'Leitura guardada carregada.' : 'Leitura pronta.'
    case 'failed':
    case 'unavailable':
    case 'check_failed': return `${state.error.title}. ${state.error.message}`
    default: return ''
  }
}

/** A clock that ticks only while something on screen depends on it. It reads
 *  the time again as soon as it starts: a reading that arrives minutes after
 *  the card mounted must not show its age as of the mount. */
function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now()) // clock-ok: relative "há N min" of an AI card, not a period
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now()) // clock-ok: relative time of an AI card, not a period
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, everyMs)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [everyMs, active])
  return now
}

export function InsightsCard({ notStarted, nothingToRead, ...req }: InsightsCardProps) {
  // Two components, not a flag inside one: the live card's hook asks the
  // server on mount, and a window with nothing in it has nothing to ask.
  if (notStarted) return <EmptyWindowCard t={notStartedText(notStarted)} />
  if (nothingToRead) return <EmptyWindowCard t={nothingToReadText(nothingToRead)} />
  return <LiveInsightsCard {...req} />
}

/** Every block on the page says the window is empty (the store did not sell
 *  yet, is archived, or had nothing in it); so does this one, with no "Gerar
 *  leitura" (a paid call the server refuses over an empty fact sheet). */
function EmptyWindowCard({ t }: { t: { title: string; text: string } }) {
  return (
    <Block title="Leitura da IA" howTo={HOW_TO} info={INFO} infoLabel="Como a leitura da IA é feita">
      <EmptyState compact icon="clock" title={t.title}>{t.text}</EmptyState>
    </Block>
  )
}

function LiveInsightsCard({ storeId, from, to, split }: Omit<InsightsCardProps, 'notStarted' | 'nothingToRead'>) {
  const { state, generate, regenerate, cancel, recheck } = useInsights({ storeId, from, to, split })
  const generating = state.kind === 'generating'
  const now = useNow(generating ? 1000 : 30_000, generating || state.kind === 'ready' || state.kind === 'failed')

  const shown: InsightsResult | null = state.kind === 'ready' ? state.result : state.kind === 'failed' ? state.previous : null
  const win = state.kind === 'idle' || state.kind === 'generating' || state.kind === 'failed'
    ? state.window
    : state.kind === 'ready' ? state.result.window : null

  const idleNote = state.kind === 'idle' ? windowNote(state.window) : null

  const actions = state.kind === 'ready'
    ? <Button size="sm" variant="ghost" icon="refresh" onClick={regenerate}>Gerar de novo</Button>
    : null

  const footer = shown
    ? (
        <>
          <span>Escrita por <b>{shown.model}</b> a partir da planilha de fatos do Opero.</span>
          <span>Número marcado “não conferido” não está nessa planilha: confira antes de agir.</span>
        </>
      )
    : undefined

  return (
    <Block
      title="Leitura da IA"
      eyebrow={win ? `${win.label} · ${plural(win.days, 'dia completo', 'dias completos')}` : undefined}
      howTo={HOW_TO}
      info={INFO}
      infoLabel="Como a leitura da IA é feita"
      actions={actions}
      footer={footer}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage(state)}</p>
      <div aria-busy={state.kind === 'checking' || generating}>
        {state.kind === 'checking' && (
          <div className={s.skel} aria-label="Procurando leitura guardada">
            <Skeleton width="68%" height={12} />
            <Skeleton width="92%" height={12} />
            <Skeleton width="48%" height={12} />
          </div>
        )}

        {state.kind === 'check_failed' && (
          <ErrorState compact title={state.error.title} action={<Button size="sm" icon="refresh" onClick={recheck}>Tentar de novo</Button>}>
            {state.error.message}
          </ErrorState>
        )}

        {state.kind === 'unavailable' && (
          <EmptyState compact icon={state.error.code === 'no_closed_days' || state.error.code === 'no_data' ? 'calendar' : 'lock'} title={state.error.title}>
            {state.error.message}
          </EmptyState>
        )}

        {state.kind === 'idle' && (
          <div className={s.idle}>
            <p className={s.lead}>
              A IA lê os números desta loja em <b>{state.window.label}</b> e aponta o que mudou e o que fazer,
              dizendo em quantos pedidos ou dólares cada conclusão se apoia.
            </p>
            {idleNote && <p className={s.note}><Icon name="clock" size={13} />{idleNote}</p>}
            <div className={s.cta}>
              <Button variant="primary" icon="sparkle" onClick={generate}>Gerar leitura de {state.window.label}</Button>
              <span className={s.small}>Leva até 1 minuto. Fica guardada por 6 horas.</span>
            </div>
          </div>
        )}

        {state.kind === 'generating' && (
          <div className={s.progress}>
            <span className={s.spin} aria-hidden="true" />
            <span className={s.phase}>
              {PHASE_TEXT[state.phase] ?? 'Gerando a leitura…'}
              <span className={`${s.elapsed} num`}> · {Math.max(0, Math.floor((now - state.startedAt) / 1000))} s</span>
            </span>
            <Button size="sm" variant="ghost" icon="x" onClick={cancel}>Cancelar</Button>
          </div>
        )}

        {state.kind === 'failed' && (
          <Callout tone="neg" title={state.error.title}>
            {state.error.message}
            {state.error.retry && (
              <div className={s.retry}>
                <Button size="sm" icon="refresh" onClick={state.previous ? regenerate : generate}>Tentar de novo</Button>
                {state.previous && <span className={s.small}>A leitura anterior continua abaixo.</span>}
              </div>
            )}
          </Callout>
        )}

        {shown && (
          <Result
            result={shown}
            cached={state.kind === 'ready' ? state.cached : true}
            now={now}
            dim={state.kind === 'failed'}
          />
        )}
      </div>
    </Block>
  )
}

function Result({ result, cached, now, dim }: { result: InsightsResult; cached: boolean; now: number; dim: boolean }) {
  const generated = Date.parse(result.generatedAt)
  const age = formatRelativeTime(result.generatedAt, new Date(Math.max(now, Number.isNaN(generated) ? now : generated)))
  const note = windowNote(result.window)
  const insights = result.insights ?? []
  const gaps = result.dataGaps ?? []
  return (
    <div className={dim ? `${s.result} ${s.dim}` : s.result}>
      <div className={s.meta}>
        <Chip tone="mut" icon="clock" size="sm" title={new Date(result.generatedAt).toLocaleString('pt-BR')}>gerada {age}</Chip>
        {cached && <span>guardada para esta loja e este período</span>}
        {note && <span>{note}</span>}
      </div>

      {result.headline && <Headline h={result.headline} split={result.split} />}

      <p className={s.summary}>{result.summary}</p>

      {insights.length === 0
        ? (
            <EmptyState compact icon="check" title="Nada pedindo ação">
              A IA não viu neste período nada que justifique mudar algo agora.
            </EmptyState>
          )
        : <ol className={s.cards}>{insights.map((c, i) => <Insight key={`${i}-${c.title}`} card={c} />)}</ol>}

      {gaps.length > 0 && (
        <div className={s.gaps}>
          <div className="lbl">O que estes dados não permitem dizer</div>
          <ul>{gaps.map((g, i) => <li key={`${i}-${g}`}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function Headline({ h, split }: { h: InsightsHeadline; split: boolean }) {
  // Same spend basis as the page's ROAS card, not the headline's revenue ÷ Meta.
  const channel = adChannelOf(h)
  return (
    <div className={s.headline}>
      <dl className={s.stats}>
        <div>
          <dt className="lbl">Vendas</dt>
          <dd><Money value={h.revenue} /> <span className={s.sub}><Count value={h.orders} /> {h.orders === 1 ? 'pedido' : 'pedidos'}</span></dd>
        </div>
        <div>
          <dt className="lbl">{h.configured ? 'Lucro real' : 'Vendas − anúncios'}{split && ' · loja inteira'}</dt>
          <dd><Money value={h.operatingProfit} /></dd>
        </div>
        {h.configured && (
          <div>
            <dt className="lbl">Margem</dt>
            <dd><Pct value={h.margin} /></dd>
          </div>
        )}
        <div className={s.roas}>
          <dt className="lbl">{channel ? ROAS_LABEL[channel] : 'ROAS'}</dt>
          <dd><RoasGauge roas={channelRoas(h)} breakEven={h.breakEvenRoas} configured={h.configured} revenue={h.revenue} size="mini" label="" /></dd>
        </div>
      </dl>
      {split && h.partnerProfit !== null && (
        <p className={s.share}>
          <Icon name="split" size={14} />
          <span>Sua parte (50%)</span>
          <Money value={h.partnerProfit} className={s.shareValue} />
          <span className={s.sub}>metade {h.configured ? 'do lucro real' : 'de vendas − anúncios'} da loja inteira, acima. Vendas, margem e ROAS não se dividem.</span>
        </p>
      )}
      {!h.configured && (
        <p className={s.cfg}>
          <Chip tone="cfg" icon="sliders" size="sm">Custos não configurados</Chip>
          <span className={s.sub}>Sem custo de produto, frete nem taxas: o valor acima é vendas − anúncios, não lucro.</span>
        </p>
      )}
    </div>
  )
}

function Insight({ card }: { card: InsightCard }) {
  // The server validates the card's shape; an unknown kind or target type (a
  // newer server, an old cached reading) still renders, as a plain diagnosis.
  const k = KIND[card.kind] ?? KIND.diagnostico
  const confidence = CONFIDENCE[card.confidence]
  const t = card.target
  const target = t && t.type !== 'loja' && t.name ? `${TARGET[t.type] ?? 'Alvo'} · ${t.name}` : null
  const evidence = card.evidence ?? []
  return (
    <li className={s.card}>
      <div className={s.cardHead}>
        <Chip tone={k.tone} icon={k.icon} size="sm">{k.label}</Chip>
        {confidence && <Badge tone="mut">{confidence}</Badge>}
        {!card.verified && <Badge tone="warn" icon="alert" title={UNVERIFIED_TIP}>número não conferido</Badge>}
      </div>
      <h4 className={s.cardTitle}>{card.title}</h4>
      {target && <p className={s.target}>{target}</p>}
      <p className={s.detail}>{card.detail}</p>
      {card.action && (
        <p className={s.action}><Icon name="arrowRight" size={14} /><span><b>O que fazer:</b> {card.action}</span></p>
      )}
      {evidence.length > 0 && (
        <dl className={s.evidence}>
          {evidence.map((e, i) => (
            <div key={`${i}-${e.label}`} className={e.verified ? undefined : s.unverified}>
              <dt>{e.label}</dt>
              <dd>
                <span className="num">{e.value}</span>
                {!e.verified && <Badge tone="warn" icon="alert" title={UNVERIFIED_TIP}>não conferido</Badge>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className={s.sample}>Amostra: {card.sample}</p>
    </li>
  )
}

export default InsightsCard
