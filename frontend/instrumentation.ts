/**
 * Runs once when a server process starts.
 *
 * Next evaluates this file for both runtimes. The Node-only code (the sync
 * scheduler, child_process, pg) lives in instrumentation-node.ts and is
 * imported inside `if (process.env.NEXT_RUNTIME === 'nodejs')` — the
 * documented pattern. The compiler replaces NEXT_RUNTIME per build and drops
 * the import from the edge bundle; the old early-return form did not, so the
 * edge compile of `next dev` tried to bundle child_process and every route
 * answered 500.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
