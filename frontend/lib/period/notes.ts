/**
 * The notes catalogue (spec §4): one text per adjustment, the same words on
 * the desktop (header chip + line) and on the phone (strip). Every value in a
 * note was validated and formatted by lib/period before it got here; nothing
 * from a URL is echoed raw (R15).
 */

import type { Note, NoteCode } from './types'

const s = (n: Note, k: string): string => String(n.params?.[k] ?? '')

/** The text of one note. */
export function noteText(n: Note): string {
  switch (n.code) {
    case 'future_start':
      return `${s(n, 'asked')} ainda não começou em ${s(n, 'city')}: mostrando Hoje (${s(n, 'today')}).`
    case 'future_end':
      return `Até hoje, ${s(n, 'today')}: o resto ainda não aconteceu.`
    case 'floor':
      return 'Não há dados antes de 2000: mostrando a partir de 1 jan 2000.'
    case 'too_early':
      return 'Não há dados antes de 2000: o período do link foi ignorado.'
    case 'too_long':
      return `Mostrando os últimos 366 dias (${s(n, 'range')}): o máximo por página.`
    case 'archived_clamp':
      return `A ${s(n, 'store')} foi arquivada em ${s(n, 'day')} às ${s(n, 'time')} e não sincroniza mais: não há dados depois disso.`
    case 'archived_frozen':
      return `Sem dados de ${s(n, 'range')}: a ${s(n, 'store')} está arquivada desde ${s(n, 'day')}.`
    case 'starts_inside':
      return `A ${s(n, 'store')} começou em ${s(n, 'day')}: o período tem ${s(n, 'n')} ${Number(n.params?.n) === 1 ? 'dia' : 'dias'} antes disso.`
    case 'partial_base':
      return `Base incompleta: a ${s(n, 'store')} começou em ${s(n, 'day')}.`
    case 'unknown_store':
      return `A loja do link não está disponível. Mostrando ${s(n, 'saved')}.`
    case 'bad_param':
      return `O período do link não existe: mostrando ${s(n, 'period')}.`
    case 'incomplete':
      return `O período do link não tinha as duas datas: mostrando ${s(n, 'period')}.`
    case 'saved_store_gone':
      return `${s(n, 'store')} não está mais disponível. Mostrando Todas.`
    case 'remembered_gone':
      return n.params?.store
        ? `A loja lembrada (${s(n, 'store')}) não está mais disponível: mostrando ${s(n, 'other')}.`
        : `A loja lembrada não está mais disponível: mostrando ${s(n, 'other')}.`
    case 'single_store':
      return `Só há uma loja ativa: mostrando a ${s(n, 'store')}.`
    case 'scope_dates_differ':
      return s(n, 'text')
    case 'left_archive':
      return `O período da consulta da loja arquivada não vale aqui: mostrando ${s(n, 'period')}.`
    case 'members_changed':
      return 'A lista de lojas ativas mudou desde a notificação: o total pode ser diferente do que ela dizia.'
    case 'stores_changed':
      return `A lista de lojas mudou: ${s(n, 'change')}.`
    case 'legacy_push_undated':
      return `Notificação antiga, sem data: mostrando o seu período (${s(n, 'period')}).`
    case 'turn_deferred':
      return `O dia virou: estes números são de ${s(n, 'label')}.`
  }
}

/** Codes that describe how the window was fitted (R9). */
const FIT: readonly NoteCode[] = ['future_end', 'too_long', 'floor']

/**
 * Several notes as one text, each day said once (R9 example 1): two or more
 * fit notes combine into "Período ajustado: as datas iam até 30 dez 2026, que
 * ainda não aconteceu, e passavam de 366 dias. Mostrando 30 dez 2025 –
 * 24 nov 2026." Fit notes carry `window` (the range shown) and future_end
 * carries `askedEnd`.
 */
export function notesText(input: readonly Note[]): string {
  const notes = withoutAbsorbed(input)
  const fit = notes.filter(n => FIT.includes(n.code))
  const rest = notes.filter(n => !FIT.includes(n.code))
  const parts: string[] = []
  if (fit.length >= 2) {
    const reasons: string[] = []
    const end = fit.find(n => n.code === 'future_end')
    if (end) reasons.push(`as datas iam até ${s(end, 'askedEnd')}, que ainda não aconteceu`)
    if (fit.some(n => n.code === 'too_long')) reasons.push(`${end ? '' : 'as datas '}passavam de 366 dias`)
    if (fit.some(n => n.code === 'floor')) reasons.push(`${reasons.length ? '' : 'as datas '}começavam antes de 2000`)
    const window = fit.map(n => n.params?.window).find(Boolean)
    // "…, que ainda não aconteceu, e passavam de 366 dias" (R9 ex. 1): the
    // relative clause closes with its comma before the "e".
    const and = end ? ', e ' : ' e '
    const joined = reasons.length > 1 ? `${reasons.slice(0, -1).join(', ')}${and}${reasons[reasons.length - 1]}` : reasons[0]
    parts.push(`Período ajustado: ${joined}.${window ? ` Mostrando ${window}.` : ''}`)
  } else {
    parts.push(...fit.map(noteText))
  }
  parts.push(...rest.map(noteText))
  return parts.join(' ')
}

/** Codes a note's text already says (scope_dates_differ params.absorbs:
 *  "future_end,future_start"), so several notes read as one sentence with no
 *  day said twice (§4). */
export function absorbedCodes(notes: readonly Note[]): Set<string> {
  return new Set(notes.flatMap(n => (typeof n.params?.absorbs === 'string' ? n.params.absorbs.split(',') : [])))
}

/** `notes` without the ones another note already says (absorbedCodes). */
export function withoutAbsorbed(notes: readonly Note[], also: readonly Note[] = []): Note[] {
  const gone = absorbedCodes([...notes, ...also])
  return gone.size ? notes.filter(n => !gone.has(n.code)) : [...notes]
}

/** Notes without repeats (same code and params). */
export function dedupeNotes(notes: readonly Note[]): Note[] {
  const seen = new Set<string>()
  return notes.filter(n => {
    const k = `${n.code}|${JSON.stringify(n.params ?? {})}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** One-shot `ajuste=` codes (R15): the codes a redirect carries so the landing
 *  page shows the note once. Only these may arrive by URL. */
export const URL_NOTE_CODES: readonly NoteCode[] = [
  'bad_param', 'incomplete', 'too_early', 'floor', 'too_long', 'remembered_gone', 'single_store',
]
