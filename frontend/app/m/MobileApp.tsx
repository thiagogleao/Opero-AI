'use client'

/**
 * Opero Mobile: the owner's phone screen.
 *
 * The state is lib/period/phone's (R16): the saved view (the owner's choices,
 * localStorage) and, when an external link opened the app (a push, a deep
 * link, an archived store), a one-visit view over it (sessionStorage, never
 * saved, never rolling). _lib/viewStore is only the browser plumbing. One
 * answer at a time from GET /api/mobile for the SHOWN selection, dropped only
 * when it answers another selection (_lib/useMobileData, R19). While another
 * selection loads, the old answer stays visible but dimmed under
 * "Carregando …", so it is never read as the new store's numbers.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import type { MobileStoreOption } from '@/lib/views/mobile'
import type { DetailSection } from '@/lib/views/mobileDetail'
import { formatRangeLabel, formatTimeInTz, tzCity } from '@/lib/format'
import { REFERENCE_TZ } from '@/lib/engine/dates'
import {
  announce, archiveOpening, findStore, offsetMinutes, preset, resolve, valueName,
  type PeriodValue, type ViewerStores,
} from '@/lib/period'
import { ALL, rowHelp, shownSelection, shownView, storeOptions, stripFor, stripNotes, type Tab } from '@/lib/period/phone'
import { clientNow } from '@/lib/period/client/clock'
import { selectionKey } from './_lib/request'
import {
  applySwNavigate, dispatch, getFacts, getServerState, getState, markHidden, markVisible, rereadSaved, setFacts, subscribe,
  touch,
} from './_lib/viewStore'
import { useMobileData, useNow, useRefresh } from './_lib/useMobileData'
import { diffFeed, inScope, type FeedBaseline } from './_lib/feed'
import { refreshOutcome, refreshProgress } from './_lib/refreshProgress'
import { getSoundPref, playChaChing, restoreSound, setSoundPref, subscribeSoundPref } from './_lib/sound'
import { usePush } from './_lib/usePush'
import { NO_SHARED_ADS, type PairOrdersKnown, type SharedAds } from './_lib/sharedAds'
import { Header, NoteStrip, PeriodBar, RefreshStrip, StoreChips, Strip } from './_components/Top'
import {
  Attention, ChargebackBlock, DailyBlock, DayBlock, frozenTitle, LedgerBlock, LiveFeed, notYetTitle, phoneBand, RefundsBlock, SharedAdsNotes, StoreList,
} from './_components/Home'
import { PhoneNumberBand } from './_components/NumberBand'
import { PeriodDetails } from './_components/PeriodDetails'
import { DetailTabs } from './_components/Details'
import { AlertsSheet, PeriodSheet, SettingsSheet } from './_components/Sheets'
import s from './m.module.css'

type SheetName = 'period' | 'settings' | 'alerts' | null

export default function MobileApp({ stores: firstStores, archived: firstArchived, facts, sharedAds }: {
  stores: MobileStoreOption[]; archived: MobileStoreOption[]
  /** The store facts the period rules resolve with (lib/period ViewerStores);
   *  every answer may bring newer ones (R19). */
  facts: ViewerStores
  /** Shared ad-account pairs, streamed by page.tsx (never rejects). */
  sharedAds: Promise<SharedAds>
}) {
  // Until the pairing arrives the screen simply has no pair note; it never
  // holds the numbers back.
  const [shared, setShared] = useState<SharedAds>(NO_SHARED_ADS)
  useEffect(() => {
    let live = true
    sharedAds.then(v => { if (live) setShared(v) }, () => {})
    return () => { live = false }
  }, [sharedAds])
  const phone = useSyncExternalStore(subscribe, getState, getServerState)
  // The store lists follow the ADOPTED facts (R19): a store archived while the
  // app is open leaves the chips, joins the archived list and stops being
  // polled. The page's props are only the first paint. (A facts change always
  // dispatches, so this re-renders with them.)
  const adopted = phone ? getFacts() : null
  const lists = useMemo(() => (adopted ? storeOptions(adopted) : null), [adopted])
  const stores: MobileStoreOption[] = lists?.active ?? firstStores
  const archived: MobileStoreOption[] = lists?.archived ?? firstArchived
  const shownV = phone ? shownView(phone) : null
  const sel = useMemo(() => (phone ? shownSelection(phone) : null), [phone])
  const selKey = sel ? selectionKey(sel) : null
  // An archived store is not synced: nothing new can arrive, so it is not
  // polled (the footer said "atualizam sozinhos a cada 45 s").
  const archivedSel = !!shownV && archived.some(a => a.id === shownV.loja)
  const home = useMobileData(sel, { poll: !archivedSel, onFacts: setFacts })
  const now = useNow()
  const push = usePush()
  const soundOn = useSyncExternalStore(subscribeSoundPref, getSoundPref, () => false)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [force, setForce] = useState(0)
  // The one-action strip (R4 announcements, open notes, facts changes) is
  // lib/period/phone's PhoneState.transient: one owner, set by the actions and
  // the facts rows of R16, replaced by the next action.
  const transient = phone?.transient ?? []
  const deviceTz = useMemo(() => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : REFERENCE_TZ), [])

  const activeIds = useMemo(() => new Set(stores.map(x => x.id)), [stores])
  const nameOf = useCallback((id: string) => (id === ALL ? 'Todas as lojas' : [...stores, ...archived].find(x => x.id === id)?.name ?? 'esta loja'), [stores, archived])

  // Open the app once (lib/period openApp: fresh open vs restore, R16), after
  // the router's own mount effects; register the service worker so pushes,
  // taps and key rotation reach this page.
  useEffect(() => {
    const t = setTimeout(() => setFacts(facts), 0)
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {})
    // Not setSoundEnabled: no gesture here, so the context waits for the first tap.
    restoreSound(getSoundPref())
    return () => clearTimeout(t)
  }, [facts])

  // Visit identity and storage on resume (R16, R8): hidden/visible, bfcache,
  // another window's saved view, and a heartbeat while visible.
  useEffect(() => {
    const onVis = () => (document.visibilityState === 'hidden' ? markHidden() : markVisible())
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) markVisible(true) }
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === 'opero.m.view.v3') rereadSaved() }
    const beat = setInterval(() => { if (document.visibilityState === 'visible') touch() }, 60_000)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // R4 on the phone: a chip or row tap that will show other dates than the
  // place it sits in says so, with the desktop's words, until the next action
  // (lib/period/phone act, inside dispatch: from what is on screen). The row
  // help line below is the same function.
  const rowLine = useCallback((storeId: string) => {
    const f = getFacts()
    const st = getState()
    if (!f || !st) return null
    const from = shownSelection(st)
    return announce(from, from.scope, { kind: 'store', id: storeId }, f, clientNow())?.line ?? null
  }, [])
  // A period the owner picks: saved; a visit keeps only its store and tab.
  const pick = useCallback((period: PeriodValue) => {
    dispatch({ type: 'period', period })
  }, [])
  // A row of Todas, or an in-screen store link ("Abrir EPOCH", "Ver as lojas
  // juntas"): outside a visit it pins the store (saved); inside a visit it is a
  // drill-down that keeps the visit's dates and saves nothing (R5, R16).
  const pickRow = useCallback((loja: string) => {
    dispatch({ type: 'row', loja })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  // The store buttons at the top: the owner's choice; they end a visit (an
  // archived store's chip, shown only while it is on screen, changes nothing).
  const pickChip = useCallback((loja: string) => {
    dispatch({ type: 'chip', loja })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  // An archived store from Ajustes: a consultation visit on the 30 days
  // ending on its archive day (R10, lib/period archiveOpening — the desktop
  // list's opening too), never saved.
  const openArchived = useCallback((loja: string) => {
    const st = getFacts() ? findStore(getFacts()!, loja) : null
    const open = st ? archiveOpening(st) : null
    dispatch({ type: 'archive', loja, period: open ?? preset('30d') })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  // A tab the owner opens or closes is theirs, whatever a link opened.
  const pickTab = useCallback((aba: DetailSection | null) => {
    dispatch({ type: 'tab', aba: aba as Tab | null })
  }, [])

  // ── Sound: new sales of what is on screen, never on a switch ────────────
  const baseline = useRef<FeedBaseline | null>(null)
  const announced = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!home.data || !home.dataKey) return
    const { baseline: next, fresh } = diffFeed(baseline.current, home.dataKey, home.data.liveFeed, announced.current, Date.now()) // clock-ok: sale-chime baseline age, not a period
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
        // A push tapped while /m is open: always a fresh open (R16, R17).
        applySwNavigate(m.url)
        return
      }
      const v = getState()
      if (m.type === 'sale') {
        const storeId = m.payload?.tenantId
        if (!v || !inScope(shownView(v).loja, storeId, activeIds)) return
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
  }, [activeIds])

  // ── Atualizar: only the stores on screen, real progress ─────────────────
  const onRefreshed = useCallback(() => {
    loadRef.current('manual')
    setForce(f => f + 1)
  }, [])
  const refresh = useRefresh(onRefreshed)
  const onScreen = useCallback(() => {
    const v = getState()
    if (!v) return []
    const loja = shownView(v).loja
    return loja === ALL ? stores.map(x => x.id) : activeIds.has(loja) ? [loja] : []
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

  // ── A store that disappeared (removed elsewhere): say so ─────────────────
  // A visit's store gone ends the visit (unknown_store); the saved store
  // gone falls back to Todas (saved_store_gone, R16).
  const storeGone = home.error?.kind === 'store' && home.errorKey === selKey
  useEffect(() => {
    if (!storeGone) return
    const v = getState()
    if (!v) return
    if (v.visit) {
      dispatch({ type: 'back', notes: [{ code: 'unknown_store', params: { saved: nameOf(v.saved.loja) } }] })
    } else if (v.saved.loja !== ALL) {
      dispatch({ type: 'chip', loja: ALL, notes: [{ code: 'saved_store_gone', params: { store: nameOf(v.saved.loja) } }] })
    }
  }, [storeGone, nameOf])

  // ── What is shown ───────────────────────────────────────────────────────
  const data = home.data
  const fresh = !!data && home.dataKey === selKey
  const error = home.error && home.errorKey === selKey ? home.error : null
  const loadingThis = home.loadingKey !== null && home.loadingKey === selKey
  const verdictInput = useMemo(
    () => (data ? verdictInputFromPortfolio(data, { subject: data.request.store === 'all' ? 'Suas lojas' : undefined }) : null),
    [data],
  )
  const verdict = useMemo(() => (verdictInput ? buildVerdict(verdictInput) : null), [verdictInput])
  // One store in a shared ad-account pair (EPOCH ↔ CAMP HALLOW): the pair's
  // orders in the shown window and in its comparison base, as the desktop
  // Resumo reads them (SharedAccountNote, R2-1 "base misturada"). Asked only
  // for such a store, once per window; until it answers (or if it fails) the
  // band keeps the cautious wording.
  const one = data && data.request.store !== 'all' && data.stores.length === 1 ? data.stores[0].id : null
  const pairStore = one && shared.pairs.some(p => p.adStoreId === one || p.salesStoreId === one) ? one : null
  const wFrom = data?.range.from ?? ''
  const wTo = data?.range.to ?? ''
  const hasBase = !!data && data.comparison.none == null
  const cFrom = hasBase ? data.comparison.from : ''
  const cTo = hasBase ? data.comparison.to : ''
  const baseRange = hasBase ? data.comparison.rangeText || formatRangeLabel({ from: cFrom, to: cTo }, data.anchorToday) : ''
  const knownKey = pairStore ? [pairStore, wFrom, wTo, cFrom, cTo].join('|') : null
  const [knownRead, setKnownRead] = useState<{ key: string; value: PairOrdersKnown } | null>(null)
  useEffect(() => {
    if (!knownKey || !pairStore) return
    const ctrl = new AbortController()
    const q = new URLSearchParams({ store: pairStore, from: wFrom, to: wTo })
    if (cFrom && cTo) { q.set('cfrom', cFrom); q.set('cto', cTo) }
    fetch(`/api/mobile/shared?${q}`, { signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { window?: PairOrdersKnown['now']; base?: PairOrdersKnown['base'] } | null) => {
        if (j) setKnownRead({ key: knownKey, value: { now: j.window ?? null, base: j.base ?? null, baseRange } })
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [knownKey, pairStore, wFrom, wTo, cFrom, cTo, baseRange])
  const known = knownRead && knownRead.key === knownKey ? knownRead.value : null
  // The number band (spec §1): the verdict's numbers, the phone's own chips
  // (another clock, an archived store, a shared ad account). The clock chip
  // reads the time, so it follows the minute.
  const nowMinute = now ? Math.floor(now / 60_000) : 0
  const pb = useMemo(
    () => (data && verdictInput && verdict ? phoneBand(data, verdictInput, verdict, shared, { now: nowMinute * 60_000, deviceTz, archived: archivedSel, known }) : null),
    [data, verdictInput, verdict, shared, nowMinute, deviceTz, archivedSel, known],
  )
  const scopeName = shownV ? nameOf(shownV.loja) : ''
  // The shown selection resolved locally on the server-corrected clock, only
  // to label it while its answer loads (R19 a/b); the server's resolution
  // wins as soon as it answers this selection.
  const factsNow = getFacts() ?? facts
  const local = sel && now ? resolve(sel, factsNow, new Date(now)) : null
  const shownRes = fresh && data?.resolution ? data.resolution : local
  const selTz = shownRes?.clockTz ?? REFERENCE_TZ
  const selToday = shownRes?.clockToday
  const strip = phone ? stripFor(phone, factsNow, shownRes, selToday) : null
  // Notes of the answer on screen (fits, archive, first sale, with a link's
  // own normalising folded into the same "Período ajustado" sentence, R9) and
  // the one-action strip, as one text each.
  // The one-action strip is computed again at this instant (lib/period/phone
  // liveTransient): it follows the day turning and a reload the next day.
  const { answer: answerNotes, transient: transientText } = stripNotes(
    transient, fresh && data?.resolution ? data.resolution : null,
    phone && now ? { state: phone, viewer: factsNow, now: new Date(now) } : undefined,
  )
  const pendingName = shownV ? `${shownV.loja === ALL ? 'Todas' : nameOf(shownV.loja)} · ${local?.label.short ?? valueName(shownV.period, selToday, true)}` : ''
  const shownName = data?.resolution
    ? `${data.request.store === 'all' ? 'Todas' : data.stores[0]?.name ?? ''} · ${data.resolution.label.short}`
    : ''
  const singleTz = data && data.request.store !== 'all' && data.stores.length === 1 ? data.stores[0].timezone : null
  // One store on another clock: every time on screen is the store's (the
  // banner, "parcial · até", the curve, the feed), so "Números de" is too, and
  // names the clock — it read 00h01 under a Tokyo screen at 12h01.
  const screenTz = singleTz && now && offsetMinutes(singleTz, new Date(now)) !== offsetMinutes(deviceTz, new Date(now)) ? singleTz : deviceTz
  const fetchedClock = home.fetchedAt
    ? `${formatTimeInTz(new Date(home.fetchedAt), screenTz)}${screenTz !== deviceTz ? `, no horário de ${tzCity(screenTz)}` : ''}`
    : '—'
  // C15c: the saved store, said in the footer (the old "Fixado em X" line).
  const pinnedName = phone ? (phone.saved.loja === ALL ? 'Todas' : [...stores, ...archived].find(x => x.id === phone.saved.loja)?.name ?? null) : null
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
      <StoreChips stores={stores} archived={archived} shown={shownV?.loja ?? null} saved={phone?.saved.loja ?? null}
        pendingKey={loadingThis && !fresh ? shownV?.loja ?? null : null} onPick={pickChip} />
      <PeriodBar
        period={shownV?.period ?? null}
        label={shownRes?.label ?? null}
        onPick={p => pick(preset(p))}
        onMore={() => setSheet('period')}
      />

      <RefreshStrip run={refresh.run} onClose={refresh.dismiss} onRetry={() => void refresh.start(onScreen())} />
      {/* The visit an external link opened (R16): built from what the visit
          still overrides, with the way back to the owner's own view. */}
      {strip && (
        <Strip tone="info" icon="info" onClose={() => dispatch({ type: 'close_strip' })}>
          {strip.text}{' '}
          <button type="button" className={s.linkBtn} onClick={() => dispatch({ type: 'back' })}>{strip.button}</button>
        </Strip>
      )}
      {/* The answer's own notes: a fitted window (R9), an archived store's
          clamp (R10), a store that started inside the window (R11). */}
      {answerNotes && <NoteStrip>{answerNotes}</NoteStrip>}
      {/* A scope change that opens other dates (R4), or a link that could
          not be used as it was: until the next action. */}
      {transientText && <Strip tone="warn" icon="alert" onClose={() => dispatch({ type: 'close_transient' })}>{transientText}</Strip>}

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
      ) : !data || !verdict || !pb ? (
        <HomeSkeleton />
      ) : (
        // inert: the dimmed answer is another selection's, so its rows must not
        // be focusable or tappable as if they were this one's.
        <div className={`${s.content}${fresh ? '' : ` ${s.dim}`}`} aria-busy={!fresh || undefined} aria-hidden={!fresh || undefined} inert={!fresh || undefined}>
          {/* The archived store and another clock are status chips of the band
              now (spec §3.10): nothing sits between the period bar and it. */}
          {data.stores.length === 0 ? (
            <EmptyState title="Nenhuma loja ativa" />
          ) : (
            <>
              <PhoneNumberBand band={pb.band} heading={shownName || 'Números do período'} />
              <DayBlock data={data} />
              <DailyBlock data={data} />
              <PeriodDetails
                // Closed again on another store or period (spec §1.6: closed on load).
                key={selKey ?? ''}
                band={pb.band}
                before={pb.before}
                extraCount={pb.pairs.length}
                extra={pb.pairs.length ? <SharedAdsNotes data={data} notes={pb.pairs} onAll={() => pickRow(ALL)} /> : null}
              />
              <LedgerBlock data={data} v={verdict} />
              <Attention data={data} />
              <StoreList data={data} shared={shared} onPick={pickRow} opensOther={rowLine} help={phone ? rowHelp(phone) : undefined} />
              <LiveFeed data={data} now={now} deviceTz={deviceTz} />
            </>
          )}
        </div>
      )}

      {sel && (
        <div className={s.content}>
          <DetailTabs sel={sel} aba={shownV?.aba ?? null} onTab={pickTab} forceSignal={force} pollSignal={home.fetchedAt ?? 0} homeRange={fresh && data ? `${data.range.from}|${data.range.to}` : null} now={now} scopeName={scopeName}
            shared={shared} onStore={pickRow} frozen={archivedSel}
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
          <span>Números de {fetchedClock} · {archivedSel ? 'loja arquivada: sem sincronização, não atualizam sozinhos' : 'atualizam sozinhos a cada 45 s com o app aberto'}{pinnedName ? ` · fixado em ${pinnedName}` : ''}.</span>
        )}
        <button type="button" className={s.linkBtn} onClick={() => setSheet('settings')}>Ajustes deste aparelho</button>
      </footer>

      {sheet === 'period' && shownV && (
        <PeriodSheet
          period={shownV.period}
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
          onOpenStore={openArchived}
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
