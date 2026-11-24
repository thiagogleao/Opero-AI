/**
 * Every AI failure the screen can show, in Portuguese, by code.
 *
 * The routes already send Portuguese text, but the screen decides the words
 * by the code (the server's `billing` text says "avise o administrador"; here
 * it names who can fix it). The server's own sentence is used only where it
 * carries something the code does not: the wait of a rate limit, the reason a
 * question was refused as too long.
 */

export type AiSurface = 'chat' | 'insights'

/** What the screen shows for one failure. */
export interface UiError {
  /** Stable key: the route's code, `http_<status>`, `network` or `cut`. */
  code: string
  title: string
  message: string
  /** Trying again can help (false: the period, the store or the session has to change first). */
  retry: boolean
}

export const BILLING_MESSAGE = 'A IA está sem crédito na Anthropic — avise o Thiago.'

interface Input {
  /** The route's error code (stream `error` event or JSON body `code`). */
  code?: string | null
  /** HTTP status when the route refused before streaming. */
  status?: number
  /** The route's own sentence (JSON `error` or event `message`). */
  serverMessage?: string | null
  /** Seconds until the per-viewer limit frees up (429). */
  retryAfter?: number | null
}

export function waitLabel(seconds: number): string {
  if (seconds >= 3600) return `em ${Math.ceil(seconds / 3600)} h`
  if (seconds >= 60) return `em ${Math.ceil(seconds / 60)} min`
  return `em ${Math.max(1, Math.ceil(seconds))} s`
}

export function describeAiError(input: Input, surface: AiSurface): UiError {
  const { code, status, serverMessage, retryAfter } = input
  const server = serverMessage?.trim() || null
  const e = (c: string, title: string, message: string, retry = true): UiError => ({ code: c, title, message, retry })

  switch (code) {
    case 'billing':
      return e('billing', 'IA sem crédito', BILLING_MESSAGE)
    case 'auth':
      return e('auth', 'Chave da IA recusada', 'A Anthropic recusou a chave da IA — avise o Thiago.')
    case 'overloaded':
      return e('overloaded', 'IA ocupada', 'A IA está ocupada agora. Tente de novo em 1 minuto.')
    case 'unavailable':
      return e('unavailable', 'IA fora do ar', 'Não consegui falar com a IA. Verifique a conexão e tente de novo.')
    case 'rate_limited': {
      // Our own per-viewer limit (HTTP 429 before the stream) says how long
      // to wait; Anthropic's limit (stream event) is a one-minute thing.
      if (status === 429) {
        const wait = retryAfter ? ` Tente de novo ${waitLabel(retryAfter)}.` : ''
        const what = surface === 'chat' ? 'perguntas ao Copiloto' : 'leituras da IA'
        return e('rate_limited', 'Limite atingido', server ?? `Você chegou ao limite de ${what}.${wait}`)
      }
      return e('rate_limited', 'IA sobrecarregada', 'A IA está recebendo pedidos demais agora. Tente de novo em 1 minuto.')
    }
    case 'bad_request':
      return surface === 'chat'
        ? e('bad_request', 'Pergunta recusada', 'A IA recusou este pedido. Tente reformular a pergunta.')
        : e('bad_request', 'Pedido recusado', 'A IA recusou o pedido de análise. Tente de novo; se continuar, avise o Thiago.')
    case 'refused':
      return e('refused', 'A IA não analisou', 'A IA não conseguiu analisar este período. Tente outro período ou mais tarde.')
    case 'truncated':
      return e('truncated', 'Análise cortada', 'A análise ficou longa demais e foi cortada. Tente um período menor.')
    case 'invalid_output':
      return e('invalid_output', 'Resposta fora do formato', 'A IA devolveu uma resposta fora do formato. Tente de novo.')
    case 'no_closed_days':
      return e('no_closed_days', 'Sem dias completos', 'A leitura usa só dias completos e este período ainda não tem nenhum. Escolha um período que termine ontem ou antes.', false)
    case 'no_data':
      return e('no_data', 'Nada para ler neste período', 'Não há vendas nem gasto em anúncios neste período nem no anterior: a IA não tem o que ler. Escolha outro período.', false)
    case 'aborted':
      return e('aborted', 'Interrompida', surface === 'insights'
        ? 'A análise em andamento foi interrompida. Tente de novo.'
        : 'A resposta foi interrompida. Tente de novo.')
    case 'internal':
      return e('internal', 'Algo deu errado', 'Algo deu errado ao consultar a IA. Tente de novo.')
    case 'network':
      return e('network', 'Sem conexão', 'Sem conexão com o servidor. Verifique a internet e tente de novo.')
    case 'cut':
      return e('cut', 'Resposta incompleta', surface === 'chat'
        ? 'A resposta parou no meio do caminho. Tente de novo.'
        : 'A análise parou no meio do caminho. Tente de novo.')
  }

  switch (status) {
    case 400:
      return e('http_400', surface === 'chat' ? 'Pergunta não enviada' : 'Pedido inválido', server ?? 'O pedido não foi aceito. Tente de novo.')
    case 401:
      return e('http_401', 'Sessão expirada', 'Sua sessão expirou. Recarregue a página e entre de novo.', false)
    case 404:
      return e('http_404', 'Loja indisponível', 'Esta loja não está disponível para o seu acesso.', false)
    case 422:
      return e('http_422', 'Período sem dados', server ?? 'Este período não pode ser analisado. Escolha outro.', false)
  }
  if (typeof status === 'number' && status >= 500) {
    return e(`http_${status}`, 'Servidor indisponível', server ?? 'O servidor não conseguiu ler os dados agora. Tente de novo.')
  }
  return e(code || 'internal', 'Algo deu errado', server ?? 'Algo deu errado ao consultar a IA. Tente de novo.')
}
