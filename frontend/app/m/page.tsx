import { hasMobileSession } from '@/lib/mobileAuth'
import Dashboard from './Dashboard'

// Auth is per-request (cookie), so this page must never be cached or prerendered.
export const dynamic = 'force-dynamic'

const SHELL_CSS = `
  .m-root {
    /* Dark-only by design: this is a glanceable phone dashboard, and the
       surface is fixed so the accent and status hues stay validated. */
    color-scheme: dark;
    --surface:  #0a0f0d;   /* page plane */
    --card:     #121815;   /* raised card */
    --hairline: rgba(255,255,255,0.08);
    --ink:      #ffffff;
    --ink-2:    #a8b3ae;
    --ink-3:    #6b7873;
    --good:     #059669;   /* data mark: positive — validated on --surface */
    --bad:      #d03b3b;   /* data mark: negative */
    --accent:   #10b981;   /* brand: chrome only, never a data mark */

    min-height: 100dvh;
    background: var(--surface);
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    padding:
      calc(env(safe-area-inset-top) + 12px)
      calc(env(safe-area-inset-right) + 14px)
      calc(env(safe-area-inset-bottom) + 28px)
      calc(env(safe-area-inset-left) + 14px);
    max-width: 640px;
    margin: 0 auto;
  }
  .m-root * { box-sizing: border-box; }
  .m-root button { font: inherit; color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    .m-root *, .m-root *::before { animation: none !important; transition: none !important; }
  }
`

export default async function MobilePage() {
  const allowed = await hasMobileSession()

  return (
    <div className="m-root">
      <style>{SHELL_CSS}</style>
      {allowed ? <Dashboard /> : <Denied />}
    </div>
  )
}

/**
 * Shown to anyone without the session cookie. Deliberately says nothing about
 * what this app is, which stores exist, or how to get in — the only way in is
 * the magic link, which the owner already has.
 */
function Denied() {
  return (
    <div style={{ paddingTop: '30vh', textAlign: 'center' }}>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', margin: 0 }}>Acesso restrito</p>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>
        Abra o link de acesso neste dispositivo.
      </p>
    </div>
  )
}
