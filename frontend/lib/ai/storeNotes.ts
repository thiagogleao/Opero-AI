/**
 * What the numbers of a particular store cannot show by themselves. Each note
 * here once produced a confident, wrong conclusion (CLAUDE.md, "As lojas"), so
 * both the Copilot and the insights read them before talking about the store.
 *
 * Keyed by the myshopify subdomain, which never changes, rather than by tenant
 * id (two formats coexist there).
 */

const NOTES: Readonly<Record<string, readonly string[]>> = {
  // CAMP HALLOW
  '6grccx-hc': [
    'Esta loja não tem conta de anúncio própria: os anúncios dela (campanha "CBO - FREDDIE KReUGER - USA" e cópias) rodaram na conta antiga da EPOCH, e o gasto aparece na EPOCH, não aqui. Por isso o gasto Meta desta loja pode aparecer como $0 e o lucro dela fica superestimado nesses períodos — não trate esta loja como "sem anúncios" nem como grupo de controle orgânico.',
  ],
  // EPOCH
  'png1yp-wb': [
    'Antes de novembro/2026 a conta de anúncio da EPOCH também veiculou anúncios da CAMP HALLOW ("CBO - FREDDIE KReUGER - USA" e cópias) e de lojas fora do Opero (campanhas "EVEREST"). Nesses períodos o gasto Meta desta loja inclui anúncios cujas vendas caíram em outras lojas: o lucro da EPOCH fica subestimado e o ROAS da conta não é só dela.',
  ],
  // Glooty
  '0j1hj0-5i': [
    'A conta de anúncio da Glooty rodou outra loja antes de 04/11/2026: gasto e compras do Meta antes dessa data não são da Glooty.',
  ],
  // Hibikura
  'mpjmxs-uj': [
    'Loja japonesa: vende em ienes (JPY) e o dia dela é o de Tóquio. Todos os valores no Opero já estão convertidos para US$.',
  ],
  // Dumpling Squishy (hzsjyp)
  'hzsjyp-dk': [
    'Esta loja não tem conta de anúncio Meta cadastrada no Opero: ROAS e veredito de anúncios não se aplicam.',
  ],
  // Squishy World
  '7ad04d-2g': [
    'Loja arquivada (suspensa na Shopify): só histórico, sem dados novos.',
  ],
}

export function storeNotes(domain: string | null | undefined): string[] {
  if (!domain) return []
  const key = domain.replace(/^https?:\/\//, '').split('.')[0]
  // Own keys only: a shop handle such as "constructor" threw "not iterable".
  return Object.hasOwn(NOTES, key) ? [...NOTES[key]] : []
}
