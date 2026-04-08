"""Creates the profit_settings table and inserts default config."""
import json
from dotenv import load_dotenv
load_dotenv()

from app.database import engine
from sqlalchemy import text

DEFAULT_CONFIG = {
    "shopify": {
        "transaction_fee_pct": 2.0,        # % on 3rd-party gateway orders
        "payment_processing_pct": 2.9,     # % Shopify Payments / Stripe
        "payment_processing_fixed": 0.30,  # fixed per transaction (USD)
    },
    "cogs": {
        "default_cost_usd": 15.0,          # cost per unit (product)
        "packaging_cost_usd": 1.50,        # packaging per order
        "volume_discounts": [              # discount on COGS when multiple units
            {"min_units": 2, "discount_pct": 5},
            {"min_units": 3, "discount_pct": 10},
            {"min_units": 5, "discount_pct": 15},
        ],
        "products": [],  # per-product overrides: [{product_id, name, cost_usd}]
    },
    "shipping": {
        "default_rate_usd": 9.99,
        "rates": [
            {"country_code": "US", "name": "Estados Unidos", "cost_usd": 8.99},
            {"country_code": "AU", "name": "Austrália",       "cost_usd": 14.99},
            {"country_code": "GB", "name": "Reino Unido",     "cost_usd": 11.99},
            {"country_code": "CA", "name": "Canadá",          "cost_usd": 10.99},
            {"country_code": "DE", "name": "Alemanha",        "cost_usd": 11.99},
            {"country_code": "FR", "name": "França",          "cost_usd": 11.99},
        ],
    },
    "extra_costs": [
        # frequency: "monthly" | "per_order" | "annual"
        # {"name": "Armazenagem", "amount_usd": 500, "frequency": "monthly"},
    ],
}

with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS profit_settings (
            key     VARCHAR PRIMARY KEY,
            value   JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """))
    conn.execute(text("""
        INSERT INTO profit_settings (key, value)
        VALUES ('config', :val)
        ON CONFLICT (key) DO NOTHING
    """), {"val": json.dumps(DEFAULT_CONFIG)})
    conn.commit()

print("✅  profit_settings table ready with default config.")
