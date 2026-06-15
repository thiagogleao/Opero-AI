"""
Migration: fix shopify_daily_metrics unique constraint to include tenant_id.

Before: UNIQUE(date)          -- breaks multi-tenant (all tenants share one row per date)
After:  UNIQUE(tenant_id, date) -- correct per-tenant isolation

Run once on production:
    python migrate_shopify_daily_tenant.py
"""

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.database import engine


def migrate():
    with engine.begin() as conn:
        # 1. Add tenant_id column if it doesn't exist yet
        conn.execute(text("""
            ALTER TABLE shopify_daily_metrics
            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64)
        """))
        print("✓ tenant_id column ensured")

        # 2. Drop the old single-column constraint if it exists
        conn.execute(text("""
            ALTER TABLE shopify_daily_metrics
            DROP CONSTRAINT IF EXISTS uq_shopify_daily_date
        """))
        print("✓ old constraint dropped")

        # 3. Create the new composite constraint
        conn.execute(text("""
            ALTER TABLE shopify_daily_metrics
            ADD CONSTRAINT uq_shopify_daily_tenant_date
            UNIQUE (tenant_id, date)
        """))
        print("✓ new constraint (tenant_id, date) created")

        # 4. Add an index on tenant_id for query performance
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_shopify_daily_tenant
            ON shopify_daily_metrics (tenant_id)
        """))
        print("✓ index on tenant_id created")

    print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
