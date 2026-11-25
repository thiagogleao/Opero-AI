/**
 * The grep tests of spec §5: the period rules exist once. They fail the suite
 * when a second implementation, a stray clock read, a store-fact date printed
 * without lib/period, or a legacy period key comes back.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../..')

function files(dir: string, exts = ['.ts', '.tsx', '.js']): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === '.next' || e === '__tests__' || e.startsWith('.')) continue
      const full = path.join(d, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (exts.some(x => e.endsWith(x)) && !e.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(path.join(ROOT, dir))
  return out
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/')
/** Code lines only: comment lines are skipped. */
const codeLines = (f: string) => readFileSync(f, 'utf8').split(/\r?\n/).map((text, i) => ({ text, n: i + 1 }))
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l.text))

const SOURCES = ['app', 'components', 'lib', 'public'].flatMap(d => files(d))

/** API routes that resolve a period: a clock read there is a second clock. */
const PERIOD_ROUTES = ['app/api/mobile/route.ts', 'app/api/mobile/detail/', 'app/api/campaigns/', 'app/api/profit/', 'app/api/webhooks/shopify/orders/']

describe('§5 grep tests', () => {
  it('resolveRange, comparisonRange and anchorTz are called only inside lib/period (and the engine that defines them)', () => {
    const bad: string[] = []
    for (const f of SOURCES) {
      const r = rel(f)
      if (r.startsWith('lib/period/') || r.startsWith('lib/engine/')) continue
      for (const l of codeLines(f)) if (/\b(resolveRange|comparisonRange|anchorTz)\(/.test(l.text)) bad.push(`${r}:${l.n}`)
    }
    expect(bad).toEqual([])
  })

  it('no clock read (new Date() / Date.now()) in lib/views, lib/period, components, app/m, lib/alerts and the period routes without a "clock-ok" reason', () => {
    const scope = (r: string) => (r.startsWith('lib/views/') || r.startsWith('lib/period/') || r.startsWith('components/') || r.startsWith('app/m/') || r === 'lib/alerts.ts'
      || PERIOD_ROUTES.some(p => r.startsWith(p)))
      && !r.startsWith('lib/period/client/')
    const bad: string[] = []
    const optOuts: string[] = []
    for (const f of SOURCES) {
      const r = rel(f)
      if (!scope(r)) continue
      for (const l of codeLines(f)) {
        if (!/new Date\(\)|Date\.now\(\)/.test(l.text)) continue
        // Only "clock-ok: <reason>" in a comment on the line itself opts out
        // ("// clock-ok: …" or "/* clock-ok: … */"): the bare word, anywhere on
        // the line, used to pass without saying why.
        const why = /(?:\/\/|\/\*)\s*clock-ok:\s*([^*\s][^*]*?)\s*(?:\*\/|$)/.exec(l.text)
        if (why) optOuts.push(`${r}:${l.n} — ${why[1].trim()}`)
        else bad.push(`${r}:${l.n}`)
      }
    }
    // Every opt-out is printed so a review sees them all.
    console.info(`clock-ok opt-outs (${optOuts.length}):\n  ${optOuts.join('\n  ')}`)
    expect(bad).toEqual([])
  })

  it('no implicit clock: todayInTz / minutesIntoDay always get their instant in the period code and routes', () => {
    // Their `now = new Date()` default reads the server clock unseen: the
    // sale push priced "today" at the webhook's run time while its link opened
    // the order's day; the summary's claim day and its view came from two
    // instants. One argument (no instant) fails here.
    const scope = (r: string) => r.startsWith('lib/views/') || r.startsWith('lib/period/') || r.startsWith('components/') || r.startsWith('app/m/')
      || r === 'lib/alerts.ts' || r.startsWith('lib/ai/') || r.startsWith('lib/data/') || r.startsWith('app/api/')
    const bad: string[] = []
    for (const f of SOURCES) {
      const r = rel(f)
      if (!scope(r)) continue
      for (const l of codeLines(f)) {
        if (/\b(todayInTz|minutesIntoDay)\(\s*[^,()]*(\([^()]*\))?[^,()]*\)/.test(l.text)) bad.push(`${r}:${l.n}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no date formatter on a store-fact date or a window bound outside lib/period (dateBeside / rangeBeside instead)', () => {
    // lib/storeExport.ts may not be changed (the Electron app reads its file).
    const allowed = new Set(['lib/storeExport.ts'])
    const bad: string[] = []
    for (const f of SOURCES) {
      const r = rel(f)
      if (r.startsWith('lib/period/') || allowed.has(r)) continue
      for (const l of codeLines(f)) {
        if (/(formatDate|formatRange|formatRangeLabel|toLocaleDateString)\(/.test(l.text)
          && /firstOrderDate|firstActivityDate|firstSale|startedOn|archivedOn|archivedAt|range\.from|range\.to|window\./.test(l.text)) bad.push(`${r}:${l.n}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('volta, rowPreset, linkDay and compareAs exist only in the legacy parsers', () => {
    // lib/period/url.ts (R15) and push.ts / phone.ts (R17) read the old URLs once.
    const legacy = new Set(['lib/period/url.ts', 'lib/period/push.ts', 'lib/period/phone.ts'])
    const re = /(['"`.]volta\b|\bvolta\s*[:=?]|\browPreset\b|\blinkDay\b|\bcompareAs\b)/
    const bad: string[] = []
    for (const f of SOURCES) {
      const r = rel(f)
      if (legacy.has(r)) continue
      for (const l of codeLines(f)) if (re.test(l.text)) bad.push(`${r}:${l.n}: ${l.text.trim().slice(0, 80)}`)
    }
    expect(bad).toEqual([])
  })

  it('the old local rules are gone (no second implementation)', () => {
    const gone = /\b(settleRowDates|rowDateClocks|rowDatesOf|allStoresWindow|linkOpensDates|rowOpensDates|storeRowSelection|expireRowDates|expireLinkDay|chipSelection|presetOf|resumoLinkOverrides|rowKeepsDates|carriedLoja|COMPARE_AS|COMPARE_AS_PRESET|COMPARE_AS_PRESETS|mergeQuery|layerHref|resolvePortfolioWindow|fitCustomRange|archivedComparison|archivedWindow|resolvePeriodWindow|parsePageParams|buildHref|comparisonPlan)\b/
    const bad: string[] = []
    for (const f of SOURCES) for (const l of codeLines(f)) if (gone.test(l.text)) bad.push(`${rel(f)}:${l.n}`)
    expect(bad).toEqual([])
  })
})
