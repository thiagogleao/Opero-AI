#!/usr/bin/env node
/**
 * Run the app locally against the production database, safely.
 *
 *   node scripts/dev-local.mjs [port]
 *
 * - DATABASE_URL is read from the repo-root .env (frontend/.env.local points at
 *   a dead database and must not be used).
 * - DATABASE_READ_ONLY=1: every transaction is read-only at the server, so
 *   nothing this process does can write to production.
 * - AUTO_SYNC_DISABLED=1: the sync scheduler, alerts and pushes stay off — a
 *   laptop must not collect, claim alerts or push to the owner's phone.
 * - MOBILE_ACCESS_TOKEN is replaced by a random one for this run; the unlock
 *   links for the owner view are printed at start.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '..')
const rootEnv = path.resolve(frontend, '..', '.env')
const port = process.argv[2] || '3100'

const env = { ...process.env }
const text = fs.existsSync(rootEnv) ? fs.readFileSync(rootEnv, 'utf8') : ''
const dbUrl = text.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!dbUrl) {
  console.error('DATABASE_URL not found in the repo-root .env')
  process.exit(1)
}
env.DATABASE_URL = dbUrl
env.DATABASE_READ_ONLY = '1'
env.AUTO_SYNC_DISABLED = '1'
env.NEXT_PUBLIC_APP_URL = `http://localhost:${port}`
if (process.env.OPERO_TMP) { env.TMP = env.TEMP = env.TMPDIR = process.env.OPERO_TMP }
// A throwaway owner token for this local run only, so the real magic-link
// secret never has to be typed, pasted or printed to unlock a laptop.
// OPERO_LOCAL_TOKEN keeps the same throwaway token across restarts (it must be
// 32+ characters and is only ever valid on this local server).
env.MOBILE_ACCESS_TOKEN = (process.env.OPERO_LOCAL_TOKEN?.length ?? 0) >= 32
  ? process.env.OPERO_LOCAL_TOKEN
  : crypto.randomBytes(32).toString('base64url')
console.log(`[dev-local] owner view: http://localhost:${port}/api/mobile/unlock?k=${env.MOBILE_ACCESS_TOKEN}&to=desktop`)
console.log(`[dev-local] phone view: http://localhost:${port}/api/mobile/unlock?k=${env.MOBILE_ACCESS_TOKEN}`)

const next = path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next')
const child = spawn(process.execPath, ['--max-old-space-size=4096', next, 'dev', '--webpack', '-p', port], {
  cwd: frontend, env, stdio: 'inherit',
})
child.on('exit', code => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
