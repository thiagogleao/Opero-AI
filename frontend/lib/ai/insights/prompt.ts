import { INSIGHTS_MAX_ITEMS } from '../config'

/**
 * The insights prompt and the JSON shape the model must return.
 *
 * What the old prompt got wrong, and what replaced it:
 *  - "GERE EXATAMENTE 8 INSIGHTS" and a ban on "pode ser" made the model
 *    invent a kill card and a scale card for every store. Now 0–6 cards,
 *    uncertainty allowed, and a card only from the precomputed verdict lists.
 *  - Numbers were free text. Now each card lists the numbers it used, copied
 *    from the sheet, and the server checks them against the sheet.
 *  - Country advice came from Meta's country ROAS. Now only Shopify orders
 *    against Meta spend, with the order count as the sample.
 */

export const INSIGHT_KINDS = ['parar', 'escalar', 'atencao', 'oportunidade', 'diagnostico'] as const
export const CONFIDENCES = ['alta', 'media', 'baixa'] as const
export const TARGET_TYPES = ['loja', 'anuncio', 'campanha', 'pais', 'produto'] as const

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }

/** Structured-output schema (output_config.format). Array lengths are not
 *  expressible there; the server enforces the maximum. */
export const INSIGHTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'insights', 'dataGaps'],
  properties: {
    summary: { type: 'string' },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'detail', 'action', 'confidence', 'sample', 'evidence', 'target'],
        properties: {
          kind: { type: 'string', enum: [...INSIGHT_KINDS] },
          title: { type: 'string' },
          detail: { type: 'string' },
          action: nullableString,
          confidence: { type: 'string', enum: [...CONFIDENCES] },
          sample: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'value'],
              properties: { label: { type: 'string' }, value: { type: 'string' } },
            },
          },
          target: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'id', 'name'],
            properties: {
              type: { type: 'string', enum: [...TARGET_TYPES] },
              id: nullableString,
              name: nullableString,
            },
          },
        },
      },
    },
    dataGaps: { type: 'array', items: { type: 'string' } },
  },
}

export function insightsSystemPrompt(split: boolean): string {
  const rules = [
    'Você é o analista de lucro e anúncios do Opero. Vai ler a ficha de números de UMA loja Shopify, num período de dias fechados, e devolver uma análise curta para o dono decidir onde colocar o dinheiro.',
    '',
    'Evidência:',
    '1. Use só números que estão na ficha. Copie-os exatamente como aparecem (mesmo arredondamento e formato: $1,234.56, 12.3%, 1.55x). Não faça contas novas; se uma comparação precisar de dois números, cite os dois.',
    '2. Em "evidence" liste cada número que o card usa, com o rótulo da ficha. Um card sem número da ficha não deve existir.',
    '3. Em "sample" diga o tamanho da amostra (pedidos, compras, dias com gasto, gasto). Amostra pequena = confiança "baixa".',
    '4. Incerteza é permitida e esperada. Quando os dados não sustentam uma conclusão, diga isso (num card de confiança baixa ou em "dataGaps"). Nenhum card é uma resposta válida quando nada se destaca.',
    '',
    'Decisão:',
    '5. Os vereditos de anúncio e de campanha já vêm calculados pela regra única do app, contra o ROAS de empate da loja. Não crie limites próprios. Card "parar" só para anúncio da lista DESLIGAR ou campanha com veredito "cortar"; card "escalar" só para anúncio da lista ESCALAR ou campanha com veredito "escalar". Listas vazias = nenhum card desse tipo.',
    '6. ROAS da conta (receita da loja ÷ gasto Meta) inclui vendas orgânicas e sobe sozinho quando o gasto cai; ROAS do Meta é o que o Meta atribui. Não trate um como o outro.',
    '7. Países: só pelos pedidos da Shopify contra o gasto do Meta no país, sempre com o número de pedidos. A atribuição de compras por país do Meta não serve para decidir. Com menos de 30 pedidos num país, não recomende cortar nem escalar o país (no máximo observar). Se a cobertura do detalhamento por país for parcial, diga.',
    '8. Frequência e hook rate não são coletados: não fale de fadiga de criativo por frequência.',
    '9. Lucro é o lucro operacional do motor. ROAS de empate = receita ÷ contribuição; custos fixos e anúncios Shopify ficam fora dele.',
    '10. Leia as NOTAS DA LOJA: elas dizem o que os números desta loja não mostram (contas de anúncio compartilhadas, outra loja na conta, moeda).',
  ]
  if (split) {
    rules.push('11. O leitor é sócio com 50% do lucro. A ficha traz os números inteiros da loja e uma seção "SUA PARTE (50%)". Ao falar do lucro, lucro por pedido, resultado de caixa ou reembolsos do sócio, use essa seção e escreva "sua parte (50%)"; margens, ROAS e ponto de empate nunca se dividem.')
  }
  rules.push(
    '',
    'Formato:',
    `- Português do Brasil, valores em US$. Frases curtas e concretas, sem jargão vazio. No máximo ${INSIGHTS_MAX_ITEMS} cards, do que tem mais dinheiro em jogo para o que tem menos.`,
    '- "kind": parar, escalar, atencao (risco ou piora), oportunidade, diagnostico (o que explica o resultado).',
    '- "action": um passo concreto (o quê e onde) ou null quando o card é só diagnóstico.',
    '- "target": o anúncio, campanha, país ou produto pelo id e pelo nome exatos da ficha; type "loja" com id e name null para a loja inteira.',
    '- "summary": 1 a 3 frases com o resultado do período (lucro, receita e o que mais pesou).',
    '- "dataGaps": o que esta ficha não permite concluir, em frases curtas.',
  )
  return rules.join('\n')
}

export function insightsUserMessage(sheet: string): string {
  return `Ficha de números da loja:\n\n${sheet}\n\nEscreva a análise deste período.`
}
