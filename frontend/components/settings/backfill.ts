/**
 * After an ad account is linked, ask the sync for its history from the date the
 * link route returned (backfillFrom, in the store's timezone). The answer is
 * reported as it is: a job started or queued, one already running, or the
 * sync refusing (this server does not collect, the store is archived…).
 */

import { callApi } from './messages'

interface RefreshJob { source: string; state: string; from: string | null; note?: string }

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** A sentence for the screen, never a claim that data arrived. */
export async function startBackfill(storeId: string, dateFrom: string, account?: string): Promise<string> {
  const r = await callApi<{ started: boolean; jobs: RefreshJob[] }>('/api/refresh', {
    method: 'POST',
    body: JSON.stringify({ storeId, sources: ['facebook'], dateFrom, ...(account ? { account } : {}) }),
  })
  if (!r.ok) return `A importação do histórico não começou: ${r.error}`
  const job = r.data?.jobs.find(j => j.source === 'facebook')
  if (!job) return 'A importação do histórico não começou.'
  switch (job.state) {
    case 'started': case 'queued': case 'merged':
      return `Importação do histórico desde ${ddmm(job.from ?? dateFrom)} iniciada; os números aparecem quando ela terminar.`
    case 'running':
      return 'Já havia uma coleta do Meta em andamento para esta loja; o histórico entra nela ou na próxima.'
    case 'fresh':
      return 'O Meta desta loja acabou de ser coletado.'
    default:
      return `A importação do histórico não começou${job.note ? `: ${job.note}` : '.'}`
  }
}
