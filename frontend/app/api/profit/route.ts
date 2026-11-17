/**
 * /api/profit — a store's cost settings: read them, preview a draft, save.
 *
 *   GET  ?store=<id>                     → ProfitConfigResponse
 *   POST { storeId?, config?, period?, from?, to? } → ProfitPreviewResponse
 *   PUT  { storeId, baseVersion, config }           → ProfitSaveResponse
 *
 * Types and the validation rules live in lib/data/profitConfig.ts.
 *
 * The preview prices the draft through the profit engine itself
 * (computeStorePnL with configOverride), so what the cost screen shows is what
 * the dashboard will show once saved. This route used to run its own copy of
 * the maths, without Shopify ads and with its own daily source, and showed
 * $18k of profit for a store the dashboard put at $8.6k.
 *
 * A save is checked field by field, merged onto what is stored (a partial body
 * never wipes anything), and written only if the settings have not changed
 * since the screen loaded them (baseVersion). A screen whose load failed has no
 * version and cannot save an empty form over a store's rate cards.
 */

import { AccessError, accessErrorResponse, getViewer, requireStore, resolveStore, type StoreRef, type Viewer } from '@/lib/access'
import { query } from '@/lib/db'
import { computeStorePnL } from '@/lib/engine/pnl'
import { formatRange, todayInTz } from '@/lib/engine/dates'
import {
  EMPTY_CONFIG_ISSUE, NO_CONFIG_VERSION, costBreakdown, isEmptyConfig, normalizeSavedConfig, parseProfitConfig,
  parseWindow, sameConfig, saveDecision,
  type ConfigIssue, type ProfitApiError, type ProfitConfig, type ProfitConfigResponse, type ProfitPreviewResponse,
  type ProfitSaveResponse, type ProfitStoreSummary,
} from '@/lib/data/profitConfig'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** MOKOO's settings (283 products, 49 country lists) are about 40 KB. */
const MAX_BODY_BYTES = 1_000_000

const NO_STORE = { 'Cache-Control': 'no-store' }

function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

function fail(status: number, error: string, extra: Omit<ProfitApiError, 'error'> = {}): Response {
  return json<ProfitApiError>({ error, ...extra }, status)
}

const summary = (s: StoreRef): ProfitStoreSummary => ({ id: s.id, name: s.name, timezone: s.timezone, archived: s.archived })

async function viewerOr401(): Promise<Viewer> {
  const v = await getViewer()
  if (!v) throw new AccessError(401)
  return v
}

/** The store asked for, which the viewer must be able to see; without one,
 *  the store the site has selected. Never silently another store than the one
 *  named: a cost screen showing the wrong store's settings gets them edited. */
async function pickStore(viewer: Viewer, id: unknown): Promise<StoreRef> {
  if (typeof id === 'string' && id) return requireStore(viewer, id)
  if (id !== undefined && id !== null && id !== '') throw new AccessError(404)
  const { store } = await resolveStore(viewer, null)
  if (!store) throw new AccessError(404)
  return store
}

type Body = { ok: true; body: Record<string, unknown> } | { ok: false; res: Response }

async function readBody(req: Request): Promise<Body> {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return { ok: false, res: fail(413, 'A configuração enviada é grande demais.') }
  if (!text.trim()) return { ok: true, body: {} }
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, body: v as Record<string, unknown> }
  } catch { /* fall through */ }
  return { ok: false, res: fail(400, 'Corpo da requisição inválido: envie um objeto JSON.') }
}

interface Saved { raw: unknown; version: string }

/** The stored settings and their version: md5 of the jsonb text, which
 *  Postgres keeps in one canonical form, so the version changes exactly when
 *  the content does — and the save below can compare it in the same UPDATE. */
async function loadSaved(storeId: string): Promise<Saved> {
  const [row] = await query<{ settings: unknown; version: string }>(
    `SELECT settings, md5(settings::text) AS version FROM profit_settings WHERE tenant_id = $1`,
    [storeId],
  )
  return row ? { raw: row.settings, version: row.version } : { raw: null, version: NO_CONFIG_VERSION }
}

/** Write `cfg` only if the stored version is still `baseVersion`. Returns the
 *  new version, or null when someone saved in between. */
async function writeIfUnchanged(storeId: string, cfg: ProfitConfig, baseVersion: string): Promise<string | null> {
  const settings = JSON.stringify(cfg)
  const rows = baseVersion === NO_CONFIG_VERSION
    ? await query<{ version: string }>(
        `INSERT INTO profit_settings (tenant_id, settings) VALUES ($1, $2::jsonb)
         ON CONFLICT (tenant_id) DO NOTHING
         RETURNING md5(settings::text) AS version`,
        [storeId, settings])
    : await query<{ version: string }>(
        `UPDATE profit_settings SET settings = $2::jsonb
          WHERE tenant_id = $1 AND md5(settings::text) = $3
         RETURNING md5(settings::text) AS version`,
        [storeId, settings, baseVersion])
  return rows[0]?.version ?? null
}

// ─── GET: the saved settings ──────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const viewer = await viewerOr401()
    const store = await pickStore(viewer, new URL(req.url).searchParams.get('store'))
    const saved = await loadSaved(store.id)
    const n = normalizeSavedConfig(saved.raw)
    return json<ProfitConfigResponse>({
      store: summary(store), configured: n.configured, version: saved.version,
      config: n.config, issues: n.issues, warnings: n.warnings,
    })
  } catch (err) {
    return accessErrorResponse(err)
  }
}

// ─── POST: preview ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const viewer = await viewerOr401()
    const read = await readBody(req)
    if (!read.ok) return read.res
    const body = read.body
    if (body.action === 'save') return fail(400, 'Para salvar, use PUT /api/profit com storeId, baseVersion e config.')

    const store = await pickStore(viewer, body.storeId)
    const win = parseWindow(body, store.timezone)
    if (!win.ok) return fail(400, win.issue.message, { issues: [win.issue] })

    const saved = await loadSaved(store.id)
    const norm = normalizeSavedConfig(saved.raw)
    const hasDraft = body.config !== undefined && body.config !== null

    let cfg: ProfitConfig | null
    let issues: ConfigIssue[]
    let warnings: ConfigIssue[]
    let changed = false
    if (hasDraft) {
      const parsed = parseProfitConfig(body.config, norm.config)
      cfg = parsed.config
      issues = parsed.issues
      warnings = isEmptyConfig(cfg) ? [EMPTY_CONFIG_ISSUE, ...parsed.warnings] : parsed.warnings
      changed = !norm.configured || !sameConfig(cfg, norm.config)
    } else {
      // Nothing saved and no draft: the engine's "custos não configurados".
      cfg = norm.configured ? norm.config : null
      issues = norm.issues
      warnings = norm.warnings
    }

    // The saved settings are priced with no override: the engine reads the
    // stored row itself, exactly as the dashboard does. Pricing the normalised
    // copy instead would match only while normalising is lossless, and a row
    // written by a script (a lowercase country, a duplicate entry) would make
    // "saved" on this screen differ from the dashboard.
    const draft = hasDraft && cfg ? { configOverride: { [store.id]: cfg } } : {}
    const [run, before] = await Promise.all([
      computeStorePnL(store.id, win.range, { products: true, ...draft }),
      changed ? computeStorePnL(store.id, win.range) : Promise.resolve(null),
    ])
    if (!run) throw new AccessError(404)

    return json<ProfitPreviewResponse>({
      store: summary(store),
      period: win.period,
      range: win.range,
      label: formatRange(win.range, todayInTz(store.timezone)),
      partial: run.partial,
      source: hasDraft ? 'draft' : 'saved',
      configured: run.configured,
      version: saved.version,
      totals: run.totals,
      daily: run.daily,
      breakdown: costBreakdown(run, run.configured ? cfg : null),
      saved: before ? { configured: before.configured, totals: before.totals } : null,
      changed,
      issues,
      warnings,
    })
  } catch (err) {
    return accessErrorResponse(err)
  }
}

// ─── PUT: save ────────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  try {
    const viewer = await viewerOr401()
    const read = await readBody(req)
    if (!read.ok) return read.res
    const body = read.body

    if (typeof body.storeId !== 'string' || !body.storeId) {
      return fail(400, 'Informe a loja (storeId).', { issues: [{ path: 'storeId', message: 'Informe a loja.' }] })
    }
    // Partners may edit their own stores and the owner every store: the same
    // rule as seeing them.
    const store = await requireStore(viewer, body.storeId)
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return fail(400, 'Envie a configuração (config) como objeto.', { issues: [{ path: 'config', message: 'Envie a configuração.' }] })
    }

    const saved = await loadSaved(store.id)
    const decision = saveDecision(body.baseVersion, saved.version)
    if (!decision.ok) return fail(decision.status, decision.issue.message, { issues: [decision.issue], version: saved.version })

    const norm = normalizeSavedConfig(saved.raw)
    const parsed = parseProfitConfig(body.config, norm.config)
    if (parsed.issues.length) {
      return fail(422, 'Configuração inválida: corrija os campos indicados.', { issues: parsed.issues, warnings: parsed.warnings })
    }
    if (isEmptyConfig(parsed.config)) {
      return fail(422, EMPTY_CONFIG_ISSUE.message, { issues: [EMPTY_CONFIG_ISSUE], warnings: parsed.warnings })
    }
    if (norm.configured && sameConfig(parsed.config, norm.config)) {
      return json<ProfitSaveResponse>({ ok: true, changed: false, version: saved.version, configured: true, config: norm.config, warnings: parsed.warnings })
    }

    const version = await writeIfUnchanged(store.id, parsed.config, saved.version)
    if (!version) {
      const now = await loadSaved(store.id)
      return fail(409, 'A configuração foi alterada por outra pessoa enquanto você editava. Recarregue para ver a versão atual.', {
        issues: [{ path: 'baseVersion', message: 'Versão desatualizada.' }], version: now.version,
      })
    }
    return json<ProfitSaveResponse>({ ok: true, changed: true, version, configured: true, config: parsed.config, warnings: parsed.warnings })
  } catch (err) {
    return accessErrorResponse(err)
  }
}
