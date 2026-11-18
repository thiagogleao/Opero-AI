'use client'

/**
 * SafeMarkdown — renders an AI answer. Model text can be steered by what a
 * shopper typed into an order note or a product title, so it is treated as
 * untrusted (AI18):
 *  - raw HTML is dropped (skipHtml);
 *  - only text elements are kept (allow-list): no images, so an answer can
 *    never make the browser fetch a URL carrying data;
 *  - a link survives only when it points to a page of this app (links.ts),
 *    and it keeps the store and period on screen; any other link, and every
 *    bare URL, is shown as plain text.
 * Tables (GFM) scroll sideways inside the drawer instead of widening it.
 *
 * Props: { children: string; className? }
 */

import Link from 'next/link'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { internalHref, withPageState } from './links'
import s from './Markdown.module.css'

const ALLOWED = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'hr',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
] as const

const heading: Components['h1'] = ({ children }) => <p className={s.h}>{children}</p>

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    const to = internalHref(href)
    if (!to) return <span>{children}</span>
    // Keep the store and period on screen (the answers render in the drawer,
    // on the client only, so reading the address here never differs from a
    // server render).
    const search = typeof window === 'undefined' ? '' : window.location.search
    return <Link href={withPageState(to, search)} className={s.link}>{children}</Link>
  },
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  table: ({ children }) => (
    <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Tabela da resposta">
      <table className={s.table}>{children}</table>
    </div>
  ),
}

/** The URL kept on a link: only app pages (everything else becomes text). */
const urlTransform = (url: string) => internalHref(url) ?? ''

export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `${s.md} ${className}` : s.md}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={urlTransform}
        components={COMPONENTS}
      >
        {children}
      </Markdown>
    </div>
  )
}
