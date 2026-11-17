"""
Shopify REST payload → database rows. Pure functions, no I/O.

The same mapping runs in TypeScript for the orders webhook
(frontend/lib/sync/orderMapping.ts); both are tested against one fixture
(app/tests/fixtures/order_jpy.json) so they cannot drift.

Money: every amount on a REST order is in the SHOP currency (`currency`).
Amounts are stored in US dollars, converted with the rate of the order's local
day; the shop currency and the rate are stored beside them so the original can
be rebuilt. A non-USD order without a rate is refused, never stored as dollars.

Geography: `country_code` stays the BILLING country, exactly as before, because
the profit engine prices shipping and supplier costs by it and changing it
would silently reprice history. Where the parcel actually goes is stored apart:
  geo_country_code  shipping country (billing when there is no shipping
                    address), with US territories split out of 'US';
  province_code     the province/state of that same address.
Shopify sends Puerto Rico, the US Virgin Islands, Guam, American Samoa, the
Northern Mariana Islands and the Minor Outlying Islands as country 'US' with
the territory in province_code; geo_country_code turns them into their own ISO
codes (EPOCH alone had 31 Puerto Rico orders hidden as US).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional

# US territories Shopify reports as country US + province code.
US_TERRITORIES = {"PR", "VI", "GU", "AS", "MP", "UM"}

RateFor = Callable[[Optional[str]], Optional[float]]


class MissingRate(RuntimeError):
    pass


def to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_ts(value: Optional[str]) -> Optional[datetime]:
    """ISO timestamp with offset → aware UTC datetime (timestamptz-safe)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def local_day(value: Optional[str]) -> Optional[str]:
    """The calendar day of a Shopify timestamp in the shop's own timezone.
    Shopify writes timestamps with the shop's offset, so the first ten
    characters already are the local date (converting to UTC first would push
    late-night orders into the next day)."""
    if not value:
        return None
    s = str(value)
    return s[:10] if len(s) >= 10 and s[4] == "-" and s[7] == "-" else None


def geo_country(country: Optional[str], province: Optional[str]) -> Optional[str]:
    c = (country or "").upper() or None
    p = (province or "").upper() or None
    if c == "US" and p in US_TERRITORIES:
        return p
    return c


def _shop_money(obj: Optional[dict]) -> Optional[float]:
    if not isinstance(obj, dict):
        return None
    sm = obj.get("shop_money") or {}
    if "amount" not in sm:
        return None
    return to_float(sm.get("amount"))


def _address(order: dict) -> tuple[Optional[str], Optional[str]]:
    """(country, province) of where the order goes: shipping, else billing."""
    for key in ("shipping_address", "billing_address"):
        a = order.get(key)
        if isinstance(a, dict) and a.get("country_code"):
            return a.get("country_code"), a.get("province_code")
    return None, None


def shipping_total(order: dict) -> float:
    """Shipping charged to the customer, in shop currency."""
    v = _shop_money(order.get("total_shipping_price_set"))
    if v is not None:
        return v
    return sum(to_float(l.get("price")) for l in order.get("shipping_lines") or [])


def order_rate(order: dict, rate_for: RateFor) -> Optional[float]:
    """USD per unit of shop currency for this order, or None for a USD shop.
    Raises MissingRate for a foreign-currency order without a rate."""
    currency = (order.get("currency") or "USD").upper()
    if currency == "USD":
        return None
    rate = rate_for(local_day(order.get("created_at")))
    if not rate:
        raise MissingRate(f"pedido {order.get('id')} em {currency} sem cotação")
    return float(rate)


def map_order(order: dict, rate_for: RateFor) -> dict:
    """One shopify_orders row. tenant_id is added by the caller."""
    rate = order_rate(order, rate_for)
    usd = (lambda v: round(v * rate, 6)) if rate else (lambda v: v)
    details = order.get("client_details") or {}
    customer = order.get("customer") or {}
    billing = order.get("billing_address") or {}
    country, province = _address(order)
    current_total = order.get("current_total_price")
    return {
        "order_id": str(order["id"]),
        "order_number": order.get("order_number"),
        "created_at": parse_ts(order.get("created_at")),
        "processed_at": parse_ts(order.get("processed_at")),
        "cancelled_at": parse_ts(order.get("cancelled_at")),
        "cancel_reason": order.get("cancel_reason") or None,
        "financial_status": order.get("financial_status"),
        "fulfillment_status": order.get("fulfillment_status"),
        "currency": order.get("currency"),
        "fx_rate": rate,
        "total_price": usd(to_float(order.get("total_price"))),
        "subtotal_price": usd(to_float(order.get("subtotal_price"))),
        "total_discounts": usd(to_float(order.get("total_discounts"))),
        "total_tax": usd(to_float(order.get("total_tax"))),
        "total_shipping": usd(shipping_total(order)),
        # Reflects refunds and edits; revenue stays total_price (the engine
        # books refunds separately, so lowering it would count them twice).
        "current_total_price": usd(to_float(current_total)) if current_total is not None else None,
        "country_code": (billing.get("country_code") or None),
        "geo_country_code": geo_country(country, province),
        "province_code": (province or None),
        "customer_id": str(customer["id"]) if customer.get("id") else None,
        "customer_email": order.get("email") or None,
        "source_name": order.get("source_name") or None,
        "tags": order.get("tags") or None,
        "landing_site": order.get("landing_site") or None,
        "referring_site": order.get("referring_site") or None,
        "browser_ip": order.get("browser_ip") or details.get("browser_ip") or None,
        "user_agent": details.get("user_agent") or None,
        "accept_language": details.get("accept_language") or None,
    }


def map_line_items(order: dict, rate_for: RateFor) -> list[dict]:
    rate = order_rate(order, rate_for)
    usd = (lambda v: round(v * rate, 6)) if rate else (lambda v: v)
    rows = []
    for item in order.get("line_items") or []:
        rows.append({
            "order_id": str(order["id"]),
            "line_item_id": str(item["id"]),
            "product_id": str(item["product_id"]) if item.get("product_id") else None,
            "variant_id": str(item["variant_id"]) if item.get("variant_id") else None,
            "product_title": item.get("title"),
            "variant_title": item.get("variant_title"),
            "title": item.get("name") or item.get("title"),
            "sku": item.get("sku") or None,
            "quantity": int(item.get("quantity") or 1),
            "price": usd(to_float(item.get("price"))),
            "total_discount": usd(to_float(item.get("total_discount"))),
            "fulfillment_status": item.get("fulfillment_status"),
        })
    return rows


def map_checkout(checkout: dict, shop_currency: Optional[str], rate_for: RateFor) -> dict:
    """Abandoned checkout totals are in the CUSTOMER's currency
    (presentment). Only a total in the shop currency can be converted with the
    shop's rates; any other one is stored as NULL rather than as a number in
    won or rupees read as dollars."""
    cur = (checkout.get("presentment_currency") or checkout.get("currency") or "").upper() or None
    shop = (shop_currency or "USD").upper()
    total = to_float(checkout.get("total_price"), default=None)  # type: ignore[arg-type]
    usd: Optional[float] = None
    if total is not None and cur in (None, shop):
        if shop == "USD":
            usd = total
        else:
            rate = rate_for(local_day(checkout.get("created_at")))
            usd = round(total * rate, 6) if rate else None
    return {
        "checkout_id": str(checkout["id"]),
        "customer_email": checkout.get("email") or None,
        "created_at": parse_ts(checkout.get("created_at")),
        "updated_at": parse_ts(checkout.get("updated_at")),
        "total_price": usd,
        "currency": cur,
        "recovered": bool(checkout.get("completed_at")),
    }


def map_product(product: dict, rate_for_latest: Callable[[float], float]) -> dict:
    variants = product.get("variants") or []
    prices = [rate_for_latest(to_float(v.get("price"))) for v in variants if v.get("price") not in (None, "")]
    inventory = [v.get("inventory_quantity") for v in variants if isinstance(v.get("inventory_quantity"), int)]
    image = product.get("image") or {}
    return {
        "product_id": str(product["id"]),
        "title": product.get("title"),
        "handle": product.get("handle"),
        "status": product.get("status"),
        "product_type": product.get("product_type"),
        "vendor": product.get("vendor"),
        "tags": product.get("tags") or None,
        "created_at": parse_ts(product.get("created_at")),
        "updated_at": parse_ts(product.get("updated_at")),
        "image_url": image.get("src") if isinstance(image, dict) else None,
        "price_min": min(prices) if prices else None,
        "price_max": max(prices) if prices else None,
        "inventory_quantity": sum(inventory) if inventory else None,
        "variants_count": len(variants),
        "synced_at": datetime.now(timezone.utc),
    }
