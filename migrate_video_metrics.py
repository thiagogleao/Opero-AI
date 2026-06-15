"""
Migration: add video metric columns to fb_ad_daily_metrics.

These columns were added to the ORM model but SQLAlchemy create_all() never
ALTER TABLEs existing tables, so production is missing them. Any query that
references video_plays, video_p25/50/75/100, hook_rate, hold_rate_* will fail
with 'column does not exist' until this migration runs.

Run once on production:
    python migrate_video_metrics.py
"""

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.database import engine


def migrate():
    with engine.begin() as conn:
        cols = [
            ("video_plays",   "INTEGER"),
            ("video_p25",     "INTEGER"),
            ("video_p50",     "INTEGER"),
            ("video_p75",     "INTEGER"),
            ("video_p100",    "INTEGER"),
            ("hook_rate",     "FLOAT"),
            ("hold_rate_25",  "FLOAT"),
            ("hold_rate_50",  "FLOAT"),
            ("hold_rate_75",  "FLOAT"),
            ("hold_rate_100", "FLOAT"),
            ("add_to_cart",          "INTEGER DEFAULT 0"),
            ("initiate_checkout",    "INTEGER DEFAULT 0"),
        ]
        for col, dtype in cols:
            conn.execute(text(f"""
                ALTER TABLE fb_ad_daily_metrics
                ADD COLUMN IF NOT EXISTS {col} {dtype}
            """))
            print(f"✓ fb_ad_daily_metrics.{col} ensured")

        # Also add landing_url to fb_ads if not there
        conn.execute(text("""
            ALTER TABLE fb_ads
            ADD COLUMN IF NOT EXISTS landing_url TEXT
        """))
        print("✓ fb_ads.landing_url ensured")

    print("\nMigration complete.")


if __name__ == "__main__":
    migrate()
