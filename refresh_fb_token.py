"""
Converte o token de curta duração do Facebook para longa duração (60 dias)
e salva automaticamente no .env.

Usage:
  python refresh_fb_token.py                      # usa token do .env
  python refresh_fb_token.py SEU_TOKEN_CURTO      # usa token passado como argumento
"""

import os
import re
import sys
import requests
from dotenv import load_dotenv

# Fix Windows terminal encoding
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv()

APP_ID     = os.getenv("FACEBOOK_APP_ID", "")
APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")

# Accept token from command-line argument or .env
if len(sys.argv) > 1:
    TOKEN = sys.argv[1].strip()
else:
    TOKEN = os.getenv("FACEBOOK_ACCESS_TOKEN", "")

if not all([APP_ID, APP_SECRET, TOKEN]):
    print("ERRO: Faltam FACEBOOK_APP_ID, FACEBOOK_APP_SECRET ou token no .env")
    sys.exit(1)


def debug_token(token: str) -> dict:
    r = requests.get(
        "https://graph.facebook.com/debug_token",
        params={
            "input_token": token,
            "access_token": f"{APP_ID}|{APP_SECRET}",
        },
        timeout=10,
    )
    return r.json().get("data", {})


def exchange_for_long_lived(short_token: str) -> str:
    r = requests.get(
        "https://graph.facebook.com/oauth/access_token",
        params={
            "grant_type":        "fb_exchange_token",
            "client_id":         APP_ID,
            "client_secret":     APP_SECRET,
            "fb_exchange_token": short_token,
        },
        timeout=10,
    )
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"]["message"])
    return data["access_token"]


def save_token_to_env(new_token: str, env_path: str = ".env"):
    with open(env_path, "r", encoding="utf-8") as f:
        content = f.read()

    new_content = re.sub(
        r"^FACEBOOK_ACCESS_TOKEN=.*$",
        f"FACEBOOK_ACCESS_TOKEN={new_token}",
        content,
        flags=re.MULTILINE,
    )

    if new_content == content:
        new_content = content.rstrip() + f"\nFACEBOOK_ACCESS_TOKEN={new_token}\n"

    with open(env_path, "w", encoding="utf-8") as f:
        f.write(new_content)


def main():
    import datetime

    print("=" * 52)
    print("  Facebook Token Manager")
    print("=" * 52)

    print("\n  Verificando token...")
    info = debug_token(TOKEN)

    if not info:
        print("ERRO: Nao foi possivel verificar o token.")
        sys.exit(1)

    is_valid   = info.get("is_valid", False)
    token_type = info.get("type", "unknown")
    expires_at = info.get("expires_at", 0)

    if expires_at:
        exp_dt    = datetime.datetime.fromtimestamp(expires_at)
        days_left = (exp_dt - datetime.datetime.now()).days
        print(f"   Tipo   : {token_type}")
        print(f"   Valido : {'sim' if is_valid else 'nao'}")
        print(f"   Expira : {exp_dt.strftime('%d/%m/%Y %H:%M')} ({days_left} dias restantes)")
    else:
        print(f"   Tipo   : {token_type}")
        print(f"   Valido : {'sim (sem expiracao)' if is_valid else 'nao'}")

    if not is_valid:
        print("\nERRO: Token invalido. Gere um novo no Graph API Explorer.")
        sys.exit(1)

    if expires_at and days_left > 7:
        # Still valid — but if a new short-lived token was passed, exchange it anyway
        if len(sys.argv) > 1:
            print(f"\n  Token do .env ainda valido ({days_left} dias). Convertendo token novo...")
        else:
            print(f"\n  OK - Token valido por mais {days_left} dias. Nada a fazer.")
            return

    print("\n  Convertendo para token de longa duracao (60 dias)...")
    try:
        new_token = exchange_for_long_lived(TOKEN)
    except RuntimeError as e:
        print(f"ERRO ao converter: {e}")
        sys.exit(1)

    new_info    = debug_token(new_token)
    new_expires = new_info.get("expires_at", 0)
    if new_expires:
        new_exp_dt = datetime.datetime.fromtimestamp(new_expires)
        new_days   = (new_exp_dt - datetime.datetime.now()).days
        print(f"   Novo token expira: {new_exp_dt.strftime('%d/%m/%Y')} ({new_days} dias)")

    save_token_to_env(new_token)
    print("\n  Token salvo no .env com sucesso!")
    print("  Proxima coleta vai usar o novo token automaticamente.")
    print("=" * 52)


if __name__ == "__main__":
    main()
