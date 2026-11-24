import { describe, expect, it } from 'vitest'
import {
  apiQuery, chipReturnLabel, chipSelection, chipView, clampSelection, clockDiffers, compareAsOf, customRange, echoMatches, expireLinkDay, expireRowDates,
  linkDayKey, linkDayNotice, notificationDay, periodButtonYear, rowTapSelection,
  patchSelection, periodButtonFull, periodButtonLabel, rawFromSearch, rowOpensDates,
  linkRangeNotice, rawFromStorage, resolveView, selectionKey, selectionPeriodLabel, selectionTz, storeRowSelection, todasRangeAt, toSearch, toStorage,
  tzOffsetMinutes, unknownLinkStore, type Selection,
} from '../selection'
import { diffFeed, FRESH_SALE_MS, inScope } from '../feed'
import {
  afterFailedStatus, refreshOutcome, refreshProgress, skippedText, STATUS_GIVE_UP_MS, STATUS_MAX_FAILURES,
} from '../refreshProgress'
import { fitCustomRange, MAX_WINDOW_DAYS, rangeCutNote, resolvePortfolioWindow } from '@/lib/views/portfolioLimits'
import {
  alertDeliveryText, alertRowTitle, campaignChip, campaignGapNotes, countriesLeftOutLine, countriesMetaSide, creativeChip, dueByLabel, feedLine, judgedWindowsText,
  liveFeedSpeed, ptNumbers,
  pushBlockedText, shopAdsLine,
} from '../labels'
import { adSignalChip, ACTION_CHIP } from '@/components/campaigns/text'
import { signalLabel } from '@/lib/creativeSignal'
import { deliveryOf, storeUrl, summaryUrl } from '@/lib/alerts'
import { bytesToBase64Url, sameServerKey, urlBase64ToUint8Array } from '../pushKeys'
import { adsElsewhere, NO_SHARED_ADS, noSpendLine, pairNotes, pairOrdersKnown, type SharedAds } from '../sharedAds'

const known = (id: string) => ['mokoo', 'epoch', 'squishy'].includes(id)
const TOKYO = 'Asia/Tokyo'
/** 13h in Brasília on 18 nov (01h of 19 nov in Tokyo). */
const AT_18 = '2026-11-18T16:00:00.000Z'
/** 13h in Brasília on 23 nov (01h of 24 nov in Tokyo). */
const AT_23 = '2026-11-23T16:00:00.000Z'

describe('resolveView', () => {
  const stored = rawFromStorage(JSON.stringify({ loja: 'epoch', periodo: '30d', de: null, ate: null, aba: 'produtos' }))

  it('launch without a URL restores the last store, period and tab', () => {
    expect(resolveView(rawFromSearch(''), stored, known)).toEqual({ sel: { loja: 'epoch', periodo: '30d', de: null, ate: null }, aba: 'produtos' })
  })
  it('first launch ever: Todas · Hoje', () => {
    expect(resolveView({}, {}, known)).toEqual({ sel: { loja: 'todas', periodo: 'today', de: null, ate: null }, aba: null })
  })
  it('a notification tap (?loja=&aba=) picks the store and tab and keeps the stored period', () => {
    const v = resolveView(rawFromSearch('?loja=mokoo&aba=campanhas'), stored, known)
    expect(v).toEqual({ sel: { loja: 'mokoo', periodo: '30d', de: null, ate: null }, aba: 'campanhas' })
  })
  it('a store the owner cannot open, or garbage, falls back field by field', () => {
    const v = resolveView(rawFromSearch('?loja=someone-else&periodo=forever&aba=x'), stored, known)
    expect(v).toEqual({ sel: { loja: 'epoch', periodo: '30d', de: null, ate: null }, aba: null })
    expect(resolveView(rawFromSearch('?loja=nope'), rawFromStorage('{not json'), known).sel.loja).toBe('todas')
  })
  it('custom counts only with both dates (sorted), else the previous period stays', () => {
    expect(resolveView(rawFromSearch('?periodo=custom&de=2026-11-12&ate=2026-11-01'), {}, known).sel)
      .toEqual({ loja: 'todas', periodo: 'custom', de: '2026-11-01', ate: '2026-11-12' })
    expect(resolveView(rawFromSearch('?periodo=custom&de=2026-11-12'), stored, known).sel.periodo).toBe('30d')
  })
  it('round-trips through the URL and storage', () => {
    const v = { sel: { loja: 'mokoo', periodo: 'custom' as const, de: '2026-11-01', ate: '2026-11-05' }, aba: 'paises' as const }
    expect(toSearch(v)).toBe('loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-05&aba=paises')
    expect(resolveView(rawFromSearch(toSearch(v)), {}, known)).toEqual(v)
    expect(resolveView({}, rawFromStorage(toStorage(v)), known)).toEqual(v)
  })
})

describe('echoMatches', () => {
  const sel = { loja: 'mokoo', periodo: 'today' as const, de: null, ate: null }
  it('accepts only the exact answer to what is on screen', () => {
    expect(echoMatches({ store: 'mokoo', period: 'today', from: null, to: null }, sel)).toBe(true)
    // The slow "Todas" answer landing after MOKOO was tapped: dropped.
    expect(echoMatches({ store: 'all', period: 'today', from: null, to: null }, sel)).toBe(false)
    expect(echoMatches({ store: 'mokoo', period: '7d', from: null, to: null }, sel)).toBe(false)
    expect(echoMatches(null, sel)).toBe(false)
  })
  it('custom dates must match too, and Todas is "all" on the wire', () => {
    const c = { loja: 'todas', periodo: 'custom' as const, de: '2026-11-01', ate: '2026-11-05' }
    expect(apiQuery(c)).toBe('period=custom&store=all&from=2026-11-01&to=2026-11-05')
    expect(echoMatches({ store: 'all', period: 'custom', from: '2026-11-01', to: '2026-11-05' }, c)).toBe(true)
    expect(echoMatches({ store: 'all', period: 'custom', from: '2026-11-01', to: '2026-11-04' }, c)).toBe(false)
    expect(selectionKey(c)).not.toBe(selectionKey({ ...c, ate: '2026-11-04' }))
  })
})

describe('clocks', () => {
  const at = new Date('2026-11-17T16:00:00Z')
  it('Belém and São Paulo share a clock (no "dia de Belém" noise); Tóquio does not', () => {
    expect(tzOffsetMinutes('America/Sao_Paulo', at)).toBe(-180)
    expect(tzOffsetMinutes('Asia/Tokyo', at)).toBe(540)
    expect(clockDiffers('America/Belem', 'America/Sao_Paulo', at)).toBe(false)
    expect(clockDiffers('Asia/Tokyo', 'America/Sao_Paulo', at)).toBe(true)
  })
})

describe('diffFeed', () => {
  const now = Date.parse('2026-11-17T20:00:00Z')
  const sale = (storeId: string, orderId: string, minutesAgo: number) => {
    const at = new Date(now - minutesAgo * 60_000).toISOString()
    return { storeId, orderId, placedAt: at, receivedAt: at }
  }
  it('the first answer of a selection is a silent baseline', () => {
    const r = diffFeed(null, 'mokoo|today||', [sale('mokoo', '1', 1)], new Set(), now)
    expect(r.fresh).toEqual([])
  })
  it('switching store never rings, even with orders the old view had not seen', () => {
    const base = diffFeed(null, 'mokoo|today||', [sale('mokoo', '1', 30)], new Set(), now).baseline
    const r = diffFeed(base, 'todas|today||', [sale('epoch', '9', 2), sale('mokoo', '1', 30)], new Set(), now)
    expect(r.fresh).toEqual([])
    expect(r.baseline.key).toBe('todas|today||')
  })
  it('rings for a new, recent sale of the same view, once', () => {
    const base = diffFeed(null, 'k', [sale('mokoo', '1', 30)], new Set(), now).baseline
    const r = diffFeed(base, 'k', [sale('mokoo', '2', 1), sale('mokoo', '1', 30)], new Set(), now)
    expect(r.fresh).toEqual(['mokoo|2'])
    expect(diffFeed(r.baseline, 'k', [sale('mokoo', '2', 1)], new Set(), now).fresh).toEqual([])
    // Already announced by the service worker's push: no second chime.
    expect(diffFeed(base, 'k', [sale('mokoo', '3', 1)], new Set(['mokoo|3']), now).fresh).toEqual([])
  })
  it('an old sale that surfaces late is history, not news', () => {
    const base = diffFeed(null, 'k', [], new Set(), now).baseline
    expect(diffFeed(base, 'k', [sale('glooty', '7', FRESH_SALE_MS / 60_000 + 5)], new Set(), now).fresh).toEqual([])
  })
  it('inScope: Todas means the active stores; one store means that store', () => {
    const active = new Set(['mokoo', 'epoch'])
    expect(inScope('todas', 'epoch', active)).toBe(true)
    expect(inScope('todas', 'squishy', active)).toBe(false)
    expect(inScope('mokoo', 'epoch', active)).toBe(false)
    expect(inScope('mokoo', undefined, active)).toBe(false)
  })
})

describe('refreshProgress', () => {
  const launched = [
    { storeId: 'mokoo', name: 'MOKOO', source: 'shopify' as const, state: 'started' as const },
    { storeId: 'mokoo', name: 'MOKOO', source: 'facebook' as const, state: 'started' as const },
    { storeId: 'epoch', name: 'EPOCH', source: 'shopify' as const, state: 'queued' as const },
  ]
  const run = (storeId: string, source: 'shopify' | 'facebook', status: string | null) => ({
    storeId, name: storeId, source, status, startedAt: status ? '2026-11-17T20:00:00Z' : null, finishedAt: null,
  })
  it('counts finished runs, not time', () => {
    const p = refreshProgress(launched, { since: '', done: false, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'running'), run('epoch', 'shopify', null)] })
    expect(p.lines.map(l => l.state)).toEqual(['ok', 'rodando', 'fila'])
    expect([p.done, p.total, p.finished]).toEqual([1, 3, false])
  })
  it('finished when every launched run ended; failures are named', () => {
    const p = refreshProgress(launched, { since: '', done: true, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'error'), run('epoch', 'shopify', 'success'), run('glooty', 'shopify', 'running')] })
    expect(p.finished).toBe(true)
    expect(p.failed.map(l => `${l.name}:${l.source}`)).toEqual(['MOKOO:facebook'])
  })
  it('nothing launched is never "finished" (and before any status, all queued)', () => {
    expect(refreshProgress([], null).finished).toBe(false)
    expect(refreshProgress(launched, null).lines.every(l => l.state === 'fila')).toBe(true)
  })
  it('says which stores were skipped as recent', () => {
    expect(skippedText([
      { storeId: 'a', name: 'MOKOO', source: 'shopify', reason: 'recente', retryInSeconds: 30 },
      { storeId: 'a', name: 'MOKOO', source: 'facebook', reason: 'recente', retryInSeconds: 30 },
      { storeId: 'b', name: 'CAMP HALLOW', source: 'facebook', reason: 'sem_conta_de_anuncio', retryInSeconds: null },
    ])).toBe('MOKOO: sincronizada há menos de 2 min, não precisa de novo.')
    expect(skippedText([])).toBeNull()
    expect(skippedText([{ storeId: 'b', name: 'EPOCH', source: 'facebook', reason: 'em_andamento', retryInSeconds: null }]))
      .toBe('EPOCH: já está sincronizando agora.')
  })

  describe('watching after a failed progress read (the strip never spins forever)', () => {
    it('a lost session or a store that is gone stops at once, with its own words and no retry', () => {
      const session = afterFailedStatus('session', 'Sessão expirada neste aparelho', 1, 4_000)
      expect(session).toMatchObject({ do: 'fail', retryable: false })
      expect(session.do === 'fail' && session.message).toMatch(/sessão deste aparelho expirou/)
      const store = afterFailedStatus('store', 'Loja não encontrada', 1, 4_000)
      expect(store).toMatchObject({ do: 'fail', retryable: false })
      expect(store.do === 'fail' && store.message).toMatch(/^Loja não encontrada: uma das lojas na tela não está mais disponível/)
    })
    it('a passing failure waits; several in a row stop with a retry', () => {
      expect(afterFailedStatus('server', 'Erro 500', 1, 8_000)).toEqual({ do: 'wait' })
      expect(afterFailedStatus('server', 'Erro 500', STATUS_MAX_FAILURES - 1, 20_000)).toEqual({ do: 'wait' })
      const stop = afterFailedStatus('server', 'Erro 500', STATUS_MAX_FAILURES, 24_000)
      expect(stop).toMatchObject({ do: 'fail', retryable: true })
      expect(stop.do === 'fail' && stop.message).toMatch(/falhou 5 vezes seguidas \(Erro 500\)/)
    })
    it('the clock is judged whatever the read returned', () => {
      // The old loop `continue`d before the time check: past 8 min it still spun.
      expect(afterFailedStatus('server', 'Erro 500', 1, STATUS_GIVE_UP_MS + 1)).toEqual({ do: 'giveUp' })
      expect(afterFailedStatus('bad', 'Pedido inválido', 1, STATUS_GIVE_UP_MS + 1)).toEqual({ do: 'giveUp' })
    })
  })

  describe('closing sentence', () => {
    const two = launched.slice(0, 2)
    it('"atualizada" only when every launched run finished clean, and only then it may vanish', () => {
      const ok = refreshProgress(two, { since: '', done: true, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'success')] })
      expect(refreshOutcome(ok, 'MOKOO', 1, null)).toEqual({ tone: 'ok', autoDismiss: true, text: 'MOKOO atualizada · números recarregados.' })
    })
    it('gave up with nothing started: says the numbers were NOT refreshed, stays on screen', () => {
      const none = refreshProgress(two, { since: '', done: false, runs: [run('mokoo', 'shopify', null), run('mokoo', 'facebook', null)] })
      const out = refreshOutcome(none, 'MOKOO', 1, 8)
      expect(out).toEqual({ tone: 'warn', autoDismiss: false, text: '0 de 2 buscas começaram em 8 min: os números não foram atualizados.' })
      expect(out.text).not.toMatch(/atualizada/)
      expect(refreshOutcome(refreshProgress(two.slice(0, 1), null), 'MOKOO', 1, 8).text).toBe('A busca não começou em 8 min: os números não foram atualizados.')
    })
    it('gave up halfway: how far it got, and that the rest still runs', () => {
      const half = refreshProgress(two, { since: '', done: false, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'running')] })
      expect(refreshOutcome(half, 'MOKOO', 1, 8)).toEqual({ tone: 'warn', autoDismiss: false, text: '1 de 2 buscas concluídas em 8 min; a outra ainda roda em segundo plano e os números podem mudar.' })
    })
    it('a failure is named and stays', () => {
      const failed = refreshProgress(two, { since: '', done: true, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'error')] })
      const out = refreshOutcome(failed, 'MOKOO', 1, null)
      expect(out.tone).toBe('warn')
      expect(out.autoDismiss).toBe(false)
      expect(out.text).toMatch(/com falha em: MOKOO \(anúncios\)/)
    })
  })
})

describe('custom dates (Escolher datas)', () => {
  const today = '2026-11-18'
  it('applies exactly the range it previews: ordered, the end clamped to today', () => {
    expect(customRange('2026-11-12', '2026-11-03', today)).toEqual({ ok: true, from: '2026-11-03', to: '2026-11-12', clamped: false, cut: null })
    expect(customRange('2026-11-15', '2026-11-28', today)).toEqual({ ok: true, from: '2026-11-15', to: today, clamped: true, cut: null })
  })
  it('a start after today is refused, never turned into "25–18 nov"', () => {
    expect(customRange('2026-11-25', '2026-11-28', today)).toEqual({ ok: false, error: 'A data inicial não pode passar de hoje' })
    expect(customRange('2026-11-28', '2026-11-25', today)).toEqual({ ok: false, error: 'A data inicial não pode passar de hoje' })
  })
  it('half-chosen is not a range yet', () => {
    expect(customRange('', '2026-11-03', today)).toBeNull()
    expect(customRange('2026-11-03', '', today)).toBeNull()
  })
  it('keeps the server limits: the last 366 days at most, nothing before 2000 (iOS ignores min)', () => {
    // 1990–today was 13.470 days per store on the phone (5,3 MB, 8 s).
    expect(customRange('1990-01-01', today, today)).toEqual({ ok: true, from: '2025-11-18', to: today, clamped: false, cut: 'long' })
    expect(customRange('1999-06-01', '2000-03-01', today)).toEqual({ ok: true, from: '2000-01-01', to: '2000-03-01', clamped: false, cut: 'floor' })
    expect(customRange('1990-01-01', '1995-01-01', today)).toEqual({ ok: false, error: 'Escolha datas a partir de 1 jan 2000' })
    // Exactly 366 days is allowed as asked.
    expect(customRange('2025-11-18', today, today)).toEqual({ ok: true, from: '2025-11-18', to: today, clamped: false, cut: null })
  })
})

describe('portfolio window limits (lib/views/portfolioLimits, the phone and the server alike)', () => {
  const today = '2026-11-18'
  it('cuts like the desktop pages: floor at 2000, end at today, then the last 366 days', () => {
    expect(fitCustomRange('1990-01-01', '2026-11-17', today)).toEqual({ from: '2025-11-17', to: '2026-11-17', cut: 'long' })
    expect(fitCustomRange('0100-01-01', '2026-12-31', today)).toEqual({ from: '2025-11-18', to: today, cut: 'long' })
    expect(fitCustomRange('2026-11-12', '2026-11-03', today)).toEqual({ from: '2026-11-03', to: '2026-11-12', cut: null })
    expect(fitCustomRange('1999-12-25', '2000-01-10', today)).toEqual({ from: '2000-01-01', to: '2000-01-10', cut: 'floor' })
    const r = fitCustomRange('1990-01-01', today, today)
    expect(Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1).toBe(MAX_WINDOW_DAYS)
  })
  it('says why in one sentence, and nothing when the range was used as asked', () => {
    expect(rangeCutNote(fitCustomRange('1990-01-01', '2026-11-17', today), today))
      .toBe('O período pedido passa de 366 dias, o máximo: aqui estão os últimos 366, 17 nov 2025 – 17 nov 2026.')
    expect(rangeCutNote(fitCustomRange('1999-12-25', '2000-01-10', today), today))
      .toBe('Datas antes de 1 jan 2000 não entram: o período começa em 1 jan 2000.')
    expect(rangeCutNote(fitCustomRange('2026-11-03', '2026-11-12', today), today)).toBeNull()
  })
  it('resolves presets as before and custom ranges through the cut', () => {
    const now = new Date('2026-11-18T15:00:00Z')
    expect(resolvePortfolioWindow('7d', 'America/Sao_Paulo', null, null, now)).toEqual({ range: { from: '2026-11-11', to: '2026-11-17' }, note: null })
    const w = resolvePortfolioWindow('custom', 'America/Sao_Paulo', '1990-01-01', '2026-11-17', now)
    expect(w.range).toEqual({ from: '2025-11-17', to: '2026-11-17' })
    expect(w.note).toMatch(/passa de 366 dias/)
  })
})

describe('custom range from a link, storage or a store switch (the button names the dates the numbers use)', () => {
  const custom = (de: string, ate: string, loja = 'mokoo'): Selection => ({ loja, periodo: 'custom', de, ate })
  const today = '2026-11-18'
  it('clamps the end to the selected store\'s today, like the server', () => {
    expect(clampSelection(custom('2026-11-10', '2026-11-30'), today)).toEqual(custom('2026-11-10', today))
    // Tokyo's 13–19 nov carried to MOKOO in the Brazilian afternoon.
    expect(clampSelection(custom('2026-11-13', '2026-11-19'), today)).toEqual(custom('2026-11-13', today))
  })
  it('a range entirely after today becomes "Hoje", which is what the server answers', () => {
    expect(clampSelection(custom('2026-11-25', '2026-11-30'), today)).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null })
    expect(clampSelection(custom('2026-11-19', '2026-11-19'), today)).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null })
  })
  it('keeps the last 366 days and nothing before 2000, so the button names the dates the server prices', () => {
    expect(clampSelection(custom('1990-01-01', '2026-11-17'), today)).toEqual(custom('2025-11-17', '2026-11-17'))
    expect(clampSelection(custom('1999-12-25', '2000-01-10'), today)).toEqual(custom('2000-01-01', '2000-01-10'))
    // A link with only dates before 2000 is malformed, as on the desktop: the stored view stays.
    const v = resolveView(rawFromSearch('?loja=mokoo&periodo=custom&de=1990-01-01&ate=1995-01-01'), { loja: 'mokoo', periodo: '7d' }, known, () => today)
    expect(v.sel).toEqual({ loja: 'mokoo', periodo: '7d', de: null, ate: null })
    const w = resolveView(rawFromSearch('?loja=todas&periodo=custom&de=1990-01-01&ate=2026-11-17'), {}, known, () => today)
    expect(w.sel).toEqual({ loja: 'todas', periodo: 'custom', de: '2025-11-17', ate: '2026-11-17' })
  })
  it('leaves a valid range and the presets alone (same object)', () => {
    const ok = custom('2026-11-03', '2026-11-12')
    expect(clampSelection(ok, today)).toBe(ok)
    const preset: Selection = { loja: 'mokoo', periodo: '7d', de: null, ate: null }
    expect(clampSelection(preset, today)).toBe(preset)
  })
  it('the deep link /m?periodo=custom&de=2026-11-25&ate=2026-11-30 opens as Hoje, never as "25–30 nov"', () => {
    const v = resolveView(rawFromSearch('?loja=mokoo&periodo=custom&de=2026-11-25&ate=2026-11-30'), {}, known, () => today)
    expect(v.sel).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null })
    const w = resolveView(rawFromSearch('?loja=mokoo&periodo=custom&de=2026-11-10&ate=2026-11-30'), {}, known, () => today)
    expect(w.sel).toEqual(custom('2026-11-10', today))
  })
  it('reads each selection on its own calendar: the store\'s timezone, Brasília for Todas', () => {
    const active = [{ id: 'mokoo', timezone: 'America/Belem' }, { id: 'hib', timezone: 'Asia/Tokyo' }]
    const archived = [{ id: 'squishy', timezone: 'America/Sao_Paulo' }]
    expect(selectionTz('hib', active, archived)).toBe('Asia/Tokyo')
    expect(selectionTz('todas', active, archived)).toBe('America/Sao_Paulo')
    expect(selectionTz('squishy', active, archived)).toBe('America/Sao_Paulo')
    // One active store: Todas is that store's calendar (lib/engine/dates anchorTz).
    expect(selectionTz('todas', [active[1]])).toBe('Asia/Tokyo')
  })
  it('names a custom period by its dates, never "Escolher datas"', () => {
    expect(selectionPeriodLabel(custom('2026-11-03', '2026-11-12'), today)).toBe('3–12 nov')
    expect(selectionPeriodLabel({ periodo: 'today', de: null, ate: null })).toBe('Hoje')
  })
})

describe('chargeback deadline (until when the evidence can be sent)', () => {
  const now = new Date('2026-11-18T13:00:00Z')
  it('is an instant on the phone\'s clock with the hour, never the UTC date', () => {
    // EPOCH: 04:00 UTC on the 22nd is 01h00 on the 22nd in Brasília.
    expect(dueByLabel('2026-11-22 04:00:00+00', 'America/Sao_Paulo', now)).toBe('até 22 nov, 01h00')
    // 02:00 UTC on the 22nd is still the 21st in Brasília: the UTC slice said "22 nov".
    expect(dueByLabel('2026-11-22 02:00:00+00', 'America/Sao_Paulo', now)).toBe('até 21 nov, 23h00')
  })
  it('says hoje and amanhã when they apply, and parses ISO forms', () => {
    expect(dueByLabel('2026-11-18 23:00:00+00', 'America/Sao_Paulo', now)).toBe('até hoje, 20h00')
    expect(dueByLabel('2026-11-19T23:00:00Z', 'America/Sao_Paulo', now)).toBe('até amanhã (19 nov), 20h00')
    expect(dueByLabel('not a date', 'America/Sao_Paulo', now)).toBeNull()
  })
})

describe('live feed line', () => {
  const item = (title: string, quantity: number | null) => ({ title, quantity, price: null })
  it('the first product with its own quantity; the rest outside the cut part', () => {
    // #5316: 1 gift + 6 blind boxes used to read "7× Happy Capy Blind Box – Free Gift +1".
    expect(feedLine([item('Happy Capy Blind Box – Free Gift', 1), item('Mokoo™ | CapyCup Limited Edition Blind Box', 6)]))
      .toEqual({ name: 'Happy Capy Blind Box – Free Gift', more: '+1 produto', units: '7 unidades' })
    expect(feedLine([item('HIBACHI ZERO remote', 2), item('ceramic heater', 2)]))
      .toEqual({ name: '2× HIBACHI ZERO remote', more: '+1 produto', units: '4 unidades' })
    expect(feedLine(['a', 'b', 'c', 'd', 'e'].map(t => item(t, 1)))).toEqual({ name: 'a', more: '+4 produtos', units: '5 unidades' })
  })
  it('one product says its quantity once; unknown quantities are not summed', () => {
    expect(feedLine([item('Glitter Highland Cow Squishy', 2)])).toEqual({ name: '2× Glitter Highland Cow Squishy', more: null, units: null })
    expect(feedLine([item('a', null), item('b', 2)])).toEqual({ name: 'a', more: '+1 produto', units: null })
    expect(feedLine([])).toEqual({ name: 'Pedido', more: null, units: null })
  })
})

describe('alert rows', () => {
  it('never shows the raw kind code', () => {
    expect(alertRowTitle('scale_up', null)).toBe('Campanha para escalar')
    expect(alertRowTitle('scale_cut', null)).toBe('Campanha para cortar')
    expect(alertRowTitle('daily_summary', null)).toBe('Resumo do dia')
    expect(alertRowTitle('something_new', null)).toBe('Alerta')
    expect(alertRowTitle('margin_drop', 'Margem 9% — MOKOO')).toBe('Margem 9% — MOKOO')
  })
  it('stored titles from before lib/format read pt-BR (17 nov 12h14 rows)', () => {
    expect(alertRowTitle('roas_drop', '⚠️ ROAS 0.62× — EPOCH ®️')).toBe('⚠️ ROAS 0,62× — EPOCH ®️')
    expect(alertRowTitle('margin_drop', '⚠️ Margem -82% — EPOCH ®️')).toBe('⚠️ Margem −82% — EPOCH ®️')
    // Titles already in pt-BR pass unchanged.
    expect(alertRowTitle('roas_drop', '⚠️ ROAS 0,62× abaixo do empate — EPOCH ®️')).toBe('⚠️ ROAS 0,62× abaixo do empate — EPOCH ®️')
    expect(alertRowTitle('spend_no_sales', '💸 $1.234 em anúncios e nenhuma venda — Glooty')).toBe('💸 $1.234 em anúncios e nenhuma venda — Glooty')
  })
  it('ptNumbers rewrites money, ratios, percentages and the minus sign', () => {
    expect(ptNumbers('$1,234.50 · $9.80 · 1.95x · 12.5% · -$40 · (-3%)')).toBe('$1.234,50 · $9,80 · 1,95x · 12,5% · −\u2060$40 · (−3%)')
    // Text that already has the joiner (formatMoney) keeps exactly one.
    expect(ptNumbers('Lucro −\u2060$40')).toBe('Lucro −\u2060$40')
    expect(ptNumbers('Dumpling Squishy · 8jcp3a — CBO-2 $1.234 · 0,62×')).toBe('Dumpling Squishy · 8jcp3a — CBO-2 $1.234 · 0,62×')
  })
})

describe('push keys', () => {
  const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
  it('compares the subscription key with the server key, padding-insensitive', () => {
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytesToBase64Url(bytes)).toBe(key)
    expect(sameServerKey(bytes.buffer, key)).toBe(true)
    expect(sameServerKey(bytes.buffer, `${key}=`)).toBe(true)
    expect(sameServerKey(urlBase64ToUint8Array(key.replace('BEl', 'BEm')).buffer, key)).toBe(false)
    expect(sameServerKey(null, key)).toBeNull()
  })
})

describe('shared ad accounts on the phone (CAMP HALLOW on EPOCH)', () => {
  const pair = {
    adStoreId: 'epoch', adStoreName: 'EPOCH ®️', salesStoreId: 'camp', salesStoreName: 'CAMP HALLOW', orders: 446, revenue: 42265.99,
  }
  const shared: SharedAds = { pairs: [pair], badges: {}, lookbackDays: 90 }
  const orders = (m: Record<string, number>) => (id: string) => (id in m ? m[id] : null)

  it('a store row with no ad spend says whose ads it sells on, never a bare "sem anúncios"', () => {
    expect(noSpendLine(shared, 'camp', 85)).toBe('sem gasto no período · vende com anúncios pagos pela EPOCH ®️')
    expect(noSpendLine(shared, 'camp', 0)).toBe('sem gasto em anúncio · antes vendia com anúncios pagos pela EPOCH ®️')
    expect(noSpendLine(shared, 'mokoo', 12)).toBe('sem anúncios')
    expect(noSpendLine(NO_SHARED_ADS, 'camp', 85)).toBe('sem anúncios')
  })

  it('Todas: one note per pair, cautious unless the selling store sold nothing', () => {
    const mixed = pairNotes(shared, { all: true, storeId: null }, '19 out – 17 nov', orders({ camp: 85, epoch: 300 }))
    expect(mixed).toHaveLength(1)
    expect(mixed[0].tone).toBe('warn')
    expect(mixed[0].title).toBe('CAMP HALLOW vende com anúncios pagos pela EPOCH ®️')
    expect(mixed[0].body).toMatch(/^Nos últimos 90 dias, 446 pedidos da CAMP HALLOW \(\$42\.266\) vieram de anúncios pagos pela EPOCH ®️\. /)
    expect(mixed[0].body).toMatch(/A soma das lojas não muda/)
    const quiet = pairNotes(shared, { all: true, storeId: null }, '11–17 nov', orders({ camp: 0, epoch: 300 }))
    expect(quiet[0].tone).toBe('info')
    expect(quiet[0].title).toBe('CAMP HALLOW vendia com anúncios pagos pela EPOCH ®️')
    expect(quiet[0].body).toMatch(/Em 11–17 nov, a CAMP HALLOW não teve pedidos: o resultado deste período não está misturado/)
  })

  it('one store: the pair from its own side; other stores get nothing', () => {
    const camp = pairNotes(shared, { all: false, storeId: 'camp' }, '19 out – 17 nov', orders({ camp: 85 }))
    expect(camp[0].title).toBe('Os anúncios da CAMP HALLOW rodam na conta da EPOCH ®️')
    expect(camp[0].body).toMatch(/Esse gasto não aparece aqui: se os pedidos deste período também vieram de lá, o lucro da CAMP HALLOW parece maior do que é/)
    // EPOCH alone does not know CAMP HALLOW's orders: conditional, never "paga".
    const epoch = pairNotes(shared, { all: false, storeId: 'epoch' }, '11–17 nov', orders({ epoch: 300 }))
    expect(epoch[0].tone).toBe('warn')
    expect(epoch[0].title).toBe('A EPOCH ®️ pagou anúncios que venderam na CAMP HALLOW')
    expect(epoch[0].body).toMatch(/se parte do gasto deste período vendeu na CAMP HALLOW/)
    expect(pairNotes(shared, { all: false, storeId: 'mokoo' }, '11–17 nov', orders({ mokoo: 9 }))).toEqual([])
    expect(pairOrdersKnown(0)).toBe(0)
    expect(pairOrdersKnown(3)).toBeNull()
    expect(pairOrdersKnown(null)).toBeNull()
  })

  // /m?loja=todas&periodo=custom&de=2025-12-15&ate=2026-01-15 said "antes
  // vendia com anúncios pagos pela EPOCH" and "Para períodos anteriores, some
  // as duas lojas" for a window before CAMP HALLOW's first sale (24 jul 2026),
  // while the desktop said it "ainda não vendia".
  describe('a window before the sales store existed', () => {
    const withFirst: SharedAds = { ...shared, firstSales: { camp: '2026-07-24' } }
    const win = { range: { from: '2025-12-15', to: '2026-01-15' }, today: '2026-11-24' }
    const TEXT = 'Em 15 dez 2025 – 15 jan 2026, a CAMP HALLOW ainda não vendia (1ª venda em 24 jul 2026): nada deste período está misturado.'

    it('Todas and both stores say it did not sell yet — the desktop sentence, word for word', () => {
      const all = pairNotes(withFirst, { all: true, storeId: null }, '15 dez 2025 – 15 jan 2026', orders({ camp: 0, epoch: 12 }), win)
      expect(all[0].tone).toBe('info')
      expect(all[0].body.endsWith(TEXT)).toBe(true)
      expect(all[0].body).not.toMatch(/períodos anteriores/)
      const camp = pairNotes(withFirst, { all: false, storeId: 'camp' }, '15 dez 2025 – 15 jan 2026', orders({ camp: 0 }), win)
      expect(camp[0].body.endsWith(TEXT)).toBe(true)
      // EPOCH alone does not see CAMP HALLOW's orders, but before its first
      // sale it had none: not the cautious "se parte do gasto… vendeu".
      const epoch = pairNotes(withFirst, { all: false, storeId: 'epoch' }, '15 dez 2025 – 15 jan 2026', orders({ epoch: 12 }), win)
      expect(epoch[0].tone).toBe('info')
      expect(epoch[0].body.endsWith(TEXT)).toBe(true)
    })

    it('the year joins the first sale only when a date on screen is in another year', () => {
      const oct = { range: { from: '2026-06-01', to: '2026-06-30' }, today: '2026-11-24' }
      const notes = pairNotes(withFirst, { all: true, storeId: null }, '1–30 jun', orders({ camp: 0 }), oct)
      expect(notes[0].body).toMatch(/\(1ª venda em 24 jul\)/)
      const cmpLastYear = pairNotes(withFirst, { all: true, storeId: null }, '1–30 jun', orders({ camp: 0 }), { ...oct, alsoShown: ['2025-06-01', '2025-06-30'] })
      expect(cmpLastYear[0].body).toMatch(/\(1ª venda em 24 jul 2026\)/)
    })

    it('a window from the first sale on, or no first sale known, keeps the old wording', () => {
      const after = pairNotes(withFirst, { all: true, storeId: null }, '11–17 nov', orders({ camp: 0 }), { range: { from: '2026-11-11', to: '2026-11-17' }, today: '2026-11-24' })
      expect(after[0].body).toMatch(/Para períodos anteriores, some as duas lojas/)
      expect(pairNotes(shared, { all: true, storeId: null }, '15 dez 2025 – 15 jan 2026', orders({ camp: 0 }), win)[0].body).toMatch(/Para períodos anteriores/)
      expect(pairNotes(withFirst, { all: true, storeId: null }, '15 dez 2025 – 15 jan 2026', orders({ camp: 0 }))[0].body).toMatch(/Para períodos anteriores/)
    })

    it('the store row has no "antes vendia" before the first sale', () => {
      expect(noSpendLine(withFirst, 'camp', 0, win.range)).toBe('sem gasto em anúncio')
      expect(noSpendLine(withFirst, 'camp', 0, { from: '2026-11-11', to: '2026-11-17' })).toBe('sem gasto em anúncio · antes vendia com anúncios pagos pela EPOCH ®️')
      expect(noSpendLine(withFirst, 'camp', 0)).toBe('sem gasto em anúncio · antes vendia com anúncios pagos pela EPOCH ®️')
      expect(noSpendLine(withFirst, 'mokoo', 0, win.range)).toBe('sem anúncios')
    })
  })
})

// ─── Campaign and ad chips: the desktop's, word for word ──────────────────────
describe('phone chips match the desktop chips', () => {
  it("an 'ok' ad below its break-even is \"Abaixo do empate\" with a ring; above, \"Manter\" with a check", () => {
    expect(creativeChip('ok', 'Abaixo do empate')).toEqual({ label: 'Abaixo do empate', tone: 'neu', icon: 'ring' })
    expect(creativeChip('ok', 'Manter')).toMatchObject({ label: 'Manter', icon: 'check' })
    // Same spec as the desktop's adSignalChip for the same ROAS and break-even.
    for (const [roas, be] of [[0, 1.5], [1.2, 1.5], [1.8, 1.5], [3, 1.5]] as const) {
      expect(creativeChip('ok', signalLabel('ok', roas, be))).toEqual(adSignalChip('ok', roas, be))
    }
    for (const sig of ['kill', 'scale', 'refresh'] as const) {
      expect(creativeChip(sig, signalLabel(sig, 1, 1.5))).toEqual(adSignalChip(sig, 1, 1.5))
    }
  })
  it('a campaign action reads as on the desktop', () => {
    expect(campaignChip('manter', 'Manter')).toEqual(ACTION_CHIP.manter)
    expect(campaignChip('cortar', null)).toEqual(ACTION_CHIP.cortar)
  })
})

// ─── Alerts sheet: what each fired alert reached ──────────────────────────────
describe('alert delivery', () => {
  const now = new Date('2026-11-18T18:00:00Z')
  it('reads the stored count; rows without one say it was not recorded, whatever their age', () => {
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 2, devices: 2, keys: true }))).toBe('entregue a 2 aparelhos')
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 1, devices: 3 }))).toBe('entregue a 1 aparelho')
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 0, devices: 0, keys: true }))).toBe('não entregue: nenhum aparelho inscrito')
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 0, devices: 2, keys: true }))).toBe('não entregue: os 2 aparelhos inscritos recusaram')
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 0, devices: 1 }))).toBe('não entregue: o aparelho inscrito recusou')
    expect(alertDeliveryText(deliveryOf({ title: 't', delivered: 0, devices: 0, keys: false }))).toBe('não entregue: sem chave de push neste servidor')
    // Production's rows: { title } or { margin } or { hour }, no count.
    expect(alertDeliveryText(deliveryOf({ title: '⚠️ Margem 4% — MOKOO' }))).toBe('entrega não registrada')
    expect(alertDeliveryText(deliveryOf({ margin: 12 }))).toBe('entrega não registrada')
    expect(alertDeliveryText(deliveryOf(null))).toBe('entrega não registrada')
  })
  it('a claim still being sent, and one that never reported back', () => {
    expect(deliveryOf({ title: 't', delivered: null }, '2026-11-18 17:58:00+00', now)).toEqual({ state: 'sending' })
    expect(deliveryOf({ title: 't', delivered: null }, '2026-11-18 17:00:00.123+00', now)).toEqual({ state: 'interrupted' })
    expect(alertDeliveryText({ state: 'interrupted' })).toBe('envio interrompido, entrega desconhecida')
  })
  it('a server without push keys says so, not "nenhum aparelho inscrito"', () => {
    expect(pushBlockedText({ pushKeys: false, devices: 0 })).toMatch(/^Sem chave de push neste servidor/)
    expect(pushBlockedText({ pushKeys: true, devices: 0 })).toMatch(/^Nenhum aparelho inscrito/)
    expect(pushBlockedText({ pushKeys: true, devices: 2 })).toBeNull()
    // An answer from an older server (no pushKeys field) keeps the old reading.
    expect(pushBlockedText({ devices: 0 })).toMatch(/^Nenhum aparelho inscrito/)
  })
})

// ─── Notification taps open the push's own period ─────────────────────────────
describe('notification links', () => {
  const stored = rawFromStorage(JSON.stringify({ loja: 'epoch', periodo: '7d', de: null, ate: null, aba: null }))
  it('a sale or alert tap opens the store on today, whatever was used last', () => {
    const v = resolveView(rawFromSearch(storeUrl('mokoo', { tab: 'campanhas' }).split('?')[1]), stored, known)
    expect(v).toEqual({ sel: { loja: 'mokoo', periodo: 'today', de: null, ate: null }, aba: 'campanhas' })
  })
  it('the daily summary opens Todas · Hoje, not the store last pinned', () => {
    expect(resolveView(rawFromSearch(summaryUrl('2026-11-23').split('?')[1]), stored, known).sel).toEqual({ loja: 'todas', periodo: 'today', de: null, ate: null })
  })
})

// ─── A push's "hoje" is the day it was sent on ───────────────────────────────
describe('notification day (dia)', () => {
  const stored = rawFromStorage(JSON.stringify({ loja: 'epoch', periodo: '7d', de: null, ate: null, aba: null }))
  const hib = (id: string) => id === 'hib' || known(id)
  // Tokyo's calendar for Hibikura, Brasília's for the rest.
  const todayAt = (tokyo: string, brasilia: string) => (loja: string) => (loja === 'hib' ? tokyo : brasilia)
  const alert = storeUrl('hib', { dia: '2026-11-23' })
  const own = { periodo: '7d' as const, de: null, ate: null }

  it('the alert link names its day; the summary too; another preset names it only when given', () => {
    expect(alert).toBe('/m?loja=hib&periodo=today&dia=2026-11-23')
    expect(summaryUrl('2026-11-23')).toBe('/m?loja=todas&periodo=today&dia=2026-11-23')
    // The scale push's "7 dias" names the day it was sent: the period is the link's too.
    expect(storeUrl('hib', { periodo: '7d', tab: 'campanhas', dia: '2026-11-23' })).toBe('/m?loja=hib&periodo=7d&dia=2026-11-23&aba=campanhas')
    expect(storeUrl('hib', { periodo: '7d', tab: 'campanhas' })).toBe('/m?loja=hib&periodo=7d&aba=campanhas')
  })
  it('still that day on the store\'s clock: Hoje, the link\'s only (the owner was on 7 dias)', () => {
    const url = rawFromSearch(alert.split('?')[1])
    const v = resolveView(url, stored, hib, todayAt('2026-11-23', '2026-11-23'))
    expect(v.sel).toEqual({
      loja: 'hib', periodo: 'today', de: null, ate: null,
      linkDay: { dia: '2026-11-23', own, on: { loja: 'hib', today: '2026-11-23' } },
    })
    expect(linkDayNotice(v.sel, '2026-11-23')).toBe('A notificação abriu Hoje. Os botões de loja no alto voltam para “Últimos 7 dias”.')
  })
  it('a notification over the period the owner already had changes nothing and marks nothing', () => {
    const onToday = rawFromStorage(JSON.stringify({ loja: 'epoch', periodo: 'today', de: null, ate: null, aba: null }))
    const v = resolveView(rawFromSearch(alert.split('?')[1]), onToday, hib, todayAt('2026-11-23', '2026-11-23'))
    expect(v.sel).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
    expect(linkDayNotice(v.sel, '2026-11-23')).toBeNull()
  })
  it('tapped after the store\'s day turned (12h05 in Brasília, Tokyo 24 nov): Ontem, the day the alert named, with a strip', () => {
    const url = rawFromSearch(alert.split('?')[1])
    const v = resolveView(url, stored, hib, todayAt('2026-11-24', '2026-11-23'))
    expect(v.sel).toMatchObject({ loja: 'hib', periodo: 'yesterday', de: null, ate: null })
    expect(linkDayNotice(v.sel, '2026-11-24'))
      .toBe('A notificação era sobre 23 nov: mostrando esse dia (Ontem), não o de hoje. Os botões de loja no alto voltam para “Últimos 7 dias”.')
  })
  it('the 21h summary tapped the next morning opens that day of Todas; days later, that single date', () => {
    const url = rawFromSearch(summaryUrl('2026-11-23').split('?')[1])
    expect(resolveView(url, stored, hib, todayAt('2026-11-25', '2026-11-24')).sel).toMatchObject({ loja: 'todas', periodo: 'yesterday', de: null, ate: null })
    const later = resolveView(url, stored, hib, todayAt('2026-11-27', '2026-11-26')).sel
    expect(later).toMatchObject({ loja: 'todas', periodo: 'custom', de: '2026-11-23', ate: '2026-11-23' })
    expect(linkDayNotice(later, '2026-11-26')).toBe('A notificação era sobre 23 nov: mostrando esse dia, não o de hoje. Os botões de loja no alto voltam para “Últimos 7 dias”.')
  })
  it('a bogus or future day, or a period other than today, changes nothing', () => {
    const today = { periodo: 'today' as const, de: null, ate: null }
    expect(notificationDay(today, 'ontem', '2026-11-24')).toBe(today)
    expect(notificationDay(today, '2026-11-25', '2026-11-24')).toBe(today)
    const week = { periodo: '7d' as const, de: null, ate: null }
    expect(notificationDay(week, '2026-11-20', '2026-11-24')).toBe(week)
    // Another preset with a dia (the scale push's form) is shown as it is —
    // the day is not read into it — and marked as the link's.
    const v = resolveView(rawFromSearch('loja=hib&periodo=30d&dia=2026-11-20'), stored, hib, todayAt('2026-11-24', '2026-11-23'))
    expect(v.sel).toMatchObject({ loja: 'hib', periodo: '30d', de: null, ate: null, linkDay: { dia: '2026-11-20', asked: '30d' } })
    // Without a dia it is a plain link.
    expect(resolveView(rawFromSearch('loja=hib&periodo=30d'), stored, hib, todayAt('2026-11-24', '2026-11-23')).sel)
      .toEqual({ loja: 'hib', periodo: '30d', de: null, ate: null })
  })
})

// ─── The day a notification opens is the link's, never the owner's period ────
describe('notification day stays the link\'s (linkDay)', () => {
  const hib = (id: string) => id === 'hib' || known(id)
  const todayAt = (tokyo: string, brasilia: string) => (loja: string) => (loja === 'hib' ? tokyo : brasilia)
  const onToday = rawFromStorage(JSON.stringify({ loja: 'todas', periodo: 'today', de: null, ate: null, aba: null }))
  const todasToday: Selection = { loja: 'todas', periodo: 'today', de: null, ate: null }
  // A sale push from last night, tapped at 09h on 24 nov.
  const sale = rawFromSearch('loja=mokoo&periodo=today&dia=2026-11-23')
  const at24 = todayAt('2026-11-25', '2026-11-24')
  const v = resolveView(sale, onToday, hib, at24)

  it('opens MOKOO · Ontem, but storage keeps the owner\'s Todas-era "Hoje"', () => {
    expect(v.sel).toMatchObject({ loja: 'mokoo', periodo: 'yesterday', de: null, ate: null })
    expect(JSON.parse(toStorage(v))).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null, aba: null })
  })
  it('any store chip brings back "Hoje" (Todas, MOKOO itself, Hibikura)', () => {
    expect(chipSelection(v.sel, 'todas')).toEqual(todasToday)
    expect(chipSelection(v.sel, 'mokoo')).toEqual({ ...todasToday, loja: 'mokoo' })
    expect(chipSelection(v.sel, 'hib')).toEqual({ ...todasToday, loja: 'hib' })
  })
  it('the next launch from the icon (/m, no query) opens "Hoje"', () => {
    const reopen = resolveView(rawFromSearch(''), rawFromStorage(toStorage(v)), hib, todayAt('2026-11-28', '2026-11-27'))
    expect(reopen.sel).toEqual({ ...todasToday, loja: 'mokoo' })
  })
  it('a period the owner picks replaces it for good', () => {
    const picked = patchSelection(v.sel, { periodo: 'yesterday', de: null, ate: null })
    expect(picked).toEqual({ loja: 'mokoo', periodo: 'yesterday', de: null, ate: null })
    expect(JSON.parse(toStorage({ sel: picked, aba: null })).periodo).toBe('yesterday')
  })
  it('the URL stays the notification\'s link: a reload the same day opens the same day, still marked', () => {
    expect(toSearch(v)).toBe('loja=mokoo&periodo=today&dia=2026-11-23')
    const reload = resolveView(rawFromSearch(toSearch(v)), rawFromStorage(toStorage(v)), hib, at24)
    expect(reload.sel).toEqual(v.sel)
    // A tab change keeps it.
    expect(toSearch({ ...v, aba: 'paises' })).toBe('loja=mokoo&periodo=today&dia=2026-11-23&aba=paises')
  })
  it('an open app rolls to the next day: the owner\'s period comes back on the clock tick', () => {
    expect(expireLinkDay(v.sel, at24)).toBe(v.sel)
    expect(expireLinkDay(v.sel, todayAt('2026-11-26', '2026-11-25'))).toEqual({ ...todasToday, loja: 'mokoo' })
  })
  it('a push two days old opens that date, which never becomes the stored period', () => {
    const old = resolveView(rawFromSearch('loja=hib&periodo=today&dia=2026-11-22'), onToday, hib, todayAt('2026-11-24', '2026-11-23'))
    expect(old.sel).toMatchObject({ loja: 'hib', periodo: 'custom', de: '2026-11-22', ate: '2026-11-22' })
    expect(JSON.parse(toStorage(old))).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null, aba: null })
    expect(chipSelection(old.sel, 'todas')).toEqual(todasToday)
    expect(chipSelection(old.sel, 'mokoo')).toEqual({ ...todasToday, loja: 'mokoo' })
    expect(toSearch(old)).toBe('loja=hib&periodo=today&dia=2026-11-22')
  })
  it('Hibikura after its day ended (12h05 in Brasília): Hibikura · Ontem, and Todas and MOKOO back on "Hoje" (24 nov)', () => {
    const h = resolveView(rawFromSearch('loja=hib&periodo=today&dia=2026-11-24'), onToday, hib, todayAt('2026-11-25', '2026-11-24'))
    expect(h.sel).toMatchObject({ loja: 'hib', periodo: 'yesterday' })
    expect(h.sel.linkDay?.on).toEqual({ loja: 'hib', today: '2026-11-25' })
    expect(chipSelection(h.sel, 'todas')).toEqual(todasToday)
    expect(chipSelection(h.sel, 'mokoo')).toEqual({ ...todasToday, loja: 'mokoo' })
  })
  it('a second notification while on the first one\'s day keeps the owner\'s period (an open app: applyUrl reads storage as toStorage)', () => {
    const second = resolveView(rawFromSearch('loja=epoch&periodo=today&dia=2026-11-22'), rawFromStorage(toStorage(v)), hib, at24)
    expect(second.sel.linkDay?.own).toEqual({ periodo: 'today', de: null, ate: null })
  })
  it('a store row under the summary\'s "Ontem" keeps the day the link\'s: the next chip and launch bring back "Hoje"', () => {
    const summary = resolveView(rawFromSearch(summaryUrl('2026-11-23').split('?')[1]), onToday, hib, at24)
    expect(summary.sel).toMatchObject({ loja: 'todas', periodo: 'yesterday' })
    const answer = { period: 'yesterday' as const, range: { from: '2026-11-23', to: '2026-11-23' }, anchorToday: '2026-11-24', generatedAt: '2026-11-24T12:00:00.000Z' }
    // MOKOO's row (same calendar as Todas): the store only.
    const mokoo = rowTapSelection(summary.sel, storeRowSelection({ id: 'mokoo', storeToday: '2026-11-24', timezone: 'America/Belem' }, answer))
    expect(mokoo).toMatchObject({ loja: 'mokoo', periodo: 'yesterday' })
    expect(JSON.parse(toStorage({ sel: mokoo, aba: null })).periodo).toBe('today')
    expect(chipSelection(mokoo, 'todas')).toEqual(todasToday)
    // Hibikura's row at 12h05 (Tokyo already on 25 nov): Todas' 23 nov as row
    // dates — and still the owner's "Hoje" behind them.
    const at12 = { ...answer, generatedAt: '2026-11-24T15:05:00.000Z' }
    const hibRow = rowTapSelection(summary.sel, storeRowSelection({ id: 'hib', storeToday: '2026-11-25', timezone: TOKYO }, at12))
    expect(hibRow).toMatchObject({ loja: 'hib', periodo: 'custom', de: '2026-11-23', ate: '2026-11-23', rowPreset: 'yesterday' })
    expect(chipReturnLabel(hibRow)).toBe('Hoje')
    expect(chipSelection(hibRow, 'todas')).toEqual(todasToday)
    expect(JSON.parse(toStorage({ sel: hibRow, aba: null })).periodo).toBe('today')
    expect(toSearch({ sel: hibRow, aba: null })).toBe('loja=hib&periodo=custom&de=2026-11-23&ate=2026-11-23&volta=yesterday&dia=2026-11-23')
    // A reload the same day keeps the row dates, still the link's.
    const clocks = [{ id: 'mokoo', timezone: 'America/Belem' }, { id: 'hib', timezone: TOKYO }]
    const reload = resolveView(rawFromSearch(toSearch({ sel: hibRow, aba: null })), rawFromStorage(toStorage({ sel: hibRow, aba: null })), hib, at24,
      todasRangeAt(clocks, new Date('2026-11-24T15:10:00Z')))
    expect(reload.sel).toMatchObject({ loja: 'hib', periodo: 'custom', de: '2026-11-23', rowPreset: 'yesterday' })
    expect(reload.sel.linkDay?.own).toEqual({ periodo: 'today', de: null, ate: null })
    // A period the owner picks drops both.
    expect(patchSelection(hibRow, { periodo: '7d', de: null, ate: null })).toEqual({ loja: 'hib', periodo: '7d', de: null, ate: null })
  })
  it('row dates and plain picks behave as before (no linkDay)', () => {
    expect(rowTapSelection(todasToday, { loja: 'mokoo' })).toEqual({ ...todasToday, loja: 'mokoo' })
    expect(rowTapSelection(todasToday, { loja: 'mokoo' }, at24)).toEqual({ ...todasToday, loja: 'mokoo' })
    expect(chipReturnLabel(todasToday)).toBeNull()
  })
})

// ─── A store row hands a notification's period to the store's own clock ─────
// Regression: the summary of 24 nov opened in the morning of 25 nov, then the
// Hibikura row. At 12h in Brasília (Tokyo's midnight) "Ontem" rolled to Tokyo's
// 25 nov under a strip that still named 24 nov; a reload jumped back to 24 nov.
describe('store row under a notification\'s period (linkDay re-anchored)', () => {
  const hib = (id: string) => id === 'hib' || known(id)
  const todayAt = (tokyo: string, brasilia: string) => (loja: string) => (loja === 'hib' ? tokyo : brasilia)
  const week = rawFromStorage(JSON.stringify({ loja: 'todas', periodo: '7d', de: null, ate: null, aba: null }))
  const morning = todayAt('2026-11-25', '2026-11-25') // 09h in Brasília, 21h in Tokyo
  const afterNoon = todayAt('2026-11-26', '2026-11-25') // 12h30 in Brasília, 00h30 in Tokyo
  const summary = resolveView(rawFromSearch(summaryUrl('2026-11-24').split('?')[1]), week, hib, morning)
  const answer = { period: 'yesterday' as const, range: { from: '2026-11-24', to: '2026-11-24' }, anchorToday: '2026-11-25', generatedAt: '2026-11-25T12:00:00.000Z' }
  const hibRow = rowTapSelection(summary.sel, storeRowSelection({ id: 'hib', storeToday: '2026-11-25', timezone: TOKYO }, answer), morning)

  it('opens Hibikura · Ontem, the link\'s, now read on Tokyo\'s calendar', () => {
    expect(summary.sel).toMatchObject({ loja: 'todas', periodo: 'yesterday', linkDay: { on: { loja: 'todas', today: '2026-11-25' } } })
    expect(hibRow).toMatchObject({ loja: 'hib', periodo: 'yesterday', de: null, ate: null })
    expect(hibRow.linkDay).toEqual({ dia: '2026-11-24', own: { periodo: '7d', de: null, ate: null }, on: { loja: 'hib', today: '2026-11-25' } })
    expect(linkDayNotice(hibRow, '2026-11-25')).toBe('A notificação era sobre 24 nov: mostrando esse dia (Ontem), não o de hoje. Os botões de loja no alto voltam para “Últimos 7 dias”.')
  })
  it('at Tokyo\'s midnight the owner\'s own period comes back instead of rolling under the strip', () => {
    expect(expireLinkDay(hibRow, morning)).toBe(hibRow)
    expect(expireLinkDay(hibRow, afterNoon)).toEqual({ loja: 'hib', periodo: '7d', de: null, ate: null })
    // Before the clock tick catches it, the strip never calls Tokyo's 25 nov "esse dia".
    expect(linkDayNotice(hibRow, '2026-11-26')).toBeNull()
  })
  it('the screen and a reload of its URL agree', () => {
    const url = toSearch({ sel: hibRow, aba: null })
    expect(url).toBe('loja=hib&periodo=today&dia=2026-11-24')
    expect(resolveView(rawFromSearch(url), rawFromStorage(toStorage({ sel: hibRow, aba: null })), hib, morning).sel).toEqual(hibRow)
  })
  it('a store on Todas\' calendar (MOKOO) expires with it, at midnight in Brasília', () => {
    const mokoo = rowTapSelection(summary.sel, storeRowSelection({ id: 'mokoo', storeToday: '2026-11-25', timezone: 'America/Belem' }, answer), morning)
    expect(mokoo.linkDay?.on).toEqual({ loja: 'mokoo', today: '2026-11-25' })
    expect(expireLinkDay(mokoo, afterNoon)).toBe(mokoo)
    expect(expireLinkDay(mokoo, todayAt('2026-11-27', '2026-11-26'))).toEqual({ loja: 'mokoo', periodo: '7d', de: null, ate: null })
  })
  it('row dates (Hibikura after noon) stay on Todas\' calendar, as a reload reads them', () => {
    const at13 = { ...answer, generatedAt: '2026-11-25T16:00:00.000Z' }
    const dates = rowTapSelection(summary.sel, storeRowSelection({ id: 'hib', storeToday: '2026-11-26', timezone: TOKYO }, at13), afterNoon)
    expect(dates).toMatchObject({ loja: 'hib', periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', rowPreset: 'yesterday' })
    expect(dates.linkDay?.on).toEqual({ loja: 'todas', today: '2026-11-25' })
  })
  it('a strip the owner closed stays closed through a store row (one key per notification, not per store)', () => {
    expect(linkDayKey(summary.sel)).not.toBeNull()
    expect(linkDayKey(hibRow)).toBe(linkDayKey(summary.sel))
    // Another notification is another key.
    const other = resolveView(rawFromSearch(summaryUrl('2026-11-23').split('?')[1]), week, hib, morning)
    expect(linkDayKey(other.sel)).not.toBe(linkDayKey(summary.sel))
    expect(linkDayKey(todasRowless)).toBeNull()
  })
})
const todasRowless: Selection = { loja: 'todas', periodo: 'today', de: null, ate: null }

// ─── The scale push's "7 dias" and Campanhas are the link's ───────────────────
// Regression: the scale/cut push (periodo=7d, aba=campanhas, no dia) was taken
// for the owner's choice: saved, kept by the chips, reopened on every launch.
describe('scale push: its period and tab are the link\'s', () => {
  const ids = (id: string) => id === 'glooty' || known(id)
  const at24 = () => '2026-11-24'
  const onToday = rawFromStorage(JSON.stringify({ loja: 'mokoo', periodo: 'today', de: null, ate: null, aba: null }))
  const url = rawFromSearch(storeUrl('glooty', { tab: 'campanhas', periodo: '7d', dia: '2026-11-24' }).split('?')[1])
  const v = resolveView(url, onToday, ids, at24)

  it('opens Glooty · 7 dias with Campanhas, marked as the link\'s', () => {
    expect(v.sel).toEqual({
      loja: 'glooty', periodo: '7d', de: null, ate: null,
      linkDay: { dia: '2026-11-24', own: { periodo: 'today', de: null, ate: null }, on: { loja: 'glooty', today: '2026-11-24' }, asked: '7d' },
    })
    expect(v.aba).toBe('campanhas')
    expect(v.ownAba).toBeNull()
    expect(linkDayNotice(v.sel, '2026-11-24')).toBe('A notificação abriu “Últimos 7 dias”. Os botões de loja no alto voltam para “Hoje”.')
  })
  it('storage keeps the owner\'s Hoje and no tab; the next launch opens them', () => {
    expect(JSON.parse(toStorage(v))).toEqual({ loja: 'glooty', periodo: 'today', de: null, ate: null, aba: null })
    const reopen = resolveView(rawFromSearch(''), rawFromStorage(toStorage(v)), ids, at24)
    expect(reopen).toEqual({ sel: { loja: 'glooty', periodo: 'today', de: null, ate: null }, aba: null })
  })
  it('a store button brings back the owner\'s period and tab', () => {
    expect(chipView(v, 'mokoo')).toEqual({ sel: { loja: 'mokoo', periodo: 'today', de: null, ate: null }, aba: null })
    // Links inside the screen keep the tab (chipSelection alone).
    expect(chipSelection(v.sel, 'mokoo')).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null })
  })
  it('its URL stays the link: a reload the same day opens the same view, still the link\'s', () => {
    expect(toSearch(v)).toBe('loja=glooty&periodo=7d&dia=2026-11-24&aba=campanhas')
    expect(resolveView(rawFromSearch(toSearch(v)), rawFromStorage(toStorage(v)), ids, at24)).toEqual(v)
  })
  it('the next day the owner\'s period comes back by itself', () => {
    expect(expireLinkDay(v.sel, () => '2026-11-25')).toEqual({ loja: 'glooty', periodo: 'today', de: null, ate: null })
  })
  it('over the owner\'s own "7 dias": no period marker, and the tab still is not stored', () => {
    const onWeek = rawFromStorage(JSON.stringify({ loja: 'mokoo', periodo: '7d', de: null, ate: null, aba: 'paises' }))
    const w = resolveView(url, onWeek, ids, at24)
    expect(w.sel).toEqual({ loja: 'glooty', periodo: '7d', de: null, ate: null })
    expect(w).toMatchObject({ aba: 'campanhas', ownAba: 'paises' })
    expect(JSON.parse(toStorage(w)).aba).toBe('paises')
    expect(chipView(w, 'todas')).toEqual({ sel: { loja: 'todas', periodo: '7d', de: null, ate: null }, aba: 'paises' })
    // Already on Campanhas: nothing to keep apart.
    const onCamp = rawFromStorage(JSON.stringify({ loja: 'mokoo', periodo: '7d', de: null, ate: null, aba: 'campanhas' }))
    expect(resolveView(url, onCamp, ids, at24).ownAba).toBeUndefined()
  })
  it('a plain link with a tab (no dia) is still the owner\'s choice', () => {
    const plain = resolveView(rawFromSearch('loja=glooty&periodo=7d&aba=campanhas'), onToday, ids, at24)
    expect(plain).toEqual({ sel: { loja: 'glooty', periodo: '7d', de: null, ate: null }, aba: 'campanhas' })
  })
})

// ─── The period bar's last button names a chosen period readably ──────────────
describe('periodButtonLabel', () => {
  const today = '2026-11-24'
  it('presets keep their short name; dates within a month keep "3–12 nov"', () => {
    expect(periodButtonLabel({ periodo: 'lastmonth', de: null, ate: null })).toBe('Mês passado')
    expect(periodButtonLabel({ periodo: 'custom', de: '2026-11-03', ate: '2026-11-12' })).toBe('3–12 nov')
    expect(periodButtonLabel({ periodo: 'custom', de: '2026-11-23', ate: '2026-11-23' })).toBe('23 nov')
    expect(periodButtonYear({ periodo: 'custom', de: '2026-11-03', ate: '2026-11-12' }, null, today)).toBeNull()
    expect(periodButtonYear({ periodo: 'lastmonth', de: null, ate: null }, null, today)).toBeNull()
  })
  it('across months the compact form; the title keeps the full range', () => {
    const custom = { periodo: 'custom' as const, de: '2026-10-25', ate: '2026-11-23' }
    expect(periodButtonLabel(custom)).toBe('25/10–23/11')
    expect(periodButtonFull(custom, null, today)).toBe('25 out – 23 nov')
    // The answer's dates win over the selection's when they are on screen.
    expect(periodButtonLabel(custom, { from: '2026-10-26', to: '2026-11-23' })).toBe('26/10–23/11')
  })
  it('another year: the dates as compact as this year\'s ("25/12–3/1" fits 390 px), the year on its own line', () => {
    const newYear = { periodo: 'custom' as const, de: '2025-12-25', ate: '2026-01-03' }
    expect(periodButtonLabel(newYear)).toBe('25/12–3/1')
    expect(periodButtonYear(newYear, null, today)).toBe('2025–26')
    expect(periodButtonFull(newYear, null, today)).toBe('25 dez 2025 – 3 jan 2026')
    const lastNov = { periodo: 'custom' as const, de: '2025-11-03', ate: '2025-11-12' }
    expect(periodButtonLabel(lastNov)).toBe('3–12 nov')
    expect(periodButtonYear(lastNov, null, today)).toBe('2025')
    expect(periodButtonLabel({ periodo: 'custom', de: '2025-10-25', ate: '2025-11-23' })).toBe('25/10–23/11')
    // Next January, a range across New Year.
    expect(periodButtonYear({ periodo: 'custom', de: '2026-12-25', ate: '2027-01-03' }, null, '2027-01-05')).toBe('2026–27')
  })
})

// ─── Store rows of "Todas" open what they showed ──────────────────────────────
describe('storeRowSelection', () => {
  const today = { period: 'today' as const, range: { from: '2026-11-18', to: '2026-11-18' }, anchorToday: '2026-11-18', generatedAt: AT_18 }
  it('a store already on another date (Hibikura from 12h in Brasília) opens the dates of its row, with the preset', () => {
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19', timezone: TOKYO }, today))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-18', ate: '2026-11-18', rowPreset: 'today' })
    const week = { period: '7d' as const, range: { from: '2026-11-11', to: '2026-11-17' }, anchorToday: '2026-11-18', generatedAt: AT_18 }
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19', timezone: TOKYO }, week))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-11', ate: '2026-11-17', rowPreset: '7d' })
  })
  it('a store on the same date keeps the period; a custom period is already the same dates', () => {
    expect(storeRowSelection({ id: 'mokoo', storeToday: '2026-11-18', timezone: 'America/Belem' }, today)).toEqual({ loja: 'mokoo' })
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19', timezone: TOKYO }, { ...today, period: 'custom' })).toEqual({ loja: 'hib' })
  })
  it('"Mês passado" names the same month on Tokyo\'s clock: the row keeps the preset, no fixed dates', () => {
    const lastmonth = { period: 'lastmonth' as const, range: { from: '2026-10-01', to: '2026-10-31' }, anchorToday: '2026-11-23', generatedAt: AT_23 }
    const row = { id: 'hib', storeToday: '2026-11-24', timezone: TOKYO }
    expect(rowOpensDates(row, lastmonth)).toBe(false)
    expect(storeRowSelection(row, lastmonth)).toEqual({ loja: 'hib' })
    // On the 1st in Tokyo (31 out in Brasília) the months differ: dates again.
    const onFirst = { ...lastmonth, range: { from: '2026-09-01', to: '2026-09-30' }, anchorToday: '2026-10-31', generatedAt: '2026-10-31T16:00:00.000Z' }
    expect(storeRowSelection({ ...row, storeToday: '2026-11-01' }, onFirst))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-09-01', ate: '2026-09-30', rowPreset: 'lastmonth' })
  })
  it('"Este mês" row dates are compared by the preset\'s rule (compare=mtd), and that is part of the key', () => {
    const mtd = { period: 'mtd' as const, range: { from: '2026-11-01', to: '2026-11-23' }, anchorToday: '2026-11-23', generatedAt: AT_23 }
    const patch = storeRowSelection({ id: 'hib', storeToday: '2026-11-24', timezone: TOKYO }, mtd)
    expect(patch).toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-01', ate: '2026-11-23', rowPreset: 'mtd' })
    const sel = patchSelection({ loja: 'todas', periodo: 'mtd', de: null, ate: null }, patch)
    expect(compareAsOf(sel)).toBe('mtd')
    expect(new URLSearchParams(apiQuery(sel)).get('compare')).toBe('mtd')
    const picked: Selection = { loja: 'hib', periodo: 'custom', de: '2026-11-01', ate: '2026-11-23' }
    expect(selectionKey(sel)).not.toBe(selectionKey(picked))
    expect(new URLSearchParams(apiQuery(picked)).get('compare')).toBeNull()
    // "7 dias" row dates: the custom rule already is the preset's.
    expect(compareAsOf({ periodo: 'custom', rowPreset: '7d' })).toBeNull()
  })
  it('the custom dates survive the clamp to the store\'s own today', () => {
    const patch = storeRowSelection({ id: 'hib', storeToday: '2026-11-19', timezone: TOKYO }, today)
    const sel = { loja: 'todas', periodo: 'today', de: null, ate: null, ...patch } as Selection
    expect(clampSelection(sel, '2026-11-19')).toBe(sel)
  })
})

// ─── Row dates belong to the store a row opened, not to the owner's period ────
describe('row dates (rowPreset)', () => {
  const todas: Selection = { loja: 'todas', periodo: 'today', de: null, ate: null }
  const answer = { period: 'today' as const, range: { from: '2026-11-23', to: '2026-11-23' }, anchorToday: '2026-11-23', generatedAt: AT_23 }
  const hib = patchSelection(todas, storeRowSelection({ id: 'hib', storeToday: '2026-11-24', timezone: TOKYO }, answer))
  // Todas' calendar (Brasília) at 13h on 23 nov, and after midnight.
  const clocks = [{ id: 'mokoo', timezone: 'America/Belem' }, { id: 'hib', timezone: 'Asia/Tokyo' }]
  const at13h = todasRangeAt(clocks, new Date('2026-11-23T16:00:00Z'))
  const at0h30 = todasRangeAt(clocks, new Date('2026-11-24T03:30:00Z'))

  it('Todas · Hoje → Hibikura row → Todas chip lands back on Todas · Hoje (and on MOKOO · Hoje)', () => {
    expect(hib).toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-23', ate: '2026-11-23', rowPreset: 'today' })
    expect(chipSelection(hib, 'todas')).toEqual(todas)
    expect(chipSelection(hib, 'mokoo')).toEqual({ loja: 'mokoo', periodo: 'today', de: null, ate: null })
    // The same store's chip too: Hibikura on its own clock.
    expect(chipSelection(hib, 'hib')).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
    // From "7 dias" and "Este mês" as well: the preset, not the frozen dates.
    const week = patchSelection({ ...todas, periodo: '7d' }, storeRowSelection({ id: 'hib', storeToday: '2026-11-24', timezone: TOKYO },
      { period: '7d', range: { from: '2026-11-16', to: '2026-11-22' }, anchorToday: '2026-11-23', generatedAt: AT_23 }))
    expect(chipSelection(week, 'todas')).toEqual({ ...todas, periodo: '7d' })
  })
  it('a chip without row dates keeps the period as before, custom dates the owner picked included', () => {
    const picked: Selection = { loja: 'hib', periodo: 'custom', de: '2026-11-01', ate: '2026-11-05' }
    expect(chipSelection(picked, 'todas')).toEqual({ ...picked, loja: 'todas' })
    expect(chipSelection({ ...todas, periodo: '30d' }, 'mokoo')).toEqual({ loja: 'mokoo', periodo: '30d', de: null, ate: null })
  })
  it('a period the owner picks replaces row dates; only a row patch brings new ones', () => {
    expect(patchSelection(hib, { periodo: 'yesterday', de: null, ate: null })).toEqual({ loja: 'hib', periodo: 'yesterday', de: null, ate: null })
    expect(patchSelection(hib, { periodo: 'custom', de: '2026-11-20', ate: '2026-11-23' }))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-20', ate: '2026-11-23' })
  })
  it('storage keeps the preset, never the row dates: a reopen opens "Hoje"', () => {
    const v = { sel: hib, aba: null }
    expect(JSON.parse(toStorage(v))).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null, aba: null })
    expect(resolveView({}, rawFromStorage(toStorage(v)), id => id === 'hib').sel).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
  })
  it('the URL keeps the dates with their preset; a reload the same day keeps them, the next day goes back to the preset', () => {
    const v = { sel: hib, aba: null }
    expect(toSearch(v)).toBe('loja=hib&periodo=custom&de=2026-11-23&ate=2026-11-23&volta=today')
    const known = (id: string) => id === 'hib'
    expect(resolveView(rawFromSearch(toSearch(v)), {}, known, undefined, at13h).sel).toEqual(hib)
    expect(resolveView(rawFromSearch(toSearch(v)), {}, known, undefined, at0h30).sel).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
    // Row dates are one store's: on Todas they are the preset.
    expect(resolveView(rawFromSearch('loja=todas&periodo=custom&de=2026-11-23&ate=2026-11-23&volta=today'), {}, known).sel).toEqual(todas)
    // A bogus volta is ignored: plain custom dates.
    expect(resolveView(rawFromSearch('loja=hib&periodo=custom&de=2026-11-23&ate=2026-11-23&volta=forever'), {}, known).sel)
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-23', ate: '2026-11-23' })
  })
  it('an open app rolls to the new day: after midnight the row dates give way to "Hoje"', () => {
    expect(expireRowDates(hib, at13h)).toBe(hib)
    expect(expireRowDates(hib, at0h30)).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
    const plain: Selection = { loja: 'hib', periodo: 'custom', de: '2026-11-23', ate: '2026-11-23' }
    expect(expireRowDates(plain, at0h30)).toBe(plain)
    // Moved to Todas some other way (a store gone 404 → Todas): the preset.
    expect(expireRowDates({ ...hib, loja: 'todas' }, at13h)).toEqual(todas)
  })
  it('row dates a store cannot read as they are go back to the preset, not to a cut range', () => {
    expect(clampSelection({ ...hib, de: '2026-11-25', ate: '2026-11-25' }, '2026-11-24')).toEqual({ loja: 'hib', periodo: 'today', de: null, ate: null })
  })
})

// ─── A link to a store that does not exist says so ────────────────────────────
describe('unknownLinkStore', () => {
  it('names a store the owner cannot open; Todas, empty and known ones are fine', () => {
    expect(unknownLinkStore(rawFromSearch('?loja=bogus&aba=foo'), known)).toBe('bogus')
    expect(unknownLinkStore(rawFromSearch('?loja=mokoo'), known)).toBeNull()
    expect(unknownLinkStore(rawFromSearch('?loja=todas'), known)).toBeNull()
    expect(unknownLinkStore(rawFromSearch('?loja='), known)).toBeNull()
    expect(unknownLinkStore(rawFromSearch(''), known)).toBeNull()
  })
})

// ─── Campanhas: the judged windows, without nested parentheses ────────────────
describe('judgedWindowsText', () => {
  it('one window in parentheses; several after a colon, each with its stores', () => {
    expect(judgedWindowsText([{ label: '17–23 nov', stores: ['MOKOO'] }]))
      .toBe('A ação é julgada nos últimos 7 dias fechados (17–23 nov); o dinheiro, no período escolhido.')
    expect(judgedWindowsText([{ label: '17–23 nov', stores: ['MOKOO', 'EPOCH ®️'] }, { label: '18–24 nov', stores: ['Hibikura'] }]))
      .toBe('A ação é julgada nos últimos 7 dias fechados: 17–23 nov (MOKOO, EPOCH ®️) e 18–24 nov (Hibikura); o dinheiro, no período escolhido.')
    expect(judgedWindowsText([])).toBe('A ação é julgada nos últimos 7 dias fechados; o dinheiro, no período escolhido.')
  })
})

// ─── Países: stores without costs out of the per-country sum, in visible text ─
describe('countriesLeftOutLine', () => {
  it('names the stores and their sales, as the desktop "Fora da soma por país"', () => {
    expect(countriesLeftOutLine([{ store: 'Glooty', revenue: 1118, metaSpend: 2925 }]))
      .toBe('Fora da soma por país: Glooty ($1.118 em vendas) — sem custos configurados, então não há contribuição por país para somar.')
    expect(countriesLeftOutLine([{ store: 'Glooty', revenue: 0, metaSpend: 80 }]))
      .toBe('Sem o gasto no Meta de Glooty ($80,00): sem custos configurados.')
    expect(countriesLeftOutLine([])).toBeNull()
  })
})

// ─── Países: what Meta's side has ─────────────────────────────────────────────
describe('countriesMetaSide', () => {
  const row = (spend: number, purchases: number) => ({ meta: { spend, purchases } })
  it('"none" when the window has no Meta spend and no attributed purchase', () => {
    expect(countriesMetaSide({ meta: { totalSpend: 0, coveredSpend: 0 }, countries: [row(0, 0), row(0, 0)] })).toBe('none')
    expect(countriesMetaSide({ meta: { totalSpend: 0, coveredSpend: 0 }, countries: [] })).toBe('none')
  })
  it('"no_split" when Meta spent but split none of it by country (MOKOO, 0% covered)', () => {
    expect(countriesMetaSide({ meta: { totalSpend: 6597.35, coveredSpend: 0 }, countries: [row(0, 0), row(0, 0)] })).toBe('no_split')
  })
  it('"split" as soon as one country carries a Meta line', () => {
    expect(countriesMetaSide({ meta: { totalSpend: 12.5, coveredSpend: 12.5 }, countries: [row(12.5, 0)] })).toBe('split')
    expect(countriesMetaSide({ meta: { totalSpend: 0, coveredSpend: 0 }, countries: [row(0, 1)] })).toBe('split')
  })
})

// ─── Campanhas / Criativos of a store selling on another store's ads ─────────
describe('adsElsewhere', () => {
  const shared: SharedAds = {
    pairs: [{ adStoreId: 'epoch', adStoreName: 'EPOCH ®️', salesStoreId: 'camp', salesStoreName: 'CAMP HALLOW', orders: 445, revenue: 20000 }],
    badges: {}, lookbackDays: 90,
  }
  it('points CAMP HALLOW at EPOCH, and nobody else anywhere', () => {
    const e = adsElsewhere(shared, 'camp', 'campanhas')
    expect(e).toMatchObject({ adStoreId: 'epoch', title: 'Os anúncios da CAMP HALLOW rodam na conta da EPOCH ®️' })
    expect(e?.body).toMatch(/^As campanhas e o gasto estão na EPOCH ®️\. Nos últimos 90 dias, 445 pedidos da CAMP HALLOW/)
    expect(adsElsewhere(shared, 'camp', 'anuncios')?.body).toMatch(/^Os anúncios e o gasto/)
    expect(adsElsewhere(shared, 'epoch', 'campanhas')).toBeNull()
    expect(adsElsewhere(NO_SHARED_ADS, 'camp', 'campanhas')).toBeNull()
  })
})

// ─── A link's custom range cut before asking (regression: cut in silence) ────
describe('linkRangeNotice', () => {
  const known2 = (id: string) => id === 'user_3CV'
  const today = '2026-11-24'
  const open = (search: string) => {
    const url = rawFromSearch(search)
    const v = resolveView(url, {}, known2, () => today)
    return { sel: v.sel, note: linkRangeNotice(url, v.sel, today) }
  }

  it('1 jan 2024 – 30 dez 2026: says it shows the last 366 days, up to today', () => {
    const { sel, note } = open('?loja=user_3CV&periodo=custom&de=2024-01-01&ate=2026-12-30')
    expect(sel).toMatchObject({ periodo: 'custom', de: '2025-11-24', ate: '2026-11-24' })
    expect(note).toBe('O link pedia 1 jan 2024 – 30 dez 2026. Mostrando 24 nov 2025 – 24 nov 2026: só os últimos 366 dias (o máximo de uma vez) e até hoje (o resto ainda não aconteceu).')
  })
  it('an end in the future alone, a start before 2000, a start after today', () => {
    expect(open('?loja=user_3CV&periodo=custom&de=2026-11-20&ate=2026-11-30').note)
      .toBe('O link pedia 20–30 nov. Mostrando 20–24 nov: até hoje (o resto ainda não aconteceu).')
    expect(open('?loja=user_3CV&periodo=custom&de=1999-12-01&ate=2000-03-01').note)
      .toBe('O link pedia 1 dez 1999 – 1 mar 2000. Mostrando 1 jan – 1 mar 2000: a partir de 1 jan 2000 (nada antes disso entra).')
    const later = open('?loja=user_3CV&periodo=custom&de=2026-11-26&ate=2026-11-30')
    expect(later.sel.periodo).toBe('today')
    expect(later.note).toBe('As datas do link (26–30 nov) ainda não chegaram: mostrando Hoje.')
  })
  it('nothing to say: a range used as asked, a preset, no URL period, row dates', () => {
    expect(open('?loja=user_3CV&periodo=custom&de=2026-11-10&ate=2026-11-16').note).toBeNull()
    expect(open('?loja=user_3CV&periodo=7d').note).toBeNull()
    expect(open('?loja=user_3CV').note).toBeNull()
    expect(open('?loja=user_3CV&periodo=custom&de=2026-11-20&ate=2026-11-30&volta=today').note).toBeNull()
  })
})

// ─── Vendas ao vivo: "em segundos" only where it is true (regression) ────────
describe('liveFeedSpeed', () => {
  const noLive = [{ storeId: 'hib', name: 'Hibikura' }, { storeId: 'camp', name: 'CAMP HALLOW' }]
  it('a store without the live feed alone: sales arrive with the sync, no footer repeating it', () => {
    expect(liveFeedSpeed([{ id: 'hib' }], noLive)).toEqual({
      howTo: 'Cada venda nova aparece com a sincronização, até 10 minutos depois: esta loja não avisa vendas na hora.',
      footer: null,
    })
  })
  it('a store with the feed: "em segundos"', () => {
    expect(liveFeedSpeed([{ id: 'mokoo' }], noLive)).toEqual({ howTo: 'Cada venda nova aparece em segundos.', footer: null })
  })
  it('Todas: the claim leaves out the stores the footer names', () => {
    expect(liveFeedSpeed([{ id: 'mokoo' }, { id: 'hib' }, { id: 'camp' }], noLive)).toEqual({
      howTo: 'Cada venda nova aparece em segundos, menos as das lojas citadas abaixo.',
      footer: 'Hibikura e CAMP HALLOW não avisam vendas na hora: os pedidos aparecem com a sincronização, até 10 minutos depois.',
    })
  })
})

// ─── Campanhas of a store selling through Shop Campaigns (regression) ────────
describe('Campanhas: Shopify ads beside the Meta list', () => {
  it('names the Shopify spend the list leaves out, per store with several', () => {
    expect(shopAdsLine(5301.63, [{ store: 'Dumpling Squishy · 8jcp3a', shopSpend: 5301.63 }], false))
      .toBe('Mais $5.302 em Anúncios Shopify (Shop Campaigns), fora desta lista. Entram no lucro da loja; a lista é só das campanhas do Meta.')
    expect(shopAdsLine(5527.93, [{ store: 'MOKOO', shopSpend: 226.3 }, { store: 'Dumpling Squishy · 8jcp3a', shopSpend: 5301.63 }, { store: 'EPOCH', shopSpend: 0 }], true))
      .toBe('Mais $5.528 em Anúncios Shopify (Shop Campaigns), fora desta lista: Dumpling Squishy · 8jcp3a $5.302, MOKOO $226. Entram no lucro da loja; a lista é só das campanhas do Meta.')
    expect(shopAdsLine(0, [], true)).toBeNull()
  })
  it('the Meta-vs-store gap only for stores whose ads run on Meta', () => {
    const notes = [
      { store: 'Dumpling Squishy · 8jcp3a', metaVsStoreRevenueGap: -92.7, shopSpend: 5301.63, adChannel: 'shop' as const },
      { store: 'Misto', metaVsStoreRevenueGap: -60, shopSpend: 800, adChannel: 'both' as const },
      { store: 'MOKOO', metaVsStoreRevenueGap: -38.6, shopSpend: 226.3, adChannel: 'meta' as const },
      { store: 'EPOCH', metaVsStoreRevenueGap: -22.8, shopSpend: 0, adChannel: 'meta' as const },
      { store: 'Hibikura', metaVsStoreRevenueGap: -4.4, shopSpend: 0, adChannel: 'meta' as const },
    ]
    expect(campaignGapNotes(notes)).toEqual([
      'MOKOO: o Meta credita 39% menos vendas do que a loja registrou (o resto: Anúncios Shopify, com $226 de gasto no período; orgânico, e-mail, recompra ou venda que o pixel não viu).',
      'EPOCH: o Meta credita 23% menos vendas do que a loja registrou.',
    ])
  })
})
