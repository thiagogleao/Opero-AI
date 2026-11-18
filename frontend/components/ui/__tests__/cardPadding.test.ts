import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Card } from '../Card'
import { KpiCard } from '../KpiCard'

// Regression: every KPI card rendered with zero padding. Card's default
// pad='none' added `.padNone { padding: 0 }`, which tied with KpiCard's own
// `.kpi { padding: … }` on specificity, so the stylesheet inserted last won —
// and the root loading.css (which carries Card.module.css) is inserted after
// the page's CSS. A default Card must add no padding rule for a caller's
// class to fight.

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? []

describe('Card padding', () => {
  it('adds no padding class by default, so a caller className owns the padding', () => {
    const cls = classOf(renderToStaticMarkup(createElement(Card, { className: 'mine' }, 'x')))
    expect(cls).toContain('mine')
    expect(cls.some(c => /pad/i.test(c))).toBe(false)
  })

  it('still adds the class for an explicit pad', () => {
    const cls = classOf(renderToStaticMarkup(createElement(Card, { pad: 'md' }, 'x')))
    expect(cls.some(c => /padMd/.test(c))).toBe(true)
  })

  it('KpiCard root carries only Card + Kpi classes, no padding override', () => {
    const cls = classOf(renderToStaticMarkup(createElement(KpiCard, { label: 'Receita', value: '$1' })))
    expect(cls.some(c => /kpi/.test(c))).toBe(true)
    expect(cls.some(c => /pad/i.test(c))).toBe(false)
  })

  it('Card.module.css has no rule that zeroes padding (the reset already does)', () => {
    const css = readFileSync(path.resolve(__dirname, '../Card.module.css'), 'utf8')
    expect(css).not.toMatch(/\.padNone\b/)
    expect(css).not.toMatch(/^\.card\s*\{[^}]*padding/m)
  })
})
