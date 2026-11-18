"""
Meta insights → database rows. Pure functions, no I/O.

Rules that each fixed a wrong number:
  - ONE alias per event, the pixel one first: offsite_conversion.fb_pixel_purchase.
    Summing it with the generic 'purchase' doubles purchases; preferring the
    generic one counts Shop/onsite/offline purchases the store's own books do
    not see (CLAUDE.md). The generic alias is only a fallback for a row that
    carries no pixel alias at all.
  - A purchase value above PHANTOM_PURCHASE_VALUE on one ad-day is a Meta
    glitch (EPOCH: $183,000 on $4 of spend), never a sale. The row is stored
    as Meta sent it — the profit engine drops such values at read time
    (frontend/lib/engine/pnl.ts, same threshold) — but it is flagged
    (phantom_purchase) and its stored ROAS is computed without it.
  - Landing page views are an action ('landing_page_view'), not a top-level
    field; reading the field stored 0 for every row ever collected.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

# Must equal PHANTOM_PURCHASE_VALUE in frontend/lib/engine/pnl.ts.
PHANTOM_PURCHASE_VALUE = 20000.0

PURCHASE = ("offsite_conversion.fb_pixel_purchase", "purchase")
ADD_TO_CART = ("offsite_conversion.fb_pixel_add_to_cart", "add_to_cart", "omni_add_to_cart")
INITIATE_CHECKOUT = ("offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout")

INSIGHT_FIELDS = [
    "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name",
    "spend", "impressions", "reach", "frequency",
    "clicks", "ctr", "cpm", "cpc",
    "actions", "action_values",
    "outbound_clicks",
    "video_play_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p100_watched_actions",
]

BREAKDOWN_FIELDS = ["ad_id", "spend", "impressions", "clicks", "ctr", "cpm", "actions", "action_values"]

BREAKDOWNS = [
    ("country", ["country"]),
    ("device", ["device_platform"]),
    ("placement", ["publisher_platform", "platform_position"]),
    ("age_gender", ["age", "gender"]),
]

# An ad read on its own (GET /?ids=…). The parents come expanded in the same
# call, so an ad whose campaign or ad set the account listing no longer shows
# (archived) still lands with names and a campaign row.
AD_FIELDS_BY_ID = [
    "id", "name", "status", "effective_status", "account_id", "adset_id", "campaign_id",
    "creative{id}", "created_time", "updated_time",
    "adset{id,name,status}", "campaign{id,name,status,objective}",
]


def graph_ts(value: Optional[str]) -> Optional[datetime]:
    """Graph timestamps look like 2026-11-10T12:00:00+0000."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except (ValueError, TypeError):
        return None


def to_int(value, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def first_action(actions, *types, default: float = 0.0) -> float:
    """Value of the first action type present, in the order given."""
    if not actions:
        return default
    for t in types:
        for a in actions:
            if a.get("action_type") == t:
                return to_float(a.get("value"))
    return default


def video_value(field) -> Optional[int]:
    if not field:
        return None
    try:
        return int(float(field[0].get("value", 0)))
    except (IndexError, TypeError, ValueError, AttributeError):
        return None


def is_phantom(purchase_value: float) -> bool:
    return purchase_value > PHANTOM_PURCHASE_VALUE


def _ratio(a, b) -> Optional[float]:
    return (a / b) if (a and b) else None


def parse_daily_insight(insight: dict, account_id: Optional[str], money_rate: float = 1.0) -> Optional[dict]:
    """One fb_ad_daily_metrics row. tenant_id is added by the caller.
    money_rate converts an ad account that does not bill in dollars."""
    ad_id = insight.get("ad_id")
    day = insight.get("date_start")
    if not ad_id or not day:
        return None
    actions = insight.get("actions") or []
    values = insight.get("action_values") or []

    spend = to_float(insight.get("spend")) * money_rate
    purchase_value = first_action(values, *PURCHASE) * money_rate
    purchases = int(first_action(actions, *PURCHASE))
    phantom = is_phantom(purchase_value)
    clean_value = 0.0 if phantom else purchase_value

    impressions = to_int(insight.get("impressions"))
    plays = video_value(insight.get("video_play_actions"))
    p25 = video_value(insight.get("video_p25_watched_actions"))
    p50 = video_value(insight.get("video_p50_watched_actions"))
    p75 = video_value(insight.get("video_p75_watched_actions"))
    p100 = video_value(insight.get("video_p100_watched_actions"))
    outbound = insight.get("outbound_clicks") or []
    link_clicks = to_int(first_action(outbound, "outbound_click")) if outbound else to_int(first_action(actions, "link_click"))

    return {
        "ad_id": str(ad_id),
        "date": day,
        "fb_ad_account_id": account_id,
        "campaign_id": insight.get("campaign_id") or None,
        "adset_id": insight.get("adset_id") or None,
        "spend": spend,
        "impressions": impressions,
        "reach": to_int(insight.get("reach")),
        "frequency": to_float(insight.get("frequency")),
        "clicks": to_int(insight.get("clicks")),
        "link_clicks": link_clicks,
        "landing_page_views": to_int(first_action(actions, "landing_page_view")),
        "ctr": to_float(insight.get("ctr")),
        "cpm": to_float(insight.get("cpm")) * money_rate,
        "cpc": to_float(insight.get("cpc")) * money_rate,
        "purchases": purchases,
        "purchase_value": purchase_value,
        "phantom_purchase": phantom,
        "roas": (clean_value / spend) if spend > 0 else 0,
        "add_to_cart": int(first_action(actions, *ADD_TO_CART)),
        "initiate_checkout": int(first_action(actions, *INITIATE_CHECKOUT)),
        "post_engagement": to_int(first_action(actions, "post_engagement")),
        "video_plays": plays,
        "video_p25": p25,
        "video_p50": p50,
        "video_p75": p75,
        "video_p100": p100,
        "hook_rate": _ratio(plays, impressions),
        "hold_rate_25": _ratio(p25, plays),
        "hold_rate_50": _ratio(p50, plays),
        "hold_rate_75": _ratio(p75, plays),
        "hold_rate_100": _ratio(p100, plays),
    }


def breakdown_value(insight: dict, dims: list[str]) -> str:
    return "_".join(str(insight.get(d) or "unknown") for d in dims)


def parse_breakdown(insight: dict, label: str, dims: list[str], money_rate: float = 1.0) -> Optional[dict]:
    ad_id = insight.get("ad_id")
    day = insight.get("date_start")
    if not ad_id or not day:
        return None
    actions = insight.get("actions") or []
    values = insight.get("action_values") or []
    purchase_value = first_action(values, *PURCHASE) * money_rate
    return {
        "ad_id": str(ad_id),
        "date": day,
        "breakdown_type": label,
        "breakdown_value": breakdown_value(insight, dims),
        "spend": to_float(insight.get("spend")) * money_rate,
        "impressions": to_int(insight.get("impressions")),
        "clicks": to_int(insight.get("clicks")),
        "purchases": int(first_action(actions, *PURCHASE)),
        "purchase_value": purchase_value,
        "phantom_purchase": is_phantom(purchase_value),
    }


def structure_from_insights(raw: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Minimal fb_ads / fb_adsets / fb_campaigns rows from the names insights
    already carry. Campaign views reach spend through fb_ads, so an ad that
    started after the last structure pass used to vanish from every campaign
    total until someone ran a full sync (15% of Glooty's spend)."""
    ads: dict[str, dict] = {}
    adsets: dict[str, dict] = {}
    campaigns: dict[str, dict] = {}
    for i in raw:
        ad_id = i.get("ad_id")
        if not ad_id:
            continue
        ads[str(ad_id)] = {
            "ad_id": str(ad_id), "name": i.get("ad_name"),
            "adset_id": i.get("adset_id"), "adset_name": i.get("adset_name"),
            "campaign_id": i.get("campaign_id"), "campaign_name": i.get("campaign_name"),
        }
        if i.get("adset_id"):
            adsets[str(i["adset_id"])] = {
                "adset_id": str(i["adset_id"]), "campaign_id": i.get("campaign_id"), "name": i.get("adset_name"),
            }
        if i.get("campaign_id"):
            campaigns[str(i["campaign_id"])] = {"campaign_id": str(i["campaign_id"]), "name": i.get("campaign_name")}
    return list(ads.values()), list(adsets.values()), list(campaigns.values())


def catalog_from_ads(ads: list[dict], fallback_account: Optional[str],
                     synced_at: datetime) -> tuple[list[dict], list[dict], list[dict]]:
    """Full fb_ads / fb_adsets / fb_campaigns rows for ads read by id
    (AD_FIELDS_BY_ID). The campaign is filed under the ad's own account
    (Meta's account_id, without the act_ prefix), falling back to the account
    being collected. Creative details are merged in by the caller."""
    ad_rows: dict[str, dict] = {}
    adsets: dict[str, dict] = {}
    campaigns: dict[str, dict] = {}
    for ad in ads:
        ad_id = ad.get("id")
        if not ad_id:
            continue
        adset = ad.get("adset") or {}
        campaign = ad.get("campaign") or {}
        adset_id = ad.get("adset_id") or adset.get("id")
        campaign_id = ad.get("campaign_id") or campaign.get("id")
        ad_rows[str(ad_id)] = {
            "ad_id": str(ad_id), "name": ad.get("name"), "status": ad.get("status"),
            "effective_status": ad.get("effective_status"),
            "adset_id": adset_id, "adset_name": adset.get("name"),
            "campaign_id": campaign_id, "campaign_name": campaign.get("name"),
            "created_time": graph_ts(ad.get("created_time")), "updated_time": graph_ts(ad.get("updated_time")),
            "synced_at": synced_at,
        }
        # Parents may already have a row from the listing; a field the
        # expansion did not bring must not blank it (upsert writes every key
        # the row carries, NULL included).
        if adset_id:
            adsets[str(adset_id)] = _present({
                "adset_id": str(adset_id), "campaign_id": campaign_id, "name": adset.get("name"),
                "status": adset.get("status"), "synced_at": synced_at,
            })
        if campaign_id:
            account = f"act_{ad['account_id']}" if ad.get("account_id") else fallback_account
            campaigns[str(campaign_id)] = _present({
                "campaign_id": str(campaign_id), "account_id": account, "name": campaign.get("name"),
                "status": campaign.get("status"), "objective": campaign.get("objective"),
                "synced_at": synced_at,
            })
    return list(ad_rows.values()), list(adsets.values()), list(campaigns.values())


def _present(row: dict) -> dict:
    return {k: v for k, v in row.items() if v is not None}
