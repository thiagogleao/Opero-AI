"""Pure-function tests for the collectors. Run from the repo root:

    python -m unittest discover -s app/tests -t .

No database, no network: DATABASE_URL only has to be set for app.config to
load, any value works.
"""

import json
import os
import unittest
from datetime import date
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/none")

from app.collectors.facebook_mapping import (  # noqa: E402
    PHANTOM_PURCHASE_VALUE, first_action, parse_breakdown, parse_daily_insight, structure_from_insights,
)
from app.collectors.redact import redact  # noqa: E402
from app.collectors.shopify_client import _next_link  # noqa: E402
from app.collectors.shopify_mapping import (  # noqa: E402
    MissingRate, geo_country, local_day, map_checkout, map_line_items, map_order,
)
from app.collectors.upsert import choose_conflict, group_by_keys, update_columns  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


class OrderMappingTest(unittest.TestCase):
    """The same fixture is asserted by frontend/lib/sync/__tests__/orderMapping.test.ts."""

    def setUp(self):
        self.order = load("order_jpy.json")
        self.expected = load("order_jpy_expected.json")
        rate, day = self.expected["rate"], self.expected["rate_day"]
        self.rate_for = lambda d: rate if d == day else None

    def test_order_row_matches_fixture(self):
        row = map_order(self.order, self.rate_for)
        exp = self.expected["order"]
        self.assertEqual(set(row), set(exp))
        for k, v in exp.items():
            got = row[k]
            if hasattr(got, "isoformat"):
                got = got.isoformat()
            if isinstance(v, float) or isinstance(got, float):
                self.assertAlmostEqual(got, v, places=6, msg=k)
            else:
                self.assertEqual(got, v, msg=k)

    def test_line_items_match_fixture(self):
        rows = map_line_items(self.order, self.rate_for)
        exp = self.expected["items"]
        self.assertEqual(len(rows), len(exp))
        for r, e in zip(rows, exp):
            for k, v in e.items():
                if isinstance(v, float):
                    self.assertAlmostEqual(r[k], v, places=6, msg=k)
                else:
                    self.assertEqual(r[k], v, msg=k)

    def test_foreign_currency_without_rate_is_refused(self):
        with self.assertRaises(MissingRate):
            map_order(self.order, lambda d: None)

    def test_usd_order_is_not_converted(self):
        o = {**self.order, "currency": "USD"}
        row = map_order(o, lambda d: None)
        self.assertEqual(row["total_price"], 12750.0)
        self.assertIsNone(row["fx_rate"])

    def test_billing_country_is_kept_for_pricing(self):
        # The profit engine prices by country_code; it must stay billing.
        row = map_order(self.order, self.rate_for)
        self.assertEqual(row["country_code"], "JP")

    def test_shipping_falls_back_to_lines(self):
        o = {**self.order}
        del o["total_shipping_price_set"]
        self.assertAlmostEqual(map_order(o, self.rate_for)["total_shipping"], 9.75)

    def test_no_shipping_address_uses_billing(self):
        o = {**self.order, "shipping_address": None}
        row = map_order(o, self.rate_for)
        self.assertEqual(row["geo_country_code"], "JP")
        self.assertEqual(row["province_code"], "JP-13")


class GeoTest(unittest.TestCase):
    def test_territories(self):
        for p in ("PR", "VI", "GU", "AS", "MP", "UM"):
            self.assertEqual(geo_country("US", p), p)
        self.assertEqual(geo_country("US", "CA"), "US")
        self.assertEqual(geo_country("de", None), "DE")
        self.assertIsNone(geo_country(None, "PR"))

    def test_local_day(self):
        self.assertEqual(local_day("2026-11-10T23:30:00-03:00"), "2026-11-10")
        self.assertIsNone(local_day("garbage"))
        self.assertIsNone(local_day(None))


class CheckoutTest(unittest.TestCase):
    def test_presentment_total_is_not_read_as_dollars(self):
        c = {"id": 1, "total_price": "180000", "presentment_currency": "KRW", "currency": "USD",
             "created_at": "2026-11-10T10:00:00-03:00"}
        row = map_checkout(c, "USD", lambda d: None)
        self.assertIsNone(row["total_price"])
        self.assertEqual(row["currency"], "KRW")

    def test_shop_currency_total_is_kept(self):
        c = {"id": 2, "total_price": "49.90", "presentment_currency": "USD", "created_at": "2026-11-10T10:00:00-03:00"}
        self.assertAlmostEqual(map_checkout(c, "USD", lambda d: None)["total_price"], 49.9)

    def test_jpy_shop_converts(self):
        c = {"id": 3, "total_price": "10000", "presentment_currency": "JPY", "created_at": "2026-11-10T10:00:00+09:00"}
        self.assertAlmostEqual(map_checkout(c, "JPY", lambda d: 0.0065)["total_price"], 65.0)


class MetaMappingTest(unittest.TestCase):
    def insight(self, **kw):
        base = {
            "ad_id": "120", "ad_name": "Ad", "adset_id": "55", "adset_name": "Set", "campaign_id": "77",
            "campaign_name": "CBO", "date_start": "2026-11-10", "spend": "100", "impressions": "1000",
            "actions": [
                {"action_type": "purchase", "value": "5"},
                {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "4"},
                {"action_type": "landing_page_view", "value": "37"},
            ],
            "action_values": [
                {"action_type": "purchase", "value": "500"},
                {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "400"},
            ],
        }
        base.update(kw)
        return base

    def test_pixel_alias_first(self):
        row = parse_daily_insight(self.insight(), "act_1")
        self.assertEqual(row["purchases"], 4)
        self.assertEqual(row["purchase_value"], 400)
        self.assertAlmostEqual(row["roas"], 4.0)

    def test_generic_alias_is_fallback_only(self):
        row = parse_daily_insight(self.insight(
            actions=[{"action_type": "purchase", "value": "2"}],
            action_values=[{"action_type": "purchase", "value": "90"}]), "act_1")
        self.assertEqual(row["purchases"], 2)
        self.assertEqual(row["purchase_value"], 90)

    def test_landing_page_views_from_actions(self):
        self.assertEqual(parse_daily_insight(self.insight(), "act_1")["landing_page_views"], 37)

    def test_phantom_is_stored_flagged_and_out_of_roas(self):
        row = parse_daily_insight(self.insight(
            spend="4", action_values=[{"action_type": "offsite_conversion.fb_pixel_purchase", "value": "183000"}]), "act_1")
        self.assertTrue(row["phantom_purchase"])
        self.assertEqual(row["purchase_value"], 183000)
        self.assertEqual(row["roas"], 0)

    def test_threshold_matches_engine(self):
        self.assertEqual(PHANTOM_PURCHASE_VALUE, 20000)
        at = parse_daily_insight(self.insight(
            action_values=[{"action_type": "offsite_conversion.fb_pixel_purchase", "value": "20000"}]), None)
        self.assertFalse(at["phantom_purchase"])

    def test_account_tag_and_campaign_on_row(self):
        row = parse_daily_insight(self.insight(), "act_9")
        self.assertEqual((row["fb_ad_account_id"], row["campaign_id"], row["adset_id"]), ("act_9", "77", "55"))

    def test_money_rate(self):
        row = parse_daily_insight(self.insight(), "act_1", money_rate=0.5)
        self.assertEqual(row["spend"], 50)
        self.assertEqual(row["purchase_value"], 200)

    def test_breakdown(self):
        row = parse_breakdown({**self.insight(), "age": "25-34", "gender": "female"}, "age_gender", ["age", "gender"])
        self.assertEqual(row["breakdown_value"], "25-34_female")
        self.assertEqual(row["purchases"], 4)

    def test_structure_from_insights(self):
        ads, sets, camps = structure_from_insights([self.insight(), self.insight(ad_id="121")])
        self.assertEqual({a["ad_id"] for a in ads}, {"120", "121"})
        self.assertEqual(ads[0]["campaign_name"], "CBO")
        self.assertEqual(len(sets), 1)
        self.assertEqual(camps, [{"campaign_id": "77", "name": "CBO"}])

    def test_first_action_missing(self):
        self.assertEqual(first_action([], "x"), 0.0)
        self.assertEqual(first_action(None, "x", default=3), 3)


class UpsertPlanTest(unittest.TestCase):
    def test_only_columns_present_are_updated(self):
        cols = update_columns(["order_id", "total_price", "bogus", "id"], ["order_id"],
                              ["id", "order_id", "total_price", "total_shipping", "tenant_id"])
        self.assertEqual(cols, ["total_price"])

    def test_tenant_safe_key_preferred(self):
        sets = [frozenset({"date", "tenant_id", "ad_id"}), frozenset({"ad_id", "date"})]
        self.assertEqual(choose_conflict([["tenant_id", "ad_id", "date"], ["ad_id", "date"]], sets),
                         ["tenant_id", "ad_id", "date"])
        self.assertEqual(choose_conflict([["tenant_id", "ad_id"], ["ad_id"]], [frozenset({"ad_id"})]), ["ad_id"])
        self.assertIsNone(choose_conflict([["x"]], sets))

    def test_rows_grouped_by_columns(self):
        groups = group_by_keys([{"a": 1, "b": 2}, {"a": 3}, {"b": 4, "a": 5}])
        self.assertEqual(sorted(len(g) for g in groups), [1, 2])


class RedactTest(unittest.TestCase):
    def test_tokens_and_params(self):
        s = ("HTTPSConnectionPool(host='graph.facebook.com'): /v20.0/act_1/insights?access_token=EAAB"
             + "x" * 40 + "&appsecret_proof=abcdef123 failed; token shpat_" + "a" * 20)
        out = redact(s)
        self.assertNotIn("EAAB", out)
        self.assertNotIn("abcdef123", out)
        self.assertNotIn("shpat_aaaa", out)
        self.assertIn("access_token=***", out)

    def test_header_and_length(self):
        self.assertIn("X-Shopify-Access-Token: ***", redact("X-Shopify-Access-Token: secretvalue"))
        self.assertEqual(len(redact("y" * 2000)), 600)


class LinkHeaderTest(unittest.TestCase):
    def test_next(self):
        h = ('<https://s.myshopify.com/admin/api/2026-10/orders.json?page_info=abc&limit=250>; rel="previous", '
             '<https://s.myshopify.com/admin/api/2026-10/orders.json?page_info=def&limit=250>; rel="next"')
        self.assertTrue(_next_link(h).endswith("page_info=def&limit=250"))
        self.assertIsNone(_next_link(""))


class WindowTest(unittest.TestCase):
    def test_default_and_swap(self):
        import collect_recent as cr
        self.assertEqual(cr.resolve_window(date(2026, 11, 17), None, None), (date(2026, 11, 15), date(2026, 11, 17)))
        self.assertEqual(cr.resolve_window(date(2026, 11, 17), date(2026, 11, 20), date(2026, 11, 18)),
                         (date(2026, 11, 18), date(2026, 11, 20)))


if __name__ == "__main__":
    unittest.main()


class UpsertSqlTest(unittest.TestCase):
    """Compiles the real statement against an in-memory table (no database)."""

    def table(self):
        from sqlalchemy import Column, MetaData, Numeric, Table, Text
        return Table("shopify_orders", MetaData(), Column("order_id", Text), Column("tenant_id", Text),
                     Column("total_price", Numeric), Column("total_shipping", Numeric), Column("browser_ip", Text))

    def sql(self, **kw):
        from sqlalchemy.dialects import postgresql
        from app.collectors.upsert import build_statement
        stmt = build_statement(self.table(), [{"order_id": "1", "tenant_id": "t", "total_price": 5, "browser_ip": None}],
                               **kw)
        return str(stmt.compile(dialect=postgresql.dialect()))

    def test_owner_guard_and_preserve(self):
        s = self.sql(conflict=["order_id"], cols=["browser_ip", "total_price"], keep={"browser_ip"}, guard_owner=True)
        self.assertIn("ON CONFLICT (order_id) DO UPDATE SET", s)
        self.assertIn("coalesce(excluded.browser_ip, shopify_orders.browser_ip)", s)
        self.assertIn("WHERE shopify_orders.tenant_id IS NOT DISTINCT FROM excluded.tenant_id", s)
        self.assertNotIn("total_shipping =", s)  # a column the row did not carry is never touched
        self.assertNotIn("tenant_id = excluded.tenant_id", s)

    def test_tenant_key_has_no_guard(self):
        s = self.sql(conflict=["tenant_id", "order_id"], cols=["total_price"], keep=set(), guard_owner=False)
        self.assertIn("ON CONFLICT (tenant_id, order_id) DO UPDATE SET total_price = excluded.total_price", s)
        self.assertNotIn("WHERE", s)

    def test_nothing_to_update(self):
        s = self.sql(conflict=["order_id"], cols=[], keep=set(), guard_owner=True)
        self.assertIn("ON CONFLICT (order_id) DO NOTHING", s)


class LaneTest(unittest.TestCase):
    def test_lanes_match_job_runner(self):
        import collect_recent as cr
        self.assertEqual(cr.lane("shopify", "scheduled"), "shopify")
        self.assertEqual(cr.lane("facebook", "quick"), "facebook")
        self.assertEqual(cr.lane("facebook", "repull28"), "facebook")
        self.assertEqual(cr.lane("facebook", "structure"), "facebook_structure")


class CreativeCacheTest(unittest.TestCase):
    """Creatives are fetched only for new ads or changed creatives (P17)."""

    def collector(self, stored_rows, has_creative_col=True):
        from unittest import mock
        from app.collectors.facebook import FacebookCollector
        c = FacebookCollector.__new__(FacebookCollector)
        c.tenant_id = "t"
        c.session = mock.MagicMock()
        c.session.execute.return_value = stored_rows
        c._fb_ads_columns = lambda: {"creative_id"} if has_creative_col else set()
        c.fetched = []
        def fake_fetch(ids):
            c.fetched.extend(ids)
            return {i: {"creative_url": None, "thumbnail_url": f"thumb-{i}", "landing_url": None} for i in ids}
        c._fetch_creatives = fake_fetch
        return c

    def test_only_new_or_changed(self):
        stored = [
            ("ad1", "cr1", None, "t1", None),      # same creative → cached
            ("ad2", "crOLD", None, "t2", None),    # creative changed → fetch
            ("ad3", None, None, "t3", None),       # legacy row with details → cached, id remembered
            ("ad4", None, None, None, None),       # legacy row without details → fetch
        ]
        c = self.collector(stored)
        ads = [{"id": "ad1", "creative": {"id": "cr1"}}, {"id": "ad2", "creative": {"id": "cr2"}},
               {"id": "ad3", "creative": {"id": "cr3"}}, {"id": "ad4", "creative": {"id": "cr4"}},
               {"id": "ad5", "creative": {"id": "cr5"}}]
        out = c._creatives(ads)
        self.assertEqual(sorted(c.fetched), ["cr2", "cr4", "cr5"])
        self.assertNotIn("ad1", out)
        self.assertEqual(out["ad3"], {"creative_id": "cr3"})
        self.assertEqual(out["ad2"]["thumbnail_url"], "thumb-cr2")
        self.assertEqual(out["ad2"]["creative_id"], "cr2")

    def test_window_respects_cut(self):
        from app.collectors.facebook import FacebookCollector
        c = FacebookCollector.__new__(FacebookCollector)
        c.collect_from = date(2026, 11, 4)
        self.assertEqual(c.window(date(2026, 10, 20), date(2026, 11, 16)), (date(2026, 11, 4), date(2026, 11, 16)))
        self.assertIsNone(c.window(date(2026, 10, 1), date(2026, 10, 31)))
        c.collect_from = None
        self.assertEqual(c.window(date(2026, 10, 20), date(2026, 11, 16)), (date(2026, 10, 20), date(2026, 11, 16)))


class ShopifyCollectorHelpersTest(unittest.TestCase):
    def test_rate_for_and_bounds(self):
        from app.collectors.shopify import ShopifyCollector
        c = ShopifyCollector.__new__(ShopifyCollector)
        c.rates = {date(2026, 11, 10): 0.0065, date(2026, 11, 11): 0.0066}
        c.tz_name = "Asia/Tokyo"
        self.assertEqual(c._rate_for("2026-11-10"), 0.0065)
        self.assertEqual(c._rate_for("2026-11-30"), 0.0066)   # latest known
        self.assertEqual(c._bounds(date(2026, 11, 10)), ("2026-11-10T00:00:00+09:00", "2026-11-10T23:59:59+09:00"))
        c.rates = {}
        self.assertIsNone(c._rate_for("2026-11-10"))

    def test_error_messages(self):
        from app.collectors.shopify import ShopifyCollector
        from app.collectors.shopify_auth import ShopifyAuthError
        from app.collectors.shopify_client import ShopifyUnauthorized, ShopifyUnavailable
        c = ShopifyCollector.__new__(ShopifyCollector)
        self.assertIn("reconecte", c.describe_error(ShopifyUnauthorized("x", 401)))
        self.assertIn("402", c.describe_error(ShopifyUnavailable("x", 402)))
        self.assertIn("renovação falhou", c.describe_error(ShopifyAuthError("app not installed")))
