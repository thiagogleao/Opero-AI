"""
Facebook Ads collector.

Collects per ad/day:
  - Core metrics: spend, impressions, reach, frequency, clicks, CTR, CPM, CPC
  - Conversions: purchases, purchase_value, ROAS, cost_per_purchase
  - Video: plays, P25/P50/P75/P100 views, hook_rate, hold_rates
  - Breakdowns: country, device, placement, age+gender

Data is upserted so re-runs are safe.
"""

import logging
import time
from datetime import date, datetime
from typing import Optional

from facebook_business.api import FacebookAdsApi
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.campaign import Campaign
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.ad import Ad
from facebook_business.exceptions import FacebookRequestError
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.collectors.base import BaseCollector
from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# All insight fields we want at the ad level (daily)
_INSIGHT_FIELDS = [
    "ad_id", "ad_name", "adset_id", "campaign_id",
    "spend", "impressions", "reach", "frequency",
    "clicks", "ctr", "cpm", "cpc",
    "actions", "action_values", "cost_per_action_type",
    "outbound_clicks",
    "video_play_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p100_watched_actions",
]

_BREAKDOWN_FIELDS = [
    "ad_id", "spend", "impressions", "clicks", "ctr", "cpm",
    "actions", "action_values",
]

# Breakdown specs: (db_type_label, api_breakdowns_list)
_BREAKDOWNS = [
    ("country",    ["country"]),
    ("device",     ["device_platform"]),
    ("placement",  ["publisher_platform", "platform_position"]),
    ("age_gender", ["age", "gender"]),
]

# Breakdowns are capped to last N days to prevent timeouts on long date ranges.
# Daily insights (spend/ROAS/purchases) are still collected for the full period.
_BREAKDOWN_MAX_DAYS = 14


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_action(actions: list, action_type: str, default=0):
    """Extract a numeric value from Facebook's action list."""
    if not actions:
        return default
    for a in actions:
        if a.get("action_type") == action_type:
            return float(a.get("value", 0))
    return default


def _first_action(actions: list, *action_types, default=0.0):
    """Return the value of the FIRST matching action type.
    Use instead of summing multiple action_types that may represent the same event
    (e.g. 'purchase' and 'offsite_conversion.fb_pixel_purchase' are the same conversion).
    """
    if not actions:
        return default
    for action_type in action_types:
        for a in actions:
            if a.get("action_type") == action_type:
                return float(a.get("value", 0))
    return default


def _int(value, default=0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _float(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _video_action_value(field_list, default=None) -> Optional[int]:
    """
    Video metric fields are lists like [{"action_type": "video_view", "value": "1000"}].
    Returns int or None.
    """
    if not field_list:
        return default
    try:
        return int(float(field_list[0].get("value", 0)))
    except (IndexError, TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

def _refresh_token_if_needed() -> str:
    """
    Check token expiry via Graph API. If < 7 days remaining, exchange for a
    new long-lived token and update .env automatically. Returns the active token.
    """
    import datetime
    import re
    import requests

    token     = settings.facebook_access_token
    app_id    = settings.facebook_app_id
    app_secret = settings.facebook_app_secret

    try:
        resp = requests.get(
            "https://graph.facebook.com/debug_token",
            params={"input_token": token, "access_token": f"{app_id}|{app_secret}"},
            timeout=10,
        )
        info = resp.json().get("data", {})
    except Exception as e:
        logger.warning("[facebook] Could not check token expiry: %s", e)
        return token

    expires_at = info.get("expires_at", 0)
    if not expires_at:
        return token  # non-expiring token (system user)

    days_left = (datetime.datetime.fromtimestamp(expires_at) - datetime.datetime.now()).days
    logger.info("[facebook] Token valid for %d more days", days_left)

    if days_left > 7:
        return token

    # Exchange for long-lived token
    logger.info("[facebook] Token expiring soon — auto-renewing...")
    try:
        r = requests.get(
            "https://graph.facebook.com/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": app_id,
                "client_secret": app_secret,
                "fb_exchange_token": token,
            },
            timeout=10,
        )
        new_token = r.json().get("access_token")
        if not new_token:
            raise ValueError(r.json())
    except Exception as e:
        logger.warning("[facebook] Auto-renewal failed: %s", e)
        return token

    # Persist to .env
    try:
        env_path = ".env"
        with open(env_path, "r", encoding="utf-8") as f:
            content = f.read()
        new_content = re.sub(
            r"^FACEBOOK_ACCESS_TOKEN=.*$",
            f"FACEBOOK_ACCESS_TOKEN={new_token}",
            content,
            flags=re.MULTILINE,
        )
        with open(env_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        logger.info("[facebook] Token renewed and saved to .env (valid 60 days)")
    except Exception as e:
        logger.warning("[facebook] Could not save renewed token to .env: %s", e)

    return new_token


class FacebookCollector(BaseCollector):
    source = "facebook"

    def __init__(
        self,
        session: Session,
        tenant_id: Optional[str] = None,
        access_token: Optional[str] = None,
        ad_account_id: Optional[str] = None,
        app_id: Optional[str] = None,
        app_secret: Optional[str] = None,
    ):
        super().__init__(session, tenant_id)
        _app_id     = app_id     or settings.facebook_app_id
        _app_secret = app_secret or settings.facebook_app_secret
        _token      = access_token or _refresh_token_if_needed()
        _account_id = ad_account_id or settings.facebook_ad_account_id
        FacebookAdsApi.init(app_id=_app_id, app_secret=_app_secret, access_token=_token)
        self._account = AdAccount(_account_id)
        self._account_id = _account_id

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------

    def _run(self, date_from: date, date_to: date) -> None:
        from datetime import timedelta

        logger.info("[facebook] Syncing account structure...")
        self._sync_account()
        self._sync_campaigns()
        self._sync_adsets()
        ad_ids = self._sync_ads()

        logger.info("[facebook] Collecting daily insights for %d ads...", len(ad_ids))
        self._collect_daily_insights(date_from, date_to)

        # Cap breakdowns to last _BREAKDOWN_MAX_DAYS days to avoid timeouts on long ranges
        breakdown_from = max(date_from, date_to - timedelta(days=_BREAKDOWN_MAX_DAYS - 1))
        if breakdown_from > date_from:
            logger.info(
                "[facebook] Breakdowns capped to last %d days (%s → %s)",
                _BREAKDOWN_MAX_DAYS, breakdown_from, date_to,
            )

        logger.info("[facebook] Collecting breakdowns...")
        for label, breakdowns in _BREAKDOWNS:
            self._collect_breakdown(label, breakdowns, breakdown_from, date_to)

    # ------------------------------------------------------------------
    # Structure sync
    # ------------------------------------------------------------------

    def _sync_account(self):
        info = self._account.api_get(fields=["name", "currency", "account_status"])
        rows = [{
            "account_id": self._account_id,
            "name": info.get("name"),
            "currency": info.get("currency"),
            "account_status": info.get("account_status"),
            "synced_at": datetime.utcnow(),
        }]
        self._upsert_raw("fb_ad_accounts", rows, ["account_id"])

    def _sync_campaigns(self):
        campaigns = self._paginate(
            self._account.get_campaigns(
                fields=["id", "name", "status", "objective"],
                params={"limit": 200},
            )
        )
        rows = [
            {
                "campaign_id": c["id"],
                "account_id": self._account_id,
                "name": c.get("name"),
                "status": c.get("status"),
                "objective": c.get("objective"),
                "synced_at": datetime.utcnow(),
            }
            for c in campaigns
        ]
        self._upsert_raw("fb_campaigns", rows, ["campaign_id"])

    def _sync_adsets(self):
        adsets = self._paginate(
            self._account.get_ad_sets(
                fields=["id", "name", "status", "campaign_id"],
                params={"limit": 200},
            )
        )
        rows = [
            {
                "adset_id": a["id"],
                "campaign_id": a.get("campaign_id"),
                "name": a.get("name"),
                "status": a.get("status"),
                "synced_at": datetime.utcnow(),
            }
            for a in adsets
        ]
        self._upsert_raw("fb_adsets", rows, ["adset_id"])

    def _sync_ads(self) -> list[str]:
        ads = self._paginate(
            self._account.get_ads(
                fields=["id", "name", "status", "adset_id", "campaign_id", "creative"],
                params={"limit": 200},
            )
        )
        rows = []
        for ad in ads:
            creative = ad.get("creative") or {}
            rows.append({
                "ad_id": ad["id"],
                "adset_id": ad.get("adset_id"),
                "campaign_id": ad.get("campaign_id"),
                "name": ad.get("name"),
                "status": ad.get("status"),
                "creative_type": None,   # enriched later by analyzer
                "creative_url": creative.get("image_url") or creative.get("video_url"),
                "thumbnail_url": creative.get("thumbnail_url"),
                "synced_at": datetime.utcnow(),
            })
        self._upsert_raw("fb_ads", rows, ["ad_id"])
        return [ad["id"] for ad in ads]

    # ------------------------------------------------------------------
    # Daily insights
    # ------------------------------------------------------------------

    def _collect_daily_insights(self, date_from: date, date_to: date):
        params = {
            "level": "ad",
            "time_range": {
                "since": str(date_from),
                "until": str(date_to),
            },
            "time_increment": 1,   # one row per day
            "limit": 500,
        }

        cursor = self._account.get_insights(
            fields=_INSIGHT_FIELDS,
            params=params,
        )

        rows = []
        for insight in self._paginate(cursor):
            row = self._parse_daily_insight(insight)
            if row:
                rows.append(row)

            # Batch upserts every 500 rows to avoid huge transactions
            if len(rows) >= 500:
                self._upsert_raw("fb_ad_daily_metrics", rows, ["ad_id", "date"])
                rows = []

        if rows:
            self._upsert_raw("fb_ad_daily_metrics", rows, ["ad_id", "date"])

    def _parse_daily_insight(self, insight: dict) -> Optional[dict]:
        ad_id = insight.get("ad_id")
        raw_date = insight.get("date_start")
        if not ad_id or not raw_date:
            return None

        actions = insight.get("actions") or []
        action_values = insight.get("action_values") or []
        cost_per = insight.get("cost_per_action_type") or []

        # Use _first_action to avoid double-counting: FB API often returns the same
        # conversion under both the generic name ("purchase") and the pixel-specific
        # name ("offsite_conversion.fb_pixel_purchase"). Summing both inflates values 2×.
        purchases = int(_first_action(actions, "purchase", "offsite_conversion.fb_pixel_purchase"))
        purchase_value = _first_action(action_values, "purchase", "offsite_conversion.fb_pixel_purchase")
        add_to_cart = int(_first_action(actions, "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"))
        initiate_checkout = int(_first_action(actions, "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"))

        spend = _float(insight.get("spend"))
        roas = (purchase_value / spend) if spend > 0 else 0
        cost_per_purchase = (spend / purchases) if purchases > 0 else 0

        impressions = _int(insight.get("impressions"))
        video_plays = _video_action_value(insight.get("video_play_actions"))
        video_p25 = _video_action_value(insight.get("video_p25_watched_actions"))
        video_p50 = _video_action_value(insight.get("video_p50_watched_actions"))
        video_p75 = _video_action_value(insight.get("video_p75_watched_actions"))
        video_p100 = _video_action_value(insight.get("video_p100_watched_actions"))

        # hook_rate: % of people who saw the ad and started watching (3-sec view / impression)
        hook_rate = (video_plays / impressions) if (video_plays and impressions) else None
        # hold_rates: % of viewers who kept watching past each milestone
        hold_rate_25 = (video_p25 / video_plays) if (video_p25 and video_plays) else None
        hold_rate_50 = (video_p50 / video_plays) if (video_p50 and video_plays) else None
        hold_rate_75 = (video_p75 / video_plays) if (video_p75 and video_plays) else None
        hold_rate_100 = (video_p100 / video_plays) if (video_p100 and video_plays) else None

        # link_clicks comes from outbound_clicks
        outbound = insight.get("outbound_clicks") or []
        link_clicks = _int(_parse_action(outbound, "outbound_click")) if outbound else _int(_parse_action(actions, "link_click"))

        return {
            "ad_id": ad_id,
            "adset_id": insight.get("adset_id", ""),
            "campaign_id": insight.get("campaign_id", ""),
            "date": raw_date,
            "spend": spend,
            "impressions": impressions,
            "reach": _int(insight.get("reach")),
            "frequency": _float(insight.get("frequency")),
            "clicks": _int(insight.get("clicks")),
            "link_clicks": link_clicks,
            "landing_page_views": _int(insight.get("landing_page_views")),
            "ctr": _float(insight.get("ctr")),
            "link_ctr": (link_clicks / impressions * 100) if (link_clicks and impressions) else 0,
            "cpm": _float(insight.get("cpm")),
            "cpc": _float(insight.get("cpc")),
            "purchases": purchases,
            "purchase_value": purchase_value,
            "roas": roas,
            "cost_per_purchase": cost_per_purchase,
            "add_to_cart": add_to_cart,
            "initiate_checkout": initiate_checkout,
            "post_engagement": _int(_parse_action(actions, "post_engagement")),
            "video_plays": video_plays,
            "video_p25": video_p25,
            "video_p50": video_p50,
            "video_p75": video_p75,
            "video_p100": video_p100,
            "hook_rate": hook_rate,
            "hold_rate_25": hold_rate_25,
            "hold_rate_50": hold_rate_50,
            "hold_rate_75": hold_rate_75,
            "hold_rate_100": hold_rate_100,
        }

    # ------------------------------------------------------------------
    # Breakdowns
    # ------------------------------------------------------------------

    def _collect_breakdown(
        self,
        label: str,
        breakdowns: list[str],
        date_from: date,
        date_to: date,
    ):
        logger.info("[facebook] Breakdown: %s", label)
        params = {
            "level": "ad",
            "breakdowns": breakdowns,
            "time_range": {"since": str(date_from), "until": str(date_to)},
            "time_increment": 1,
            "limit": 500,
        }

        cursor = self._account.get_insights(
            fields=_BREAKDOWN_FIELDS,
            params=params,
        )

        rows = []
        for insight in self._paginate(cursor):
            ad_id = insight.get("ad_id")
            raw_date = insight.get("date_start")
            if not ad_id or not raw_date:
                continue

            # Build breakdown_value from whichever breakdown fields are present
            breakdown_value = self._build_breakdown_value(insight, breakdowns)

            actions = insight.get("actions") or []
            action_values = insight.get("action_values") or []
            spend = _float(insight.get("spend"))
            purchase_value = _first_action(action_values, "purchase", "offsite_conversion.fb_pixel_purchase")
            purchases = int(_first_action(actions, "purchase", "offsite_conversion.fb_pixel_purchase"))
            roas = (purchase_value / spend) if spend > 0 else 0

            rows.append({
                "ad_id": ad_id,
                "date": raw_date,
                "breakdown_type": label,
                "breakdown_value": breakdown_value,
                "spend": spend,
                "impressions": _int(insight.get("impressions")),
                "clicks": _int(insight.get("clicks")),
                "ctr": _float(insight.get("ctr")),
                "cpm": _float(insight.get("cpm")),
                "purchases": purchases,
                "purchase_value": purchase_value,
                "roas": roas,
            })

            if len(rows) >= 500:
                self._upsert_raw(
                    "fb_ad_breakdowns", rows,
                    ["ad_id", "date", "breakdown_type", "breakdown_value"],
                )
                rows = []

        if rows:
            self._upsert_raw(
                "fb_ad_breakdowns", rows,
                ["ad_id", "date", "breakdown_type", "breakdown_value"],
            )

    @staticmethod
    def _build_breakdown_value(insight: dict, breakdowns: list[str]) -> str:
        """Combine multiple breakdown dimensions into a single string key."""
        parts = []
        mapping = {
            "country": "country",
            "device_platform": "device_platform",
            "publisher_platform": "publisher_platform",
            "platform_position": "platform_position",
            "age": "age",
            "gender": "gender",
        }
        for api_field in breakdowns:
            key = mapping.get(api_field, api_field)
            val = insight.get(key) or insight.get(api_field, "unknown")
            parts.append(str(val))
        return "_".join(parts)

    # ------------------------------------------------------------------
    # Pagination helper
    # ------------------------------------------------------------------

    @staticmethod
    def _paginate(cursor, sleep_between_pages: float = 0.5):
        """Iterate all pages of a Facebook API cursor with rate-limit sleep."""
        for item in cursor:
            yield item
        while cursor.load_next_page():
            time.sleep(sleep_between_pages)
            for item in cursor:
                yield item

    # ------------------------------------------------------------------
    # Low-level upsert (uses table name string, not model class)
    # ------------------------------------------------------------------

    def _upsert_raw(self, table_name: str, rows: list[dict], conflict_columns: list[str]) -> int:
        if not rows:
            return 0
        from sqlalchemy import text, Table, MetaData
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        rows = self._inject_tenant(rows)

        meta = MetaData()
        meta.reflect(bind=self.session.bind, only=[table_name])
        table = meta.tables[table_name]

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
