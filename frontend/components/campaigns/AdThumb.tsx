'use client'

/**
 * AdThumb — the picture of an ad, with a fallback that says why there is none.
 * Meta's CDN URLs are signed and expire; lib/data/meta drops the expired ones
 * before they get here (the browser would log a 403 for each), so `sources`
 * holds only links that may still load, and `expired` says the ad had a
 * picture whose link died. A link that still fails is tried in turn and, when
 * none loads, the fallback shows instead of a broken-image box. A plain <img>:
 * next/image would only proxy and cache URLs that are about to expire.
 *
 * The fallback walks the sources on the <img> element itself (no React state):
 * an image that failed before hydration fired its error event before React was
 * listening, so the ref callback checks for that case on mount.
 *
 * Props: { sources: (string|null)[] (best first); video?: boolean; className?: string;
 *          alt?: string; iconSize?: number;
 *          expired?: boolean (the ad's picture links all expired);
 *          label?: boolean (write the reason next to the icon; otherwise it is the tooltip);
 *          compact?: boolean (with no picture, shrink to one line instead of keeping
 *            the box's aspect ratio — the creative page's large preview) }
 */

import { Icon } from '@/components/ui/Icon'
import s from './AdThumb.module.css'

export const PREVIEW_EXPIRED = 'Prévia indisponível — o link do Meta expirou'
export const PREVIEW_NONE = 'Sem prévia — o Meta não enviou imagem deste anúncio'
export const PREVIEW_FAILED = 'Prévia indisponível — o Meta não entregou a imagem'

export function AdThumb({ sources, video, className, alt = '', iconSize = 16, expired, label, compact }: {
  sources: (string | null)[]; video?: boolean; className?: string; alt?: string; iconSize?: number
  expired?: boolean; label?: boolean; compact?: boolean
}) {
  const list = sources.filter((x): x is string => !!x)
  const noneText = expired ? PREVIEW_EXPIRED : PREVIEW_NONE
  const advance = (img: HTMLImageElement) => {
    const next = Number(img.dataset.i ?? 0) + 1
    if (next < list.length) {
      img.dataset.i = String(next)
      img.src = list[next]
    } else {
      img.hidden = true
      // The wrapper switches to the "failed" reason (and, when compact, to one line).
      const wrap = img.parentElement
      if (wrap) { wrap.dataset.empty = 'failed'; wrap.title = PREVIEW_FAILED }
    }
  }
  return (
    <span
      className={`${s.wrap} ${compact ? s.compact : ''} ${className ?? ''}`}
      data-empty={list.length ? undefined : 'none'}
      title={list.length ? undefined : noneText}
    >
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
      <span className={`${s.fallback} ${label ? s.labelled : ''}`}>
        <Icon name={video ? 'dot' : 'box'} size={iconSize} label={label ? undefined : `${alt ? `${alt}: ` : ''}${list.length ? PREVIEW_FAILED : noneText}`} />
        {label && (
          <span className={s.why}>
            {list.length > 0 ? PREVIEW_FAILED : noneText}
          </span>
        )}
      </span>
    </span>
  )
}
