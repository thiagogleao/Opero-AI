/**
 * "N erros nas últimas 24 h · …" under a connection's last collection, shared
 * by the Shopify block (server) and the ad-account rows (client).
 *
 * Known errors are said in Portuguese (lib/integrations/syncErrors); unknown
 * ones are quoted, cut short. Red only while the errors stand: when a later
 * collection of the same thing worked, the line turns grey and says so, so a
 * one-off 500 at 23h does not sit in red next to "funcionando" all next day.
 */

import { plural } from '@/lib/format'
import { shortError } from './messages'

export interface SyncErrors {
  errors24h: number
  lastError: string | null
  lastErrorText: string | null
  errorsResolved: boolean
}

export function SyncErrorsLine({ e, one, many }: { e: SyncErrors; one: string; many: string }) {
  if (e.errors24h <= 0) return null
  const several = e.errors24h > 1
  const what = e.lastErrorText
    ? <>{several ? 'último: ' : ''}{e.lastErrorText}</>
    : e.lastError ? <>último erro registrado: “{shortError(e.lastError)}”</> : null
  return (
    <span className={e.errorsResolved ? 'mut' : 'neg'}>
      {plural(e.errors24h, one, many)} nas últimas 24 h
      {e.errorsResolved ? `, ${several ? 'já superados' : 'já superado'} pela coleta seguinte` : ''}
      {what && <> · {what}</>}
    </span>
  )
}
