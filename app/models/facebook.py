from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Date, DateTime, Float, Integer, Numeric, String, Text,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FbAdAccount(Base):
    __tablename__ = "fb_ad_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(256))
    currency: Mapped[Optional[str]] = mapped_column(String(8))
    account_status: Mapped[Optional[int]] = mapped_column(Integer)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FbCampaign(Base):
    __tablename__ = "fb_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(512))
    status: Mapped[Optional[str]] = mapped_column(String(32))
    objective: Mapped[Optional[str]] = mapped_column(String(64))
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FbAdSet(Base):
    __tablename__ = "fb_adsets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    adset_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(512))
    status: Mapped[Optional[str]] = mapped_column(String(32))
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FbAd(Base):
    __tablename__ = "fb_ads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ad_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    adset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(512))
    status: Mapped[Optional[str]] = mapped_column(String(32))
    # "image" | "video" | "carousel" — detected from creative
    creative_type: Mapped[Optional[str]] = mapped_column(String(16))
    creative_url: Mapped[Optional[str]] = mapped_column(Text)
    thumbnail_url: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FbAdDailyMetric(Base):
    """One row per ad per day. Upserted on (ad_id, date)."""

    __tablename__ = "fb_ad_daily_metrics"
    __table_args__ = (
        UniqueConstraint("ad_id", "date", name="uq_fb_daily_ad_date"),
        Index("ix_fb_daily_date", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ad_id: Mapped[str] = mapped_column(String(64), nullable=False)
    adset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # Core spend/reach
    spend: Mapped[float] = mapped_column(Float, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    reach: Mapped[int] = mapped_column(Integer, default=0)
    frequency: Mapped[float] = mapped_column(Float, default=0)

    # Click metrics
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    link_clicks: Mapped[int] = mapped_column(Integer, default=0)
    landing_page_views: Mapped[int] = mapped_column(Integer, default=0)
    ctr: Mapped[float] = mapped_column(Float, default=0)        # all clicks / impressions
    link_ctr: Mapped[float] = mapped_column(Float, default=0)   # link clicks / impressions
    cpm: Mapped[float] = mapped_column(Float, default=0)
    cpc: Mapped[float] = mapped_column(Float, default=0)

    # Conversions
    purchases: Mapped[int] = mapped_column(Integer, default=0)
    purchase_value: Mapped[float] = mapped_column(Float, default=0)
    roas: Mapped[float] = mapped_column(Float, default=0)        # purchase_value / spend
    cost_per_purchase: Mapped[float] = mapped_column(Float, default=0)

    # Engagement
    post_engagement: Mapped[int] = mapped_column(Integer, default=0)

    # Video metrics (null for non-video ads)
    video_plays: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_p25: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_p50: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_p75: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_p100: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # hook_rate = video_plays / impressions (did the first 3s hook them?)
    hook_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # hold_rate_X = video_pX / video_plays (% who kept watching)
    hold_rate_25: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hold_rate_50: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hold_rate_75: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hold_rate_100: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class FbAdBreakdown(Base):
    """
    Breakdown metrics per ad per day.
    breakdown_type: country | device | placement | age_gender
    breakdown_value: BR | mobile | feed | 25-34_male
    """

    __tablename__ = "fb_ad_breakdowns"
    __table_args__ = (
        UniqueConstraint(
            "ad_id", "date", "breakdown_type", "breakdown_value",
            name="uq_fb_breakdown",
        ),
        Index("ix_fb_breakdown_date", "date"),
        Index("ix_fb_breakdown_type", "breakdown_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ad_id: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    breakdown_type: Mapped[str] = mapped_column(String(32), nullable=False)
    breakdown_value: Mapped[str] = mapped_column(String(128), nullable=False)

    spend: Mapped[float] = mapped_column(Float, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    ctr: Mapped[float] = mapped_column(Float, default=0)
    cpm: Mapped[float] = mapped_column(Float, default=0)
    purchases: Mapped[int] = mapped_column(Integer, default=0)
    purchase_value: Mapped[float] = mapped_column(Float, default=0)
    roas: Mapped[float] = mapped_column(Float, default=0)
