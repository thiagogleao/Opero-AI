"""
Testa se a API do Shopify realmente retorna pedidos de janeiro
usando requests diretamente (sem a biblioteca ShopifyAPI).
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

STORE = os.getenv("SHOPIFY_STORE_URL", "")
TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "").strip("'\"")
VERSION = os.getenv("SHOPIFY_API_VERSION", "2024-01")

BASE = f"https://{STORE}/admin/api/{VERSION}"
HEADERS = {"X-Shopify-Access-Token": TOKEN}


def get_count(params):
    r = requests.get(f"{BASE}/orders/count.json", headers=HEADERS, params=params)
    return r.json().get("count", "ERROR")


def get_orders(params):
    r = requests.get(f"{BASE}/orders.json", headers=HEADERS, params=params)
    data = r.json()
    orders = data.get("orders", [])
    return orders, r.headers.get("Link", "")


print("=" * 60)
print("Diagnóstico: pedidos de janeiro via requests direto")
print("=" * 60)

# Test 1: count for January
jan_params = {
    "status": "any",
    "created_at_min": "2026-01-04T00:00:00",
    "created_at_max": "2026-01-31T23:59:59",
}
count_jan = get_count(jan_params)
print(f"\n[1] Count endpoint — janeiro (sem updated_at_min): {count_jan}")

# Test 2: count for January with updated_at_min
jan_params_u = {**jan_params, "updated_at_min": "2020-01-01T00:00:00"}
count_jan_u = get_count(jan_params_u)
print(f"[2] Count endpoint — janeiro (com updated_at_min 2020): {count_jan_u}")

# Test 3: actually fetch January orders
orders_jan, link = get_orders({**jan_params_u, "limit": 10})
print(f"[3] Find  endpoint — janeiro (com updated_at_min 2020): {len(orders_jan)} orders")
if orders_jan:
    for o in orders_jan[:3]:
        print(f"    order #{o.get('order_number')} created_at={o.get('created_at')} total={o.get('total_price')}")
else:
    print("    → 0 orders returned")

# Test 4: fetch full range count
full_params = {
    "status": "any",
    "created_at_min": "2026-01-04T00:00:00",
    "created_at_max": "2026-04-04T23:59:59",
}
count_full = get_count(full_params)
print(f"\n[4] Count endpoint — jan-abr completo: {count_full}")

# Test 5: try fetching with since_id=1 (bypass date filter entirely)
print(f"\n[5] Fetching 5 oldest orders (since_id=1, status=any)...")
oldest, _ = get_orders({"status": "any", "limit": 5, "since_id": 1})
for o in oldest:
    print(f"    order #{o.get('order_number')} created_at={o.get('created_at')}")

print("\n" + "=" * 60)
print("Se [3] retorna 0 mas [4] retorna 1434, a API tem bug.")
print("Se [5] mostra pedidos de jan, o bug é no filtro de data.")
print("=" * 60)
