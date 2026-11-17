"""
A small Shopify Admin client on `requests`.

Replaces the ShopifyAPI library, which pinned versions it knew about (the last
one, 2024-07, is long out of support, so every call was silently served by
whatever Shopify falls forward to), turned a 401 into a generic exception the
token renewal never saw, and handed back resource objects that could not be
unit-tested. Here a call returns plain JSON and fails with a typed error.
"""

from __future__ import annotations

import logging
import time
from typing import Iterator, Optional

import requests

logger = logging.getLogger(__name__)

# One Admin API version for every Shopify call in the project. The TypeScript
# side uses the same value in frontend/lib/sync/shopifyApi.ts — change both.
# Shopify supports a version for about a year; bump this each January/July.
API_VERSION = "2026-10"

TIMEOUT = 30
MAX_RETRIES = 5


class ShopifyError(RuntimeError):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class ShopifyUnauthorized(ShopifyError):
    """401: the token is not accepted (revoked, expired, app recreated)."""


class ShopifyUnavailable(ShopifyError):
    """402/423/404 on the shop: suspended, locked or gone. Not our bug to retry."""


def _next_link(link_header: str) -> Optional[str]:
    """The rel="next" URL of a REST Link header, if any."""
    for part in (link_header or "").split(","):
        if 'rel="next"' in part:
            return part.split(";")[0].strip().strip("<>")
    return None


class ShopifyClient:
    def __init__(self, domain: str, token: str, version: str = API_VERSION,
                 http: Optional[requests.Session] = None):
        d = domain.replace("https://", "").replace("http://", "").strip("/")
        self.domain = d
        self.token = token
        self.version = version
        self.base = f"https://{d}/admin/api/{version}"
        self.http = http or requests.Session()

    # ── Transport ───────────────────────────────────────────────────────────

    def _request(self, method: str, url: str, **kw) -> requests.Response:
        headers = {"X-Shopify-Access-Token": self.token, "Accept": "application/json"}
        if "json" in kw:
            headers["Content-Type"] = "application/json"
        for attempt in range(MAX_RETRIES):
            try:
                r = self.http.request(method, url, headers=headers, timeout=TIMEOUT, **kw)
            except requests.RequestException as e:
                if attempt == MAX_RETRIES - 1:
                    raise ShopifyError(f"sem resposta da Shopify: {type(e).__name__}") from e
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After") or 2)
                logger.warning("[shopify] 429, aguardando %.1fs", wait)
                time.sleep(min(wait, 30))
                continue
            if r.status_code >= 500 and attempt < MAX_RETRIES - 1:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 401:
                raise ShopifyUnauthorized("a Shopify recusou o token (HTTP 401)", 401)
            if r.status_code in (402, 423):
                raise ShopifyUnavailable(f"loja indisponível na Shopify (HTTP {r.status_code})", r.status_code)
            if r.status_code >= 400:
                detail = r.text[:200].replace("\n", " ")
                raise ShopifyError(f"Shopify HTTP {r.status_code}: {detail}", r.status_code)
            return r
        raise ShopifyError("Shopify não respondeu depois de várias tentativas")

    # ── REST ────────────────────────────────────────────────────────────────

    def get(self, path: str, params: Optional[dict] = None) -> dict:
        r = self._request("GET", f"{self.base}/{path}", params=params or {})
        return r.json() if r.content else {}

    def paginate(self, path: str, key: str, params: Optional[dict] = None,
                 pause: float = 0.25) -> Iterator[dict]:
        """Every item of a paginated REST list. Shopify's cursor URL already
        carries the filters, so later pages are fetched by URL alone."""
        r = self._request("GET", f"{self.base}/{path}", params=params or {})
        while True:
            for item in (r.json() or {}).get(key, []) if r.content else []:
                yield item
            nxt = _next_link(r.headers.get("Link", ""))
            if not nxt:
                return
            time.sleep(pause)
            r = self._request("GET", nxt)

    # ── GraphQL ─────────────────────────────────────────────────────────────

    def graphql(self, query: str, variables: Optional[dict] = None,
                version: Optional[str] = None) -> dict:
        base = self.base if not version else f"https://{self.domain}/admin/api/{version}"
        r = self._request("POST", f"{base}/graphql.json", json={"query": query, "variables": variables or {}})
        body = r.json()
        if body.get("errors"):
            msg = body["errors"][0].get("message", "") if isinstance(body["errors"], list) else str(body["errors"])
            raise ShopifyError(f"GraphQL: {msg[:200]}")
        return body.get("data") or {}
