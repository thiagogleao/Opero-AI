import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { beginNavigation, endNavigation, IN_FLIGHT_TTL_MS, inFlightParam, isStoreOnlyPath, navigationInFlight } from '../url'

// The URL rules themselves are lib/period's (url.ts: desktopHref, layer,
// pickIsNoop), tested in lib/period/__tests__. This file keeps the shell's own
// part: the in-flight registry, and the store-only route list against every
// page's scope.

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'

describe('the navigation in flight', () => {
  it('is used only while it loads, and only its own token ends it', () => {
    const t0 = 1_000_000
    const first = beginNavigation(`/products?loja=${MOKOO}&periodo=30d`, t0)
    expect(inFlightParam('periodo', t0)).toBe('30d')
    expect(inFlightParam('parte', t0)).toBeNull()
    const second = beginNavigation(`/products?loja=glooty&periodo=30d`, t0)
    endNavigation(first) // the replaced navigation's control finishing changes nothing
    expect(navigationInFlight(t0)).toBe('/products?loja=glooty&periodo=30d')
    endNavigation(second)
    expect(navigationInFlight(t0)).toBeNull()
    expect(inFlightParam('loja', t0)).toBeUndefined()
  })

  it('a navigation that never reported back stops counting after the safety window', () => {
    const t0 = 2_000_000
    const tok = beginNavigation(`/?loja=${MOKOO}`, t0)
    expect(navigationInFlight(t0 + IN_FLIGHT_TTL_MS - 1)).toBe(`/?loja=${MOKOO}`)
    expect(navigationInFlight(t0 + IN_FLIGHT_TTL_MS + 1)).toBeNull()
    endNavigation(tok)
  })
})

describe('isStoreOnlyPath', () => {
  it('matches each one-store page and its subpaths, and only those', () => {
    for (const p of ['/', '/attribution', '/profit', '/settings', '/settings/chaves', '/facebook/accounts', '/creatives/120249693989210625']) {
      expect(isStoreOnlyPath(p), p).toBe(true)
    }
    for (const p of ['/overview', '/campaigns', '/products', '/countries', '/dev/ui', '/profits', '/settingsx']) {
      expect(isStoreOnlyPath(p), p).toBe(false)
    }
  })

  // The list repeats what each page asks getPageContext for; this keeps the two
  // from drifting apart (a page moved to scope 'store' without the list would
  // let "Todas as lojas" do nothing again while it loads).
  it('agrees with the scope every shell page asks getPageContext for', () => {
    const appDir = path.resolve(__dirname, '../../../app')
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === 'page.tsx') pages.push(full)
      }
    }
    walk(appDir)
    let checked = 0
    for (const file of pages) {
      const src = readFileSync(file, 'utf8')
      const usesShell = /getPageContext\(|<PickerPage\b/.test(src)
      if (!usesShell) continue
      const storeOnly = /scope:\s*'store'/.test(src) || /<PickerPage\b/.test(src)
      const route = '/' + path.relative(appDir, path.dirname(file)).split(path.sep)
        .filter(seg => seg && !/^\(.*\)$/.test(seg))
        .map(seg => (seg.startsWith('[') ? 'x' : seg))
        .join('/')
      expect(isStoreOnlyPath(route), `${route} (${path.relative(appDir, file)})`).toBe(storeOnly)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })
})

// ─── Row dates (?volta) are page state (regression) ──────────────────────────
// volta was not a state key, so the shell copied it from the URL on screen into
// every URL its pickers built: dates picked after a Todas row link opened as
// "?…&periodo=custom&de=2026-11-01&ate=2026-11-10&volta=today", and the server
// read them as stale row dates and showed "Hoje". It followed preset clicks
// and the store picker too. Only the server-built query may carry it now.
