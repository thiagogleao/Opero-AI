"""
Shopify collector.

Per run, for one store:
  1. shop info (timezone, name, currency) — written only when it changed;
  2. exchange rates when the shop does not bill in dollars;
  3. orders: every order CREATED in the requested window, plus every order
     UPDATED since the last successful run (with 15 minutes of overlap). The
     second set is what lets a refund, a cancellation or a fulfilment that
     happens on day 5 reach the database — the old collector only re-read the
     last three days, so an order's status froze on day 2;
  4. line items, then the derived tables rebuilt from shopify_orders in SQL
     (daily metrics, customers, country metrics) for every day those orders
     touch;
  5. Shop Campaigns spend (ShopifyQL), abandoned checkouts, and the product
     catalogue at most once an hour.

A 401 on a Dev Dashboard store (24 h token) forces one renewal and one retry.
Any failure is recorded on the run (see base.py) instead of vanishing.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.collectors.base import BaseCollector
from app.collectors.redact import redact
from app.collectors.shopify_auth import ShopifyAuthError, can_renew, ensure_token
from app.collectors.shopify_client import (
    API_VERSION, ShopifyClient, ShopifyError, ShopifyUnauthorized, ShopifyUnavailable,
)
from app.collectors.shopify_mapping import (
    MissingRate, local_day, map_checkout, map_line_items, map_order, map_product,
)
from app.collectors.upsert import upsert

logger = logging.getLogger(__name__)

# Re-read orders updated since the last success minus this much, so an update
# that landed while the previous run was paginating is never missed.
UPDATED_OVERLAP = timedelta(minutes=15)
# After a long outage the first run re-reads at most this far back by
# updated_at; the scheduler widens the created window to cover the gap too.
UPDATED_MAX_LOOKBACK = timedelta(days=30)
PRODUCTS_EVERY = timedelta(hours=1)


class ShopifyCollector(BaseCollector):
    source = "shopify"

    def __init__(self, session: Session, creds: dict, timezone_name: Optional[str] = None,
                 mode: Optional[str] = None):
        super().__init__(session, creds.get("id"), mode=mode)
        self.creds = creds
        self.tz_name = timezone_name or creds.get("timezone") or "UTC"
        self.client: Optional[ShopifyClient] = None
        self.currency: Optional[str] = None
        self.rates: dict[date, float] = {}

    # ── Errors as the panel shows them ──────────────────────────────────────

    def describe_error(self, exc: BaseException) -> str:
        if isinstance(exc, ShopifyAuthError):
            return redact(f"Token da Shopify: renovação falhou — {exc}")
        if isinstance(exc, ShopifyUnauthorized):
            return "Token da Shopify recusado (HTTP 401) — reconecte a loja"
        if isinstance(exc, ShopifyUnavailable):
            return f"Loja indisponível na Shopify (HTTP {exc.status}) — suspensa ou fechada"
        if isinstance(exc, MissingRate):
            return redact(f"Sem cotação para converter em dólar: {exc}")
        return super().describe_error(exc)

    # ── Run ─────────────────────────────────────────────────────────────────

    def _run(self, date_from: date, date_to: date) -> None:
        self._connect(force=False)
        try:
            self._collect(date_from, date_to)
        except ShopifyUnauthorized:
            if not can_renew(self.creds):
                raise
            # The stored token was refused before its expiry: mint a new one
            # and try once more. A second 401 is a real credential problem.
            logger.warning("[shopify] 401 — renovando o token e tentando de novo")
            self._connect(force=True)
            self._collect(date_from, date_to)

    def _connect(self, force: bool) -> None:
        token = ensure_token(self.session, self.creds, force=force)
        domain = self.creds.get("shopify_domain")
        if not domain or not token:
            raise ShopifyAuthError("loja sem domínio ou token da Shopify")
        self.client = ShopifyClient(domain, token, API_VERSION)

    def _collect(self, date_from: date, date_to: date) -> None:
        self._load_shop()
        since = self._updated_since()
        orders = self._fetch_orders(date_from, date_to, since)
        days = {d for d in (local_day(o.get("created_at")) for o in orders) if d}
        first_day = min([date_from] + [date.fromisoformat(d) for d in days])
        self._load_rates(first_day, date_to)

        rate_for = self._rate_for
        order_rows = self.inject_tenant([map_order(o, rate_for) for o in orders])
        item_rows = self.inject_tenant([r for o in orders for r in map_line_items(o, rate_for)])
        self.records += upsert(
            self.session, "shopify_orders", order_rows, [["order_id"]],
            preserve_on_null=["browser_ip", "user_agent", "accept_language"],
        )
        self.records += upsert(self.session, "shopify_order_items", item_rows, [["order_id", "line_item_id"]])
        logger.info("[shopify] %d pedidos (%d itens) gravados", len(order_rows), len(item_rows))

        customer_ids = sorted({r["customer_id"] for r in order_rows if r.get("customer_id")})
        self._rebuild_daily(first_day, date_to)
        self._rebuild_countries(first_day, date_to)
        self._rebuild_customers(customer_ids)

        self._sync_shop_campaigns(date_from, date_to)
        self._sync_checkouts(date_from, date_to)
        self._sync_products()

    # ── Shop ────────────────────────────────────────────────────────────────

    def _load_shop(self) -> None:
        shop = (self.client.get("shop.json") or {}).get("shop") or {}
        tz = shop.get("iana_timezone")
        name = shop.get("name")
        self.currency = shop.get("currency") or self.creds.get("shopify_currency")
        if tz:
            self.tz_name = tz
        if self.tenant_id and (tz or name or shop.get("currency")):
            # Only when something changed: this ran every ten minutes and
            # rewrote the tenants row each time.
            self.session.execute(
                text("UPDATE tenants SET timezone = COALESCE(:tz, timezone), "
                     "shop_name = COALESCE(:name, shop_name), "
                     "shopify_currency = COALESCE(:cur, shopify_currency) "
                     "WHERE id = :tid AND (timezone IS DISTINCT FROM COALESCE(:tz, timezone) "
                     "OR shop_name IS DISTINCT FROM COALESCE(:name, shop_name) "
                     "OR shopify_currency IS DISTINCT FROM COALESCE(:cur, shopify_currency))"),
                {"tz": tz, "name": name, "cur": shop.get("currency"), "tid": self.tenant_id},
            )
            self.session.commit()

    # ── FX ──────────────────────────────────────────────────────────────────

    def _load_rates(self, first: date, last: date) -> None:
        if not self.currency or self.currency.upper() == "USD":
            self.rates = {}
            return
        from app.collectors.fx import FxError, taxas_do_periodo
        try:
            self.rates = taxas_do_periodo(self.session, self.currency, first, last)
        except FxError as e:
            # Importing yen as dollars would inflate revenue ~150x: fail loudly.
            raise MissingRate(f"loja em {self.currency}: {e}") from e

    def _rate_for(self, day: Optional[str]) -> Optional[float]:
        if not self.rates:
            return None
        if day:
            try:
                d = date.fromisoformat(day)
                if d in self.rates:
                    return self.rates[d]
            except ValueError:
                pass
        return self.rates[max(self.rates)]

    def _latest_usd(self, value: float) -> float:
        rate = self._rate_for(None)
        return round(value * rate, 6) if rate else value

    # ── Orders ──────────────────────────────────────────────────────────────

    def _bounds(self, d: date) -> tuple[str, str]:
        try:
            tz = ZoneInfo(self.tz_name)
        except Exception:  # noqa: BLE001
            tz = ZoneInfo("UTC")
        start = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
        end = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=tz)
        return start.isoformat(), end.isoformat()

    def _updated_since(self) -> Optional[datetime]:
        """Start of the last successful Shopify run, minus the overlap."""
        if not self.tenant_id:
            return None
        last = self.session.execute(
            text("SELECT max(started_at) FROM sync_runs WHERE tenant_id = :t AND source = 'shopify' "
                 "AND status = 'success' AND id <> :me"),
            {"t": self.tenant_id, "me": self.run_id or -1},
        ).scalar()
        if last is None:
            return None
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        floor = datetime.now(timezone.utc) - UPDATED_MAX_LOOKBACK
        if last < floor:
            self.warn(f"último sync com sucesso em {last:%d/%m %H:%M} UTC; relendo só 30 dias de alterações")
            return floor
        return last - UPDATED_OVERLAP

    def _fetch_orders(self, date_from: date, date_to: date, since: Optional[datetime]) -> list[dict]:
        seen: dict[str, dict] = {}
        chunk = date_from
        while chunk <= date_to:
            end = min(chunk + timedelta(days=6), date_to)
            params = {
                "status": "any", "limit": 250,
                "created_at_min": self._bounds(chunk)[0],
                "created_at_max": self._bounds(end)[1],
                # Kept from the old collector, which found orders older than
                # 60 days missing without it.
                "updated_at_min": "2020-01-01T00:00:00Z",
            }
            for o in self.client.paginate("orders.json", "orders", params):
                seen[str(o["id"])] = o
            chunk = end + timedelta(days=1)
        created = len(seen)
        if since is not None:
            params = {"status": "any", "limit": 250, "updated_at_min": since.isoformat()}
            for o in self.client.paginate("orders.json", "orders", params):
                seen[str(o["id"])] = o
        logger.info("[shopify] pedidos: %d criados no período, %d alterados desde %s",
                    created, len(seen) - created, since.isoformat() if since else "—")
        return list(seen.values())

    # ── Derived tables, rebuilt from shopify_orders ─────────────────────────

    def _rebuild_daily(self, first: date, last: date) -> None:
        """Every day of the range gets a row, so a day whose only order was
        refunded drops to zero instead of keeping its old total. New vs
        returning comes from the customer's whole collected history."""
        if not self.tenant_id:
            return
        self.session.execute(text("""
            WITH ranked AS (
              SELECT order_id,
                     row_number() OVER (PARTITION BY customer_id ORDER BY created_at) AS n
                FROM shopify_orders
               WHERE tenant_id = :t AND customer_id IS NOT NULL
            ), kept AS (
              SELECT (o.created_at AT TIME ZONE :tz)::date AS d, o.total_price, COALESCE(r.n, 1) AS n
                FROM shopify_orders o
                LEFT JOIN ranked r ON r.order_id = o.order_id
               WHERE o.tenant_id = :t
                 AND o.financial_status NOT IN ('refunded', 'voided')
                 AND (o.created_at AT TIME ZONE :tz)::date BETWEEN :a AND :b
            )
            INSERT INTO shopify_daily_metrics
              (tenant_id, date, total_orders, total_revenue, avg_order_value,
               new_customers, returning_customers, new_customer_revenue, returning_customer_revenue)
            SELECT :t, g.d::date,
                   count(k.d),
                   COALESCE(sum(k.total_price), 0),
                   CASE WHEN count(k.d) > 0 THEN sum(k.total_price) / count(k.d) ELSE 0 END,
                   count(k.d) FILTER (WHERE k.n = 1),
                   count(k.d) FILTER (WHERE k.n > 1),
                   COALESCE(sum(k.total_price) FILTER (WHERE k.n = 1), 0),
                   COALESCE(sum(k.total_price) FILTER (WHERE k.n > 1), 0)
              FROM generate_series(CAST(:a AS date), CAST(:b AS date), interval '1 day') AS g(d)
              LEFT JOIN kept k ON k.d = g.d::date
             GROUP BY g.d
            ON CONFLICT (date, tenant_id) DO UPDATE SET
              total_orders = EXCLUDED.total_orders,
              total_revenue = EXCLUDED.total_revenue,
              avg_order_value = EXCLUDED.avg_order_value,
              new_customers = EXCLUDED.new_customers,
              returning_customers = EXCLUDED.returning_customers,
              new_customer_revenue = EXCLUDED.new_customer_revenue,
              returning_customer_revenue = EXCLUDED.returning_customer_revenue
        """), {"t": self.tenant_id, "tz": self.tz_name, "a": first, "b": last})
        self.session.commit()

    def _rebuild_countries(self, first: date, last: date) -> None:
        if not self.tenant_id:
            return
        params = {"t": self.tenant_id, "tz": self.tz_name, "a": first, "b": last}
        self.session.execute(text(
            "DELETE FROM shopify_country_metrics WHERE tenant_id = :t AND date BETWEEN :a AND :b"), params)
        self.session.execute(text("""
            WITH ranked AS (
              SELECT order_id, row_number() OVER (PARTITION BY customer_id ORDER BY created_at) AS n
                FROM shopify_orders WHERE tenant_id = :t AND customer_id IS NOT NULL
            )
            INSERT INTO shopify_country_metrics
              (tenant_id, date, country_code, orders_count, revenue, avg_order_value, new_customers)
            SELECT :t, (o.created_at AT TIME ZONE :tz)::date, COALESCE(o.country_code, 'XX'),
                   count(*), sum(o.total_price), sum(o.total_price) / count(*),
                   count(*) FILTER (WHERE COALESCE(r.n, 1) = 1)
              FROM shopify_orders o
              LEFT JOIN ranked r ON r.order_id = o.order_id
             WHERE o.tenant_id = :t
               AND o.financial_status NOT IN ('refunded', 'voided')
               AND (o.created_at AT TIME ZONE :tz)::date BETWEEN :a AND :b
             GROUP BY 2, 3
        """), params)
        self.session.commit()

    def _rebuild_customers(self, customer_ids: list[str]) -> None:
        """Lifetime figures from every collected order of the customer — the
        old code wrote the count of the current three-day batch, resetting
        repeat buyers to one order on every sync."""
        if not self.tenant_id or not customer_ids:
            return
        self.session.execute(text("""
            INSERT INTO shopify_customers
              (customer_id, tenant_id, email, total_spent, orders_count, avg_order_value,
               first_order_at, last_order_at, country_code, is_returning)
            SELECT o.customer_id, :t,
                   (array_agg(o.customer_email ORDER BY o.created_at DESC))[1],
                   COALESCE(sum(o.total_price) FILTER (WHERE o.financial_status NOT IN ('refunded','voided')), 0),
                   count(*) FILTER (WHERE o.financial_status NOT IN ('refunded','voided')),
                   COALESCE(avg(o.total_price) FILTER (WHERE o.financial_status NOT IN ('refunded','voided')), 0),
                   min(o.created_at), max(o.created_at),
                   (array_agg(o.country_code ORDER BY o.created_at DESC))[1],
                   count(*) FILTER (WHERE o.financial_status NOT IN ('refunded','voided')) > 1
              FROM shopify_orders o
             WHERE o.tenant_id = :t AND o.customer_id = ANY(:ids)
             GROUP BY o.customer_id
            ON CONFLICT (customer_id) DO UPDATE SET
              email = EXCLUDED.email, total_spent = EXCLUDED.total_spent,
              orders_count = EXCLUDED.orders_count, avg_order_value = EXCLUDED.avg_order_value,
              first_order_at = EXCLUDED.first_order_at, last_order_at = EXCLUDED.last_order_at,
              country_code = EXCLUDED.country_code, is_returning = EXCLUDED.is_returning
            WHERE shopify_customers.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id
        """), {"t": self.tenant_id, "ids": customer_ids})
        self.session.commit()

    # ── Shop Campaigns ──────────────────────────────────────────────────────

    def _sync_shop_campaigns(self, date_from: date, date_to: date) -> None:
        """Ad spend Shopify bills on its own invoice. It is not in Meta, so
        without it Dumpling's profit read almost $1,000 a day too high. Lives in
        ShopifyQL (shop_campaign_insights) and needs read_reports; a store
        without that scope gets a warning on the run, not a failed sync."""
        if not self.tenant_id:
            return
        q = ("FROM shop_campaign_insights SHOW shop_campaign_ad_spend "
             f"GROUP BY day SINCE {date_from.isoformat()} UNTIL {date_to.isoformat()} ORDER BY day")
        try:
            data = self.client.graphql(
                "query($q:String!){ shopifyqlQuery(query:$q){ tableData{ rows } parseErrors } }", {"q": q})
        except ShopifyUnauthorized:
            raise
        except ShopifyError as e:
            msg = str(e)
            if "read_reports" in msg:
                self.warn("Shop Campaigns: falta o escopo read_reports — gasto de anúncios Shopify não descontado")
            else:
                self.warn(f"Shop Campaigns: {msg[:160]}")
            return
        res = (data or {}).get("shopifyqlQuery") or {}
        if res.get("parseErrors") and len(str(res["parseErrors"])) > 2:
            self.warn(f"Shop Campaigns: ShopifyQL recusou — {str(res['parseErrors'])[:160]}")
            return
        rows = []
        for line in ((res.get("tableData") or {}).get("rows")) or []:
            day = line.get("day")
            if not day:
                continue
            raw = float(line.get("shop_campaign_ad_spend") or 0)
            rate = self._rate_for(str(day)[:10])
            rows.append({
                "tenant_id": self.tenant_id, "date": str(day)[:10],
                "spend": round(raw * rate, 6) if rate else raw,
                "currency": self.currency, "fx_rate": rate,
                "synced_at": datetime.now(timezone.utc),
            })
        self.records += upsert(self.session, "shop_campaign_daily", rows, [["tenant_id", "date"]])

    # ── Abandoned checkouts ─────────────────────────────────────────────────

    def _sync_checkouts(self, date_from: date, date_to: date) -> None:
        params = {"status": "open", "limit": 250,
                  "created_at_min": self._bounds(date_from)[0], "created_at_max": self._bounds(date_to)[1]}
        try:
            checkouts = list(self.client.paginate("checkouts.json", "checkouts", params))
        except ShopifyUnauthorized:
            raise
        except ShopifyError as e:
            self.warn(f"checkouts abandonados: {str(e)[:120]}")
            return
        rows = self.inject_tenant([map_checkout(c, self.currency, self._rate_for) for c in checkouts])
        self.records += upsert(self.session, "shopify_abandoned_checkouts", rows, [["checkout_id"]])
        self._patch_abandonment(rows)

    def _patch_abandonment(self, rows: list[dict]) -> None:
        if not self.tenant_id or not rows:
            return
        by_day: dict[str, list[float]] = {}
        try:
            tz = ZoneInfo(self.tz_name)
        except Exception:  # noqa: BLE001
            tz = ZoneInfo("UTC")
        for r in rows:
            if r.get("created_at") is None:
                continue
            d = r["created_at"].astimezone(tz).date().isoformat()
            by_day.setdefault(d, []).append(r["total_price"] or 0.0)
        for d, values in by_day.items():
            self.session.execute(
                text("UPDATE shopify_daily_metrics SET cart_abandonment_count = :n, cart_abandonment_value = :v "
                     "WHERE tenant_id = :t AND date = :d"),
                {"n": len(values), "v": sum(values), "t": self.tenant_id, "d": d},
            )
        self.session.commit()

    # ── Products ────────────────────────────────────────────────────────────

    def _sync_products(self) -> None:
        """The catalogue changes rarely and was re-downloaded every ten
        minutes. Now: at most hourly, and only what changed since last time."""
        if not self.tenant_id:
            return
        last = self.session.execute(
            text("SELECT max(synced_at) FROM shopify_products WHERE tenant_id = :t"), {"t": self.tenant_id}
        ).scalar()
        now = datetime.now(timezone.utc)
        if last is not None:
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if now - last < PRODUCTS_EVERY:
                return
        params: dict = {"limit": 250}
        if last is not None:
            params["updated_at_min"] = (last - timedelta(minutes=5)).isoformat()
        try:
            products = list(self.client.paginate("products.json", "products", params))
        except ShopifyUnauthorized:
            raise
        except ShopifyError as e:
            self.warn(f"produtos: {str(e)[:120]}")
            return
        rows = self.inject_tenant([map_product(p, self._latest_usd) for p in products])
        if not rows and last is not None:
            # Nothing changed: still mark the catalogue as checked so the
            # next run waits another hour.
            self.session.execute(
                text("UPDATE shopify_products SET synced_at = now() WHERE tenant_id = :t "
                     "AND synced_at = (SELECT max(synced_at) FROM shopify_products WHERE tenant_id = :t)"),
                {"t": self.tenant_id})
            self.session.commit()
            return
        self.records += upsert(self.session, "shopify_products", rows, [["product_id"]])
