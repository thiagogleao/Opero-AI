/**
 * Puxa o historico de gasto de Shop Campaigns para shop_campaign_daily.
 *
 * O coletor novo ja grava isso a cada sync, mas so para o periodo que o sync
 * cobre (os ultimos dois dias). Este script traz o passado de uma vez.
 *
 * O dado vive no ShopifyQL (schema shop_campaign_insights, campo
 * shop_campaign_ad_spend) e nao em marketing_events nem em
 * marketingActivities, que voltam vazios. Exige API 2026-10 e escopo
 * read_reports — loja sem o escopo e pulada com aviso.
 *
 * Os valores vem na moeda da loja, entao loja fora do dolar e convertida pela
 * cotacao do dia, a mesma tabela fx_rates que os pedidos usam.
 *
 * Uso:  node backfill_shop_campaigns.js [--dias 90] [--dry-run]
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require(path.join(__dirname, 'frontend/node_modules/pg'))

const dryRun = process.argv.includes('--dry-run')
const iDias = process.argv.indexOf('--dias')
const DIAS = iDias > -1 ? Number(process.argv[iDias + 1]) : 90

const DATABASE_URL = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()

const f = n => '$' + Number(n || 0).toFixed(2)

async function ql(loja, consulta) {
  const r = await fetch(`https://${loja.shopify_domain}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': loja.tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($q:String!){ shopifyqlQuery(query:$q){ tableData{ rows } parseErrors } }',
      variables: { q: consulta },
    }),
  })
  const j = await r.json().catch(() => null)
  if (j?.errors) return { erro: j.errors[0]?.message || 'erro desconhecido' }
  const d = j?.data?.shopifyqlQuery
  if (d?.parseErrors && String(d.parseErrors).length > 2) return { erro: String(d.parseErrors) }
  return { linhas: d?.tableData?.rows || [] }
}

;(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const cli = await pool.connect()
  try {
    const { rows: lojas } = await cli.query(
      `SELECT id, shop_name, shopify_domain, shopify_access_token tok,
              COALESCE(shopify_currency,'USD') moeda
         FROM tenants
        WHERE shopify_access_token IS NOT NULL AND archived_at IS NULL
        ORDER BY shop_name`)

    const hoje = new Date()
    const de = new Date(hoje.getTime() - DIAS * 86400000).toISOString().slice(0, 10)
    const ate = hoje.toISOString().slice(0, 10)
    console.log(`janela: ${de} a ${ate}\n`)

    let totalGeral = 0
    for (const loja of lojas) {
      const r = await ql(loja,
        `FROM shop_campaign_insights SHOW shop_campaign_ad_spend ` +
        `GROUP BY day SINCE ${de} UNTIL ${ate} ORDER BY day`)
      if (r.erro) {
        const semEscopo = /read_reports/.test(r.erro)
        console.log(`${loja.shop_name.padEnd(20)} pulada — ${semEscopo ? 'falta o escopo read_reports' : r.erro.slice(0, 70)}`)
        continue
      }
      const comGasto = r.linhas.filter(x => Number(x.shop_campaign_ad_spend) > 0)
      if (!comGasto.length) { console.log(`${loja.shop_name.padEnd(20)} sem gasto de Shop no periodo`); continue }

      // cotacao: so para loja fora do dolar
      let taxas = {}
      if (loja.moeda !== 'USD') {
        const { rows } = await cli.query(
          `SELECT date::text d, usd_rate::float r FROM fx_rates WHERE currency=$1`, [loja.moeda])
        for (const x of rows) taxas[x.d] = x.r
      }
      const taxaDe = dia => {
        if (loja.moeda === 'USD') return null
        if (taxas[dia]) return taxas[dia]
        const antes = Object.keys(taxas).filter(d => d <= dia).sort()
        return antes.length ? taxas[antes[antes.length - 1]] : null
      }

      let soma = 0, gravadas = 0, semTaxa = 0
      await cli.query('BEGIN')
      for (const linha of comGasto) {
        const dia = linha.day
        const bruto = Number(linha.shop_campaign_ad_spend)
        const tx = taxaDe(dia)
        if (loja.moeda !== 'USD' && !tx) { semTaxa++; continue }
        const valor = tx ? bruto * tx : bruto
        soma += valor
        gravadas++
        await cli.query(
          `INSERT INTO shop_campaign_daily (tenant_id, date, spend, currency, fx_rate, synced_at)
           VALUES ($1,$2::date,$3,$4,$5,now())
           ON CONFLICT (tenant_id, date) DO UPDATE SET
             spend = EXCLUDED.spend, currency = EXCLUDED.currency,
             fx_rate = EXCLUDED.fx_rate, synced_at = now()`,
          [loja.id, dia, valor, loja.moeda, tx])
      }
      if (dryRun) await cli.query('ROLLBACK'); else await cli.query('COMMIT')
      totalGeral += soma
      console.log(`${loja.shop_name.padEnd(20)} ${f(soma).padStart(11)} em ${gravadas} dia(s)` +
        `${loja.moeda !== 'USD' ? '  (convertido de ' + loja.moeda + ')' : ''}` +
        `${semTaxa ? '  ' + semTaxa + ' dia(s) sem cotacao, pulados' : ''}`)
    }
    console.log(`\ntotal: ${f(totalGeral)}${dryRun ? '   (--dry-run: nada gravado)' : ''}`)
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {})
    console.error('erro:', e.message)
    process.exitCode = 1
  } finally {
    cli.release()
    await pool.end()
  }
})()
