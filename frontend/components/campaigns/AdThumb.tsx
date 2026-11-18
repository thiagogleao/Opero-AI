'use client'

/**
 * AdThumb — the picture of an ad, with a fallback. Meta's CDN URLs are signed
 * and expire (the stored thumbnail of an old ad answers 403), so each source
 * is tried in turn and, when none loads, an icon shows instead of a
 * broken-image box. A plain <img>: next/image would only proxy and cache URLs
 * that are about to expire.
 *
 * The fallback walks the sources on the <img> element itself (no React state):
 * an image that failed before hydration fired its error event before React was
 * listening, so the ref callback checks for that case on mount.
 *
 * Props: { sources: (string|null)[] (best first); video?: boolean; className?: string;
 *          alt?: string; iconSize?: number }
 */

import { Icon } from '@/components/ui/Icon'
import s from './AdThumb.module.css'

export function AdThumb({ sources, video, className, alt = '', iconSize = 16 }: {
  sources: (string | null)[]; video?: boolean; className?: string; alt?: string; iconSize?: number
}) {
  const list = sources.filter((x): x is string => !!x)
  const advance = (img: HTMLImageElement) => {
    const next = Number(img.dataset.i ?? 0) + 1
    if (next < list.length) {
      img.dataset.i = String(next)
      img.src = list[next]
    } else {
      img.hidden = true
    }
  }
  return (
    <span className={`${s.wrap} ${className ?? ''}`}>
      {list.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={list[0]}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={e => advance(e.currentTarget)}
          ref={el => { if (el && el.complete && el.naturalWidth === 0) advance(el) }}
        />
      )}
      <span className={s.fallback}><Icon name={video ? 'dot' : 'box'} size={iconSize} label={list.length ? undefined : alt || undefined} /></span>
    </span>
  )
}
