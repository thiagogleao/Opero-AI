"""
Gera o Shopify Access Token via OAuth (roda uma vez só).
Execute: py -3.12 get_shopify_token.py
Depois visite a URL que aparecer no terminal.
"""

import os
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

import requests
from dotenv import load_dotenv, set_key

load_dotenv()

SHOP          = os.getenv("SHOPIFY_STORE_URL", "")
CLIENT_ID     = os.getenv("SHOPIFY_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")
REDIRECT_URI  = "http://localhost:3000/callback"
SCOPES        = "read_orders,read_all_orders,read_customers,read_products,read_checkouts,read_analytics"

result = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if "/callback" not in self.path:
            self.send_response(404)
            self.end_headers()
            return

        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        code = params.get("code")

        if not code:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Erro: code nao recebido.")
            return

        resp = requests.post(
            f"https://{SHOP}/admin/oauth/access_token",
            json={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code},
        )
        data = resp.json()
        token = data.get("access_token")

        if token:
            result["token"] = token
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<h1>Sucesso! Pode fechar esta aba.</h1>")
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(f"Erro: {data}".encode())

    def log_message(self, *args):
        pass  # silencia logs do servidor


def main():
    auth_url = (
        f"https://{SHOP}/admin/oauth/authorize"
        f"?client_id={CLIENT_ID}"
        f"&scope={SCOPES}"
        f"&redirect_uri={urllib.parse.quote(REDIRECT_URI, safe='')}"
    )

    print("\n" + "=" * 52)
    print("  Shopify — Gerador de Access Token")
    print("=" * 52)
    print("\nAbrindo o navegador para autorizar o app...")
    print(f"\nSe não abrir, acesse manualmente:\n{auth_url}\n")
    webbrowser.open(auth_url)
    print("Aguardando autorização...")

    server = HTTPServer(("localhost", 3000), Handler)
    while "token" not in result:
        server.handle_request()

    token = result["token"]
    set_key(".env", "SHOPIFY_ACCESS_TOKEN", token)

    print("\n" + "=" * 52)
    print("  Token salvo no .env com sucesso!")
    print(f"  {token[:20]}...")
    print("=" * 52)


if __name__ == "__main__":
    main()
