import { describe, expect, it } from 'vitest'
import { livePictures, liveSignedUrl, signedUrlExpiry } from '../metaCdn'

// oe = unix seconds in hex. 0x6AE8388F = 2026-11-02T07:15:27Z (CRI2's creative link).
const NOW = new Date('2026-11-18T12:00:00Z')
const dead = 'https://scontent.xx.fbcdn.net/v/t45.1600-4/a.jpg?stp=x&_nc_cat=1&oh=00_x&oe=6AE8388F'
const live = `https://external.xx.fbcdn.net/emg1/v/t13/1?url=x&oh=00_y&oe=${Math.floor(Date.parse('2026-11-25T00:00:00Z') / 1000).toString(16).toUpperCase()}`

describe('signed Meta CDN links', () => {
  it('reads the oe expiry', () => {
    expect(signedUrlExpiry(dead)?.toISOString()).toBe('2026-11-02T07:15:27.000Z')
    expect(signedUrlExpiry('https://example.com/a.jpg')).toBeNull()
    expect(signedUrlExpiry('not a url')).toBeNull()
  })

  it('drops an expired link before the browser asks for it (a 403 in the console on every load)', () => {
    expect(liveSignedUrl(dead, NOW)).toBeNull()
    expect(liveSignedUrl(live, NOW)).toBe(live)
    // Nothing says a link without oe died; a non-URL never loads.
    expect(liveSignedUrl('https://example.com/a.jpg', NOW)).toBe('https://example.com/a.jpg')
    expect(liveSignedUrl('not a url', NOW)).toBeNull()
    expect(liveSignedUrl(null, NOW)).toBeNull()
  })

  it('says the picture expired only when the ad had one and every link died', () => {
    expect(livePictures(dead, dead, NOW)).toEqual({ thumbnailUrl: null, creativeUrl: null, previewExpired: true })
    expect(livePictures(dead, live, NOW)).toEqual({ thumbnailUrl: null, creativeUrl: live, previewExpired: false })
    expect(livePictures(null, null, NOW)).toEqual({ thumbnailUrl: null, creativeUrl: null, previewExpired: false })
  })
})
