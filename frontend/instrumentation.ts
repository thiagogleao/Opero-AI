/**
 * Runs once when the server process starts.
 *
 * The runtime guard matters: this file is also evaluated for the edge runtime,
 * where child_process and pg do not exist, so the scheduler is imported lazily
 * and only under Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startAutoSync } = await import('./lib/autoSync')
  startAutoSync()
}
