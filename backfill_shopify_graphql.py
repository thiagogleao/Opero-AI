"""
Backfill histórico de pedidos Shopify via GraphQL API.

A REST API do Shopify bloqueia pedidos com mais de 60 dias — o GraphQL não tem
essa limitação. Use este script para preencher dados históricos.

Usage:
  py -3.12 backfill_shopify_graphql.py
  py -3.12 backfill_shopify_graphql.py --date-from 2026-01-01 --date-to 2026-02-03
"""

import argparse
import logging
import os
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import requests
from dotenv import load_dotenv
from sqlalchemy import MetaData, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("backfill")

STORE   = os.getenv("SHOPIFY_STORE_URL", "")
TOKEN   = os.getenv("SHOPIFY_ACCESS_TOKEN", "").strip("'\"")
VERSION = os.getenv("SHOPIFY_API_VERSION", "2024-01")
GQL_URL = f"https://{STORE}/admin/api/{VERSION}/graphql.json"
HEADERS = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}

# ---------------------------------------------------------------------------
# GraphQL query
# ---------------------------------------------------------------------------

ORDER_QUERY = """
query GetOrders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    edges {
      cursor
      node {
        id
        legacyResourceId
        name
        email
        createdAt
        processedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        totalPriceSet      { shopMoney { amount } }
        subtotalPriceSet   { shopMoney { amount } }
        totalDiscountsSet  { shopMoney { amount } }
        billingAddress     { countryCode }
        customer {
          id
          legacyResourceId
          email
          numberOfOrders
          amountSpent { amount }
          createdAt
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              variantTitle
              quantity
              originalUnitPriceSet { shopMoney { amount } }
              product { id legacyResourceId }
              variant { id legacyResourceId }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""


def gql(query: str, variables: dict) -> dict:
    resp = requests.post(GQL_URL, headers=HEADERS, json={"query": query, "variables": variables})
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(data["errors"])
    return data["data"]


def fetch_orders_graphql(date_from: date, date_to: date) -> list[dict]:
    """Fetch all orders in range via GraphQL (no 60-day limit)."""
    # Shopify GraphQL query filter syntax: range notation
    q = f"created_at:>{date_from} AND created_at:<{date_to + timedelta(days=1)}"
    orders = []
    cursor = None
    page = 0

    while True:
        page += 1
        data = gql(ORDER_QUERY, {"first": 250, "after": cursor, "query": q})
        edges = data["orders"]["edges"]
        page_info = data["orders"]["pageInfo"]

        for edge in edges:
            orders.append(edge["node"])

        logger.info("Page %d — fetched %d orders so far", page, len(orders))

        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]
        time.sleep(0.3)  # stay under rate limits

    return orders


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _float(value, default=0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _money(node: Optional[dict]) -> float:
    if not node:
        return 0.0
    return _float(node.get("shopMoney", {}).get("amount", 0))


# ---------------------------------------------------------------------------
# DB upsert
# ---------------------------------------------------------------------------

def upsert_raw(session, table_name: str, rows: list[dict], conflict_cols: list[str]):
    if not rows:
        return
    meta = MetaData()
    meta.reflect(bind=session.bind, only=[table_name])
    table = meta.tables[table_name]
    update_cols = [c.name for c in table.columns if c.name not in conflict_cols and c.name != "id"]
    stmt = pg_insert(table).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_cols,
        set_={col: stmt.excluded[col] for col in update_cols},
    )
    session.execute(stmt)
    session.commit()


# ---------------------------------------------------------------------------
# Transform + persist
# ---------------------------------------------------------------------------

def process_orders(orders: list[dict], session):
    # Determine first-order flag per customer (by Shopify lifetime count)
    order_rows = []
    item_rows  = []
    customer_rows = []

    for o in orders:
        legacy_id = o["legacyResourceId"]
        cust = o.get("customer") or {}
        cust_id = cust.get("legacyResourceId") or None
        billing = o.get("billingAddress") or {}
        country = billing.get("countryCode") or None
        total   = _money(o.get("totalPriceSet"))
        sub     = _money(o.get("subtotalPriceSet"))
        disc    = _money(o.get("totalDiscountsSet"))

        lifetime_orders = int(cust.get("numberOfOrders") or 0)
        is_new = lifetime_orders == 1

        order_rows.append({
            "order_id":           legacy_id,
            "order_number":       int(o.get("name", "#0").lstrip("#") or 0) or None,
            "customer_id":        cust_id,
            "email":              o.get("email") or cust.get("email"),
            "created_at":         _dt(o.get("createdAt")),
            "total_price":        total,
            "subtotal_price":     sub,
            "total_discounts":    disc,
            "currency":           o.get("currencyCode"),
            "country_code":       country,
            "financial_status":   (o.get("displayFinancialStatus") or "").lower(),
            "fulfillment_status": (o.get("displayFulfillmentStatus") or "").lower(),
            "is_first_order":     is_new,
        })

        # Line items
        for edge in (o.get("lineItems") or {}).get("edges", []):
            item = edge["node"]
            prod = item.get("product") or {}
            var  = item.get("variant") or {}
            item_rows.append({
                "order_id":      legacy_id,
                "line_item_id":  item["id"].split("/")[-1],
                "product_id":    prod.get("legacyResourceId"),
                "variant_id":    var.get("legacyResourceId"),
                "product_title": item.get("title"),
                "variant_title": item.get("variantTitle"),
                "quantity":      int(item.get("quantity") or 1),
                "price":         _money(item.get("originalUnitPriceSet")),
            })

        # Customer
        if cust_id:
            total_spent = _float((cust.get("amountSpent") or {}).get("amount", 0))
            orders_count = int(cust.get("numberOfOrders") or 0)
            customer_rows.append({
                "customer_id":     cust_id,
                "email":           cust.get("email") or o.get("email"),
                "created_at":      _dt(cust.get("createdAt")),
                "total_spent":     total_spent,
                "orders_count":    orders_count,
                "avg_order_value": (total_spent / orders_count) if orders_count else 0,
                "first_order_at":  _dt(o.get("createdAt")),
                "last_order_at":   _dt(o.get("createdAt")),
                "country_code":    country,
                "is_returning":    orders_count > 1,
            })

    logger.info("Upserting %d orders...", len(order_rows))
    upsert_raw(session, "shopify_orders", order_rows, ["order_id"])
    logger.info("Upserting %d line items...", len(item_rows))
    upsert_raw(session, "shopify_order_items", item_rows, ["order_id", "line_item_id"])
    logger.info("Upserting %d customers...", len(customer_rows))
    upsert_raw(session, "shopify_customers", customer_rows, ["customer_id"])

    # Aggregate daily metrics
    by_date: dict[str, dict] = defaultdict(lambda: {
        "total_orders": 0, "total_revenue": 0.0,
        "new_customers": 0, "returning_customers": 0,
        "new_customer_revenue": 0.0, "returning_customer_revenue": 0.0,
    })
    by_country: dict[tuple, dict] = defaultdict(lambda: {
        "orders_count": 0, "revenue": 0.0, "new_customers": 0,
    })

    for o, row in zip(orders, order_rows):
        dt = row["created_at"]
        if not dt:
            continue
        d = dt.date().isoformat()
        rev = row["total_price"]
        is_new = row["is_first_order"]
        country = row["country_code"] or "XX"

        by_date[d]["total_orders"]   += 1
        by_date[d]["total_revenue"]  += rev
        if is_new:
            by_date[d]["new_customers"] += 1
            by_date[d]["new_customer_revenue"] += rev
        else:
            by_date[d]["returning_customers"] += 1
            by_date[d]["returning_customer_revenue"] += rev

        by_country[(d, country)]["orders_count"] += 1
        by_country[(d, country)]["revenue"] += rev
        if is_new:
            by_country[(d, country)]["new_customers"] += 1

    daily_rows = []
    for d, agg in by_date.items():
        tot = agg["total_orders"]
        rev = agg["total_revenue"]
        daily_rows.append({
            "date": d,
            "total_orders":   tot,
            "total_revenue":  rev,
            "avg_order_value": (rev / tot) if tot else 0,
            "new_customers":  agg["new_customers"],
            "returning_customers": agg["returning_customers"],
            "new_customer_revenue": agg["new_customer_revenue"],
            "returning_customer_revenue": agg["returning_customer_revenue"],
            "cart_abandonment_count": 0,
            "cart_abandonment_value": 0.0,
        })

    logger.info("Upserting %d daily metric rows...", len(daily_rows))
    upsert_raw(session, "shopify_daily_metrics", daily_rows, ["date"])

    country_rows = []
    for (d, country), agg in by_country.items():
        cnt = agg["orders_count"]
        rev = agg["revenue"]
        country_rows.append({
            "date": d,
            "country_code": country,
            "orders_count": cnt,
            "revenue": rev,
            "avg_order_value": (rev / cnt) if cnt else 0,
            "new_customers": agg["new_customers"],
        })
    upsert_raw(session, "shopify_country_metrics", country_rows, ["date", "country_code"])
    logger.info("Done. %d orders processed.", len(orders))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--date-from", dest="date_from", type=date.fromisoformat, default=date(2026, 1, 4))
    p.add_argument("--date-to",   dest="date_to",   type=date.fromisoformat, default=date(2026, 2, 3))
    args = p.parse_args()

    print("=" * 52)
    print("  Shopify GraphQL Backfill")
    print(f"  Período: {args.date_from} → {args.date_to}")
    print("=" * 52)

    logger.info("Fetching orders via GraphQL...")
    orders = fetch_orders_graphql(args.date_from, args.date_to)
    logger.info("Total fetched: %d orders", len(orders))

    from app.database import get_db
    with get_db() as session:
        process_orders(orders, session)

    print("\n✅  Backfill completo!")


if __name__ == "__main__":
    main()
