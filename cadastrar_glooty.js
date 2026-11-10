/**
 * Cadastra a loja Glooty no Opero e passa a Conta 6 para ela.
 *
 * O QUE MUDA
 *   1. Cria a loja "Glooty" (0j1hj0-5i.myshopify.com) no mesmo login
 *      wearcurve@gmail.com que ja ve MOKOO, Squishy World e Dumpling.
 *   2. Move o gasto da Conta 6 de 04/11/2026 em diante para ela: 261 linhas,
 *      90 anuncios, $2.156,47. O que e anterior fica onde esta.
 *   3. Arquiva a Squishy World. Ela mantem os 2.293 pedidos, os $79.902 de
 *      gasto historico e a credencial — so sai da lista e para de sincronizar.
 *
 * POR QUE 04/11
 *   O primeiro pedido da Glooty e 06/11 01:13. O gasto da Conta 6 reacendeu em
 *   04/11 ($74, depois $156, $268, $650...), ou seja dois dias de aquecimento
 *   antes da primeira venda. Cortar em 04/11 tambem deixa de fora os dois
 *   pedidos de 15/09 que estao em IENE (MOKOO Japao, de quando a loja era
 *   outra coisa) — eles entrariam no Opero como $8.090 e $4.390 de receita
 *   falsa, porque o collector le total_price sem converter moeda.
 *
 * SOBRE O TOKEN
 *   App do Dev Dashboard nao tem token permanente. Este script pede um na hora
 *   (prova que a credencial serve) e grava com a validade; dai em diante o
 *   collector renova sozinho a cada sync, de 10 em 10 minutos.
 *
 * CUSTOS
 *   De proposito NAO crio profit_settings. Sem ela o Opero mostra receita,
 *   gasto e ROAS e nao finge saber lucro. Copiar os custos da MOKOO daria um
 *   numero confiante e errado — sao produtos diferentes. O Thiago preenche
 *   dentro do Opero.
 *
 * Uso:  node cadastrar_glooty.js --dry-run
 *       node cadastrar_glooty.js
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require(path.join(__dirname, 'frontend/node_modules/pg'))

const dryRun = process.argv.includes('--dry-run')

const NOVO_ID = '5071bfb6-61c8-431f-8837-1b546f7e4f38'
const SQUISHY = '75cbc00a-8877-434a-8c84-a07797ce31ed'
const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const DONO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const EMAIL = 'wearcurve@gmail.com'
const CONTA6 = 'act_2267479727435342'
const FB_APP = '3980605682236620'
const CORTE = '2026-11-04'
const NOME = 'Glooty'

const DATABASE_URL = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()

function lerEnv(arquivo) {
  const fora = {}
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) fora[m[1]] = m[2].replace(/(^|\s)#.*$/, '').trim()
  }
  return fora
}

async function pedirTokenShopify(dominio, id, segredo) {
  const r = await fetch(`https://${dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: segredo }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    throw new Error(`Shopify recusou o token (HTTP ${r.status}): ${j.error_description || j.error || 'sem detalhe'}`)
  }
  return { token: j.access_token, escopos: j.scope || '', segundos: Number(j.expires_in) || 86399 }
}

const f = n => '$' + Number(n || 0).toFixed(2)

;(async () => {
  const env = lerEnv(path.join(__dirname, 'wear_curve.env'))
  const dominio = (env.WEAR_CURVE_SHOPIFY_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const cid = env.WEAR_CURVE_SHOPIFY_CLIENT_ID
  const csec = env.WEAR_CURVE_SHOPIFY_CLIENT_SECRET
  if (!dominio || !cid || !csec) throw new Error('wear_curve.env sem dominio/client id/client secret')

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const cli = await pool.connect()
  try {
    // ── provas antes de abrir transacao, para nao gravar credencial que nao serve
    const { rows: [mokoo] } = await cli.query(
      `SELECT fb_access_token tok FROM tenants WHERE id = $1`, [MOKOO])
    if (!mokoo?.tok) throw new Error('nao achei o token do Adanalyzer na MOKOO')

    const fb = await (await fetch(`https://graph.facebook.com/v20.0/${CONTA6}`
      + `?fields=name,account_status&access_token=${encodeURIComponent(mokoo.tok)}`)).json()
    if (fb.error) throw new Error(`o token do Facebook nao le a Conta 6: ${fb.error.message}`)
    console.log(`Facebook ok  — "${fb.name}" (${CONTA6}), status ${fb.account_status}`)

    const t = await pedirTokenShopify(dominio, cid, csec)
    console.log(`Shopify ok   — token novo, vale ${Math.round(t.segundos / 3600)}h`)
    console.log(`               escopos: ${t.escopos || '(nao informados)'}`)

    const { rows: [sq] } = await cli.query(
      `SELECT shop_name, shopify_domain, archived_at FROM tenants WHERE id = $1`, [SQUISHY])
    if (!sq) throw new Error('nao achei a Squishy World')
    const { rows: [jaExiste] } = await cli.query(
      `SELECT id FROM tenants WHERE id = $1 OR shopify_domain = $2`, [NOVO_ID, dominio])
    if (jaExiste) throw new Error(`essa loja ja esta cadastrada (${jaExiste.id})`)

    const antesMover = (await cli.query(
      `SELECT count(*)::int linhas, ROUND(SUM(spend)::numeric,2)::float gasto
         FROM fb_ad_daily_metrics WHERE tenant_id = $1 AND date >= $2::date`,
      [SQUISHY, CORTE])).rows[0]
    const antesFicar = (await cli.query(
      `SELECT count(*)::int linhas, ROUND(SUM(spend)::numeric,2)::float gasto
         FROM fb_ad_daily_metrics WHERE tenant_id = $1 AND date < $2::date`,
      [SQUISHY, CORTE])).rows[0]
    const antesPedidos = (await cli.query(
      `SELECT count(*)::int n FROM shopify_orders WHERE tenant_id = $1`, [SQUISHY])).rows[0].n

    console.log(`\nSquishy World: "${sq.shop_name}" ${sq.shopify_domain}`)
    console.log(`  move para a Glooty : ${antesMover.linhas} linhas, ${f(antesMover.gasto)}`)
    console.log(`  fica com ela       : ${antesFicar.linhas} linhas, ${f(antesFicar.gasto)}, ${antesPedidos} pedidos`)

    // ── as mudancas
    await cli.query('BEGIN')

    const expira = new Date(Date.now() + t.segundos * 1000)
    await cli.query(
      `INSERT INTO tenants
         (id, user_id, email, shop_name, shopify_domain,
          shopify_access_token, shopify_client_id, shopify_client_secret, shopify_token_expires_at,
          fb_ad_account_id, fb_access_token, facebook_app_id,
          onboarded, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)`,
      [NOVO_ID, DONO, EMAIL, NOME, dominio,
       t.token, cid, csec, expira,
       CONTA6, mokoo.tok, FB_APP,
       'America/Belem'])

    const mov = await cli.query(
      `UPDATE fb_ad_daily_metrics SET tenant_id = $1
        WHERE tenant_id = $2 AND date >= $3::date`,
      [NOVO_ID, SQUISHY, CORTE])

    await cli.query(
      `UPDATE tenants SET archived_at = now(), updated_at = now() WHERE id = $1`, [SQUISHY])

    // ── conferencia dentro da transacao: se nao bater, nada e gravado
    const depoisGlooty = (await cli.query(
      `SELECT count(*)::int linhas, count(DISTINCT ad_id)::int ads,
              min(date)::text de, max(date)::text ate,
              ROUND(SUM(spend)::numeric,2)::float gasto
         FROM fb_ad_daily_metrics WHERE tenant_id = $1`, [NOVO_ID])).rows[0]
    const depoisSq = (await cli.query(
      `SELECT count(*)::int linhas, ROUND(SUM(spend)::numeric,2)::float gasto
         FROM fb_ad_daily_metrics WHERE tenant_id = $1`, [SQUISHY])).rows[0]
    const depoisPedidos = (await cli.query(
      `SELECT count(*)::int n FROM shopify_orders WHERE tenant_id = $1`, [SQUISHY])).rows[0].n
    const { rows: [novo] } = await cli.query(
      `SELECT shop_name, shopify_domain, fb_ad_account_id, timezone, onboarded,
              (shopify_access_token IS NOT NULL) tem_token,
              (shopify_client_id IS NOT NULL) tem_app,
              shopify_token_expires_at
         FROM tenants WHERE id = $1`, [NOVO_ID])
    const { rows: [arq] } = await cli.query(
      `SELECT archived_at FROM tenants WHERE id = $1`, [SQUISHY])
    const { rows: lista } = await cli.query(
      `SELECT shop_name FROM tenants
        WHERE (user_id = $1 OR (user_id IS NULL AND id = $1)) AND archived_at IS NULL
        ORDER BY created_at`, [DONO])

    console.log('\n--- depois ---')
    console.log(`Glooty : ${depoisGlooty.linhas} linhas, ${depoisGlooty.ads} anuncios, ` +
                `${depoisGlooty.de} a ${depoisGlooty.ate}, ${f(depoisGlooty.gasto)}`)
    console.log(`         ${novo.shop_name} | ${novo.shopify_domain} | ${novo.fb_ad_account_id} | ${novo.timezone}`)
    console.log(`         token gravado: ${novo.tem_token}, app novo: ${novo.tem_app}, vence ${novo.shopify_token_expires_at?.toISOString?.().slice(0, 19)}`)
    console.log(`Squishy: ${depoisSq.linhas} linhas, ${f(depoisSq.gasto)}, ${depoisPedidos} pedidos, arquivada em ${arq.archived_at?.toISOString?.().slice(0, 19)}`)
    console.log(`lojas visiveis no login: ${lista.map(r => r.shop_name).join(', ')}`)

    const problemas = []
    if (mov.rowCount !== antesMover.linhas) problemas.push(`moveu ${mov.rowCount}, esperava ${antesMover.linhas}`)
    if (Math.abs(depoisGlooty.gasto - antesMover.gasto) > 0.01) problemas.push('gasto movido nao bate')
    if (depoisSq.linhas !== antesFicar.linhas) problemas.push('a Squishy perdeu ou ganhou linha')
    if (Math.abs(depoisSq.gasto - antesFicar.gasto) > 0.01) problemas.push('gasto da Squishy mudou')
    if (depoisPedidos !== antesPedidos) problemas.push('a Squishy perdeu pedido')
    if (!arq.archived_at) problemas.push('a Squishy nao ficou arquivada')
    if (!novo.tem_token || !novo.tem_app) problemas.push('credencial da Glooty nao gravou')
    if (lista.some(r => r.shop_name === 'Squishy World')) problemas.push('a Squishy continua aparecendo na lista')
    if (!lista.some(r => r.shop_name === NOME)) problemas.push('a Glooty nao aparece na lista')

    if (problemas.length) throw new Error('conferencia falhou: ' + problemas.join('; '))
    console.log('\nconferencia: tudo bate')

    if (dryRun) { await cli.query('ROLLBACK'); console.log('\n--dry-run: desfeito, nada gravado') }
    else { await cli.query('COMMIT'); console.log('\ngravado') }
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {})
    console.error('\nerro, nada foi gravado:', e.message)
    process.exitCode = 1
  } finally {
    cli.release()
    await pool.end()
  }
})()
