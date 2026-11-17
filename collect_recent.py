"""
Collect one store's data from one source. Spawned by the server scheduler and
the refresh endpoint (frontend/lib/sync/jobs.ts); also usable by hand.

  python collect_recent.py --tenant <id> --source shopify
  python collect_recent.py --tenant <id> --source facebook --mode structure
  python collect_recent.py --tenant <id> --source facebook --mode backfill \
        --account act_123 --date-from 2026-10-01

--mode
  shopify : recorded on the run only (scheduled | refresh | backfill).
  facebook: quick | repull7 | repull28 | backfill → daily insights;
            structure → campaigns/ads/creatives + breakdowns;
            full → both.

Default window: the last two days plus today, in the store's timezone.

Exit codes: 0 ok · 1 a run failed · 2 bad arguments or unknown store ·
75 another run of this store+source holds the lock (try again later).
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import tempfile
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

for stream in (sys.stdout, sys.stderr):
    if stream.encoding and stream.encoding.lower() != "utf-8":
        stream.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("collect")

EXIT_LOCKED = 75
FACEBOOK_INSIGHT_MODES = {"quick", "repull7", "repull28", "backfill", "full"}
FACEBOOK_STRUCTURE_MODES = {"structure", "full"}


def acquire_lock(key: str):
    """A per store+source file lock (fcntl), released by the OS on exit or
    crash. None when another process holds it. No-op on Windows."""
    path = os.path.join(tempfile.gettempdir(), f"opero_sync_{key.replace('/', '_')}.lock")
    fd = open(path, "w")
    try:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd.write(str(os.getpid()))
        fd.flush()
        return fd
    except ImportError:
        return fd
    except OSError:
        fd.close()
        return None


def lane(source: str, mode: Optional[str]) -> str:
    """The lock lane, the same one the job runner uses (frontend/lib/sync/plan.ts):
    Meta structure runs beside Meta insights, never beside another structure run."""
    return "facebook_structure" if source == "facebook" and mode == "structure" else source


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Opero — coleta de uma loja")
    p.add_argument("--tenant", dest="tenant_id", required=True)
    p.add_argument("--source", choices=["shopify", "facebook"], required=True)
    p.add_argument("--mode", default=None)
    p.add_argument("--date-from", dest="date_from", type=date.fromisoformat)
    p.add_argument("--date-to", dest="date_to", type=date.fromisoformat)
    p.add_argument("--account", default=None, help="só esta conta de anúncio (act_...)")
    p.add_argument("--include-archived", dest="include_archived", action="store_true",
                   help="coletar mesmo uma loja arquivada (só à mão)")
    return p.parse_args(argv)


def resolve_window(today: date, date_from: Optional[date], date_to: Optional[date]) -> tuple[date, date]:
    end = date_to or today
    start = date_from or (end - timedelta(days=2))
    if start > end:
        start, end = end, start
    return start, end


def load_store(session, tenant_id: str) -> Optional[dict]:
    from sqlalchemy import text
    row = session.execute(text("SELECT * FROM tenants WHERE id = :id"), {"id": tenant_id}).mappings().fetchone()
    return dict(row) if row else None


def ad_accounts(session, store: dict, only: Optional[str]) -> list[dict]:
    """The store's ad accounts to collect: the tenant-level one and every
    active extra account, each with its own token and collect_from cut."""
    from sqlalchemy import text
    from app.collectors.facebook import normalize_account
    out: list[dict] = []
    if store.get("fb_ad_account_id") and store.get("fb_access_token"):
        out.append({"account_id": normalize_account(store["fb_ad_account_id"]),
                    "token": store["fb_access_token"], "collect_from": store.get("fb_collect_from")})
    cols = {r[0] for r in session.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'tenant_fb_accounts'"))}
    extra_cut = "collect_from" if "collect_from" in cols else "NULL::date"
    for r in session.execute(text(
            f"SELECT fb_ad_account_id, fb_access_token, {extra_cut} AS collect_from FROM tenant_fb_accounts "
            "WHERE tenant_id = :t AND is_active = true ORDER BY id"), {"t": store["id"]}):
        acc = normalize_account(r[0])
        if any(a["account_id"] == acc for a in out):
            continue
        out.append({"account_id": acc, "token": r[1], "collect_from": r[2]})
    if only:
        only = normalize_account(only)
        out = [a for a in out if a["account_id"] == only]
    return out


def run_shopify(session, store: dict, start: date, end: date, mode: Optional[str]) -> bool:
    from app.collectors.base import record_failed_run
    from app.collectors.shopify import ShopifyCollector
    from app.collectors.shopify_auth import can_renew
    if not store.get("shopify_domain") or not (store.get("shopify_access_token") or can_renew(store)):
        record_failed_run(session, store["id"], "shopify", "Loja sem credenciais da Shopify — reconecte a loja",
                          start, end, mode=mode)
        return False
    try:
        ShopifyCollector(session, store, store.get("timezone"), mode=mode).collect(start, end)
        return True
    except Exception:  # noqa: BLE001 — already recorded on the run
        logger.exception("shopify falhou")
        return False


def run_facebook(session, store: dict, start: date, end: date, mode: str, only: Optional[str]) -> bool:
    from app.collectors.facebook import FacebookCollector
    from app.config import settings
    accounts = ad_accounts(session, store, only)
    if not accounts:
        logger.info("loja sem conta de anúncio ativa — nada a coletar")
        return True
    app_id = store.get("facebook_app_id") or settings.facebook_app_id
    # A store on its own Meta app without a stored secret signs nothing: the
    # default app's secret would make Meta reject the proof (code 100).
    if store.get("facebook_app_id") and store.get("facebook_app_id") != settings.facebook_app_id:
        app_secret = store.get("facebook_app_secret") or None
    else:
        app_secret = store.get("facebook_app_secret") or settings.facebook_app_secret
    ok = True
    for acc in accounts:
        phases = []
        if mode in FACEBOOK_INSIGHT_MODES:
            phases.append("insights")
        if mode in FACEBOOK_STRUCTURE_MODES:
            phases.append("structure")
        first: Optional[FacebookCollector] = None
        for phase in phases:
            c = FacebookCollector(session, store["id"], acc["account_id"], acc["token"], app_id, app_secret,
                                  phase=phase, mode=mode, collect_from=acc.get("collect_from"))
            win = c.window(start, end)
            if win is None:
                logger.info("%s: janela antes do corte %s — nada a coletar", acc["account_id"], acc.get("collect_from"))
                break
            if first is None:
                try:
                    state, status, currency = c.account_state()
                except Exception as e:  # noqa: BLE001 — record the failure on a run
                    from app.collectors.base import record_failed_run
                    from app.collectors.facebook import describe_meta_error
                    from app.collectors.redact import redact
                    record_failed_run(session, store["id"], c.source, describe_meta_error(e) or redact(e),
                                      win[0], win[1], account_id=acc["account_id"], mode=mode)
                    ok = False
                    break
                if state != "active":
                    # Not an error: a dead account is simply not collected.
                    logger.info("%s: conta inativa (account_status=%s) — ignorada", acc["account_id"], status)
                    break
                first = c
                try:
                    c.use_currency(currency, win[0], win[1])
                except Exception as e:  # noqa: BLE001
                    from app.collectors.base import record_failed_run
                    record_failed_run(session, store["id"], c.source, f"Conta em {currency} sem cotação: {e}",
                                      win[0], win[1], account_id=acc["account_id"], mode=mode)
                    ok = False
                    break
            else:
                c.money_rate = first.money_rate
            try:
                c.collect(*win)
            except Exception:  # noqa: BLE001 — recorded on the run
                logger.exception("facebook %s/%s falhou", acc["account_id"], phase)
                ok = False
    return ok


def main(argv=None) -> int:
    args = parse_args(argv)
    lock = acquire_lock(f"{args.tenant_id}_{lane(args.source, args.mode)}")
    if lock is None:
        print(f"[collect] {args.tenant_id}/{lane(args.source, args.mode)}: já em andamento", flush=True)
        return EXIT_LOCKED

    from app.collectors.base import Interrupted

    def on_term(signum, _frame):
        raise Interrupted(f"signal {signum}")

    signal.signal(signal.SIGTERM, on_term)

    from app.database import get_db
    with get_db() as session:
        store = load_store(session, args.tenant_id)
        if not store:
            print(f"[collect] loja {args.tenant_id} não existe", flush=True)
            return 2
        # Archived stores keep their history and are never synced; every
        # spawner filters them, and this holds for any that does not (the
        # suspended Squishy World logged a 402 error on every phone refresh).
        if store.get("archived_at") and not args.include_archived:
            print(f"[collect] loja {store.get('shop_name') or args.tenant_id} está arquivada — nada a coletar", flush=True)
            return 0
        tz_name = store.get("timezone") or "UTC"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:  # noqa: BLE001
            tz = ZoneInfo("UTC")
        start, end = resolve_window(datetime.now(tz).date(), args.date_from, args.date_to)
        logger.info("%s %s %s → %s (%s)", store.get("shop_name") or store["id"], args.source, start, end,
                    args.mode or "padrão")
        if args.source == "shopify":
            ok = run_shopify(session, store, start, end, args.mode or "scheduled")
        else:
            ok = run_facebook(session, store, start, end, args.mode or "quick", args.account)
    lock.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
