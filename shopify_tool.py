"""
Shopify store management tool for MOKOO.

Usage:
  python shopify_tool.py products list
  python shopify_tool.py products get <id>
  python shopify_tool.py products create
  python shopify_tool.py products update <id>
  python shopify_tool.py products delete <id>

  python shopify_tool.py pages list
  python shopify_tool.py pages get <id>
  python shopify_tool.py pages create
  python shopify_tool.py pages update <id>

  python shopify_tool.py theme list
  python shopify_tool.py theme files [theme_id]
  python shopify_tool.py theme read <theme_id> <key>
  python shopify_tool.py theme write <theme_id> <key> <file>

  python shopify_tool.py collections list
  python shopify_tool.py orders list [--limit N]
  python shopify_tool.py shop info
"""

import sys
import json
import argparse
import requests
from typing import Optional

# Windows UTF-8 fix
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── Credentials ────────────────────────────────────────────────────────────────

def _get_creds():
    try:
        import os
        sys.path.insert(0, ".")
        from app.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT shopify_domain, shopify_access_token FROM tenants LIMIT 1")
            ).fetchone()
            return row[0], row[1]
    except Exception as e:
        # Fallback to env vars
        domain = os.environ.get("SHOPIFY_DOMAIN")
        token  = os.environ.get("SHOPIFY_ACCESS_TOKEN")
        if domain and token:
            return domain, token
        print(f"[error] Could not load credentials: {e}")
        sys.exit(1)


DOMAIN, TOKEN = _get_creds()
API_VERSION   = "2024-01"
BASE_URL      = f"https://{DOMAIN}/admin/api/{API_VERSION}"
HEADERS       = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _get(path: str, params: dict = None) -> dict:
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, params=params or {})
    r.raise_for_status()
    return r.json()

def _post(path: str, data: dict) -> dict:
    r = requests.post(f"{BASE_URL}{path}", headers=HEADERS, json=data)
    r.raise_for_status()
    return r.json()

def _put(path: str, data: dict) -> dict:
    r = requests.put(f"{BASE_URL}{path}", headers=HEADERS, json=data)
    r.raise_for_status()
    return r.json()

def _delete(path: str) -> None:
    r = requests.delete(f"{BASE_URL}{path}", headers=HEADERS)
    r.raise_for_status()

def _pp(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


# ── Products ───────────────────────────────────────────────────────────────────

def products_list(args):
    data = _get("/products.json", {"limit": args.limit, "status": args.status})
    products = data.get("products", [])
    print(f"\n{'ID':<15} {'Title':<40} {'Status':<10} {'Variants':<8} {'Price'}")
    print("─" * 85)
    for p in products:
        price = p["variants"][0]["price"] if p.get("variants") else "—"
        print(f"{p['id']:<15} {p['title'][:38]:<40} {p['status']:<10} {len(p['variants']):<8} ${price}")
    print(f"\n{len(products)} products")

def products_get(args):
    data = _get(f"/products/{args.id}.json")
    p = data["product"]
    print(f"\n{'='*60}")
    print(f"  {p['title']}  [{p['status']}]  ID: {p['id']}")
    print(f"{'='*60}")
    print(f"  Handle:      {p['handle']}")
    print(f"  Type:        {p.get('product_type') or '—'}")
    print(f"  Vendor:      {p.get('vendor') or '—'}")
    print(f"  Tags:        {p.get('tags') or '—'}")
    print(f"\n  Variants ({len(p['variants'])}):")
    for v in p["variants"]:
        print(f"    [{v['id']}] {v.get('title','Default'):20} ${v['price']:>8}  SKU: {v.get('sku') or '—'}  Stock: {v.get('inventory_quantity','?')}")
    print(f"\n  Images ({len(p.get('images', []))}):")
    for img in p.get("images", [])[:3]:
        print(f"    {img['src'][:80]}")
    print(f"\n  Description (first 300 chars):")
    body = (p.get("body_html") or "").replace("<br>", "\n").replace("<p>", "").replace("</p>", "\n")
    print(f"    {body[:300]}")

def products_create(args):
    print("\nCreate new product (press Enter to skip optional fields)\n")
    title       = input("Title: ").strip()
    description = input("Description (HTML ok): ").strip()
    price       = input("Price (USD): ").strip() or "0.00"
    sku         = input("SKU (optional): ").strip()
    product_type = input("Product type (optional): ").strip()
    vendor      = input("Vendor (optional): ").strip()
    tags        = input("Tags (comma-separated, optional): ").strip()
    status      = input("Status [draft/active] (default: draft): ").strip() or "draft"

    payload = {
        "product": {
            "title": title,
            "body_html": description,
            "product_type": product_type,
            "vendor": vendor,
            "tags": tags,
            "status": status,
            "variants": [{"price": price, "sku": sku}],
        }
    }
    result = _post("/products.json", payload)
    p = result["product"]
    print(f"\n✓ Product created: {p['title']} (ID: {p['id']}, status: {p['status']})")
    print(f"  Admin URL: https://{DOMAIN}/admin/products/{p['id']}")

def products_update(args):
    # Show current values first
    current = _get(f"/products/{args.id}.json")["product"]
    print(f"\nUpdating: {current['title']} (ID: {args.id})")
    print("Press Enter to keep current value.\n")

    fields = {}
    title = input(f"Title [{current['title']}]: ").strip()
    if title: fields["title"] = title

    status = input(f"Status [{current['status']}] (draft/active): ").strip()
    if status: fields["status"] = status

    tags = input(f"Tags [{current.get('tags','')}]: ").strip()
    if tags: fields["tags"] = tags

    # Variant price update
    if current.get("variants"):
        v = current["variants"][0]
        price = input(f"Price (first variant) [${v['price']}]: ").strip()
        if price:
            _put(f"/variants/{v['id']}.json", {"variant": {"id": v["id"], "price": price}})
            print(f"  ✓ Variant price updated to ${price}")

    if fields:
        fields["id"] = args.id
        result = _put(f"/products/{args.id}.json", {"product": fields})
        print(f"  ✓ Product updated: {result['product']['title']}")
    else:
        print("  No changes made.")

def products_delete(args):
    confirm = input(f"Delete product {args.id}? Type 'yes' to confirm: ").strip()
    if confirm.lower() == "yes":
        _delete(f"/products/{args.id}.json")
        print(f"✓ Product {args.id} deleted.")
    else:
        print("Cancelled.")


# ── Pages ──────────────────────────────────────────────────────────────────────

def pages_list(args):
    data = _get("/pages.json", {"limit": 50})
    pages = data.get("pages", [])
    print(f"\n{'ID':<12} {'Title':<45} {'Published'}")
    print("─" * 70)
    for p in pages:
        pub = "✓" if p.get("published_at") else "draft"
        print(f"{p['id']:<12} {p['title'][:43]:<45} {pub}")
    print(f"\n{len(pages)} pages")

def pages_get(args):
    data = _get(f"/pages/{args.id}.json")
    p = data["page"]
    print(f"\nTitle: {p['title']}")
    print(f"Handle: {p['handle']}")
    print(f"Published: {p.get('published_at') or 'draft'}")
    print(f"\nContent:\n{p.get('body_html','')[:500]}")

def pages_create(args):
    title   = input("Page title: ").strip()
    content = input("Content (HTML): ").strip()
    handle  = input("Handle/slug (optional): ").strip()
    publish = input("Publish now? [y/N]: ").strip().lower() == "y"

    payload = {"page": {"title": title, "body_html": content}}
    if handle:   payload["page"]["handle"] = handle
    if not publish: payload["page"]["published"] = False

    result = _post("/pages.json", payload)
    p = result["page"]
    print(f"\n✓ Page created: {p['title']} (ID: {p['id']})")

def pages_update(args):
    current = _get(f"/pages/{args.id}.json")["page"]
    print(f"\nUpdating page: {current['title']}")
    fields = {}
    title = input(f"Title [{current['title']}]: ").strip()
    if title: fields["title"] = title
    content = input("New content (HTML, Enter to skip): ").strip()
    if content: fields["body_html"] = content
    if fields:
        fields["id"] = args.id
        _put(f"/pages/{args.id}.json", {"page": fields})
        print("✓ Page updated.")


# ── Themes ─────────────────────────────────────────────────────────────────────

def theme_list(args):
    data = _get("/themes.json")
    themes = data.get("themes", [])
    print(f"\n{'ID':<12} {'Name':<35} {'Role'}")
    print("─" * 60)
    for t in themes:
        print(f"{t['id']:<12} {t['name'][:33]:<35} {t['role']}")

def theme_files(args):
    theme_id = args.theme_id or _get_main_theme_id()
    data = _get(f"/themes/{theme_id}/assets.json")
    assets = data.get("assets", [])
    for a in assets:
        print(a["key"])

def theme_read(args):
    data = _get(f"/themes/{args.theme_id}/assets.json", {"asset[key]": args.key})
    asset = data.get("asset", {})
    content = asset.get("value") or asset.get("attachment", "")
    print(content)

def theme_write(args):
    with open(args.file, "r", encoding="utf-8") as f:
        content = f.read()
    payload = {"asset": {"key": args.key, "value": content}}
    _put(f"/themes/{args.theme_id}/assets.json", payload)
    print(f"✓ Written to {args.key} on theme {args.theme_id}")

def _get_main_theme_id() -> int:
    themes = _get("/themes.json").get("themes", [])
    for t in themes:
        if t["role"] == "main":
            return t["id"]
    return themes[0]["id"]


# ── Collections ────────────────────────────────────────────────────────────────

def collections_list(args):
    customs = _get("/custom_collections.json", {"limit": 50}).get("custom_collections", [])
    smarts  = _get("/smart_collections.json",  {"limit": 50}).get("smart_collections", [])
    all_c   = [("custom", c) for c in customs] + [("smart", c) for c in smarts]
    print(f"\n{'ID':<12} {'Title':<40} {'Type'}")
    print("─" * 60)
    for kind, c in all_c:
        print(f"{c['id']:<12} {c['title'][:38]:<40} {kind}")
    print(f"\n{len(all_c)} collections")


# ── Orders ─────────────────────────────────────────────────────────────────────

def orders_list(args):
    data = _get("/orders.json", {"limit": args.limit, "status": "any"})
    orders = data.get("orders", [])
    print(f"\n{'ID':<12} {'#':<8} {'Date':<14} {'Status':<12} {'Total':<10} {'Customer'}")
    print("─" * 75)
    for o in orders:
        date = (o.get("created_at") or "")[:10]
        customer = (o.get("email") or o.get("customer", {}).get("email") or "—")[:25]
        print(f"{o['id']:<12} #{o['order_number']:<7} {date:<14} {o['financial_status']:<12} ${o['total_price']:<9} {customer}")
    print(f"\n{len(orders)} orders")


# ── Shop info ──────────────────────────────────────────────────────────────────

def shop_info(args):
    shop = _get("/shop.json")["shop"]
    print(f"\n{'='*50}")
    print(f"  {shop['name']}")
    print(f"{'='*50}")
    print(f"  Domain:    {shop['domain']}")
    print(f"  Email:     {shop['email']}")
    print(f"  Currency:  {shop['currency']}")
    print(f"  Timezone:  {shop['iana_timezone']}")
    print(f"  Plan:      {shop['plan_name']}")
    print(f"  Country:   {shop.get('country_name','—')}")


# ── CLI setup ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Shopify store tool for MOKOO")
    sub = parser.add_subparsers(dest="resource")

    # products
    p_prod = sub.add_parser("products")
    p_prod_sub = p_prod.add_subparsers(dest="action")
    pl = p_prod_sub.add_parser("list")
    pl.add_argument("--limit", type=int, default=50)
    pl.add_argument("--status", default="any")
    pg = p_prod_sub.add_parser("get");   pg.add_argument("id")
    p_prod_sub.add_parser("create")
    pu = p_prod_sub.add_parser("update"); pu.add_argument("id")
    pd = p_prod_sub.add_parser("delete"); pd.add_argument("id")

    # pages
    p_page = sub.add_parser("pages")
    p_page_sub = p_page.add_subparsers(dest="action")
    p_page_sub.add_parser("list")
    pgg = p_page_sub.add_parser("get");    pgg.add_argument("id")
    p_page_sub.add_parser("create")
    pgu = p_page_sub.add_parser("update"); pgu.add_argument("id")

    # theme
    p_theme = sub.add_parser("theme")
    p_theme_sub = p_theme.add_subparsers(dest="action")
    p_theme_sub.add_parser("list")
    tfs = p_theme_sub.add_parser("files"); tfs.add_argument("theme_id", nargs="?")
    tr_ = p_theme_sub.add_parser("read");  tr_.add_argument("theme_id"); tr_.add_argument("key")
    tw  = p_theme_sub.add_parser("write"); tw.add_argument("theme_id"); tw.add_argument("key"); tw.add_argument("file")

    # collections
    sub.add_parser("collections").add_subparsers(dest="action").add_parser("list")

    # orders
    p_ord = sub.add_parser("orders")
    p_ord_sub = p_ord.add_subparsers(dest="action")
    ol = p_ord_sub.add_parser("list"); ol.add_argument("--limit", type=int, default=20)

    # shop
    sub.add_parser("shop").add_subparsers(dest="action").add_parser("info")

    args = parser.parse_args()

    dispatch = {
        ("products",    "list"):   products_list,
        ("products",    "get"):    products_get,
        ("products",    "create"): products_create,
        ("products",    "update"): products_update,
        ("products",    "delete"): products_delete,
        ("pages",       "list"):   pages_list,
        ("pages",       "get"):    pages_get,
        ("pages",       "create"): pages_create,
        ("pages",       "update"): pages_update,
        ("theme",       "list"):   theme_list,
        ("theme",       "files"):  theme_files,
        ("theme",       "read"):   theme_read,
        ("theme",       "write"):  theme_write,
        ("collections", "list"):   collections_list,
        ("orders",      "list"):   orders_list,
        ("shop",        "info"):   shop_info,
    }

    key = (args.resource, getattr(args, "action", None))
    fn  = dispatch.get(key)
    if fn:
        fn(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
