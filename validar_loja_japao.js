/**
 * Prova as credenciais da loja japonesa e mostra a conversao ANTES de gravar
 * qualquer coisa. Nao escreve no banco nem na Shopify nem no Facebook.
 *
 * O ponto delicado aqui e a moeda: o Opero soma dinheiro como numero puro, e
 * esta loja fatura em iene. Entao a ultima secao poe lado a lado o que a
 * Shopify mostra e o que entraria no Opero, para o Thiago conferir antes.
 *
 * Uso:  node validar_loja_japao.js [arquivo.env]
 */
const fs = require('fs')
const path = require('path')

const ARQ = process.argv[2] || path.join(__dirname, 'nova_loja_japao.env')
const API = '2024-10'
const V = 'v20.0'

function lerEnv(arquivo) {
  if (!fs.existsSync(arquivo)) { console.error(`nao achei ${arquivo}`); process.exit(1) }
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
    throw new Error(`HTTP ${r.status}: ${j.error_description || j.error || 'sem detalhe'}`)
  }
  return { token: j.access_token, escopos: j.scope || '', segundos: Number(j.expires_in) || 0 }
}

const adminApi = (dominio, tok) => async caminho => {
  const r = await fetch(`https://${dominio}/admin/api/${API}/${caminho}`,
    { headers: { 'X-Shopify-Access-Token': tok, Accept: 'application/json' } })
  const txt = await r.text()
  let j = null; try { j = JSON.parse(txt) } catch {}
  return { ok: r.ok, status: r.status, corpo: j, cru: txt.slice(0, 160) }
}

const fb = async (caminho, tok, params = {}) => {
  const u = new URL(`https://graph.facebook.com/${V}/${caminho}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  u.searchParams.set('access_token', tok)
  return (await fetch(u)).json()
}

const d2 = n => Number(n).toFixed(2)
const grana = (n, moeda) => (moeda === 'JPY' ? '¥' : '$') + Number(n).toLocaleString('en-US', { maximumFractionDigits: moeda === 'JPY' ? 0 : 2 })

;(async () => {
  const env = lerEnv(ARQ)
  const dominio = (env.LOJA_SHOPIFY_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const cid = env.LOJA_SHOPIFY_CLIENT_ID
  const csec = env.LOJA_SHOPIFY_CLIENT_SECRET
  const fbTok = env.LOJA_FB_ACCESS_TOKEN
  // O Gerenciador mostra o ID as vezes com e as vezes sem o "act_"; a Graph API
  // so aceita com. Normaliza em vez de reclamar.
  const contaCrua = env.LOJA_FB_AD_ACCOUNT_ID || ''
  const conta = contaCrua && !contaCrua.startsWith('act_') ? 'act_' + contaCrua : contaCrua

  const falta = []
  if (!dominio) falta.push('LOJA_SHOPIFY_DOMAIN')
  if (!cid) falta.push('LOJA_SHOPIFY_CLIENT_ID')
  if (!csec) falta.push('LOJA_SHOPIFY_CLIENT_SECRET')
  if (!fbTok) falta.push('LOJA_FB_ACCESS_TOKEN')
  if (!conta) falta.push('LOJA_FB_AD_ACCOUNT_ID')
  if (falta.length) { console.error('falta preencher:\n  ' + falta.join('\n  ')); process.exit(1) }

  console.log('='.repeat(72))
  console.log('1. SHOPIFY')
  console.log('='.repeat(72))
  let t
  try { t = await tokenShopify(dominio, cid, csec) }
  catch (e) { console.error(`  token falhou — ${e.message}`); process.exit(1) }
  console.log(`  token ok, vale ${Math.round(t.segundos / 3600)}h`)
  const tem = new Set(t.escopos.split(',').map(s => s.trim()).filter(Boolean))
  const cobre = s => tem.has(s) || (s.startsWith('read_') && s !== 'read_all_orders' && tem.has('write_' + s.slice(5)))
  const precisa = ['read_orders', 'read_all_orders', 'read_products', 'read_checkouts']
  const semEscopo = precisa.filter(s => !cobre(s))
  console.log(`  escopos: ${t.escopos}`)
  console.log(semEscopo.length ? `  FALTANDO: ${semEscopo.join(', ')}` : '  todos os escopos necessarios cobertos')

  const api = adminApi(dominio, t.token)
  const loja = await api('shop.json')
  if (!loja.ok) { console.error(`  nao li a loja (HTTP ${loja.status})`); process.exit(1) }
  const s = loja.corpo.shop
  const MOEDA = s.currency
  console.log(`\n  loja  : "${s.name}"`)
  console.log(`  moeda : ${MOEDA}${MOEDA === 'USD' ? '  (nao precisa de conversao!)' : '  -> vai ser convertida para USD'}`)
  console.log(`  fuso  : ${s.iana_timezone}   pais ${s.country_code}   plano ${s.plan_display_name}`)
  console.log(`  criada: ${String(s.created_at).slice(0, 10)}`)

  const cont = await api('orders/count.json?status=any')
  const total = cont.ok ? cont.corpo.count : '?'
  const ped = await api('orders.json?status=any&limit=250&fields=id,created_at,total_price,currency,financial_status,line_items')
  if (!ped.ok) { console.error(`  nao li pedidos (HTTP ${ped.status})`); process.exit(1) }
  const pedidos = (ped.corpo.orders || []).sort((a, b) => a.created_at.localeCompare(b.created_at))
  console.log(`  pedidos: ${total} no total, ${pedidos.length} lidos nesta amostra`)
  if (!pedidos.length) { console.log('  (loja ainda sem pedido)') }
  else {
    console.log(`  primeiro: ${pedidos[0].created_at.slice(0, 10)}   ultimo: ${pedidos[pedidos.length - 1].created_at.slice(0, 10)}`)
    const moedas = {}
    for (const o of pedidos) moedas[o.currency] = (moedas[o.currency] || 0) + 1
    console.log(`  moedas nos pedidos: ${Object.entries(moedas).map(([m, n]) => m + '=' + n).join(', ')}`)
  }

  const prod = await api('products.json?limit=5&fields=id,title,status,variants')
  console.log(`  produtos: ${prod.ok ? (prod.corpo.products || []).length + ' lidos' : 'ERRO ' + prod.status}`)
  const ab = await api('checkouts.json?limit=1')
  console.log(`  carrinho abandonado: ${ab.ok ? 'ok' : 'ERRO ' + ab.status}`)

  console.log('\n' + '='.repeat(72))
  console.log('2. FACEBOOK')
  console.log('='.repeat(72))
  const quem = await fb('debug_token', fbTok, { input_token: fbTok })
  const dd = quem.data || {}
  console.log(`  token: app "${dd.application || '?'}" (${dd.app_id || '?'}), tipo ${dd.type || '?'}`)
  console.log(`  expira: ${dd.expires_at === 0 ? 'NUNCA' : new Date((dd.expires_at || 0) * 1000).toISOString().slice(0, 19)}`)
  console.log(`  escopos: ${(dd.scopes || []).join(', ') || '?'}`)
  const ac = await fb(conta, fbTok, { fields: 'name,account_status,currency,timezone_name,amount_spent,business{name}' })
  if (ac.error) { console.error(`  NAO LI a conta ${conta}: ${ac.error.message}`); process.exit(1) }
  console.log(`\n  conta : "${ac.name}" (${conta})`)
  console.log(`  moeda : ${ac.currency}${ac.currency === 'USD' ? '  (gasto entra direto)' : '  <<< ATENCAO: nao e dolar'}`)
  console.log(`  fuso  : ${ac.timezone_name}   status ${ac.account_status}   BM ${ac.business?.name || '-'}`)
  console.log(`  gasto historico: $${d2((ac.amount_spent || 0) / 100)}`)
  const ins = await fb(`${conta}/insights`, fbTok, {
    level: 'campaign', date_preset: 'last_30d', fields: 'campaign_name,spend,actions', limit: 25,
  })
  if (ins.error) console.log(`  insights: ERRO ${ins.error.message}`)
  else {
    const l = (ins.data || []).map(r => ({ c: r.campaign_name, g: +r.spend })).sort((a, b) => b.g - a.g)
    console.log(`  campanhas com gasto nos ultimos 30 dias: ${l.length}`)
    for (const x of l.slice(0, 8)) console.log(`    ${String(x.c).slice(0, 44).padEnd(46)} $${d2(x.g)}`)
    console.log(`    total $${d2(l.reduce((a, x) => a + x.g, 0))}`)
  }

  if (!pedidos.length || MOEDA === 'USD') {
    console.log('\nnada a converter. Nada foi gravado.')
    return
  }

  console.log('\n' + '='.repeat(72))
  console.log(`3. CONVERSAO ${MOEDA} -> USD   (confira contra o que a Shopify mostra)`)
  console.log('='.repeat(72))
  const de = pedidos[0].created_at.slice(0, 10)
  const ate = pedidos[pedidos.length - 1].created_at.slice(0, 10)
  const fx = await (await fetch(`https://api.frankfurter.app/${de}..${ate}?from=${MOEDA}&to=USD`)).json()
  const taxas = {}
  for (const [dia, v] of Object.entries(fx.rates || {})) taxas[dia] = v.USD
  const dias = Object.keys(taxas).sort()
  if (!dias.length) { console.log('  nao consegui cotacao para esse periodo'); return }
  console.log(`  cotacao de ${de} a ${ate}: ${dias.length} dias publicados`)
  console.log(`  1 ${MOEDA} = ${taxas[dias[0]]} USD em ${dias[0]}  ...  ${taxas[dias[dias.length - 1]]} em ${dias[dias.length - 1]}`)

  const taxaDe = dia => {
    if (taxas[dia]) return taxas[dia]
    const antes = dias.filter(d => d <= dia)
    return antes.length ? taxas[antes[antes.length - 1]] : taxas[dias[0]]
  }

  console.log(`\n  data         ${MOEDA.padStart(12)}   taxa do dia        USD   un`)
  let somaLocal = 0, somaUsd = 0, somaUn = 0
  for (const o of pedidos.slice(-15)) {
    const dia = o.created_at.slice(0, 10)
    const tx = taxaDe(dia)
    const un = (o.line_items || []).reduce((a, i) => a + i.quantity, 0)
    console.log(`  ${dia}  ${grana(o.total_price, MOEDA).padStart(12)}   ${tx.toFixed(7)}   ${('$' + d2(+o.total_price * tx)).padStart(9)}  ${String(un).padStart(3)}`)
  }
  for (const o of pedidos) {
    const tx = taxaDe(o.created_at.slice(0, 10))
    somaLocal += +o.total_price
    somaUsd += +o.total_price * tx
    somaUn += (o.line_items || []).reduce((a, i) => a + i.quantity, 0)
  }
  console.log(`\n  TOTAL de ${pedidos.length} pedidos`)
  console.log(`    na moeda da loja : ${grana(somaLocal, MOEDA)}`)
  console.log(`    convertido       : $${d2(somaUsd)}`)
  console.log(`    ticket medio     : ${grana(somaLocal / pedidos.length, MOEDA)}  =  $${d2(somaUsd / pedidos.length)}`)
  console.log(`    unidades/pedido  : ${(somaUn / pedidos.length).toFixed(2)}`)
  console.log(`\n  SEM a conversao o Opero leria ${grana(somaLocal, MOEDA).replace('¥', '$')} de receita.`)
  console.log(`  Com a conversao le $${d2(somaUsd)}. Diferenca de ${(somaLocal / somaUsd).toFixed(0)}x.`)

  console.log('\n' + '='.repeat(72))
  console.log('nada foi gravado. Confira o total acima contra o painel da Shopify.')
  console.log('='.repeat(72))
})().catch(e => { console.error('erro inesperado:', e.message); process.exitCode = 1 })
