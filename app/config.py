from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database (required)
    database_url: str

    # Facebook Ads — optional, used as fallback when no tenant credentials in DB
    facebook_access_token: Optional[str] = None
    facebook_ad_account_id: Optional[str] = None
    facebook_app_id: Optional[str] = None
    facebook_app_secret: Optional[str] = None

    # Shopify — optional, used as fallback when no tenant credentials in DB
    shopify_store_url: Optional[str] = None
    shopify_access_token: Optional[str] = None
    shopify_client_id: Optional[str] = None
    shopify_client_secret: Optional[str] = None
    shopify_api_version: str = "2024-01"

    # Anthropic
    anthropic_api_key: Optional[str] = None
    claude_model: str = "claude-sonnet-4-6"

    # App
    app_env: str = "production"
    log_level: str = "INFO"


settings = Settings()
