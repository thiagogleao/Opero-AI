import { describe, expect, it } from 'vitest'
import {
  apiQuery, chipSelection, clampSelection, clockDiffers, customRange, echoMatches, expireRowDates, patchSelection, rawFromSearch,
  linkRangeNotice, rawFromStorage, resolveView, selectionKey, selectionPeriodLabel, selectionTz, storeRowSelection, todasRangeAt, toSearch, toStorage,
  tzOffsetMinutes, unknownLinkStore, type Selection,
} from '../selection'
import { diffFeed, FRESH_SALE_MS, inScope } from '../feed'
import {
  afterFailedStatus, refreshOutcome, refreshProgress, skippedText, STATUS_GIVE_UP_MS, STATUS_MAX_FAILURES,
} from '../refreshProgress'
import { fitCustomRange, MAX_WINDOW_DAYS, rangeCutNote, resolvePortfolioWindow } from '@/lib/views/portfolioLimits'
import {
  alertDeliveryText, alertRowTitle, campaignChip, campaignGapNotes, countriesMetaSide, creativeChip, dueByLabel, feedLine, liveFeedSpeed, ptNumbers,
  pushBlockedText, shopAdsLine,
} from '../labels'
import { adSignalChip, ACTION_CHIP } from '@/components/campaigns/text'
import { signalLabel } from '@/lib/creativeSignal'
import { deliveryOf, storeUrl, SUMMARY_URL } from '@/lib/alerts'
import { bytesToBase64Url, sameServerKey, urlBase64ToUint8Array } from '../pushKeys'
import { adsElsewhere, NO_SHARED_ADS, noSpendLine, pairNotes, pairOrdersKnown, type SharedAds } from '../sharedAds'

const known = (id: string) => ['mokoo', 'epoch', 'squishy'].includes(id)

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
    expect(ptNumbers('$1,234.50 · $9.80 · 1.95x · 12.5% · -$40 · (-3%)')).toBe('$1.234,50 · $9,80 · 1,95x · 12,5% · −$40 · (−3%)')
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
    expect(resolveView(rawFromSearch(SUMMARY_URL.split('?')[1]), stored, known).sel).toEqual({ loja: 'todas', periodo: 'today', de: null, ate: null })
  })
})

// ─── Store rows of "Todas" open what they showed ──────────────────────────────
describe('storeRowSelection', () => {
  const today = { period: 'today' as const, range: { from: '2026-11-18', to: '2026-11-18' }, anchorToday: '2026-11-18' }
  it('a store already on another date (Hibikura from 12h in Brasília) opens the dates of its row, with the preset', () => {
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19' }, today))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-18', ate: '2026-11-18', rowPreset: 'today' })
    const week = { period: '7d' as const, range: { from: '2026-11-11', to: '2026-11-17' }, anchorToday: '2026-11-18' }
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19' }, week))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-11', ate: '2026-11-17', rowPreset: '7d' })
  })
  it('a store on the same date keeps the period; a custom period is already the same dates', () => {
    expect(storeRowSelection({ id: 'mokoo', storeToday: '2026-11-18' }, today)).toEqual({ loja: 'mokoo' })
    expect(storeRowSelection({ id: 'hib', storeToday: '2026-11-19' }, { ...today, period: 'custom' })).toEqual({ loja: 'hib' })
  })
  it('the custom dates survive the clamp to the store\'s own today', () => {
    const patch = storeRowSelection({ id: 'hib', storeToday: '2026-11-19' }, today)
    const sel = { loja: 'todas', periodo: 'today', de: null, ate: null, ...patch } as Selection
    expect(clampSelection(sel, '2026-11-19')).toBe(sel)
  })
})

// ─── Row dates belong to the store a row opened, not to the owner's period ────
describe('row dates (rowPreset)', () => {
  const todas: Selection = { loja: 'todas', periodo: 'today', de: null, ate: null }
  const answer = { period: 'today' as const, range: { from: '2026-11-23', to: '2026-11-23' }, anchorToday: '2026-11-23' }
  const hib = patchSelection(todas, storeRowSelection({ id: 'hib', storeToday: '2026-11-24' }, answer))
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
    const week = patchSelection({ ...todas, periodo: '7d' }, storeRowSelection({ id: 'hib', storeToday: '2026-11-24' },
      { period: '7d', range: { from: '2026-11-16', to: '2026-11-22' }, anchorToday: '2026-11-23' }))
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
