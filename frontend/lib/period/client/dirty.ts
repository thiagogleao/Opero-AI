/**
 * Forms with unsaved edits register here (Custos, Ajustes): while any is
 * dirty, the desktop turn refresh is deferred and the page says "O dia virou:
 * estes números são de {label}. [Atualizar]" instead of dropping the edits
 * (R8, C2-M5). Client only.
 */

const checks = new Set<() => boolean>()

/** Register a dirty check; returns the unregister function. */
export function registerDirty(isDirty: () => boolean): () => void {
  checks.add(isDirty)
  return () => { checks.delete(isDirty) }
}

export function anyDirty(): boolean {
  for (const c of checks) if (c()) return true
  return false
}
