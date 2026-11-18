"""Every ad with metrics gets a catalog row (fb_ads), read by id when the
account listing does not bring it. Run from the repo root:

    python -m unittest discover -s app/tests -t .

No database, no network: the session, the Graph calls and upsert are fakes.
Fixture ids are Glooty's: 59 ads created 10-11 nov after the last structure
pass, all CAMPAIGN_PAUSED, carried $445 of its spend with no fb_ads row.
"""

import json
import os
import unittest
from datetime import date, datetime, timezone
from unittest import mock

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/none")

from facebook_business.exceptions import FacebookRequestError  # noqa: E402

from app.collectors import facebook as fb  # noqa: E402
from app.collectors.facebook_mapping import AD_FIELDS_BY_ID, catalog_from_ads  # noqa: E402

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
ACCT = "act_2267479727435342"


def graph_error(code: int) -> FacebookRequestError:
    body = json.dumps({"error": {"code": code, "message": f"erro {code}"}})
    return FacebookRequestError("erro", {}, 400, {}, body)


def ad(ad_id: str, campaign: str = "120252121920770564", adset: str = "120252121920930564", **extra) -> dict:
    return {
        "id": ad_id, "name": f"Anúncio {ad_id[-4:]}", "status": "ACTIVE", "effective_status": "CAMPAIGN_PAUSED",
        "account_id": "2267479727435342", "adset_id": adset, "campaign_id": campaign,
        "created_time": "2026-11-11T09:25:16-0800", "updated_time": "2026-11-17T10:00:00-0800",
        "creative": {"id": f"cr{ad_id[-4:]}"},
        "adset": {"id": adset, "name": "Conjunto A", "status": "ACTIVE"},
        "campaign": {"id": campaign, "name": "CBO - GLOOTY", "status": "PAUSED", "objective": "OUTCOME_SALES"},
        **extra,
    }


class CatalogMappingTest(unittest.TestCase):
    def test_full_rows_from_an_ad_read_by_id(self):
        ads, adsets, camps = catalog_from_ads([ad("120252121920990564")], ACCT, NOW)
        self.assertEqual(len(ads), 1)
        row = ads[0]
        self.assertEqual(row["ad_id"], "120252121920990564")
        self.assertEqual(row["effective_status"], "CAMPAIGN_PAUSED")
        self.assertEqual(row["campaign_id"], "120252121920770564")
        self.assertEqual(row["campaign_name"], "CBO - GLOOTY")
        self.assertEqual(row["adset_name"], "Conjunto A")
        self.assertEqual(row["created_time"].isoformat(), "2026-11-11T09:25:16-08:00")
        self.assertEqual(row["synced_at"], NOW)
        self.assertEqual(adsets, [{"adset_id": "120252121920930564", "campaign_id": "120252121920770564",
                                   "name": "Conjunto A", "status": "ACTIVE", "synced_at": NOW}])
        self.assertEqual(camps[0]["account_id"], ACCT)
        self.assertEqual(camps[0]["objective"], "OUTCOME_SALES")

    def test_campaign_filed_under_the_ads_own_account(self):
        _, _, camps = catalog_from_ads([ad("1", account_id="999")], ACCT, NOW)
        self.assertEqual(camps[0]["account_id"], "act_999")
        _, _, camps = catalog_from_ads([ad("1", account_id=None)], ACCT, NOW)
        self.assertEqual(camps[0]["account_id"], ACCT)

    def test_missing_parent_fields_do_not_blank_stored_ones(self):
        bare = ad("1")
        bare["adset"] = {"id": bare["adset_id"]}
        bare["campaign"] = {}
        _, adsets, camps = catalog_from_ads([bare], ACCT, NOW)
        self.assertNotIn("name", adsets[0])
        self.assertNotIn("status", adsets[0])
        self.assertNotIn("name", camps[0])
        self.assertEqual(camps[0]["campaign_id"], bare["campaign_id"])

    def test_parent_ids_from_the_expansion_when_flat_ids_are_absent(self):
        a = ad("1")
        a.pop("adset_id")
        a.pop("campaign_id")
        ads, adsets, camps = catalog_from_ads([a], ACCT, NOW)
        self.assertEqual(ads[0]["adset_id"], "120252121920930564")
        self.assertEqual(ads[0]["campaign_id"], "120252121920770564")
        self.assertEqual(len(adsets), 1)
        self.assertEqual(len(camps), 1)

    def test_parents_are_expanded_in_the_same_call(self):
        self.assertIn("adset{id,name,status}", AD_FIELDS_BY_ID)
        self.assertIn("campaign{id,name,status,objective}", AD_FIELDS_BY_ID)
        self.assertIn("creative{id}", AD_FIELDS_BY_ID)


class UncataloguedQueryTest(unittest.TestCase):
    def test_global_key_counts_only_ads_with_no_row_at_all(self):
        sql, params = fb.uncatalogued_ads_query("g", ACCT, date(2026, 11, 4), None, per_store_key=False)
        self.assertIn("NOT EXISTS (SELECT 1 FROM fb_ads a WHERE a.ad_id = m.ad_id)", sql)
        self.assertNotIn("a.tenant_id = m.tenant_id", sql)
        self.assertEqual(params["since"], date(2026, 11, 4))
        self.assertNotIn("until", params)
        self.assertIn("m.date >= :since", sql)
        self.assertNotIn(":until", sql)

    def test_per_store_key_counts_ads_this_store_has_no_row_for(self):
        sql, params = fb.uncatalogued_ads_query("g", ACCT, None, date(2026, 11, 17), per_store_key=True)
        self.assertIn("a.ad_id = m.ad_id AND a.tenant_id = m.tenant_id", sql)
        self.assertNotIn(":since", sql)
        self.assertEqual(params["until"], date(2026, 11, 17))

    def test_scoped_to_store_and_account_biggest_spend_first(self):
        sql, params = fb.uncatalogued_ads_query("g", ACCT, None, None, per_store_key=False, limit=7)
        self.assertIn("m.tenant_id = :t", sql)
        # Rows collected before runs tagged their account carry no tag.
        self.assertIn("(m.fb_ad_account_id = :acct OR m.fb_ad_account_id IS NULL)", sql)
        self.assertIn("ORDER BY SUM(m.spend) DESC", sql)
        self.assertEqual(params, {"t": "g", "acct": ACCT, "n": 7})


class BackfillTest(unittest.TestCase):
    def collector(self, missing, readable, allow_partial=True, fail_code=None):
        c = fb.FacebookCollector.__new__(fb.FacebookCollector)
        c.tenant_id = "5071bfb6-61c8-431f-8837-1b546f7e4f38"
        c.account_id = ACCT
        c.session = mock.MagicMock()
        c.records = 0
        c.failures = []
        c.warnings = []
        c.allow_partial = allow_partial
        c.calls = []
        c._uncatalogued_ads = lambda since, until: list(missing)

        def get_ids(ids, fields):
            c.calls.append(list(ids))
            if fail_code is not None:
                raise graph_error(fail_code)
            if any(i not in readable for i in ids):
                raise graph_error(100)  # one unreadable id fails the whole ?ids= call
            return {i: readable[i] for i in ids}

        c._get_ids = get_ids
        c._creatives = lambda ads: {a["id"]: {"thumbnail_url": f"thumb-{a['id']}"} for a in ads}
        return c

    def run_backfill(self, c, since=date(2026, 11, 4), expect_log=False):
        written = {}

        def fake_upsert(session, table, rows, keys, **kw):
            written.setdefault(table, []).extend(rows)
            return len(rows)

        with mock.patch.object(fb, "upsert", side_effect=fake_upsert):
            if expect_log:
                with self.assertLogs("app.collectors", level="WARNING"):
                    c._backfill_catalog(since, None)
            else:
                c._backfill_catalog(since, None)
        return written

    def test_missing_ads_get_full_rows_under_this_store(self):
        ids = ["120252121920990564", "120252121921040564"]
        c = self.collector(ids, {i: ad(i) for i in ids})
        written = self.run_backfill(c)
        self.assertEqual(c.calls, [ids])  # one ?ids= call for both
        self.assertEqual(sorted(r["ad_id"] for r in written["fb_ads"]), sorted(ids))
        for r in written["fb_ads"]:
            self.assertEqual(r["tenant_id"], c.tenant_id)
            self.assertEqual(r["campaign_name"], "CBO - GLOOTY")
            self.assertEqual(r["thumbnail_url"], f"thumb-{r['ad_id']}")
        self.assertEqual(written["fb_campaigns"][0]["tenant_id"], c.tenant_id)
        self.assertEqual(len(written["fb_adsets"]), 1)
        self.assertEqual(c.records, 2)
        self.assertEqual(c.failures, [])

    def test_unreadable_id_is_skipped_and_the_rest_still_land(self):
        ids = ["a1", "gone", "a3"]
        c = self.collector(ids, {"a1": ad("a1"), "a3": ad("a3")})
        written = self.run_backfill(c)
        self.assertEqual(c.calls, [ids, ["a1"], ["gone"], ["a3"]])
        self.assertEqual(sorted(r["ad_id"] for r in written["fb_ads"]), ["a1", "a3"])
        self.assertEqual(c.failures, [])

    def test_ids_are_asked_fifty_at_a_time(self):
        ids = [f"{n:03d}" for n in range(120)]
        c = self.collector(ids, {i: ad(i) for i in ids})
        self.run_backfill(c)
        self.assertEqual([len(x) for x in c.calls], [50, 50, 20])

    def test_nothing_missing_asks_meta_nothing(self):
        c = self.collector([], {})
        written = self.run_backfill(c)
        self.assertEqual(c.calls, [])
        self.assertEqual(written, {})

    def test_other_meta_errors_mark_the_structure_run_partial(self):
        c = self.collector(["a1"], {}, allow_partial=True, fail_code=190)
        written = self.run_backfill(c, expect_log=True)
        self.assertEqual(written, {})
        self.assertEqual(len(c.failures), 1)
        self.assertIn("catálogo de anúncios por id falhou", c.failures[0])
        self.assertIn("reconecte", c.failures[0])

    def test_without_partial_runs_it_is_a_warning(self):
        c = self.collector(["a1"], {}, allow_partial=False, fail_code=190)
        self.run_backfill(c, expect_log=True)
        self.assertEqual(c.failures, [])
        self.assertEqual(len(c.warnings), 1)

    def test_database_error_rolls_back_and_is_reported(self):
        c = self.collector(["a1"], {"a1": ad("a1")})
        with mock.patch.object(fb, "upsert", side_effect=RuntimeError("deadlock")):
            with self.assertLogs("app.collectors.facebook", level="ERROR"):
                c._backfill_catalog(None, None)
        c.session.rollback.assert_called()
        self.assertEqual(len(c.failures), 1)


class StructurePhaseTest(unittest.TestCase):
    def test_structure_pass_backfills_the_store_history_from_the_cut(self):
        c = fb.FacebookCollector.__new__(fb.FacebookCollector)
        c.phase = "structure"
        c.collect_from = date(2026, 11, 4)
        order = []
        c._sync_structure = lambda: order.append("listing")
        c._backfill_catalog = lambda since, until: order.append(("backfill", since, until))
        c._collect_breakdowns = lambda a, b: order.append("breakdowns")
        c._run(date(2026, 11, 16), date(2026, 11, 18))
        self.assertEqual(order, ["listing", ("backfill", date(2026, 11, 4), None), "breakdowns"])


if __name__ == "__main__":
    unittest.main()
