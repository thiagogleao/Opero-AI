/**
 * Cadastra a loja japonesa Hibikura no Opero.
 *
 * O QUE MUDA
 *   Cria uma loja nova no login kaikiyuuji2004@gmail.com, que hoje so tem a
 *   Dumpling Squishy (hzsjyp-dk). Nao move nem apaga nada: a conta de anuncio
 *   "Natalia ADS" nunca esteve no Opero, entao nao ha historico a realocar.
 *
 * POR QUE O CORTE E 08/11
 *   A conta act_1381311624088505 e compartilhada. Ate 07/11 ela rodava
 *   Halloween, Squishy Natal, Nehdoh, BSS, RL — nada da Hibikura. Em 08/11 as
 *   campanhas HIBIKURA entram e passam a ser 82%, 84% e 100% do gasto do dia.
 *
 *   A loja tem 30 pedidos antes disso (Y247.361), mas naquele periodo ela
 *   anunciava em OUTRA conta, que hoje roda outras coisas e por isso nao da
 *   para atribuir. Importar so a receita faria setembro e outubro parecerem
 *   lucro puro. Entao o corte vale para os dois lados: gasto e receita.
 *
 * MOEDA
 *   A loja fatura em IENE e a conta de anuncio em DOLAR. O gasto entra direto;
 *   a receita e convertida na importacao, pela cotacao do dia de cada pedido,
 *   e a taxa usada fica gravada em shopify_orders.fx_rate.
 *
 * CUSTOS
 *   Sem profit_settings de proposito. O painel mostra receita, gasto, ROAS,
 *   campanhas e produtos; o bloco de lucro fica apagado ate o Thiago preencher
 *   dentro do Opero. Melhor apagado do que confiante e errado.
 *
 * Uso:  node cadastrar_hibikura.js --dry-run
 *       node cadastrar_hibikura.js
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require(path.join(__dirname, 'frontend/node_modules/pg'))

const dryRun = process.argv.includes('--dry-run')

const NOVO_ID = '0344f31b-bd37-4674-8696-7555f3d98417'
const DONO = 'user_3ImfjTcWxSlfbz0PxCsNU4IyiPi'   // login da Dumpling Squishy hz
const EMAIL = 'kaikiyuuji2004@gmail.com'
const CORTE = '2026-11-08'
const FUSO = 'Asia/Tokyo'

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

async function tokenShopify(dominio, id, segredo) {
  const r = await fetch(`https://${dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: segredo }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    throw new Error(`Shopify recusou o token (HTTP ${r.status}): ${j.error_description || j.error || '-'}`)
  }
  return { token: j.access_token, segundos: Number(j.expires_in) || 86399 }
}

;(async () => {
  const env = lerEnv(path.join(__dirname, 'nova_loja_japao.env'))
  const dominio = (env.LOJA_SHOPIFY_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const cid = env.LOJA_SHOPIFY_CLIENT_ID
  const csec = env.LOJA_SHOPIFY_CLIENT_SECRET
  const fbTok = env.LOJA_FB_ACCESS_TOKEN
  const cru = env.LOJA_FB_AD_ACCOUNT_ID || ''
  const conta = cru.startsWith('act_') ? cru : 'act_' + cru
  const appId = env.LOJA_FB_APP_ID || null
  const appSec = env.LOJA_FB_APP_SECRET || null
  if (!dominio || !cid || !csec || !fbTok || !cru) throw new Error('nova_loja_japao.env incompleto')

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const cli = await pool.connect()
  try {
    // ── provas antes de abrir transacao
    const fb = await (await fetch(`https://graph.facebook.com/v20.0/${conta}`
      + `?fields=name,account_status,currency,timezone_name&access_token=${encodeURIComponent(fbTok)}`)).json()
    if (fb.error) throw new Error(`o token nao le a conta de anuncio: ${fb.error.message}`)
    if (fb.currency !== 'USD') throw new Error(`a conta esta em ${fb.currency}; eu so converto a receita, nao o gasto`)
    console.log(`Facebook ok — "${fb.name}" ${conta}, ${fb.currency}, fuso ${fb.timezone_name}, status ${fb.account_status}`)

    const t = await tokenShopify(dominio, cid, csec)
    const loja = await (await fetch(`https://${dominio}/admin/api/2024-10/shop.json`,
      { headers: { 'X-Shopify-Access-Token': t.token } })).json()
    const s = loja.shop
    if (!s) throw new Error('nao consegui ler a loja')
    console.log(`Shopify ok  — "${s.name}" ${dominio}, moeda ${s.currency}, fuso ${s.iana_timezone}`)
    if (s.currency !== 'JPY') {
      console.log(`  aviso: eu esperava JPY e vi ${s.currency}. Vou gravar ${s.currency} e converter conforme.`)
    }

    const { rows: [dono] } = await cli.query(
      `SELECT shop_name, email FROM tenants WHERE id = $1`, [DONO])
    if (!dono) throw new Error(`nao achei o login dono ${DONO}`)
    const { rows: [jaTem] } = await cli.query(
      `SELECT id, shop_name FROM tenants WHERE id = $1 OR shopify_domain = $2 OR fb_ad_account_id = $3`,
      [NOVO_ID, dominio, conta])
    if (jaTem) throw new Error(`ja existe loja usando isso: ${jaTem.shop_name} (${jaTem.id})`)
    console.log(`login dono  — ${dono.email}, hoje com a loja "${dono.shop_name}"`)

    // ── a mudanca
    await cli.query('BEGIN')
    const expira = new Date(Date.now() + t.segundos * 1000)
    await cli.query(
      `INSERT INTO tenants
         (id, user_id, email, shop_name, shopify_domain,
          shopify_access_token, shopify_client_id, shopify_client_secret,
          shopify_token_expires_at, shopify_currency,
          fb_ad_account_id, fb_access_token, facebook_app_id, facebook_app_secret,
          onboarded, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15)`,
      [NOVO_ID, DONO, EMAIL, s.name, dominio,
       t.token, cid, csec, expira, s.currency,
       conta, fbTok, appId, appSec,
       s.iana_timezone || FUSO])

    // ── conferencia dentro da transacao
    const { rows: [novo] } = await cli.query(
      `SELECT shop_name, shopify_domain, shopify_currency, timezone, fb_ad_account_id,
              (shopify_access_token IS NOT NULL) tem_tok_shop,
              (shopify_client_id IS NOT NULL) tem_app_shop,
              (fb_access_token IS NOT NULL) tem_tok_fb,
              onboarded, archived_at
         FROM tenants WHERE id = $1`, [NOVO_ID])
    const { rows: lista } = await cli.query(
      `SELECT shop_name FROM tenants
        WHERE (user_id = $1 OR (user_id IS NULL AND id = $1)) AND archived_at IS NULL
        ORDER BY created_at`, [DONO])
    const { rows: [outras] } = await cli.query(
      `SELECT count(*)::int n FROM tenants WHERE archived_at IS NULL`)

    console.log('\n--- depois ---')
    console.log(`  ${novo.shop_name} | ${novo.shopify_domain} | ${novo.shopify_currency} | ${novo.timezone}`)
    console.log(`  conta ${novo.fb_ad_account_id}`)
    console.log(`  credenciais: shopify token=${novo.tem_tok_shop} app=${novo.tem_app_shop} | facebook token=${novo.tem_tok_fb}`)
    console.log(`  lojas visiveis em ${EMAIL}: ${lista.map(r => r.shop_name).join(', ')}`)
    console.log(`  total de lojas ativas no Opero: ${outras.n}`)

    const problemas = []
    if (!novo.tem_tok_shop || !novo.tem_app_shop) problemas.push('credencial da Shopify nao gravou')
    if (!novo.tem_tok_fb) problemas.push('token do Facebook nao gravou')
    if (novo.shopify_currency !== s.currency) problemas.push('moeda nao gravou')
    if (novo.archived_at) problemas.push('nasceu arquivada')
    if (!lista.some(r => r.shop_name === s.name)) problemas.push('nao aparece na lista do login')
    if (lista.length !== 2) problemas.push(`esperava 2 lojas nesse login, vi ${lista.length}`)
    if (problemas.length) throw new Error('conferencia falhou: ' + problemas.join('; '))
    console.log('\nconferencia: tudo bate')
    console.log(`\nproximo passo: sincronizar de ${CORTE} em diante`)

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
