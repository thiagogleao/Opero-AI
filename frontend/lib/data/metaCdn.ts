/**
 * Meta's CDN links for ad pictures (scontent-*.fbcdn.net, external-*.fbcdn.net)
 * are signed: the `oe` parameter is the expiry, in unix seconds written in hex.
 * Past it the CDN answers 403, which the browser logs as a console error on
 * every load, and the collector does not refresh the stored link. Production
 * on 18 nov: 2.619 of 2.630 external thumbnails, 2.565 of 2.604 creatives and
 * 1.308 of 5.798 scontent thumbnails had expired; every link carried `oe`.
 *
 * Pure, no imports: used by the data layer (lib/data/meta loadAdInfo) and by
 * client-safe screen helpers alike.
 */

/** The `oe` expiry of a signed CDN link; null when the link has none or is not a URL. */
export function signedUrlExpiry(url: string | null | undefined): Date | null {
  if (!url) return null
  try {
    const oe = new URL(url).searchParams.get('oe')
    return oe && /^[0-9a-f]{6,10}$/i.test(oe) ? new Date(parseInt(oe, 16) * 1000) : null
  } catch {
    return null
  }
}

/**
 * The link when it can still load: null when it is empty, not a URL, or its
 * `oe` expiry has passed. A link without `oe` is kept (nothing says it died).
 */
export function liveSignedUrl(url: string | null | undefined, now: Date): string | null {
  if (!url) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  const exp = signedUrlExpiry(url)
  return exp && exp.getTime() <= now.getTime() ? null : url
}

/**
 * An ad's two picture links with the dead ones dropped, and whether it had a
 * picture that expired (so the screen can say why there is none instead of
 * showing an unexplained empty box).
 */
export function livePictures(
  thumbnailUrl: string | null | undefined, creativeUrl: string | null | undefined, now: Date,
): { thumbnailUrl: string | null; creativeUrl: string | null; previewExpired: boolean } {
  const thumb = liveSignedUrl(thumbnailUrl, now)
  const creative = liveSignedUrl(creativeUrl, now)
  return { thumbnailUrl: thumb, creativeUrl: creative, previewExpired: !thumb && !creative && !!(thumbnailUrl || creativeUrl) }
}
