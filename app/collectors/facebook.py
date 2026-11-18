"""
Meta Ads collector — one ad account per instance.

Two phases, recorded as separate sync_runs sources so one cannot hide the other:
  'facebook'            daily insights per ad (spend, purchases, video) for the
                        requested days, plus minimal ad/adset/campaign rows for
                        any ad the structure tables do not know yet;
  'facebook_structure'  campaigns, ad sets, ads (creatives fetched only for new
                        or changed ads), then every ad the store has metrics
                        for but fb_ads still does not know, read by id (see
                        _backfill_catalog), and the four breakdowns for the
                        last 14 days of the window. A breakdown or a catalog
                        backfill that fails makes the run 'partial' and says
                        which.

Guarantees:
  - an account whose account_status is not 1 (disabled, closed, unsettled) is
    not collected at all — its history stays, nothing new is asked;
  - nothing before the account link's `collect_from` is collected for this
    store (an ad account that changed stores keeps its history where it was);
  - every row is written under this store's tenant_id and never moves another
    store's row (see upsert.py);
  - an account billing in another currency is converted to USD on the way in.
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.adcreative import AdCreative
from facebook_business.api import FacebookAdsApi
from facebook_business.exceptions import FacebookRequestError
from facebook_business.session import FacebookSession
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.collectors.base import BaseCollector
from app.collectors.facebook_mapping import (
    AD_FIELDS_BY_ID, BREAKDOWN_FIELDS, BREAKDOWNS, INSIGHT_FIELDS, catalog_from_ads, graph_ts,
    parse_breakdown, parse_daily_insight, structure_from_insights,
)
from app.collectors.redact import redact
from app.collectors.upsert import choose_conflict, unique_sets, upsert

logger = logging.getLogger(__name__)

API_VERSION = "v20.0"
BREAKDOWN_MAX_DAYS = 14
# Retried with backoff: throttling (4 app, 17 user, 32 page, 613 calls,
# 80000-80014 ads insights) and Meta's transient failures (1 unknown, 2
# "Service temporarily unavailable" — seen while verifying this collector).
THROTTLE_CODES = {4, 17, 32, 613} | set(range(80000, 80015))
TRANSIENT_CODES = {1, 2}
RETRY_CODES = THROTTLE_CODES | TRANSIENT_CODES
# Total seconds a run may spend sleeping on throttles. Kept well under the
# scheduler's kill timer so a throttled run ends with an honest error instead
# of being killed mid-write.
THROTTLE_BUDGET = 240
# A known-dead account is re-checked once a day, in case it was reactivated.
DEAD_RECHECK = timedelta(hours=24)

# Conflict keys for fb_ads, tenant-safe first (see upsert.py).
AD_KEYS = [["tenant_id", "ad_id"], ["ad_id"]]
# Graph's ceiling for one GET /?ids= request.
IDS_PER_REQUEST = 50
# Uncatalogued ads read by id in one pass, biggest spend first. A routine pass
# finds none; the cap bounds the first pass after a long gap and the ids Meta
# no longer serves (deleted long ago), which are asked again on every pass.
CATALOG_BACKFILL_MAX = 300
# Graph's answer for an id it will not serve (deleted, never existed, another
# account's): 100 "Unsupported get request" on a single id, 803 for an alias.
UNREADABLE_ID_CODES = {100, 803}


def uncatalogued_ads_query(tenant_id: str, account_id: str, since: Optional[date], until: Optional[date],
                           per_store_key: bool, limit: int = CATALOG_BACKFILL_MAX) -> tuple[str, dict]:
    """Ads this store has metrics for, on this account (or untagged: rows
    collected before runs tagged their account), that fb_ads cannot show.

    While fb_ads is keyed on ad_id alone, a row another store owns already
    names the ad and cannot be written for this store anyway (upsert's owner
    guard), so only ads with no row at all count. Once the key is (tenant_id,
    ad_id), an ad counts until this store has its own row."""
    owner = " AND a.tenant_id = m.tenant_id" if per_store_key else ""
    where = ["m.tenant_id = :t", "(m.fb_ad_account_id = :acct OR m.fb_ad_account_id IS NULL)"]
    params: dict = {"t": tenant_id, "acct": account_id, "n": limit}
    if since:
        where.append("m.date >= :since")
        params["since"] = since
    if until:
        where.append("m.date <= :until")
        params["until"] = until
    sql = (
        "SELECT m.ad_id FROM fb_ad_daily_metrics m "
        f"WHERE {' AND '.join(where)} "
        f"AND NOT EXISTS (SELECT 1 FROM fb_ads a WHERE a.ad_id = m.ad_id{owner}) "
        "GROUP BY m.ad_id ORDER BY SUM(m.spend) DESC NULLS LAST, MAX(m.date) DESC, m.ad_id LIMIT :n"
    )
    return sql, params


def normalize_account(raw: str) -> str:
    n = (raw or "").replace("act_", "").replace("act=", "").replace("act:", "").strip("_=: ")
    return f"act_{n}" if n else raw


def describe_meta_error(exc: BaseException) -> Optional[str]:
    if not isinstance(exc, FacebookRequestError):
        return None
    code = exc.api_error_code()
    msg = (exc.api_error_message() or "")
    if code == 190:
        return "Token do Meta expirado ou inválido — reconecte a conta de anúncio"
    if code == 100 and "appsecret_proof" in msg:
        return "Token do Meta emitido por outro app (appsecret_proof inválido) — reconecte a conta"
    if code in THROTTLE_CODES:
        return "Limite de chamadas do Meta atingido — a próxima rodada tenta de novo"
    if code in (10, 200, 294) or (code and 200 <= code < 300):
        return "Sem permissão nesta conta de anúncio — confira o acesso no Business Manager"
    return redact(f"Meta ({code}): {msg}")


class FacebookCollector(BaseCollector):
    source = "facebook"

    def __init__(self, session: Session, tenant_id: str, account_id: str, access_token: str,
                 app_id: Optional[str], app_secret: Optional[str], *, phase: str = "insights",
                 mode: Optional[str] = None, collect_from: Optional[date] = None):
        account_id = normalize_account(account_id)
        super().__init__(session, tenant_id, account_id=account_id, mode=mode)
        self.phase = phase
        if phase == "structure":
            self.source = "facebook_structure"
            self.allow_partial = True
        self.collect_from = collect_from
        self._creds = (app_id, app_secret, access_token)
        self.api = self._new_api()
        self.account = AdAccount(account_id, api=self.api)
        self.money_rate: Callable[[str], float] = lambda _day: 1.0
        self._slept = 0.0

    def _new_api(self) -> FacebookAdsApi:
        app_id, app_secret, token = self._creds
        # Without the app secret the SDK sends no appsecret_proof, which is what
        # a token from a different Meta app needs; with the wrong secret Meta
        # rejects every call (code 100).
        return FacebookAdsApi(FacebookSession(app_id, app_secret, token), API_VERSION)

    def describe_error(self, exc: BaseException) -> str:
        return describe_meta_error(exc) or super().describe_error(exc)

    # ── Account status (called before a run is recorded) ────────────────────

    def account_state(self) -> tuple[str, Optional[int], Optional[str]]:
        """('active' | 'inactive', status, currency). An account known dead
        is not even asked again for a day; one that cannot be read but is
        known dead is treated as dead (Dumpling's old primary failed 3,900
        times with 'Invalid appsecret_proof')."""
        row = self.session.execute(
            text("SELECT account_status, synced_at, currency FROM fb_ad_accounts WHERE account_id = :a"),
            {"a": self.account_id},
        ).fetchone()
        known_status = row[0] if row else None
        if row and known_status is not None and known_status != 1 and row[1] is not None:
            checked = row[1] if row[1].tzinfo else row[1].replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - checked < DEAD_RECHECK:
                return "inactive", known_status, row[2]
        try:
            info = self._throttled(lambda: self.account.api_get(
                fields=["name", "currency", "account_status", "timezone_name"]))
        except FacebookRequestError:
            if known_status is not None and known_status != 1:
                # Still unreadable and known dead: note the check so the next
                # one waits a day (Dumpling's old main account refuses every
                # call, and was asked again on every pass).
                self.session.execute(
                    text("UPDATE fb_ad_accounts SET synced_at = now() WHERE account_id = :a "
                         "AND tenant_id IS NOT DISTINCT FROM :t"),
                    {"a": self.account_id, "t": self.tenant_id},
                )
                self.session.commit()
                return "inactive", known_status, row[2] if row else None
            raise
        status = info.get("account_status")
        upsert(self.session, "fb_ad_accounts", [{
            "account_id": self.account_id, "tenant_id": self.tenant_id, "name": info.get("name"),
            "currency": info.get("currency"), "account_status": status,
            "synced_at": datetime.now(timezone.utc),
        }], [["account_id"]])
        return ("active" if status == 1 else "inactive"), status, info.get("currency")

    def use_currency(self, currency: Optional[str], first: date, last: date) -> None:
        """Convert an account that does not bill in dollars."""
        if not currency or currency.upper() == "USD":
            return
        from app.collectors.fx import taxas_do_periodo, para_usd
        rates = taxas_do_periodo(self.session, currency, first, last)
        self.money_rate = lambda day: para_usd(1.0, date.fromisoformat(day) if day else None, rates)

    # ── Run ─────────────────────────────────────────────────────────────────

    def window(self, date_from: date, date_to: date) -> Optional[tuple[date, date]]:
        start = max(date_from, self.collect_from) if self.collect_from else date_from
        return (start, date_to) if start <= date_to else None

    def _run(self, date_from: date, date_to: date) -> None:
        if self.phase == "structure":
            self._sync_structure()
            # The whole store history from the cut, not just this window: the
            # gap this closes is ads whose spend is days or months old.
            self._backfill_catalog(self.collect_from, None)
            bd_from = max(date_from, date_to - timedelta(days=BREAKDOWN_MAX_DAYS - 1))
            self._collect_breakdowns(bd_from, date_to)
        else:
            raw: list[dict] = []
            day = date_from
            while day <= date_to:
                raw.extend(self._insights_for_day(day))
                day += timedelta(days=1)
            ads, adsets, campaigns = structure_from_insights(raw)
            self._upsert_structure(ads, adsets, campaigns)

    def _throttled(self, fn):
        """Run a Graph call, sleeping through throttling within the budget."""
        wait = 30.0
        while True:
            try:
                return fn()
            except FacebookRequestError as exc:
                if exc.api_error_code() not in RETRY_CODES or self._slept + wait > THROTTLE_BUDGET:
                    raise
                logger.warning("[facebook] throttle %s — aguardando %ds", exc.api_error_code(), wait)
                time.sleep(wait)
                self._slept += wait
                wait *= 2

    def _pages(self, cursor):
        for item in cursor:
            yield item
        while self._throttled(cursor.load_next_page):
            time.sleep(0.2)
            for item in cursor:
                yield item

    # ── Insights ────────────────────────────────────────────────────────────

    def _insights_for_day(self, day: date) -> list[dict]:
        """One request per day, never a range: a multi-day request is answered
        from a background report that, for a day still being tallied, comes
        back nearly all zeros (MOKOO read $0.42 instead of $619 that way)."""
        params = {"level": "ad", "time_range": {"since": str(day), "until": str(day)},
                  "time_increment": 1, "limit": 500}
        cursor = self._throttled(lambda: self.account.get_insights(fields=INSIGHT_FIELDS, params=params))
        raw = [dict(i) for i in self._pages(cursor)]
        rate = self.money_rate(str(day))
        rows = [r for r in (parse_daily_insight(i, self.account_id, rate) for i in raw) if r]
        for r in rows:
            if r["phantom_purchase"]:
                logger.warning("[facebook] %s ad %s: valor de compra %.2f marcado como fantasma",
                               r["date"], r["ad_id"], r["purchase_value"])
        self.records += upsert(self.session, "fb_ad_daily_metrics", self.inject_tenant(rows),
                               [["tenant_id", "ad_id", "date"], ["ad_id", "date"]])
        logger.info("[facebook] %s %s — %d anúncios", self.account_id, day, len(rows))
        return raw

    def _upsert_structure(self, ads: list[dict], adsets: list[dict], campaigns: list[dict]) -> None:
        upsert(self.session, "fb_ads", self.inject_tenant(ads), AD_KEYS)
        upsert(self.session, "fb_adsets", self.inject_tenant(adsets), [["tenant_id", "adset_id"], ["adset_id"]])
        camp = [{**c, "account_id": self.account_id} for c in campaigns]
        upsert(self.session, "fb_campaigns", self.inject_tenant(camp), [["tenant_id", "campaign_id"], ["campaign_id"]])

    # ── Structure ───────────────────────────────────────────────────────────

    def _sync_structure(self) -> None:
        now = datetime.now(timezone.utc)
        campaigns = self._throttled(lambda: list(self._pages(self.account.get_campaigns(
            fields=["id", "name", "status", "effective_status", "objective"], params={"limit": 200}))))
        adsets = self._throttled(lambda: list(self._pages(self.account.get_ad_sets(
            fields=["id", "name", "status", "campaign_id"], params={"limit": 200}))))
        ads = self._throttled(lambda: list(self._pages(self.account.get_ads(
            fields=["id", "name", "status", "effective_status", "adset_id", "campaign_id",
                    "creative", "created_time", "updated_time"], params={"limit": 200}))))

        ads = self._scope_ads(ads)
        camp_names = {c["id"]: c.get("name") for c in campaigns}
        set_names = {a["id"]: a.get("name") for a in adsets}
        creative = self._creatives(ads)

        self.records += upsert(self.session, "fb_campaigns", self.inject_tenant([{
            "campaign_id": c["id"], "account_id": self.account_id, "name": c.get("name"),
            "status": c.get("status"), "objective": c.get("objective"), "synced_at": now,
        } for c in campaigns]), [["tenant_id", "campaign_id"], ["campaign_id"]])
        self.records += upsert(self.session, "fb_adsets", self.inject_tenant([{
            "adset_id": a["id"], "campaign_id": a.get("campaign_id"), "name": a.get("name"),
            "status": a.get("status"), "synced_at": now,
        } for a in adsets]), [["tenant_id", "adset_id"], ["adset_id"]])
        rows = []
        for ad in ads:
            c = creative.get(ad["id"], {})
            rows.append({
                "ad_id": ad["id"], "name": ad.get("name"), "status": ad.get("status"),
                "effective_status": ad.get("effective_status"),
                "adset_id": ad.get("adset_id"), "adset_name": set_names.get(ad.get("adset_id")),
                "campaign_id": ad.get("campaign_id"), "campaign_name": camp_names.get(ad.get("campaign_id")),
                "created_time": graph_ts(ad.get("created_time")), "updated_time": graph_ts(ad.get("updated_time")),
                "synced_at": now, **c,
            })
        self.records += upsert(self.session, "fb_ads", self.inject_tenant(rows), AD_KEYS)

    # ── Catalog backfill (ads with metrics but no fb_ads row) ───────────────

    def _backfill_catalog(self, since: Optional[date], until: Optional[date]) -> None:
        """Give every ad this store has metrics for a catalog row.

        Campaign views reach spend through fb_ads; an ad without a row shows as
        "não sincronizado". The account listing misses two kinds of ads: those
        created after the last structure pass (the old scheduler never ran one,
        so Glooty's 59 ads from 10-11 nov, $445 of its spend, had none) and
        archived or deleted ones, which /ads does not list by default (MOKOO:
        5 archived May ads). Both are read by id here, parents expanded.

        Secondary to the money: a failure here is named on the run and never
        stops the breakdowns."""
        try:
            ids = self._uncatalogued_ads(since, until)
            if not ids:
                return
            ads = self._ads_by_id(ids)
            written = 0
            if ads:
                creative = self._creatives(ads)
                ad_rows, adset_rows, camp_rows = catalog_from_ads(ads, self.account_id, datetime.now(timezone.utc))
                ad_rows = [{**r, **creative.get(r["ad_id"], {})} for r in ad_rows]
                upsert(self.session, "fb_campaigns", self.inject_tenant(camp_rows),
                       [["tenant_id", "campaign_id"], ["campaign_id"]])
                upsert(self.session, "fb_adsets", self.inject_tenant(adset_rows),
                       [["tenant_id", "adset_id"], ["adset_id"]])
                written = upsert(self.session, "fb_ads", self.inject_tenant(ad_rows), AD_KEYS)
                self.records += written
            unread = sorted(set(ids) - {str(a["id"]) for a in ads})
            logger.info("[facebook] catálogo: %d anúncios com métricas e sem cadastro, %d gravados por id%s",
                        len(ids), written,
                        f"; {len(unread)} que o Meta não devolve (ex.: {', '.join(unread[:3])})" if unread else "")
        except Exception as exc:  # noqa: BLE001 — reported on the run, never fatal
            self._safe_rollback()
            msg = f"catálogo de anúncios por id falhou: {describe_meta_error(exc) or redact(exc, 160)}"
            logger.error("[facebook] %s", msg)
            if self.allow_partial:
                self.failures.append(msg)
            else:
                self.warn(msg)

    def _uncatalogued_ads(self, since: Optional[date], until: Optional[date]) -> list[str]:
        per_store = "tenant_id" in (choose_conflict(AD_KEYS, unique_sets(self.session, "fb_ads")) or [])
        sql, params = uncatalogued_ads_query(self.tenant_id, self.account_id, since, until, per_store)
        return [str(r[0]) for r in self.session.execute(text(sql), params)]

    def _ads_by_id(self, ids: list[str]) -> list[dict]:
        """Ads read by id, IDS_PER_REQUEST per call. One id Meta will not
        serve fails the whole ?ids= call (code 100), so such a chunk is asked
        again one id at a time and the unreadable ids are left out."""
        fields = ",".join(AD_FIELDS_BY_ID)
        found: list[dict] = []
        for i in range(0, len(ids), IDS_PER_REQUEST):
            chunk = ids[i:i + IDS_PER_REQUEST]
            try:
                found.extend(self._get_ids(chunk, fields).values())
                continue
            except FacebookRequestError as exc:
                if exc.api_error_code() not in UNREADABLE_ID_CODES:
                    raise
            if len(chunk) == 1:
                continue
            for one in chunk:
                try:
                    found.extend(self._get_ids([one], fields).values())
                except FacebookRequestError as exc:
                    if exc.api_error_code() not in UNREADABLE_ID_CODES:
                        raise
        return [a for a in found if isinstance(a, dict) and a.get("id")]

    def _get_ids(self, ids: list[str], fields: str) -> dict:
        """GET /?ids=a,b&fields=… → {id: object}. Throttling is slept through."""
        return self._throttled(lambda: self.api.call(
            "GET", ("",), params={"ids": ",".join(ids), "fields": fields}).json())

    def _scope_ads(self, ads: list[dict]) -> list[dict]:
        """With a collect_from cut, keep only this store's ads: those it has
        spend for, or that were created after the cut. A shared or re-assigned
        account lists every ad it ever ran, including another store's."""
        if not self.collect_from:
            return ads
        mine = {r[0] for r in self.session.execute(
            text("SELECT DISTINCT ad_id FROM fb_ad_daily_metrics WHERE tenant_id = :t AND date >= :d"),
            {"t": self.tenant_id, "d": self.collect_from})}
        cut = self.collect_from.isoformat()
        return [a for a in ads if a["id"] in mine or (a.get("created_time") or "")[:10] >= cut]

    def _creatives(self, ads: list[dict]) -> dict[str, dict]:
        """Creative details per ad, fetched only when the ad is new or its
        creative changed. The old cache keyed on image_url, which video ads
        never have, so ~5,800 creatives were re-downloaded on every full sync."""
        stored = {r[0]: r for r in self.session.execute(
            text("SELECT ad_id, creative_id, creative_url, thumbnail_url, landing_url FROM fb_ads "
                 "WHERE tenant_id = :t AND ad_id = ANY(:ids)"),
            {"t": self.tenant_id, "ids": [a["id"] for a in ads]})} if ads else {}
        has_creative_id = "creative_id" in self._fb_ads_columns()
        out: dict[str, dict] = {}
        to_fetch: dict[str, list[str]] = {}
        for ad in ads:
            cid = (ad.get("creative") or {}).get("id")
            if not cid:
                continue
            row = stored.get(ad["id"])
            if row is not None and (row[1] == cid or (row[1] is None and (row[2] or row[3] or row[4]))):
                # Same creative as stored, or a legacy row with details already
                # fetched: keep what is there, just remember the creative id.
                if has_creative_id and row[1] != cid:
                    out[ad["id"]] = {"creative_id": cid}
                continue
            to_fetch.setdefault(cid, []).append(ad["id"])
        if to_fetch:
            logger.info("[facebook] buscando %d criativos novos (%d anúncios já em cache)",
                        len(to_fetch), len(ads) - sum(len(v) for v in to_fetch.values()))
        for cid, details in self._fetch_creatives(list(to_fetch)).items():
            for ad_id in to_fetch[cid]:
                out[ad_id] = {**details, **({"creative_id": cid} if has_creative_id else {})}
        return out

    def _fb_ads_columns(self) -> set[str]:
        from app.collectors.upsert import _table
        return {c.name for c in _table(self.session, "fb_ads").columns}

    def _fetch_creatives(self, creative_ids: list[str]) -> dict[str, dict]:
        from concurrent.futures import ThreadPoolExecutor

        fields = ["id", "image_url", "thumbnail_url", "object_story_spec", "asset_feed_spec"]

        def one(cid: str):
            try:
                c = AdCreative(cid, api=self._new_api()).api_get(fields=fields)
                return cid, _parse_creative(dict(c))
            except Exception as e:  # noqa: BLE001 — one bad creative never fails the run
                logger.warning("[facebook] criativo %s: %s", cid, redact(e, 160))
                return cid, None

        out: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=5) as pool:
            for cid, details in pool.map(one, creative_ids):
                if details is not None:
                    out[cid] = details
        return out

    # ── Breakdowns ──────────────────────────────────────────────────────────

    def _collect_breakdowns(self, date_from: date, date_to: date) -> None:
        """Four breakdown types in parallel, each with its own API client and
        DB session. A failed type is retried through throttling and, if it
        still fails, named on the run instead of being swallowed."""
        from concurrent.futures import ThreadPoolExecutor
        from app.database import SessionLocal

        def one(label: str, dims: list[str]) -> tuple[str, int, Optional[str]]:
            session = SessionLocal()
            try:
                account = AdAccount(self.account_id, api=self._new_api())
                params = {"level": "ad", "breakdowns": dims,
                          "time_range": {"since": str(date_from), "until": str(date_to)},
                          "time_increment": 1, "limit": 500}
                cursor = self._throttled(lambda: account.get_insights(fields=BREAKDOWN_FIELDS, params=params))
                n = 0
                batch: list[dict] = []
                for i in self._pages(cursor):
                    i = dict(i)
                    r = parse_breakdown(i, label, dims, self.money_rate(i.get("date_start")))
                    if r:
                        batch.append({**r, "tenant_id": self.tenant_id})
                    if len(batch) >= 500:
                        n += upsert(session, "fb_ad_breakdowns", batch,
                                    [["date", "tenant_id", "ad_id", "breakdown_type", "breakdown_value"],
                                     ["ad_id", "date", "breakdown_type", "breakdown_value"]])
                        batch = []
                n += upsert(session, "fb_ad_breakdowns", batch,
                            [["date", "tenant_id", "ad_id", "breakdown_type", "breakdown_value"],
                             ["ad_id", "date", "breakdown_type", "breakdown_value"]])
                return label, n, None
            except Exception as e:  # noqa: BLE001 — reported on the run
                try:
                    session.rollback()
                except Exception:  # noqa: BLE001
                    pass
                return label, 0, describe_meta_error(e) or redact(e, 160)
            finally:
                session.close()

        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="fb-breakdown") as pool:
            results = list(pool.map(lambda b: one(*b), BREAKDOWNS))
        for label, n, err in results:
            self.records += n
            if err:
                self.failures.append(f"breakdown {label} falhou: {err}")
                logger.error("[facebook] breakdown %s falhou: %s", label, err)


def _parse_creative(creative: dict) -> dict:
    story = creative.get("object_story_spec") or {}
    link_data = story.get("link_data") or {}
    video_data = story.get("video_data") or {}
    cta = (video_data.get("call_to_action") or {}).get("value") or {}
    template = story.get("template_data") if isinstance(story.get("template_data"), dict) else {}
    landing = link_data.get("link") or cta.get("link") or (template or {}).get("link")
    if not landing:
        urls = (creative.get("asset_feed_spec") or {}).get("link_urls") or []
        if urls:
            landing = (urls[0] or {}).get("website_url")
    return {
        "creative_url": creative.get("image_url"),
        "thumbnail_url": creative.get("thumbnail_url"),
        "landing_url": landing,
    }
