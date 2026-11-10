/**
 * Duas coisas novas na tabela tenants:
 *
 * 1. Credenciais de app do Dev Dashboard da Shopify. Desde 01/01/2026 nao da
 *    mais para criar app pelo admin da loja, e o app do Dev Dashboard nao tem
 *    token fixo: o token sai do "client credentials grant" e vale 24h. Entao a
 *    loja guarda client_id/client_secret e o token passa a ser descartavel,
 *    com a validade anotada.
 *
 *    As lojas antigas (MOKOO, EPOCH, Dumpling) tem token legado permanente e
 *    nao mudam: se shopify_client_id for NULL, nada no codigo tenta renovar.
 *
 * 2. archived_at, para tirar uma loja de circulacao sem apagar o historico
 *    dela nem perder a credencial. Mais seguro que zerar o token, que era o
 *    unico jeito que existia e e irreversivel.
 *
 * Roda no banco do DATABASE_URL do .env — NAO no endereco fixo do migrate.js,
 * que aponta para um junction morto.
 *
 * Uso:  node migrate_shopify_oauth.js [--dry-run]
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require(path.join(__dirname, 'frontend/node_modules/pg'))

const dryRun = process.argv.includes('--dry-run')
const DATABASE_URL = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()

const COLUNAS = [
  ['shopify_client_id', 'TEXT', 'Client ID do app do Dev Dashboard'],
  ['shopify_client_secret', 'TEXT', 'Client secret (shps_...)'],
  ['shopify_token_expires_at', 'TIMESTAMPTZ', 'quando o token atual vence'],
  ['archived_at', 'TIMESTAMPTZ', 'loja fora de circulacao, historico preservado'],
]

;(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const client = await pool.connect()
  try {
    const { rows: [onde] } = await client.query(
      `SELECT current_database() db, inet_server_addr()::text ip`)
    console.log(`banco: ${onde.db} em ${onde.ip}\n`)

    const { rows: antes } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='tenants'`)
    const tem = new Set(antes.map(r => r.column_name))

    await client.query('BEGIN')
    for (const [nome, tipo, porque] of COLUNAS) {
      if (tem.has(nome)) { console.log(`  ja existe  ${nome}`); continue }
      await client.query(`ALTER TABLE tenants ADD COLUMN ${nome} ${tipo}`)
      console.log(`  criada     ${nome.padEnd(26)} ${tipo.padEnd(13)} ${porque}`)
    }

    const { rows: depois } = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name='tenants' AND column_name = ANY($1::text[]) ORDER BY 1`,
      [COLUNAS.map(c => c[0])])
    console.log(`\nconferencia: ${depois.length}/${COLUNAS.length} colunas presentes`)
    for (const c of depois) console.log(`  ${c.column_name.padEnd(26)} ${c.data_type}`)
    if (depois.length !== COLUNAS.length) throw new Error('faltou coluna, desfazendo')

    // Nenhuma loja existente e afetada: todas ficam com os quatro campos nulos.
    const { rows: [n] } = await client.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE shopify_client_id IS NOT NULL)::int com_app,
              count(*) FILTER (WHERE archived_at IS NOT NULL)::int arquivadas
         FROM tenants`)
    console.log(`\nlojas: ${n.total} no total, ${n.com_app} com app novo, ${n.arquivadas} arquivadas`)

    if (dryRun) { await client.query('ROLLBACK'); console.log('\n--dry-run: desfeito, nada gravado') }
    else { await client.query('COMMIT'); console.log('\ngravado') }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('erro, nada foi gravado:', e.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
})()
