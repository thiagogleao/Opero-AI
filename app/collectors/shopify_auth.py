"""
Token de Admin API da Shopify para apps do Dev Dashboard.

Desde 1 de janeiro de 2026 a Shopify nao deixa mais criar app pelo admin da
loja, e o app do Dev Dashboard nao tem token para copiar: ele e pedido pelo
"client credentials grant" e vale 24 horas. Entao o token deixa de ser uma
credencial guardada e passa a ser algo descartavel que se renova.

As lojas antigas continuam com token legado permanente. Quando a loja nao tem
`shopify_client_id`, este modulo devolve o token guardado sem tocar em nada —
e por isso que MOKOO, EPOCH e Dumpling nao mudam de comportamento.

Exige que o app e a loja estejam na mesma organizacao da Shopify.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Renova antes de vencer. O sync roda a cada 10 min, entao uma hora de folga e
# de sobra e evita renovar a cada passada.
MARGEM = timedelta(hours=1)

TIMEOUT = 20


class ShopifyAuthError(RuntimeError):
    pass


def _pedir_token(dominio: str, client_id: str, client_secret: str) -> tuple[str, str, int]:
    """Troca client id + secret por um token. Devolve (token, escopos, segundos).

    A Shopify documenta este endpoint somente com corpo form-encoded; nao se
    manda `scope` — ela ignora, e o token sempre vem com os escopos que a loja
    concedeu na instalacao.
    """
    url = f"https://{dominio}/admin/oauth/access_token"
    try:
        r = requests.post(
            url,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise ShopifyAuthError(f"nao consegui falar com {dominio}: {e}") from e

    try:
        corpo = r.json()
    except ValueError:
        corpo = {}

    token = corpo.get("access_token")
    if r.status_code != 200 or not token:
        motivo = corpo.get("error_description") or corpo.get("error") or r.text[:200]
        dica = ""
        texto = str(motivo).lower()
        if "not installed" in texto or "app_not_installed" in texto:
            dica = " — instale o app na loja (Dev Dashboard > app > Installs > Install app)"
        elif "shop_not_permitted" in texto:
            dica = " — app e loja estao em organizacoes diferentes da Shopify"
        raise ShopifyAuthError(f"a Shopify recusou o token (HTTP {r.status_code}): {motivo}{dica}")

    return token, corpo.get("scope", "") or "", int(corpo.get("expires_in") or 0)


def ensure_token(session: Session, creds: dict) -> Optional[str]:
    """Devolve um token de Admin API usavel para esta loja, ou None.

    - Loja com token legado (sem `shopify_client_id`): devolve o que esta
      guardado, sem nenhuma chamada de rede.
    - Loja de app do Dev Dashboard: renova quando o token guardado nao existe
      ou esta perto de vencer, grava o novo no banco e devolve.

    O token novo fica em `tenants.shopify_access_token` de proposito: o resto
    do sistema (alertas, jornadas, ajustes, no TypeScript) le essa coluna
    direto, e como o sync da Shopify passa a cada 10 minutos, o que esta
    gravado nunca fica velho. Assim nenhum desses consumidores precisa saber
    que o token virou descartavel.
    """
    dominio = creds.get("shopify_domain")
    guardado = creds.get("shopify_access_token")
    client_id = creds.get("shopify_client_id")
    client_secret = creds.get("shopify_client_secret")

    if not client_id or not client_secret:
        return guardado  # loja de token legado: nada a fazer

    if not dominio:
        raise ShopifyAuthError("a loja tem client id/secret mas nao tem shopify_domain")

    vence = creds.get("shopify_token_expires_at")
    agora = datetime.now(timezone.utc)
    if guardado and vence is not None:
        if vence.tzinfo is None:
            vence = vence.replace(tzinfo=timezone.utc)
        if vence - agora > MARGEM:
            return guardado  # ainda bom

    token, escopos, segundos = _pedir_token(dominio, client_id, client_secret)
    expira = agora + timedelta(seconds=segundos or 86399)

    session.execute(
        text(
            "UPDATE tenants SET shopify_access_token = :tok, "
            "shopify_token_expires_at = :exp, updated_at = now() WHERE id = :tid"
        ),
        {"tok": token, "exp": expira, "tid": creds.get("id")},
    )
    session.commit()

    # Deixa rastro do que a loja concedeu: escopo faltando nao da erro na
    # Shopify, ela so devolve lista vazia, e sem isso a falha fica invisivel.
    logger.info(
        "[shopify-auth] token novo para %s, vence em %s (escopos: %s)",
        dominio, expira.isoformat(timespec="seconds"), escopos or "nao informados",
    )
    if escopos:
        concedidos = {s.strip() for s in escopos.split(",") if s.strip()}
        def cobre(s: str) -> bool:
            return s in concedidos or (
                s.startswith("read_") and s != "read_all_orders"
                and ("write_" + s[5:]) in concedidos
            )
        falta = [s for s in ("read_orders", "read_all_orders", "read_products", "read_checkouts")
                 if not cobre(s)]
        if falta:
            logger.warning("[shopify-auth] %s sem os escopos %s", dominio, ", ".join(falta))

    # Mantem o dict em memoria coerente com o banco para o resto desta rodada.
    creds["shopify_access_token"] = token
    creds["shopify_token_expires_at"] = expira
    return token
