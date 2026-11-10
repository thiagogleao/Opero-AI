/**
 * Troca Client ID + Client secret por um token de Admin API e prova que ele
 * funciona. NAO grava nada no banco.
 *
 * Desde 01/01/2026 a Shopify nao deixa mais criar app pelo admin da loja, e os
 * apps do Dev Dashboard nao expoem token: o token vem do "client credentials
 * grant" e vale ~24h (expires_in 86399), entao tem de ser renovado. Esta so a
 * prova de que as credenciais servem; a renovacao automatica entra no coletor.
 *
 * Exige que o app e a loja estejam na MESMA organizacao da Shopify.
 *
 * Uso:  node testar_shopify_wear_curve.js [arquivo.env]
 *       (padrao: wear_curve.env)
 */
const fs = require('fs')
const path = require('path')

const ARQ = process.argv[2] || path.join(__dirname, 'wear_curve.env')
const API = '2024-10'

function lerEnv(arquivo) {
  if (!fs.existsSync(arquivo)) {
    console.error(`nao achei ${arquivo}`)
    process.exit(1)
  }
  const fora = {}
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    // tira o comentario de fim de linha. Tem de pegar tambem o caso de valor
    // vazio, em que o "#" fica no comeco do que sobrou — senao o comentario
    // passa a ser lido como se fosse o valor.
    fora[m[1]] = m[2].replace(/(^|\s)#.*$/, '').trim()
  }
  return fora
}

/**
 * Pede um token novo. Devolve { token, scope, expiraEm }.
 *
 * A documentacao da Shopify so mostra corpo form-encoded neste endpoint, nunca
 * JSON. Mando form-encoded por isso. Nao se manda "scope": a Shopify ignora, e
 * o token sempre vem com os escopos que a LOJA concedeu na instalacao.
 */
async function pegarToken(dominio, clientId, clientSecret) {
  const r = await fetch(`https://${dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const texto = await r.text()
  let j
  try { j = JSON.parse(texto) } catch { j = null }
  if (!r.ok || !j?.access_token) {
    const codigo = String(j?.error || '')
    const erro = j?.error_description || codigo || texto.slice(0, 300)
    const e = new Error(`a Shopify recusou (HTTP ${r.status}): ${erro}`)
    e.codigo = codigo
    throw e
  }
  return { token: j.access_token, scope: j.scope || '', expiraEm: j.expires_in }
}

/** Cada recusa tem uma causa diferente; chutar todas junto so confunde. */
function explicar(codigo, mensagem) {
  const texto = (codigo + ' ' + mensagem).toLowerCase()
  if (texto.includes('not installed') || texto.includes('app_not_installed')) return [
    'O app existe e as credenciais foram aceitas — o que falta e INSTALAR o app nessa loja.',
    '',
    '  1. O app precisa ter uma versao publicada antes de poder ser instalado:',
    '     Dev Dashboard > seu app > Versions > preencha os escopos > Release',
    '  2. Dev Dashboard > seu app > cartao "Installs" > botao "Install app"',
    '     (o mesmo botao esta no menu de tres pontos na linha do app em Apps)',
    '  3. Abre uma aba com o fluxo de OAuth: escolha a loja e clique Install',
    '',
    '  Escopos que precisam estar na versao publicada:',
    '     read_orders, read_all_orders, read_products, read_checkouts',
    '  Mudar escopo depois exige publicar versao nova E aprovar na loja.',
  ]
  if (texto.includes('shop_not_permitted') || texto.includes('cannot be performed')) return [
    'App e loja estao em organizacoes diferentes da Shopify.',
    'Esse jeito de pegar token exige a mesma organizacao.',
    '',
    '  Como conferir: Dev Dashboard > Dev stores — a loja tem de aparecer nessa lista.',
    '  Se nao aparecer, ela nao esta nessa organizacao.',
    '  Caminho alternativo: distribuicao custom para essa loja, com um lojista instalando.',
  ]
  if (texto.includes('application_cannot_be_found') || texto.includes('invalid_client')) return [
    'A Shopify nao reconheceu o client id/secret.',
    '  - confira se copiou o par do MESMO app',
    '  - o secret do Dev Dashboard comeca com shps_',
  ]
  if (texto.includes('not found')) return [
    'A loja respondeu 404: o dominio provavelmente esta errado.',
    '  Tem de ser o .myshopify.com interno da loja.',
  ]
  return [
    'Causas possiveis:',
    '  - app nao instalado na loja (Dev Dashboard > app > Installs > Install app)',
    '  - app e loja em organizacoes diferentes',
    '  - client id ou secret trocados/incompletos',
    '  - dominio errado (tem de ser o .myshopify.com)',
  ]
}

async function admin(dominio, token, caminho) {
  const r = await fetch(`https://${dominio}/admin/api/${API}/${caminho}`, {
    headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
  })
  const texto = await r.text()
  let j = null
  try { j = JSON.parse(texto) } catch {}
  return { ok: r.ok, status: r.status, corpo: j, cru: texto.slice(0, 200) }
}

;(async () => {
  const env = lerEnv(ARQ)
  const dominio = (env.WEAR_CURVE_SHOPIFY_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const id = env.WEAR_CURVE_SHOPIFY_CLIENT_ID
  const segredo = env.WEAR_CURVE_SHOPIFY_CLIENT_SECRET

  const faltando = []
  if (!dominio) faltando.push('WEAR_CURVE_SHOPIFY_DOMAIN')
  if (!id) faltando.push('WEAR_CURVE_SHOPIFY_CLIENT_ID')
  if (!segredo) faltando.push('WEAR_CURVE_SHOPIFY_CLIENT_SECRET')
  if (faltando.length) {
    console.error('falta preencher em ' + ARQ + ':\n  ' + faltando.join('\n  '))
    process.exit(1)
  }
  if (!/\.myshopify\.com$/.test(dominio)) {
    console.log(`aviso: "${dominio}" nao termina em .myshopify.com. O token precisa do`)
    console.log('       dominio interno da loja, nao o dominio publico. Vou tentar assim mesmo.\n')
  }

  console.log(`loja:      ${dominio}`)
  console.log(`client id: ${id.slice(0, 6)}...${id.slice(-4)}  (${id.length} caracteres)`)
  console.log(`secret:    ${segredo.slice(0, 4)}...  (${segredo.length} caracteres)\n`)

  // 1. o token
  let t
  try {
    t = await pegarToken(dominio, id, segredo)
  } catch (e) {
    console.error('TOKEN: falhou —', e.message)
    console.error('')
    for (const linha of explicar(e.codigo || '', e.message)) console.error(linha)
    process.exit(1)
  }
  console.log(`TOKEN: ok. expira em ${t.expiraEm}s (~${Math.round((t.expiraEm || 0) / 3600)}h)`)
  console.log(`  escopos concedidos: ${t.scope || '(a Shopify nao devolveu a lista)'}`)

  // Na Shopify, write_X JA INCLUI read_X — so read_all_orders e independente e
  // nao vem de graca com write_orders. Comparar so o texto literal faz o
  // conferidor acusar falta de permissao que na verdade existe.
  const PRECISA = ['read_orders', 'read_all_orders', 'read_products', 'read_checkouts']
  if (t.scope) {
    const tem = new Set(t.scope.split(',').map(s => s.trim()).filter(Boolean))
    const cobre = s => tem.has(s) ||
      (s.startsWith('read_') && s !== 'read_all_orders' && tem.has('write_' + s.slice(5)))
    const falta = PRECISA.filter(s => !cobre(s))
    const porWrite = PRECISA.filter(s => !tem.has(s) && cobre(s))
    if (porWrite.length) console.log(`  (${porWrite.join(', ')} vem do write_ equivalente — ok)`)
    if (falta.length) {
      console.log(`  ESCOPO FALTANDO: ${falta.join(', ')}`)
      if (falta.includes('read_all_orders')) console.log(
        '    read_all_orders nao vem com write_orders. Sem ele a Shopify so devolve\n' +
        '    pedido dos ultimos 60 dias, e o historico vem cortado sem avisar.')
      console.log('    conserto: Dev Dashboard > app > Versions > adiciona o escopo > Release,\n' +
                  '    e aprova a mudanca na loja.')
    } else console.log('  todos os escopos que o coletor precisa estao cobertos')
  }

  // 2. a loja
  const loja = await admin(dominio, t.token, 'shop.json')
  if (!loja.ok) {
    console.log(`\nLOJA: nao consegui ler (HTTP ${loja.status}) ${loja.cru}`)
  } else {
    const s = loja.corpo.shop
    console.log(`\nLOJA: "${s.name}"  moeda ${s.currency}  fuso ${s.iana_timezone}  pais ${s.country_code}`)
    console.log(`  criada em ${String(s.created_at).slice(0, 10)}  plano ${s.plan_display_name}`)
  }

  // 3. pedidos
  const ped = await admin(dominio, t.token, 'orders.json?status=any&limit=3&fields=id,created_at,total_price,currency,financial_status')
  if (!ped.ok) {
    console.log(`\nPEDIDOS: nao consegui ler (HTTP ${ped.status}) ${ped.cru}`)
    console.log('  se deu 403, falta read_orders (e read_all_orders para pedido antigo)')
  } else {
    const l = ped.corpo.orders || []
    console.log(`\nPEDIDOS: leitura ok, ${l.length} amostra(s)`)
    for (const o of l) console.log(`  ${String(o.created_at).slice(0, 19)}  $${o.total_price} ${o.currency}  ${o.financial_status}`)
    if (!l.length) console.log('  (a loja nao tem pedido nenhum ainda, ou o escopo nao cobre)')
  }

  // 4. contagem, para eu saber o tamanho do historico
  const cont = await admin(dominio, t.token, 'orders/count.json?status=any')
  if (cont.ok) console.log(`  total de pedidos na loja: ${cont.corpo.count}`)

  // 5. produtos
  const pr = await admin(dominio, t.token, 'products.json?limit=3&fields=id,title,status,variants')
  if (!pr.ok) console.log(`\nPRODUTOS: nao consegui ler (HTTP ${pr.status})`)
  else {
    const l = pr.corpo.products || []
    console.log(`\nPRODUTOS: leitura ok, ${l.length} amostra(s)`)
    for (const p of l) console.log(`  ${String(p.title).slice(0, 44).padEnd(46)} ${p.status}  ${p.variants?.length || 0} variante(s)`)
  }

  // 6. carrinho abandonado
  const ab = await admin(dominio, t.token, 'checkouts.json?limit=1')
  console.log(`\nCARRINHO ABANDONADO: ${ab.ok ? 'leitura ok' : `nao consegui (HTTP ${ab.status}) — falta read_checkouts`}`)

  console.log('\n' + '='.repeat(70))
  console.log('nada foi gravado no banco. Se os quatro blocos acima estao ok, me diz')
  console.log('e eu cadastro a loja e movo a Conta 6 para ela (com --dry-run primeiro).')
  console.log('='.repeat(70))
})().catch(e => { console.error('erro inesperado:', e.message); process.exitCode = 1 })
