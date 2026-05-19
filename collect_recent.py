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
import os
import sys
import tempfile
from datetime import date, timedelta
from zoneinfo import ZoneInfo

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


def acquire_sync_lock(tenant_id: str | None):
    """Return an open lock file handle if we acquired the lock, None if another sync is running.

    Uses fcntl.flock (Linux/Mac) which auto-releases on process exit/crash.
    Falls back to a no-op on Windows (development machines).
    """
    slug = (tenant_id or "default").replace("/", "_")
    lock_path = os.path.join(tempfile.gettempdir(), f"adanalyzer_sync_{slug}.lock")
    fd = open(lock_path, "w")
    try:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd.write(str(os.getpid()))
        fd.flush()
        logger.info("Sync lock acquired: %s", lock_path)
        return fd
    except ImportError:
        # Windows — skip locking
        return fd
    except OSError:
        fd.close()
        logger.warning("Another sync is already running for tenant=%s — exiting", tenant_id)
        return None


def parse_args():
    p = argparse.ArgumentParser(description="Collect Facebook Ads + Shopify data")
    p.add_argument("--source", choices=["facebook", "shopify", "both"], default="both")
    p.add_argument("--days", type=int, default=30, help="Collect last N days (default: 30)")
    p.add_argument("--date-from", dest="date_from", type=date.fromisoformat)
    p.add_argument("--date-to",   dest="date_to",   type=date.fromisoformat)
    p.add_argument("--tenant",    dest="tenant_id",  default=None,
                   help="Clerk user_id — reads credentials from tenants table")
    p.add_argument("--mode", choices=["quick", "structure", "full"], default="full",
                   help="Facebook collection mode: quick=metrics only, structure=structure+breakdowns only, full=everything")
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


def run_facebook(date_from: date, date_to: date, session, tenant_id=None, creds=None, mode="full"):
    if creds and (not creds.get("fb_access_token") or not creds.get("fb_ad_account_id")):
        print("  [facebook] skipped — no credentials configured")
        return
    from app.collectors.facebook import FacebookCollector
    kwargs = {"tenant_id": tenant_id, "mode": mode}
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

    # Prevent duplicate syncs for the same tenant running simultaneously.
    # The lock is per-source so shopify and facebook can run in parallel.
    lock_key = f"{args.tenant_id or 'default'}_{args.source}"
    lock_fd = acquire_sync_lock(lock_key)
    if lock_fd is None:
        sys.exit(0)  # Another process is already syncing — silent exit is fine

    from app.database import get_db

    errors = []

    with get_db() as session:
        creds = None
        if args.tenant_id:
            try:
                creds = load_tenant_creds(args.tenant_id, session)
            except Exception as e:
                print(f"  ✗ {e}")
                sys.exit(1)

        # Use the store's timezone to determine "today" so date boundaries
        # match the store's business day, not the server's UTC clock.
        store_tz_name = (creds or {}).get("timezone") or "UTC"
        try:
            store_tz = ZoneInfo(store_tz_name)
        except Exception:
            store_tz = ZoneInfo("UTC")

        from datetime import datetime
        today     = datetime.now(store_tz).date()
        date_to   = args.date_to   or today
        date_from = args.date_from or (date_to - timedelta(days=args.days))

        print("=" * 52)
        print("  AdAnalyzer — Data Collection")
        print("=" * 52)
        print(f"  Period : {date_from} → {date_to}")
        print(f"  Source : {args.source}")
        if args.tenant_id:
            print(f"  Tenant : {args.tenant_id}")
        print(f"  TZ     : {store_tz_name}  (today = {today})")
        print("=" * 52)

        if creds:
            print(f"  Store  : {creds['shopify_domain']}")
            print(f"  FB Acc : {creds['fb_ad_account_id']}")
            print("=" * 52)

        if args.source in ("facebook", "both"):
            try:
                run_facebook(date_from, date_to, session, args.tenant_id, creds, mode=args.mode)
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
        lock_fd.close()
        sys.exit(1)
    else:
        print("  Done.")
        lock_fd.close()
        sys.exit(0)


if __name__ == "__main__":
    main()
