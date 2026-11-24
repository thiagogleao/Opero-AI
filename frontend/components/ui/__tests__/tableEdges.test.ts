import { describe, expect, it } from 'vitest'
import { hiddenEdges } from '../tableEdges'

describe('hiddenEdges (DataTable edge fade)', () => {
  it('no fade when the table fits its box (or is within a pixel of it)', () => {
    expect(hiddenEdges(0, 906, 906)).toEqual({ left: false, right: false })
    expect(hiddenEdges(0, 906.6, 906)).toEqual({ left: false, right: false })
  })

  it('a wider table at rest hides columns on the right only', () => {
    expect(hiddenEdges(0, 914, 906)).toEqual({ left: false, right: true })
  })

  it('scrolled to the middle hides both sides; to the end, the left only', () => {
    expect(hiddenEdges(200, 1200, 700)).toEqual({ left: true, right: true })
    expect(hiddenEdges(500, 1200, 700)).toEqual({ left: true, right: false })
    expect(hiddenEdges(499.5, 1200, 700)).toEqual({ left: true, right: false })
  })
})
