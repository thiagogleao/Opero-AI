'use client'

/**
 * Opero Mobile: the owner's phone screen.
 *
 * One selection (store + period, optionally an open tab) that only a tap
 * changes, kept in the URL and in localStorage (_lib/viewStore). One answer at
 * a time from GET /api/mobile, applied only when it echoes exactly what is on
 * screen (_lib/useMobileData). While another selection loads, the old answer
 * stays visible but dimmed under "Carregando …", so it is never read as the
 * new store's numbers.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import type { MobileStoreOption } from '@/lib/views/mobile'
import type { DetailSection } from '@/lib/views/mobileDetail'
import { formatTimeInTz, tzCity } from '@/lib/format'
import { REFERENCE_TZ, todayInTz } from '@/lib/engine/dates'
import {
  ALL, chipReturnLabel, chipSelection, chipView, clockDiffers, linkDayKey, linkDayNotice, patchSelection, periodLabel, periodShort,
  rowTapSelection, selectionKey, selectionPeriodLabel, selectionTz, type Selection,
} from './_lib/selection'
import {
  applyUrl, configureStores, getServerView, getView, persistCurrent, revalidate, setView, subscribeView, takeLinkNotice,
  takeLinkRangeNotice,
} from './_lib/viewStore'
import { useMobileData, useNow, useRefresh } from './_lib/useMobileData'
import { diffFeed, inScope, type FeedBaseline } from './_lib/feed'
import { refreshOutcome, refreshProgress } from './_lib/refreshProgress'
import { getSoundPref, playChaChing, restoreSound, setSoundPref, subscribeSoundPref } from './_lib/sound'
import { usePush } from './_lib/usePush'
import { NO_SHARED_ADS, type SharedAds } from './_lib/sharedAds'
import { Header, PeriodBar, RefreshStrip, StoreChips, Strip } from './_components/Top'
import {
  Attention, ChargebackBlock, ClockBanner, DailyBlock, DayBlock, frozenTitle, LiveFeed, notYetTitle, RefundsBlock, SharedAdsNotes, StoreList, VerdictBlock,
} from './_components/Home'
import { DetailTabs } from './_components/Details'
import { AlertsSheet, PeriodSheet, SettingsSheet } from './_components/Sheets'
import s from './m.module.css'

type SheetName = 'period' | 'settings' | 'alerts' | null

export default function MobileApp({ stores, archived, sharedAds }: {
  stores: MobileStoreOption[]; archived: MobileStoreOption[]
  /** Shared ad-account pairs, streamed by page.tsx (never rejects). */
  sharedAds: Promise<SharedAds>
}) {
  configureStores(stores, archived)
  // Until the pairing arrives the screen simply has no pair note; it never
  // holds the numbers back.
  const [shared, setShared] = useState<SharedAds>(NO_SHARED_ADS)
  useEffect(() => {
    let live = true
    sharedAds.then(v => { if (live) setShared(v) }, () => {})
    return () => { live = false }
  }, [sharedAds])
  const view = useSyncExternalStore(subscribeView, getView, getServerView)
  const sel = view?.sel ?? null
  const selKey = sel ? selectionKey(sel) : null
  // An archived store is not synced: nothing new can arrive, so it is not
  // polled (the footer said "atualizam sozinhos a cada 45 s").
  const archivedSel = !!sel && archived.some(a => a.id === sel.loja)
  const home = useMobileData(sel, { poll: !archivedSel })
  const now = useNow()
  const push = usePush()
  const soundOn = useSyncExternalStore(subscribeSoundPref, getSoundPref, () => false)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [force, setForce] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  // A link whose custom range was cut before asking (selection linkRangeNotice).
  const [rangeNotice, setRangeNotice] = useState<string | null>(null)
  // The notification strip the owner closed (selection linkDayNotice), by the
  // notification it was about (selection linkDayKey: not the store, so a
  // store row does not bring it back); a new notification tap shows its own.
  const [closedLinkDay, setClosedLinkDay] = useState<string | null>(null)
  const deviceTz = useMemo(() => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : REFERENCE_TZ), [])

  const activeIds = useMemo(() => new Set(stores.map(x => x.id)), [stores])
  const nameOf = useCallback((id: string) => (id === ALL ? 'Todas as lojas' : [...stores, ...archived].find(x => x.id === id)?.name ?? 'esta loja'), [stores, archived])

  // The resolved view goes to the URL and storage once; the service worker
  // is registered so pushes, taps and key rotation reach this page.
  useEffect(() => {
    // After the router's own mount effects, which rewrite the URL to the one
    // the server rendered (plain /m) and would drop ?loja=&periodo=.
    const t = setTimeout(persistCurrent, 0)
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {})
    // Not setSoundEnabled: no gesture here, so the context waits for the first tap.
    restoreSound(getSoundPref())
    return () => clearTimeout(t)
  }, [])

  // A link (a notification, a saved URL) to a store that is neither active nor
  // archived opens the stored store instead: say so, as for a store gone 404,
  // so its numbers are not read as the link's store.
  const linkNotice = useCallback((shownLoja: string) =>
    `A loja do link não está disponível. Mostrando ${shownLoja === ALL ? 'Todas' : nameOf(shownLoja)}.`, [nameOf])
  useEffect(() => {
    setRangeNotice(takeLinkRangeNotice())
    if (!takeLinkNotice()) return
    const v = getView()
    if (v) setNotice(linkNotice(v.sel.loja))
  }, [linkNotice])

  // The clock tick: dates a store row opened give way to the owner's preset
  // once Todas' day is over, so a "Hoje" keeps rolling after midnight.
  useEffect(() => { if (now) revalidate() }, [now])

  // A period or range the owner picks replaces dates a store row opened
  // (selection patchSelection).
  const pick = useCallback((patch: Partial<Selection>) => {
    const v = getView()
    if (!v) return
    setNotice(null)
    setRangeNotice(null)
    setView({ ...v, sel: patchSelection(v.sel, patch) })
  }, [])
  // A store row of "Todas" may also open the dates it showed, for that store
  // only (selection storeRowSelection). It picks a store, not a period: a
  // period a notification opened stays the link's (selection rowTapSelection),
  // read from then on on the store's own clock.
  const pickRow = useCallback((patch: Partial<Selection>) => {
    const v = getView()
    if (!v) return
    setNotice(null)
    setRangeNotice(null)
    const todayOf = (loja: string) => todayInTz(selectionTz(loja, stores, archived), new Date())
    setView({ ...v, sel: rowTapSelection(v.sel, patch, todayOf) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [stores, archived])
  // A store opened from inside the screen ("Abrir EPOCH" in Campanhas, "Ver
  // as lojas juntas", an archived store in Ajustes): the period stays, except
  // row dates and a notification's period, which go back to the owner's
  // (selection chipSelection). The open tab stays: the link was read in it.
  const pickStore = useCallback((loja: string) => {
    const v = getView()
    if (!v) return
    setNotice(null)
    setRangeNotice(null)
    setView({ ...v, sel: chipSelection(v.sel, loja) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  // The store buttons at the top: the same, and a tab a notification opened
  // gives way to the owner's own (selection chipView).
  const pickChip = useCallback((loja: string) => {
    const v = getView()
    if (!v) return
    setNotice(null)
    setRangeNotice(null)
    setView(chipView(v, loja))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  // A tab the owner opens or closes is theirs, whatever a notification opened.
  const pickTab = useCallback((aba: DetailSection | null) => {
    const v = getView()
    if (v) setView({ sel: v.sel, aba })
  }, [])

  // ── Sound: new sales of what is on screen, never on a switch ────────────
  const baseline = useRef<FeedBaseline | null>(null)
  const announced = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!home.data || !home.dataKey) return
    const { baseline: next, fresh } = diffFeed(baseline.current, home.dataKey, home.data.liveFeed, announced.current, Date.now())
    baseline.current = next
    if (fresh.length) {
      for (const id of fresh) announced.current.add(id)
      playChaChing()
    }
  }, [home.data, home.dataKey])

  const loadRef = useRef(home.load)
  useEffect(() => { loadRef.current = home.load }, [home.load])

  // ── Service worker messages: a sale, another push, a tap to navigate ─────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; url?: string; payload?: { tenantId?: string; orderId?: string } } | null
      if (!m?.type) return
      if (m.type === 'navigate' && m.url) {
        const missing = applyUrl(m.url)
        const v = getView()
        setNotice(missing && v ? linkNotice(v.sel.loja) : null)
        setRangeNotice(takeLinkRangeNotice())
        setClosedLinkDay(null)
        return
      }
      const v = getView()
      if (m.type === 'sale') {
        const storeId = m.payload?.tenantId
        if (!v || !inScope(v.sel.loja, storeId, activeIds)) return
        const id = `${storeId}|${m.payload?.orderId}`
        if (m.payload?.orderId && !announced.current.has(id)) {
          announced.current.add(id)
          playChaChing()
        }
        loadRef.current('manual')
      } else if (m.type === 'push') {
        loadRef.current('poll')
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [activeIds, linkNotice])

  // ── Atualizar: only the stores on screen, real progress ─────────────────
  const onRefreshed = useCallback(() => {
    loadRef.current('manual')
    setForce(f => f + 1)
  }, [])
  const refresh = useRefresh(onRefreshed)
  const onScreen = useCallback(() => {
    const v = getView()
    if (!v) return []
    return v.sel.loja === ALL ? stores.map(x => x.id) : activeIds.has(v.sel.loja) ? [v.sel.loja] : []
  }, [stores, activeIds])
  const refreshing = refresh.run.phase === 'starting' || refresh.run.phase === 'running'
  const { dismiss } = refresh
  // Only a refresh that really finished clean goes away by itself; a failure
  // or runs that never ended stay until the owner closes them.
  useEffect(() => {
    const r = refresh.run
    if (r.phase !== 'done') return
    const p = refreshProgress(r.launched, r.status)
    if (p.total > 0 && !refreshOutcome(p, '', r.stores.length, r.gaveUpAfterMin).autoDismiss) return
    const t = setTimeout(dismiss, 8000)
    return () => clearTimeout(t)
  }, [refresh.run, dismiss])

  // ── A store that disappeared (archived elsewhere): say so, go to Todas ───
  const storeGone = home.error?.kind === 'store' && home.errorKey === selKey
  useEffect(() => {
    if (!storeGone) return
    const v = getView()
    if (!v || v.sel.loja === ALL) return
    const gone = nameOf(v.sel.loja)
    setView({ ...v, sel: chipSelection(v.sel, ALL) })
    setNotice(`${gone} não está mais disponível. Mostrando Todas.`)
  }, [storeGone, nameOf])

  // ── What is shown ───────────────────────────────────────────────────────
  const data = home.data
  const fresh = !!data && home.dataKey === selKey
  const error = home.error && home.errorKey === selKey ? home.error : null
  const loadingThis = home.loadingKey !== null && home.loadingKey === selKey
  const verdict = useMemo(
    () => (data ? buildVerdict(verdictInputFromPortfolio(data, { subject: data.request.store === 'all' ? 'Suas lojas' : undefined })) : null),
    [data],
  )
  const scopeName = sel ? (sel.loja === ALL ? 'Todas as lojas' : nameOf(sel.loja)) : ''
  // The selection's own calendar (the store's timezone, or Brasília for
  // Todas), never the previous answer's: while another store loads or after
  // it failed, `data` is still Hibikura's and its Tokyo clock built the period
  // sheet (Tokyo's "today" offered for a Brazilian store).
  const selTz = sel ? selectionTz(sel.loja, stores, archived) : REFERENCE_TZ
  const selToday = now ? todayInTz(selTz, new Date(now)) : undefined
  // A period a notification opened, for as long as it is on screen (it goes
  // back to the owner's own on the next chip or day): which day, and to what.
  const linkKey = sel ? linkDayKey(sel) : null
  const linkDayText = sel && selToday && linkKey !== closedLinkDay ? linkDayNotice(sel, selToday) : null
  const backTo = sel ? chipReturnLabel(sel, selToday) : null
  // A custom period is named by its dates: "Escolher datas" is the action.
  const pendingName = sel ? `${sel.loja === ALL ? 'Todas' : nameOf(sel.loja)} · ${selectionPeriodLabel(sel, selToday)}` : ''
  const shownName = data
    ? `${data.request.store === 'all' ? 'Todas' : data.stores[0]?.name ?? ''} · ${data.period === 'custom' ? data.rangeLabel : periodLabel(data.period)}`
    : ''
  const singleTz = data && data.request.store !== 'all' && data.stores.length === 1 ? data.stores[0].timezone : null
  // One store on another clock: every time on screen is the store's (the
  // banner, "parcial · até", the curve, the feed), so "Números de" is too, and
  // names the clock — it read 00h01 under a Tokyo screen at 12h01.
  const screenTz = singleTz && now && clockDiffers(singleTz, deviceTz, new Date(now)) ? singleTz : deviceTz
  const fetchedClock = home.fetchedAt
    ? `${formatTimeInTz(new Date(home.fetchedAt), screenTz)}${screenTz !== deviceTz ? `, no horário de ${tzCity(screenTz)}` : ''}`
    : '—'
  const pushAlert = push.status === 'nao_inscrito' || push.status === 'bloqueado' || push.status === 'sem_chave'

  if (error?.kind === 'session') {
    return (
      <div className={s.root}>
        <div className={s.gate} role="alert">
          <p>Sessão expirada neste aparelho</p>
          <p>Abra o link de acesso de novo para ver as lojas.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={s.root}>
      <Header
        data={fresh ? data : null}
        now={now}
        soundOn={soundOn}
        onSound={() => setSoundPref(!soundOn)}
        onRefresh={() => void refresh.start(onScreen())}
        refreshing={refreshing}
        refreshDisabled={archivedSel}
        onSettings={() => setSheet('settings')}
        settingsAlert={pushAlert}
      />
      <StoreChips stores={stores} archived={archived} sel={sel} pendingKey={loadingThis && !fresh ? sel?.loja ?? null : null} onPick={pickChip} />
      <PeriodBar
        sel={sel}
        today={data?.anchorToday ?? selToday}
        // The dates the numbers on screen use, once they answer this selection.
        shown={fresh && data && data.period === 'custom' ? data.range : null}
        onPick={periodo => pick({ periodo, de: null, ate: null })}
        onMore={() => setSheet('period')}
      />

      <RefreshStrip run={refresh.run} onClose={refresh.dismiss} onRetry={() => void refresh.start(onScreen())} />
      {/* The server cut a custom range (more than 366 days, or before 2000):
          the button already names the dates used; this says why. */}
      {fresh && data?.rangeNote && <Strip tone="info" icon="info">{data.rangeNote}</Strip>}
      {/* The phone cut a link's custom range before asking (the server then
          has nothing to cut and sends no rangeNote): this says why. */}
      {rangeNotice && <Strip tone="info" icon="info" onClose={() => setRangeNotice(null)}>{rangeNotice}</Strip>}
      {/* A period a notification opened (the day it was about, or Hoje over
          another stored period): which day, and what the next chip brings back. */}
      {linkDayText && <Strip tone="info" icon="info" onClose={() => setClosedLinkDay(linkKey)}>{linkDayText}</Strip>}
      {/* Dates a store row opened: say whose they are and how to get the
          owner's preset back on this store's own clock. */}
      {fresh && data && sel?.rowPreset && (
        <Strip tone="info" icon="clock">
          Mesmas datas de Todas · {periodShort(sel.rowPreset)} ({data.rangeLabel}). Ao trocar de loja, volta para “{backTo}”.{' '}
          <button type="button" className={s.linkBtn} onClick={() => pick({ periodo: sel.rowPreset, de: null, ate: null })}>
            Ver “{periodShort(sel.rowPreset)}” no relógio de {tzCity(selTz)}
          </button>
        </Strip>
      )}
      {notice &&<Strip tone="warn" icon="alert" onClose={() => setNotice(null)}>{notice}</Strip>}

      {sel && !fresh && !error && (
        <Strip tone="info" spin>
          Carregando {pendingName}…
          {data && <small>Os números apagados abaixo ainda são de {shownName}.</small>}
        </Strip>
      )}
      {sel && error && (
        fresh ? (
          <Strip tone="warn" icon="alert" spin={loadingThis}>
            Não atualizou: {error.message}. Números de {fetchedClock}.{' '}
            {/* A retry gave no sign of life until it answered (a poll shows no "Carregando"). */}
            {loadingThis
              ? <span>Tentando de novo…</span>
              : <button type="button" className={s.linkBtn} onClick={() => home.load('manual')}>Tentar de novo</button>}
          </Strip>
        ) : null
      )}

      {sel && error && !fresh ? (
        <div className={s.content}>
          <ErrorState
            title={`Não foi possível carregar ${pendingName}`}
            action={<Button icon="refresh" onClick={() => home.load('manual')}>Tentar de novo</Button>}
          >
            {error.message}. {data ? `Os números de ${shownName} foram tirados da tela para não serem lidos como desta seleção.` : ''}
          </ErrorState>
        </div>
      ) : !data || !verdict ? (
        <HomeSkeleton />
      ) : (
        // inert: the dimmed answer is another selection's, so its rows must not
        // be focusable or tappable as if they were this one's.
        <div className={`${s.content}${fresh ? '' : ` ${s.dim}`}`} aria-busy={!fresh || undefined} aria-hidden={!fresh || undefined} inert={!fresh || undefined}>
          {archivedSel && fresh && <Strip tone="info" icon="info">Loja arquivada: fora de “Todas” e sem sincronização. Só o histórico.</Strip>}
          {singleTz && <ClockBanner tz={singleTz} deviceTz={deviceTz} now={now} />}
          {data.stores.length === 0 ? (
            <EmptyState title="Nenhuma loja ativa" />
          ) : (
            <>
              <VerdictBlock data={data} v={verdict} />
              <SharedAdsNotes data={data} shared={shared} onAll={() => pickStore(ALL)} />
              <DayBlock data={data} />
              <DailyBlock data={data} />
              <Attention data={data} />
              <StoreList data={data} shared={shared} onPick={pickRow} />
              <LiveFeed data={data} now={now} deviceTz={deviceTz} />
            </>
          )}
        </div>
      )}

      {sel && (
        <div className={s.content}>
          <DetailTabs sel={sel} aba={view?.aba ?? null} onTab={pickTab} forceSignal={force} pollSignal={home.fetchedAt ?? 0} homeRange={fresh && data ? `${data.range.from}|${data.range.to}` : null} now={now} scopeName={scopeName}
            shared={shared} onStore={pickStore} frozen={archivedSel}
            // An empty list of a window with nothing to read (archived after it,
            // or before the first sale) says why, as the home blocks do.
            frozenTitle={fresh && data ? notYetTitle(data) ?? frozenTitle(data) : null} />
          {data && fresh && verdict && (
            <>
              <RefundsBlock data={data} />
              <ChargebackBlock data={data} deviceTz={deviceTz} now={now} />
            </>
          )}
        </div>
      )}

      <footer className={s.footer}>
        {fresh && home.fetchedAt && (
          <span>Números de {fetchedClock} · {archivedSel ? 'loja arquivada: sem sincronização, não atualizam sozinhos.' : 'atualizam sozinhos a cada 45 s com o app aberto.'}</span>
        )}
        <button type="button" className={s.linkBtn} onClick={() => setSheet('settings')}>Ajustes deste aparelho</button>
      </footer>

      {sheet === 'period' && sel && (
        <PeriodSheet
          sel={sel}
          tz={selTz}
          now={now}
          onPick={p => pick(p)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          push={push}
          soundOn={soundOn}
          onSound={setSoundPref}
          archived={archived}
          onOpenStore={pickStore}
          onAlerts={() => setSheet('alerts')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'alerts' && <AlertsSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className={s.content} aria-busy="true" aria-label="Carregando">
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', padding: 16, display: 'grid', gap: 12 }}>
        <Skeleton width={160} height={22} radius={11} />
        <Skeleton width="92%" height={22} />
        <Skeleton width="70%" height={22} />
        <Skeleton width={180} height={40} />
        <Skeleton height={56} radius={12} />
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', padding: 16 }}>
        <Skeleton width={180} height={14} />
        <Skeleton height={160} radius={10} style={{ marginTop: 14 }} />
      </div>
    </div>
  )
}
