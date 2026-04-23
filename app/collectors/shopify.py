"""
Shopify collector.

Collects:
  - Orders (with line items) → ShopifyOrder, ShopifyOrderItem
  - Abandoned checkouts    → ShopifyAbandonedCheckout
  - Customer aggregates    → ShopifyCustomer (LTV, repeat purchase)
  - Daily aggregates       → ShopifyDailyMetric
  - Country breakdowns     → ShopifyCountryMetric

Data is upserted so re-runs are safe.
"""

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Optional

import shopify
from sqlalchemy.orm import Session
from sqlalchemy import Table, MetaData
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.collectors.base import BaseCollector
from app.config import settings

logger = logging.getLogger(__name__)

# Shopify returns timestamps in ISO 8601 with timezone, e.g. "2024-01-15T14:23:10-05:00"
_DT_FMT = "%Y-%m-%dT%H:%M:%S%z"


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        # Store as UTC-naive datetime in the DB (SQLAlchemy convention)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, AttributeError):
        return None


def _local_date(value: Optional[str]) -> Optional[str]:
    """Return the date in the store's LOCAL timezone for day-grouping.
    Shopify timestamps include the store's UTC offset (e.g. '2024-01-15T21:00:00-03:00').
    Using .date() on the original tz-aware datetime keeps the local date correct,
    whereas converting to UTC first shifts late-night orders into the next day.
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt.date().isoformat()
    except (ValueError, AttributeError):
        return None


def _float(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ShopifyCollector(BaseCollector):
    source = "shopify"

    def __init__(
        self,
        session: Session,
        tenant_id: Optional[str] = None,
        store_url: Optional[str] = None,
        access_token: Optional[str] = None,
        api_version: Optional[str] = None,
    ):
        super().__init__(session, tenant_id)
        url   = store_url   or settings.shopify_store_url
        token = access_token or settings.shopify_access_token
        ver   = api_version  or settings.shopify_api_version
        shop_url = url if url.startswith("https://") else f"https://{url}"
        sess = shopify.Session(shop_url, ver, token)
        shopify.ShopifyResource.activate_session(sess)

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------

    def _run(self, date_from: date, date_to: date) -> None:
        logger.info("[shopify] Syncing products catalog...")
        self._sync_products()

        logger.info("[shopify] Fetching orders %s → %s", date_from, date_to)
        orders = self._fetch_all_orders(date_from, date_to)
        logger.info("[shopify] Got %d orders", len(orders))

        self._upsert_orders(orders)
        self._upsert_order_items(orders)
        self._upsert_customers(orders)
        self._aggregate_and_upsert_daily(orders)
        self._recalculate_daily_from_db(date_from, date_to)
        self._aggregate_and_upsert_countries(orders)

        logger.info("[shopify] Fetching abandoned checkouts %s → %s", date_from, date_to)
        checkouts = self._fetch_all_abandoned_checkouts(date_from, date_to)
        logger.info("[shopify] Got %d abandoned checkouts", len(checkouts))
        self._upsert_abandoned_checkouts(checkouts)

        # Refresh daily metrics with abandonment data
        self._patch_daily_with_abandonment(checkouts)

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    def _fetch_all_orders(self, date_from: date, date_to: date) -> list:
        """Return all orders in the date range.

        Fetches in 7-day chunks to avoid pagination bugs with large result sets.
        Also logs API count vs fetched count for discrepancy detection.
        """
        from datetime import timedelta

        # Ask API for total count first — useful for diagnosing discrepancies
        try:
            api_count = shopify.Order.count(
                status="any",
                created_at_min=f"{date_from}T00:00:00",
                created_at_max=f"{date_to}T23:59:59",
            )
            logger.info("[shopify] API reports %d orders for %s → %s", api_count, date_from, date_to)
        except Exception as e:
            logger.warning("[shopify] Could not get order count: %s", e)
            api_count = None

        # Fetch in 7-day chunks to keep each page under 250 and avoid pagination issues
        all_orders = []
        seen_ids: set[str] = set()
        chunk_start = date_from

        while chunk_start <= date_to:
            chunk_end = min(chunk_start + timedelta(days=6), date_to)
            params = dict(
                status="any",
                limit=250,
                created_at_min=f"{chunk_start}T00:00:00",
                created_at_max=f"{chunk_end}T23:59:59",
                # updated_at_min is required to bypass Shopify's 60-day order limit.
                # Without it, orders older than 60 days are silently excluded.
                updated_at_min="2020-01-01T00:00:00",
            )
            page = shopify.Order.find(**params)
            chunk_orders = list(page)
            while page.has_next_page():
                time.sleep(0.5)
                page = page.next_page()
                chunk_orders.extend(list(page))

            # Deduplicate (orders at chunk boundaries could theoretically overlap)
            for order in chunk_orders:
                oid = str(order.id)
                if oid not in seen_ids:
                    seen_ids.add(oid)
                    all_orders.append(order)

            logger.info("[shopify] Chunk %s → %s: %d orders", chunk_start, chunk_end, len(chunk_orders))
            chunk_start = chunk_end + timedelta(days=1)
            time.sleep(0.3)

        logger.info("[shopify] Fetched %d unique orders (API count: %s)", len(all_orders), api_count)
        if api_count and abs(len(all_orders) - api_count) > 5:
            logger.warning(
                "[shopify] ⚠ Discrepancy: fetched %d but API count = %d (diff: %d)",
                len(all_orders), api_count, api_count - len(all_orders),
            )
        return all_orders

    def _fetch_all_abandoned_checkouts(self, date_from: date, date_to: date) -> list:
        all_checkouts = []
        params = dict(
            status="open",
            limit=250,
            created_at_min=f"{date_from}T00:00:00",  # abandoned checkouts don't have processed_at
            created_at_max=f"{date_to}T23:59:59",
        )
        try:
            page = shopify.Checkout.find(**params)
            all_checkouts.extend(list(page))
            while page.has_next_page():
                time.sleep(0.5)
                page = page.next_page()
                all_checkouts.extend(list(page))
        except Exception as e:
            logger.warning("[shopify] Could not fetch abandoned checkouts: %s", e)
        return all_checkouts

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------

    def _upsert_orders(self, orders: list):
        # We need to know which customers are first-time buyers.
        # Group orders by customer and sort by date to flag is_first_order.
        customer_first_order: dict[str, str] = {}  # customer_id → earliest order_id in this batch
        for order in sorted(orders, key=lambda o: o.created_at or ""):
            cid = str(getattr(order, "customer", None) and order.customer.id or "")
            if cid and cid not in customer_first_order:
                customer_first_order[cid] = str(order.id)

        rows = []
        for order in orders:
            cid = str(getattr(order, "customer", None) and order.customer.id or "")
            billing = getattr(order, "billing_address", None)
            country_code = (billing.country_code if billing else None) or None

            rows.append({
                "order_id": str(order.id),
                "order_number": getattr(order, "order_number", None),
                "customer_id": cid or None,
                "customer_email": getattr(order, "email", None) or None,
                "created_at": _parse_dt(order.created_at),
                "total_price": _float(getattr(order, "total_price", 0)),
                "subtotal_price": _float(getattr(order, "subtotal_price", 0)),
                "total_discounts": _float(getattr(order, "total_discounts", 0)),
                "currency": getattr(order, "currency", None),
                "country_code": country_code,
                "financial_status": getattr(order, "financial_status", None),
                "fulfillment_status": getattr(order, "fulfillment_status", None),
                "is_first_order": (
                    bool(cid and customer_first_order.get(cid) == str(order.id))
                ),
            })

        self._upsert_raw("shopify_orders", rows, ["order_id"])

    def _upsert_order_items(self, orders: list):
        rows = []
        for order in orders:
            line_items = getattr(order, "line_items", []) or []
            for item in line_items:
                rows.append({
                    "order_id": str(order.id),
                    "line_item_id": str(item.id),
                    "product_id": str(item.product_id) if item.product_id else None,
                    "variant_id": str(item.variant_id) if item.variant_id else None,
                    "product_title": getattr(item, "title", None),
                    "variant_title": getattr(item, "variant_title", None),
                    "quantity": int(getattr(item, "quantity", 1) or 1),
                    "price": _float(getattr(item, "price", 0)),
                })
        self._upsert_raw("shopify_order_items", rows, ["order_id", "line_item_id"])

    # ------------------------------------------------------------------
    # Customers — build LTV from collected orders
    # ------------------------------------------------------------------

    def _upsert_customers(self, orders: list):
        """
        Aggregate customer stats from the orders in this batch.
        NOTE: total_spent/orders_count are LIFETIME values already returned
        by the Shopify customer object — we fetch those separately for accuracy.
        For now we compute from the batch and let subsequent syncs accumulate.
        """
        # Group orders by customer
        by_customer: dict[str, list] = defaultdict(list)
        for order in orders:
            cid = str(getattr(order, "customer", None) and order.customer.id or "")
            if cid:
                by_customer[cid].append(order)

        rows = []
        for cid, corders in by_customer.items():
            sample_order = corders[0]
            customer_obj = getattr(sample_order, "customer", None)

            # Use Shopify's lifetime totals if available on the customer object
            total_spent = _float(getattr(customer_obj, "total_spent", None) or 0)
            orders_count = int(getattr(customer_obj, "orders_count", None) or len(corders))
            avg_order_value = (total_spent / orders_count) if orders_count > 0 else 0

            sorted_orders = sorted(corders, key=lambda o: o.created_at or "")
            first_order_at = _parse_dt(sorted_orders[0].created_at) if sorted_orders else None
            last_order_at = _parse_dt(sorted_orders[-1].created_at) if sorted_orders else None

            billing = getattr(sample_order, "billing_address", None)
            country_code = (billing.country_code if billing else None) or None

            rows.append({
                "customer_id": cid,
                "email": getattr(customer_obj, "email", None) or getattr(sample_order, "email", None),
                "created_at": _parse_dt(getattr(customer_obj, "created_at", None)),
                "total_spent": total_spent or sum(_float(o.total_price) for o in corders),
                "orders_count": orders_count,
                "avg_order_value": avg_order_value,
                "first_order_at": first_order_at,
                "last_order_at": last_order_at,
                "country_code": country_code,
                "is_returning": orders_count > 1,
            })

        self._upsert_raw("shopify_customers", rows, ["customer_id"])

    # ------------------------------------------------------------------
    # Daily aggregates
    # ------------------------------------------------------------------

    def _aggregate_and_upsert_daily(self, orders: list):
        by_date: dict[str, dict] = defaultdict(lambda: {
            "total_orders": 0, "total_revenue": 0.0,
            "new_customers": 0, "returning_customers": 0,
            "new_customer_revenue": 0.0, "returning_customer_revenue": 0.0,
        })

        for order in orders:
            d = _local_date(order.created_at)
            if not d:
                continue
            revenue = _float(getattr(order, "total_price", 0))
            by_date[d]["total_orders"] += 1
            by_date[d]["total_revenue"] += revenue

            # Use Shopify's lifetime orders_count to determine if truly new customer
            customer_obj = getattr(order, "customer", None)
            lifetime_orders = int(getattr(customer_obj, "orders_count", 0) or 0) if customer_obj else 0
            is_new = lifetime_orders == 1
            if is_new:
                by_date[d]["new_customers"] += 1
                by_date[d]["new_customer_revenue"] += revenue
            else:
                by_date[d]["returning_customers"] += 1
                by_date[d]["returning_customer_revenue"] += revenue

        rows = []
        for d, agg in by_date.items():
            total_orders = agg["total_orders"]
            total_revenue = agg["total_revenue"]
            rows.append({
                "date": d,
                "total_orders": total_orders,
                "total_revenue": total_revenue,
                "avg_order_value": (total_revenue / total_orders) if total_orders else 0,
                "new_customers": agg["new_customers"],
                "returning_customers": agg["returning_customers"],
                "new_customer_revenue": agg["new_customer_revenue"],
                "returning_customer_revenue": agg["returning_customer_revenue"],
                "cart_abandonment_count": 0,   # patched later
                "cart_abandonment_value": 0.0,
            })

        self._upsert_raw("shopify_daily_metrics", rows, ["date", "tenant_id"])

    def _recalculate_daily_from_db(self, date_from: date, date_to: date) -> None:
        """Re-aggregate total_orders/total_revenue/avg_order_value from the DB orders table.

        Fixes the case where multiple partial syncs write overlapping date ranges and
        the in-memory batch only has a subset of orders for a given day.
        """
        from sqlalchemy import text
        self.session.execute(text("""
            UPDATE shopify_daily_metrics dm
            SET
                total_orders     = sub.order_count,
                total_revenue    = sub.order_sum,
                avg_order_value  = CASE WHEN sub.order_count > 0
                                        THEN sub.order_sum / sub.order_count ELSE 0 END
            FROM (
                SELECT
                    DATE(created_at AT TIME ZONE 'America/Belem') AS d,
                    COUNT(*)                                       AS order_count,
                    COALESCE(SUM(total_price), 0)                  AS order_sum,
                    tenant_id
                FROM shopify_orders
                WHERE tenant_id  = :tid
                  AND financial_status = 'paid'
                  AND DATE(created_at AT TIME ZONE 'America/Belem') BETWEEN :df AND :dt
                GROUP BY DATE(created_at AT TIME ZONE 'America/Belem'), tenant_id
            ) sub
            WHERE dm.date = sub.d AND dm.tenant_id = sub.tenant_id
        """), {"tid": self.tenant_id, "df": str(date_from), "dt": str(date_to)})
        self.session.commit()

    def _patch_daily_with_abandonment(self, checkouts: list):
        """Update daily rows with cart abandonment counts/values."""
        if not checkouts:
            return

        by_date: dict[str, dict] = defaultdict(lambda: {"count": 0, "value": 0.0})
        for checkout in checkouts:
            d = _local_date(getattr(checkout, "created_at", None))
            if not d:
                continue
            by_date[d]["count"] += 1
            by_date[d]["value"] += _float(getattr(checkout, "total_price", 0))

        from sqlalchemy import text

        for d, agg in by_date.items():
            self.session.execute(
                text(
                    "UPDATE shopify_daily_metrics "
                    "SET cart_abandonment_count = :count, cart_abandonment_value = :value "
                    "WHERE date = :date AND (tenant_id = :tid OR (:tid IS NULL AND tenant_id IS NULL))"
                ),
                {"count": agg["count"], "value": agg["value"], "date": d, "tid": self.tenant_id},
            )
        self.session.commit()

    # ------------------------------------------------------------------
    # Country breakdown
    # ------------------------------------------------------------------

    def _aggregate_and_upsert_countries(self, orders: list):
        # key = (date_str, country_code)
        by_country: dict[tuple, dict] = defaultdict(lambda: {
            "orders_count": 0, "revenue": 0.0, "new_customers": 0,
        })

        # Track known first-timers by customer_id per day
        customer_first_order: dict[str, str] = {}
        for order in sorted(orders, key=lambda o: o.created_at or ""):
            cid = str(getattr(order, "customer", None) and order.customer.id or "")
            if cid and cid not in customer_first_order:
                customer_first_order[cid] = str(order.id)

        for order in orders:
            d = _local_date(order.created_at)
            if not d:
                continue
            billing = getattr(order, "billing_address", None)
            country = (billing.country_code if billing else None) or "XX"
            key = (d, country)
            revenue = _float(getattr(order, "total_price", 0))
            cid = str(getattr(order, "customer", None) and order.customer.id or "")
            by_country[key]["orders_count"] += 1
            by_country[key]["revenue"] += revenue
            if cid and customer_first_order.get(cid) == str(order.id):
                by_country[key]["new_customers"] += 1

        rows = []
        for (d, country), agg in by_country.items():
            cnt = agg["orders_count"]
            rev = agg["revenue"]
            rows.append({
                "date": d,
                "country_code": country,
                "orders_count": cnt,
                "revenue": rev,
                "avg_order_value": (rev / cnt) if cnt else 0,
                "new_customers": agg["new_customers"],
            })

        self._upsert_raw("shopify_country_metrics", rows, ["date", "country_code", "tenant_id"])

    # ------------------------------------------------------------------
    # Abandoned checkouts
    # ------------------------------------------------------------------

    def _upsert_abandoned_checkouts(self, checkouts: list):
        rows = []
        for checkout in checkouts:
            rows.append({
                "checkout_id": str(checkout.id),
                "customer_email": getattr(checkout, "email", None) or None,
                "created_at": _parse_dt(getattr(checkout, "created_at", None)) or datetime.utcnow(),
                "total_price": _float(getattr(checkout, "total_price", 0)),
                "recovered": False,  # updated by a separate recovery check if needed
            })
        self._upsert_raw("shopify_abandoned_checkouts", rows, ["checkout_id"])

    # ------------------------------------------------------------------
    # Products
    # ------------------------------------------------------------------

    def _sync_products(self):
        from datetime import datetime as dt
        try:
            page = shopify.Product.find(limit=250)
            all_products = list(page)
            while page.has_next_page():
                time.sleep(0.3)
                page = page.next_page()
                all_products.extend(list(page))
        except Exception as e:
            logger.warning("[shopify] Could not fetch products: %s", e)
            return

        rows = []
        for p in all_products:
            variants = list(getattr(p, "variants", []) or [])
            prices = [_float(getattr(v, "price", 0)) for v in variants if getattr(v, "price", None)]
            image = getattr(p, "image", None)
            image_url = getattr(image, "src", None) if image else None
            rows.append({
                "product_id": str(p.id),
                "title": getattr(p, "title", None),
                "handle": getattr(p, "handle", None),
                "status": getattr(p, "status", None),
                "product_type": getattr(p, "product_type", None),
                "vendor": getattr(p, "vendor", None),
                "image_url": image_url,
                "price_min": min(prices) if prices else None,
                "price_max": max(prices) if prices else None,
                "variants_count": len(variants),
                "synced_at": dt.utcnow(),
            })
        if rows:
            self._upsert_raw("shopify_products", rows, ["product_id"])
        logger.info("[shopify] Synced %d products", len(rows))

    # ------------------------------------------------------------------
    # Low-level upsert (mirrors FacebookCollector._upsert_raw)
    # ------------------------------------------------------------------

    def _upsert_raw(self, table_name: str, rows: list[dict], conflict_columns: list[str]) -> int:
        if not rows:
            return 0

        rows = self._inject_tenant(rows)

        meta = MetaData()
        meta.reflect(bind=self.session.bind, only=[table_name])
        table = meta.tables[table_name]

        # Strip keys not present in the DB table so extra collector fields never cause errors
        col_names = {c.name for c in table.columns}
        rows = [{k: v for k, v in row.items() if k in col_names} for row in rows]

        update_cols = [
            c.name for c in table.columns
            if c.name not in conflict_columns and c.name != "id"
        ]
        stmt = pg_insert(table).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=conflict_columns,
            set_={col: stmt.excluded[col] for col in update_cols},
        )
        self.session.execute(stmt)
        self.session.commit()
        self._records_collected += len(rows)
        return len(rows)
