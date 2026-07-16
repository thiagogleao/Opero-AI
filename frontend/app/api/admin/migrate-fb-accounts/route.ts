import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'

// One-time migration endpoint — runs against the production database.
// DELETE this file after migration is confirmed.
export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tenant_fb_accounts (
        id               SERIAL PRIMARY KEY,
        tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        fb_ad_account_id TEXT NOT NULL,
        fb_access_token  TEXT NOT NULL,
        nickname         TEXT,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, fb_ad_account_id)
      )
    `)

    await query(`CREATE INDEX IF NOT EXISTS idx_tenant_fb_accounts_tenant ON tenant_fb_accounts(tenant_id)`)

    await query(`ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS fb_ad_account_id TEXT`)

    await query(`CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_fb_account ON fb_ad_daily_metrics(fb_ad_account_id) WHERE fb_ad_account_id IS NOT NULL`)

    return NextResponse.json({ ok: true, message: 'Migration complete' })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
