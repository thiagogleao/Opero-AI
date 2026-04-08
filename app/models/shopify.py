from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, Float, Integer, Numeric, String, Text,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ShopifyOrder(Base):
    __tablename__ = "shopify_orders"
    __table_args__ = (
        Index("ix_shopify_order_created", "created_at"),
        Index("ix_shopify_order_customer", "customer_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    order_number: Mapped[Optional[int]] = mapped_column(Integer)
    customer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    total_price: Mapped[float] = mapped_column(Float, default=0)
    subtotal_price: Mapped[float] = mapped_column(Float, default=0)
    total_discounts: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[Optional[str]] = mapped_column(String(8))
    country_code: Mapped[Optional[str]] = mapped_column(String(8))
    financial_status: Mapped[Optional[str]] = mapped_column(String(32))
    fulfillment_status: Mapped[Optional[str]] = mapped_column(String(32))
    # Computed: True if this is the customer's first order
    is_first_order: Mapped[bool] = mapped_column(Boolean, default=False)


class ShopifyOrderItem(Base):
    __tablename__ = "shopify_order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "line_item_id", name="uq_order_line_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    line_item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    product_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    variant_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    product_title: Mapped[Optional[str]] = mapped_column(String(512))
    variant_title: Mapped[Optional[str]] = mapped_column(String(256))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[float] = mapped_column(Float, default=0)


class ShopifyCustomer(Base):
    """Aggregated customer view for LTV and repeat purchase analysis."""

    __tablename__ = "shopify_customers"
    __table_args__ = (
        Index("ix_shopify_customer_email", "email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    total_spent: Mapped[float] = mapped_column(Float, default=0)
    orders_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_order_value: Mapped[float] = mapped_column(Float, default=0)
    first_order_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_order_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    country_code: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    # True if they have more than 1 order
    is_returning: Mapped[bool] = mapped_column(Boolean, default=False)


class ShopifyDailyMetric(Base):
    """Aggregated store metrics per day, computed from orders."""

    __tablename__ = "shopify_daily_metrics"
    __table_args__ = (
        UniqueConstraint("date", name="uq_shopify_daily_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    total_orders: Mapped[int] = mapped_column(Integer, default=0)
    total_revenue: Mapped[float] = mapped_column(Float, default=0)
    avg_order_value: Mapped[float] = mapped_column(Float, default=0)

    new_customers: Mapped[int] = mapped_column(Integer, default=0)
    returning_customers: Mapped[int] = mapped_column(Integer, default=0)
    new_customer_revenue: Mapped[float] = mapped_column(Float, default=0)
    returning_customer_revenue: Mapped[float] = mapped_column(Float, default=0)

    # From abandoned checkouts
    cart_abandonment_count: Mapped[int] = mapped_column(Integer, default=0)
    cart_abandonment_value: Mapped[float] = mapped_column(Float, default=0)


class ShopifyAbandonedCheckout(Base):
    __tablename__ = "shopify_abandoned_checkouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    checkout_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    customer_email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    total_price: Mapped[float] = mapped_column(Float, default=0)
    # True if later completed as order
    recovered: Mapped[bool] = mapped_column(Boolean, default=False)


class ShopifyCountryMetric(Base):
    """Revenue and order breakdown by country per day."""

    __tablename__ = "shopify_country_metrics"
    __table_args__ = (
        UniqueConstraint("date", "country_code", name="uq_shopify_country_date"),
        Index("ix_shopify_country_date", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    country_code: Mapped[str] = mapped_column(String(8), nullable=False)
    orders_count: Mapped[int] = mapped_column(Integer, default=0)
    revenue: Mapped[float] = mapped_column(Float, default=0)
    avg_order_value: Mapped[float] = mapped_column(Float, default=0)
    new_customers: Mapped[int] = mapped_column(Integer, default=0)
