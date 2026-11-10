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
from sqlalchemy import Table, MetaData, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.collectors.base import BaseCollector
from app.config import settings

logger = logging.getLogger(__name__)

# Module-level cache for reflected table objects — same rationale as facebook.py.
_TABLE_CACHE: dict = {}

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
        timezone: Optional[str] = None,
    ):
        super().__init__(session, tenant_id)
        self._store_tz_name = timezone  # IANA timezone string, e.g. "America/Sao_Paulo"
        # Cotacao do periodo, carregada no _run. Dicionario vazio significa loja
        # que fatura em dolar — e ai toda conversao abaixo e um no-op.
        self._taxas: dict = {}
        self._moeda: Optional[str] = None
        url   = store_url   or settings.shopify_store_url
        token = access_token or settings.shopify_access_token
        ver   = api_version  or settings.shopify_api_version
        shop_url = url if url.startswith("https://") else f"https://{url}"
        # Guardados porque o ShopifyQL de Shop Campaigns precisa de uma versao
        # de API mais nova do que a da sessao, entao a chamada e feita na mao.
        self._shop_url = shop_url.rstrip("/")
        self._shop_token = token
        sess = shopify.Session(shop_url, ver, token)
        shopify.ShopifyResource.activate_session(sess)

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------

    def _run(self, date_from: date, date_to: date) -> None:
        # A moeda da loja vem antes de tudo: se ela nao fatura em dolar, cada
        # valor tem de ser convertido na entrada, inclusive o preco do catalogo.
        self._save_shop_timezone()
        self._carregar_cotacao(date_from, date_to)

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

        self._sync_shop_campaigns(date_from, date_to)

        logger.info("[shopify] Fetching abandoned checkouts %s → %s", date_from, date_to)
        checkouts = self._fetch_all_abandoned_checkouts(date_from, date_to)
        logger.info("[shopify] Got %d abandoned checkouts", len(checkouts))
        self._upsert_abandoned_checkouts(checkouts)

        # Refresh daily metrics with abandonment data
        self._patch_daily_with_abandonment(checkouts)

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    def _save_shop_timezone(self) -> None:
        """Fetch IANA timezone, store name and currency from Shopify and persist them."""
        if not self.tenant_id:
            return
        try:
            shop = shopify.Shop.current()
            tz = getattr(shop, "iana_timezone", None) or getattr(shop, "timezone", None)
            name = getattr(shop, "name", None)
            moeda = getattr(shop, "currency", None)
            self._moeda = moeda
            updates = {}
            if tz:
                updates["tz"] = tz
            if name:
                updates["name"] = name
            if moeda:
                updates["cur"] = moeda
            if updates:
                from sqlalchemy import text
                set_clause = ", ".join(
                    (["timezone = :tz"] if "tz" in updates else []) +
                    (["shop_name = :name"] if "name" in updates else []) +
                    (["shopify_currency = :cur"] if "cur" in updates else [])
                )
                self.session.execute(
                    text(f"UPDATE tenants SET {set_clause} WHERE id = :tid"),
                    {**updates, "tid": self.tenant_id},
                )
                self.session.commit()
                logger.info(
                    "[shopify] Store info saved: tz=%s name=%s currency=%s", tz, name, moeda
                )
        except Exception as e:
            logger.warning("[shopify] Could not fetch shop info: %s", e)

    def _carregar_cotacao(self, date_from: date, date_to: date) -> None:
        """Carrega a cotacao do periodo quando a loja nao fatura em dolar.

        Loja em dolar sai daqui sem tocar em rede nem em banco, e `self._taxas`
        fica vazio — o que torna `_usd` uma funcao identidade. E por isso que
        esta mudanca nao pode alterar numero de nenhuma loja existente.
        """
        # O _save_shop_timezone engole qualquer erro de rede e segue em frente.
        # Se ele falhar numa loja em moeda local, self._moeda fica None, a
        # conversao e pulada e o sync grava iene como se fosse dolar — e ainda
        # reporta sucesso. Ja aconteceu. Entao, quando a leitura ao vivo nao
        # trouxe a moeda, caio no que esta gravado na loja.
        if not self._moeda and self.tenant_id:
            from sqlalchemy import text
            guardada = self.session.execute(
                text("SELECT shopify_currency FROM tenants WHERE id = :tid"),
                {"tid": self.tenant_id},
            ).scalar()
            if guardada:
                self._moeda = guardada
                logger.warning(
                    "[shopify] nao li a moeda da loja agora; usando a gravada: %s", guardada
                )

        if not self._moeda:
            # Loja nova cuja moeda ainda nao conhecemos. Seguir converteria nada
            # e poderia gravar valor cru sem ninguem perceber.
            logger.warning("[shopify] moeda da loja desconhecida — nao vou converter nada")
            return
        if self._moeda.upper() == "USD":
            return
        from app.collectors.fx import taxas_do_periodo, FxError
        try:
            self._taxas = taxas_do_periodo(self.session, self._moeda, date_from, date_to)
            amostra = self._taxas.get(date_to) or next(iter(self._taxas.values()))
            logger.info(
                "[shopify] loja em %s — convertendo para USD (%s dias de cotacao, "
                "1 %s = %.8f USD em %s)",
                self._moeda, len(self._taxas), self._moeda, amostra, date_to,
            )
        except FxError as e:
            # Importar iene como se fosse dolar inflaria a receita ~158x. Melhor
            # falhar o sync e aparecer no log do que gravar numero errado.
            raise RuntimeError(
                f"[shopify] loja fatura em {self._moeda} e eu nao consegui cotacao: {e}"
            ) from e

    @staticmethod
    def _como_data(dia):
        """Aceita date, 'AAAA-MM-DD' ou o timestamp cru da Shopify."""
        if dia is None or isinstance(dia, date):
            return dia
        try:
            return date.fromisoformat(str(dia)[:10])
        except ValueError:
            return None

    def _usd(self, valor: float, dia=None) -> float:
        """Valor em dolar. Para loja em dolar devolve o proprio valor."""
        if not self._taxas:
            return valor
        from app.collectors.fx import para_usd
        return para_usd(valor, self._como_data(dia), self._taxas)

    def _taxa(self, dia=None):
        """A cotacao aplicada, gravada junto do pedido para dar auditoria."""
        if not self._taxas:
            return None
        from app.collectors.fx import taxa_do_dia
        return taxa_do_dia(self._como_data(dia), self._taxas)

    def _tz_bounds(self, d: date) -> tuple[str, str]:
        """Return (start, end) ISO 8601 strings for a date with the store's timezone offset.

        Shopify treats timestamps without a timezone offset as UTC. Passing the
        store's offset (e.g. '2026-06-14T00:00:00-03:00') ensures that the query
        window matches the store's business day, not UTC midnight-to-midnight.
        Falls back to bare T00:00:00 / T23:59:59 when no timezone is configured.
        """
        if self._store_tz_name:
            try:
                from zoneinfo import ZoneInfo
                tz = ZoneInfo(self._store_tz_name)
                start = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
                end   = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=tz)
                return start.isoformat(), end.isoformat()
            except Exception:
                pass
        return f"{d}T00:00:00", f"{d}T23:59:59"

    def _fetch_all_orders(self, date_from: date, date_to: date) -> list:
        """Return all orders in the date range.

        Fetches in 7-day chunks to avoid pagination bugs with large result sets.
        Also logs API count vs fetched count for discrepancy detection.
        """
        from datetime import timedelta

        # Ask API for total count first — useful for diagnosing discrepancies
        _, count_max = self._tz_bounds(date_to)
        count_min, _ = self._tz_bounds(date_from)
        try:
            api_count = shopify.Order.count(
                status="any",
                created_at_min=count_min,
                created_at_max=count_max,
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
            chunk_min, _ = self._tz_bounds(chunk_start)
            _, chunk_max = self._tz_bounds(chunk_end)
            params = dict(
                status="any",
                limit=250,
                created_at_min=chunk_min,
                created_at_max=chunk_max,
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
        checkout_min, _ = self._tz_bounds(date_from)
        _, checkout_max = self._tz_bounds(date_to)
        params = dict(
            status="open",
            limit=250,
            created_at_min=checkout_min,  # abandoned checkouts don't have processed_at
            created_at_max=checkout_max,
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

            # Shopify exposes the checkout fingerprint either at the top level or
            # under client_details, depending on API version and order age.
            details = getattr(order, "client_details", None)
            browser_ip = (
                getattr(order, "browser_ip", None)
                or (getattr(details, "browser_ip", None) if details else None)
            )

            rows.append({
                "order_id": str(order.id),
                "order_number": getattr(order, "order_number", None),
                "browser_ip": browser_ip or None,
                "user_agent": (getattr(details, "user_agent", None) if details else None) or None,
                "accept_language": (getattr(details, "accept_language", None) if details else None) or None,
                "customer_id": cid or None,
                "customer_email": getattr(order, "email", None) or None,
                "created_at": _parse_dt(order.created_at),
                # Convertido para dolar na entrada. A moeda original e a taxa
                # usada ficam gravadas ao lado, entao da para reconstruir o
                # valor que a Shopify mostra.
                "total_price": self._usd(_float(getattr(order, "total_price", 0)), order.created_at),
                "subtotal_price": self._usd(_float(getattr(order, "subtotal_price", 0)), order.created_at),
                "total_discounts": self._usd(_float(getattr(order, "total_discounts", 0)), order.created_at),
                "currency": getattr(order, "currency", None),
                "fx_rate": self._taxa(order.created_at),
                "country_code": country_code,
                "financial_status": getattr(order, "financial_status", None),
                "fulfillment_status": getattr(order, "fulfillment_status", None),
                "is_first_order": (
                    bool(cid and customer_first_order.get(cid) == str(order.id))
                ),
            })

        # Trava de seguranca. O Opero soma dinheiro como numero puro, entao um
        # pedido em moeda local sem taxa aplicada entra inflado — na Hibikura
        # seria 158x. Isso ja aconteceu de verdade, silenciosamente, porque o
        # _save_shop_timezone engole erro de rede e o sync segue reportando
        # sucesso. Aqui eu uso a moeda do PROPRIO pedido, que nao depende de
        # nada ter dado certo antes, e prefiro quebrar o sync a gravar errado.
        suspeitos = [
            r for r in rows
            if (r.get("currency") or "USD").upper() != "USD" and r.get("fx_rate") is None
        ]
        if suspeitos:
            moedas = sorted({(r.get("currency") or "?") for r in suspeitos})
            raise RuntimeError(
                f"[shopify] {len(suspeitos)} pedido(s) em {', '.join(moedas)} sem cotacao "
                f"aplicada. Nao vou gravar: entraria como se fosse dolar. "
                f"Verifique a cotacao e a moeda da loja (tenants.shopify_currency)."
            )

        # Shopify stops returning the checkout fingerprint on older orders, so a
        # resync of history must not blank out what we already captured.
        self._upsert_raw(
            "shopify_orders", rows, ["order_id"],
            preserve_on_null=["browser_ip", "user_agent", "accept_language"],
        )

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
                    "price": self._usd(_float(getattr(item, "price", 0)), order.created_at),
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

            # Use Shopify's lifetime totals if available on the customer object.
            # Esse total nao tem data propria — e a vida inteira do cliente —,
            # entao numa loja em moeda local ele vai pela cotacao mais recente.
            # E aproximacao, e so afeta a coluna de LTV do cliente.
            total_spent = self._usd(_float(getattr(customer_obj, "total_spent", None) or 0))
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
                "total_spent": total_spent or sum(
                    self._usd(_float(o.total_price), o.created_at) for o in corders
                ),
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
            revenue = self._usd(_float(getattr(order, "total_price", 0)), d)
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
        """Re-aggregate order metrics from shopify_orders for the sync window.

        Uses a 7-day buffer on each side of the window to catch timezone-shifted
        orders and late-arriving refunds without recalculating the entire history
        (which grows unboundedly and was the main cause of sync slowness).
        """
        if not self.tenant_id:
            return

        from sqlalchemy import text
        from datetime import timedelta

        tz_row = self.session.execute(
            text("SELECT COALESCE(timezone, 'UTC') AS tz FROM tenants WHERE id = :tid"),
            {"tid": self.tenant_id},
        ).fetchone()
        store_tz = tz_row[0] if tz_row else "UTC"

        calc_from = date_from - timedelta(days=7)
        calc_to   = date_to   + timedelta(days=1)

        self.session.execute(text(
            "INSERT INTO shopify_daily_metrics "
            "    (tenant_id, date, total_orders, total_revenue, avg_order_value, "
            "     new_customers, returning_customers, new_customer_revenue, "
            "     returning_customer_revenue, cart_abandonment_count, cart_abandonment_value) "
            "SELECT "
            "    :tid, "
            "    DATE(created_at AT TIME ZONE :tz), "
            "    COUNT(*), "
            "    COALESCE(SUM(total_price), 0), "
            "    CASE WHEN COUNT(*) > 0 THEN SUM(total_price) / COUNT(*) ELSE 0 END, "
            "    0, 0, 0, 0, 0, 0 "
            "FROM shopify_orders "
            "WHERE tenant_id = :tid "
            "  AND financial_status NOT IN ('refunded', 'voided') "
            "  AND (created_at AT TIME ZONE :tz)::date BETWEEN :calc_from AND :calc_to "
            "GROUP BY DATE(created_at AT TIME ZONE :tz) "
            "ON CONFLICT (date, tenant_id) DO UPDATE SET "
            "    total_orders    = EXCLUDED.total_orders, "
            "    total_revenue   = EXCLUDED.total_revenue, "
            "    avg_order_value = EXCLUDED.avg_order_value"
        ), {"tid": self.tenant_id, "tz": store_tz, "calc_from": calc_from, "calc_to": calc_to})
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
            by_date[d]["value"] += self._usd(
                _float(getattr(checkout, "total_price", 0)), d)

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
            revenue = self._usd(_float(getattr(order, "total_price", 0)), d)
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
    # Shop Campaigns — anuncio que a Shopify roda e cobra por fora
    # ------------------------------------------------------------------

    def _sync_shop_campaigns(self, date_from: date, date_to: date) -> None:
        """Gasto de Shop Campaigns, que a Shopify cobra na fatura dela.

        Esse dinheiro nao passa pelo Meta, entao ate agora nao entrava em lugar
        nenhum do Opero e o lucro saia alto — na Dumpling Squishy eram quase
        mil dolares por dia invisiveis.

        Nao esta em marketing_events nem em marketingActivities: os dois voltam
        vazios. Vive no ShopifyQL, schema shop_campaign_insights, que exige
        versao de API 2026-10 e o escopo read_reports. Loja sem esse escopo
        apenas registra aviso — nao quebra o sync, porque o resto dos dados
        dela continua bom.
        """
        if not self.tenant_id:
            return
        import json as _json
        import urllib.request as _req

        consulta = (
            "FROM shop_campaign_insights SHOW shop_campaign_ad_spend "
            f"GROUP BY day SINCE {date_from.isoformat()} UNTIL {date_to.isoformat()} ORDER BY day"
        )
        corpo = _json.dumps({
            "query": "query($q:String!){ shopifyqlQuery(query:$q){ tableData{ rows } parseErrors } }",
            "variables": {"q": consulta},
        }).encode()
        url = f"{self._shop_url}/admin/api/2026-10/graphql.json"
        pedido = _req.Request(url, data=corpo, headers={
            "X-Shopify-Access-Token": self._shop_token,
            "Content-Type": "application/json",
        })
        try:
            with _req.urlopen(pedido, timeout=30) as r:
                j = _json.loads(r.read())
        except Exception as e:
            logger.warning("[shopify] Shop Campaigns: nao consegui consultar — %s", e)
            return

        if j.get("errors"):
            msg = j["errors"][0].get("message", "")
            if "read_reports" in msg:
                logger.warning(
                    "[shopify] Shop Campaigns: falta o escopo read_reports nesta loja; "
                    "o gasto dela nao vai ser descontado do lucro")
            else:
                logger.warning("[shopify] Shop Campaigns: %s", msg[:160])
            return

        dados = (j.get("data") or {}).get("shopifyqlQuery") or {}
        erros = dados.get("parseErrors")
        if erros and len(str(erros)) > 2:
            logger.warning("[shopify] Shop Campaigns: ShopifyQL recusou — %s", str(erros)[:160])
            return

        linhas = ((dados.get("tableData") or {}).get("rows")) or []
        if not linhas:
            return

        from sqlalchemy import text
        gravadas = 0
        total = 0.0
        for linha in linhas:
            dia = linha.get("day")
            bruto = _float(linha.get("shop_campaign_ad_spend", 0))
            if not dia:
                continue
            # O ShopifyQL devolve na moeda da loja, igual aos pedidos.
            convertido = self._usd(bruto, dia)
            total += convertido
            self.session.execute(
                text(
                    "INSERT INTO shop_campaign_daily (tenant_id, date, spend, currency, fx_rate, synced_at) "
                    "VALUES (:t, :d, :s, :c, :fx, now()) "
                    "ON CONFLICT (tenant_id, date) DO UPDATE SET "
                    "spend = EXCLUDED.spend, currency = EXCLUDED.currency, "
                    "fx_rate = EXCLUDED.fx_rate, synced_at = now()"
                ),
                {"t": self.tenant_id, "d": dia, "s": convertido,
                 "c": self._moeda, "fx": self._taxa(dia)},
            )
            gravadas += 1
        self.session.commit()
        if total > 0:
            logger.info(
                "[shopify] Shop Campaigns: %s dia(s), $%.2f no periodo", gravadas, total)

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
                "total_price": self._usd(
                    _float(getattr(checkout, "total_price", 0)),
                    getattr(checkout, "created_at", None)),
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
            # Preco de catalogo tambem esta na moeda da loja. Sem data propria,
            # entao vai pela cotacao mais recente do periodo.
            prices = [
                self._usd(_float(getattr(v, "price", 0)))
                for v in variants if getattr(v, "price", None)
            ]
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

    def _upsert_raw(
        self,
        table_name: str,
        rows: list[dict],
        conflict_columns: list[str],
        preserve_on_null: list[str] | None = None,
    ) -> int:
        if not rows:
            return 0

        rows = self._inject_tenant(rows)

        if table_name not in _TABLE_CACHE:
            meta = MetaData()
            meta.reflect(bind=self.session.bind, only=[table_name])
            _TABLE_CACHE[table_name] = meta.tables[table_name]
        table = _TABLE_CACHE[table_name]

        # Strip keys not present in the DB table so extra collector fields never cause errors
        col_names = {c.name for c in table.columns}
        rows = [{k: v for k, v in row.items() if k in col_names} for row in rows]

        update_cols = [
            c.name for c in table.columns
            if c.name not in conflict_columns and c.name != "id"
        ]
        stmt = pg_insert(table).values(rows)
        keep = set(preserve_on_null or [])
        stmt = stmt.on_conflict_do_update(
            index_elements=conflict_columns,
            set_={
                col: (
                    func.coalesce(stmt.excluded[col], table.c[col])
                    if col in keep else stmt.excluded[col]
                )
                for col in update_cols
            },
        )
        self.session.execute(stmt)
        self.session.commit()
        self._records_collected += len(rows)
        return len(rows)
