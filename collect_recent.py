"""
Manual collection runner.

Usage:
  python collect_recent.py                        # last 30 days, both sources, uses .env creds
  python collect_recent.py --days 7               # last 7 days
  python collect_recent.py --source facebook      # only facebook
  python collect_recent.py --tenant <clerk_user_id>  # use credentials from tenants table
  python collect_recent.py --date-from 2024-01-01 --date-to 2024-01-31
"""

import argparse
import logging
import sys
from datetime import date, timedelta

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("collect_recent")


def parse_args():
    p = argparse.ArgumentParser(description="Collect Facebook Ads + Shopify data")
    p.add_argument("--source", choices=["facebook", "shopify", "both"], default="both")
    p.add_argument("--days", type=int, default=30, help="Collect last N days (default: 30)")
    p.add_argument("--date-from", dest="date_from", type=date.fromisoformat)
    p.add_argument("--date-to",   dest="date_to",   type=date.fromisoformat)
    p.add_argument("--tenant",    dest="tenant_id",  default=None,
                   help="Clerk user_id — reads credentials from tenants table")
    return p.parse_args()


def load_tenant_creds(tenant_id: str, session) -> dict:
    """Fetch credentials from tenants table for the given Clerk user_id."""
    from sqlalchemy import text
    row = session.execute(
        text("SELECT * FROM tenants WHERE id = :id"),
        {"id": tenant_id}
    ).mappings().fetchone()
    if not row:
        raise ValueError(f"Tenant '{tenant_id}' not found in tenants table")
    return dict(row)


def run_facebook(date_from: date, date_to: date, session, tenant_id=None, creds=None):
    if creds and (not creds.get("fb_access_token") or not creds.get("fb_ad_account_id")):
        print("  [facebook] skipped — no credentials configured")
        return
    from app.collectors.facebook import FacebookCollector
    kwargs = {"tenant_id": tenant_id}
    if creds:
        kwargs["access_token"]  = creds["fb_access_token"]
        kwargs["ad_account_id"] = creds["fb_ad_account_id"]
    collector = FacebookCollector(session, **kwargs)
    n = collector.collect(date_from, date_to)
    print(f"  [facebook] {n} records collected")


def run_shopify(date_from: date, date_to: date, session, tenant_id=None, creds=None):
    if creds and (not creds.get("shopify_domain") or not creds.get("shopify_access_token")):
        print("  [shopify]  skipped — no credentials configured")
        return
    from app.collectors.shopify import ShopifyCollector
    kwargs = {"tenant_id": tenant_id}
    if creds:
        kwargs["store_url"]    = creds["shopify_domain"]
        kwargs["access_token"] = creds["shopify_access_token"]
    collector = ShopifyCollector(session, **kwargs)
    n = collector.collect(date_from, date_to)
    print(f"  [shopify]  {n} records collected")


def main():
    args = parse_args()

    today     = date.today()
    date_to   = args.date_to   or today
    date_from = args.date_from or (date_to - timedelta(days=args.days))

    print("=" * 52)
    print("  AdAnalyzer — Data Collection")
    print("=" * 52)
    print(f"  Period : {date_from} → {date_to}")
    print(f"  Source : {args.source}")
    if args.tenant_id:
        print(f"  Tenant : {args.tenant_id}")
    print("=" * 52)

    from app.database import get_db

    errors = []

    with get_db() as session:
        creds = None
        if args.tenant_id:
            try:
                creds = load_tenant_creds(args.tenant_id, session)
                print(f"  Store  : {creds['shopify_domain']}")
                print(f"  FB Acc : {creds['fb_ad_account_id']}")
                print("=" * 52)
            except Exception as e:
                print(f"  ✗ {e}")
                sys.exit(1)

        if args.source in ("facebook", "both"):
            try:
                run_facebook(date_from, date_to, session, args.tenant_id, creds)
            except Exception as e:
                logger.exception("Facebook collection failed")
                errors.append(f"Facebook: {e}")

        if args.source in ("shopify", "both"):
            try:
                run_shopify(date_from, date_to, session, args.tenant_id, creds)
            except Exception as e:
                logger.exception("Shopify collection failed")
                errors.append(f"Shopify: {e}")

    print("\n" + "=" * 52)
    if errors:
        print("  FAILED")
        for err in errors:
            print(f"  ✗ {err}")
        sys.exit(1)
    else:
        print("  Done.")
        sys.exit(0)


if __name__ == "__main__":
    main()
