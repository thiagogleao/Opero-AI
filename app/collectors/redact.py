"""
Scrub secrets out of text that is about to be stored or shown.

Error text reaches sync_runs.error_message, and from there the refresh panel of
any partner who can see that store. A `requests` connection error prints the
whole Graph URL — access_token and appsecret_proof included — and two rows in
production carried a full Meta token that way. Everything written to
sync_runs goes through `redact` first.
"""

import re

# Query-string parameters whose value is a credential.
_SECRET_PARAMS = re.compile(
    r"(?i)\b(access_token|appsecret_proof|client_secret|client_id|token|password|key)=([^&\s'\"]+)"
)
# Meta user/system tokens start with EAA; Shopify Admin tokens with shpat_/shpca_/shpss_.
_META_TOKEN = re.compile(r"\bEAA[A-Za-z0-9]{20,}")
_SHOPIFY_TOKEN = re.compile(r"\bshp(?:at|ca|ss|ua)_[A-Za-z0-9]{10,}")
# Header-style leaks: "X-Shopify-Access-Token: ..." / "Authorization: Bearer ...".
_HEADER = re.compile(r"(?i)(x-shopify-access-token|authorization)(['\"]?\s*[:=]\s*['\"]?)(?:bearer\s+)?[^\s,'\"}]+")

MAX_LEN = 600


def redact(text: object, max_len: int = MAX_LEN) -> str:
    """Return `text` with credentials masked and the length bounded."""
    s = "" if text is None else str(text)
    s = _SECRET_PARAMS.sub(lambda m: f"{m.group(1)}=***", s)
    s = _META_TOKEN.sub("EAA***", s)
    s = _SHOPIFY_TOKEN.sub("shp***", s)
    s = _HEADER.sub(lambda m: f"{m.group(1)}{m.group(2)}***", s)
    # Collapse whitespace: the Graph SDK error is a multi-line block, and the
    # panel shows one line.
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[: max_len - 1] + "…"
    return s
