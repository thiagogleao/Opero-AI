/**
 * Which sides of a sideways-scrolling table box still hide columns (pure; used
 * by DataTable's edge fade). A pixel of slack on each side: zoomed layouts
 * report fractional widths, and a table 0,5px wider than its box is not
 * hiding anything.
 */
export function hiddenEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): { left: boolean; right: boolean } {
  const max = scrollWidth - clientWidth
  if (max <= 1) return { left: false, right: false }
  return { left: scrollLeft > 1, right: scrollLeft < max - 1 }
}
