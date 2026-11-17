from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment for the collectors.

    Store credentials live in the tenants table, never here. The Facebook app
    id/secret are the default Meta app used to sign appsecret_proof for tokens
    it issued. The remaining optional fields are only read by old root
    scripts (test_connections.py, debug_*.py) and are kept so they still load.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str

    facebook_app_id: Optional[str] = None
    facebook_app_secret: Optional[str] = None

    # Legacy, single-store era (read only by root scripts).
    facebook_access_token: Optional[str] = None
    facebook_ad_account_id: Optional[str] = None
    shopify_store_url: Optional[str] = None
    shopify_access_token: Optional[str] = None
    shopify_api_version: str = "2026-10"
    anthropic_api_key: Optional[str] = None
    claude_model: str = "claude-sonnet-4-6"
    log_level: str = "INFO"


settings = Settings()
