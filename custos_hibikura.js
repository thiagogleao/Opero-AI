/**
 * Custo do HIBACHI ZERO, o unico produto que a Hibikura vende hoje
 * (19 das 19 unidades vendidas).
 *
 * O fornecedor cobra por PEDIDO, nao por unidade:
 *     1 unidade  -> $11,00
 *     2 unidades -> $16,04
 *     4 unidades -> $25,44
 * e esses valores ja incluem produto, manuseio e frete.
 *
 * Por isso uso `price_tiers`, que e a tabela por pedido do profitCalc e
 * substitui o custo por unidade. Como 100% das vendas sao desse produto, ela
 * vale para a loja inteira. Se entrar um segundo produto com outro custo, esta
 * conta passa a cobrar o preco do HIBACHI por ele tambem — ai tem de mudar.
 *
 * O que NAO foi informado e como eu tratei:
 *   - 3 unidades: o tierOrderCost cobra o proximo degrau, $25,44. E o que a
 *     tabela de um fornecedor costuma fazer e erra para o lado seguro.
 *   - acima de 4: $4,70 por unidade extra, derivado do proprio degrau de 2
 *     para 4 ($9,40 por 2 unidades).
 *   - frete e embalagem ficam ZERADOS de proposito: ja estao dentro dos
 *     valores acima, e somar de novo contaria duas vezes.
 *
 * Uso:  node custos_hibikura.js --dry-run
 *       node custos_hibikura.js
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require(path.join(__dirname, 'frontend/node_modules/pg'))

const dryRun = process.argv.includes('--dry-run')
const H = '0344f31b-bd37-4674-8696-7555f3d98417'
const DATABASE_URL = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()

const CONFIG = {
  shopify: {
    // Taxa do Shopify Payments MEDIDA, nao chutada: 12 payouts reais somam
    // $1.474,73 de bruto com $84,56 de taxa = 5,73%. E alta porque a loja
    // vende em iene e recebe em dolar, entao a conversao de moeda esta
    // embutida. O numero padrao de 2,9% subestimaria o custo em quase 3
    // pontos sobre toda a receita.
    transaction_fee_pct: 0,      // zero quando se usa Shopify Payments
    payment_processing_pct: 5.73,
    payment_processing_fixed: 0,
  },
  // Zerados: o frete ja esta dentro do preco por pedido do fornecedor.
  shipping: { rates: [], default_rate_usd: 0 },
  extra_costs: [],
  cogs: {
    default_cost_usd: 11,
    packaging_cost_usd: 0,
    packaging_per_unit_usd: 0,
    additional_unit_discount_usd: 0,
    price_tiers: [
      {
        effective_from: '2026-11-08',
        label: 'HIBACHI ZERO — produto + manuseio + frete',
        order_prices: { '1': 11, '2': 16.04, '4': 25.44 },
        extra_unit_usd: 4.70,
      },
    ],
    volume_discounts: [],
    products: [],
    country_prices: [],
    order_fees: [],
    packaging_per_unit_products: [],
  },
}

;(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const cli = await pool.connect()
  try {
    const { rows: [loja] } = await cli.query(
      `SELECT shop_name, shopify_currency FROM tenants WHERE id = $1`, [H])
    if (!loja) throw new Error('loja nao encontrada')
    console.log(`loja: ${loja.shop_name} (${loja.shopify_currency})`)

    const { rows: [antes] } = await cli.query(
      `SELECT count(*)::int n FROM profit_settings WHERE tenant_id = $1`, [H])
    console.log(`config de custo hoje: ${antes.n ? 'existe, vou substituir' : 'nao existe, vou criar'}`)

    // Conferir que a loja so vende esse produto antes de usar tabela por pedido
    const { rows: prods } = await cli.query(
      `SELECT product_title, SUM(quantity)::int un
         FROM shopify_order_items WHERE tenant_id = $1
        GROUP BY 1 ORDER BY 2 DESC`, [H])
    console.log('\nprodutos vendidos:')
    for (const p of prods) console.log(`  ${p.un} un  ${String(p.product_title).slice(0, 50)}`)
    if (prods.length > 1) {
      console.log('\n  ATENCAO: mais de um produto. A tabela por pedido vai cobrar o preco')
      console.log('  do HIBACHI ZERO para todos. Reveja antes de confiar no lucro.')
    }

    await cli.query('BEGIN')
    await cli.query(
      `INSERT INTO profit_settings (tenant_id, settings)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings`,
      [H, JSON.stringify(CONFIG)])

    const { rows: [gravado] } = await cli.query(
      `SELECT settings->'cogs'->'price_tiers'->0->'order_prices' AS degraus,
              settings->'cogs'->>'default_cost_usd' AS padrao,
              settings->'shopify'->>'transaction_fee_pct' AS taxa
         FROM profit_settings WHERE tenant_id = $1`, [H])
    console.log('\ngravado:')
    console.log(`  degraus por pedido: ${JSON.stringify(gravado.degraus)}`)
    console.log(`  custo padrao: $${gravado.padrao}   taxa de transacao: ${gravado.taxa}%`)

    if (dryRun) { await cli.query('ROLLBACK'); console.log('\n--dry-run: desfeito') }
    else { await cli.query('COMMIT'); console.log('\ngravado') }
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {})
    console.error('erro, nada gravado:', e.message)
    process.exitCode = 1
  } finally {
    cli.release()
    await pool.end()
  }
})()
