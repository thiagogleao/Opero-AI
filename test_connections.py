"""
Test script to verify Facebook Ads and Shopify API credentials are working.
Run with: python test_connections.py
"""

import sys
from dotenv import load_dotenv

load_dotenv()


def test_facebook_connection() -> bool:
    print("\n[Facebook Ads] Testing connection...")
    try:
        from facebook_business.api import FacebookAdsApi
        from facebook_business.adobjects.adaccount import AdAccount
        from app.config import settings

        FacebookAdsApi.init(
            app_id=settings.facebook_app_id,
            app_secret=settings.facebook_app_secret,
            access_token=settings.facebook_access_token,
        )

        account = AdAccount(settings.facebook_ad_account_id)
        info = account.api_get(fields=["name", "currency", "account_status"])

        print(f"  Account name   : {info.get('name')}")
        print(f"  Currency       : {info.get('currency')}")
        print(f"  Account status : {info.get('account_status')}")
        print("  [OK] Facebook Ads connection successful")
        return True

    except ImportError as e:
        print(f"  [ERROR] Missing dependency: {e}")
        print("  Run: pip install -r requirements.txt")
        return False
    except Exception as e:
        print(f"  [FAIL] Facebook Ads connection failed: {e}")
        return False


def test_shopify_connection() -> bool:
    print("\n[Shopify] Testing connection...")
    try:
        import shopify
        from app.config import settings

        shop_url = f"https://{settings.shopify_store_url}"
        api_version = settings.shopify_api_version

        session = shopify.Session(shop_url, api_version, settings.shopify_access_token)
        shopify.ShopifyResource.activate_session(session)

        shop = shopify.Shop.current()

        print(f"  Shop name      : {shop.name}")
        print(f"  Domain         : {shop.domain}")
        print(f"  Currency       : {shop.currency}")
        print(f"  Plan           : {shop.plan_name}")
        print("  [OK] Shopify connection successful")
        return True

    except ImportError as e:
        print(f"  [ERROR] Missing dependency: {e}")
        print("  Run: pip install -r requirements.txt")
        return False
    except Exception as e:
        print(f"  [FAIL] Shopify connection failed: {e}")
        return False


def test_anthropic_connection() -> bool:
    print("\n[Anthropic] Testing connection...")
    try:
        import anthropic
        from app.config import settings

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        message = client.messages.create(
            model=settings.claude_model,
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with: OK"}],
        )

        reply = message.content[0].text.strip()
        print(f"  Model          : {settings.claude_model}")
        print(f"  Response       : {reply}")
        print("  [OK] Anthropic connection successful")
        return True

    except ImportError as e:
        print(f"  [ERROR] Missing dependency: {e}")
        print("  Run: pip install -r requirements.txt")
        return False
    except Exception as e:
        print(f"  [FAIL] Anthropic connection failed: {e}")
        return False


def main():
    print("=" * 50)
    print("  AdAnalyzer — Connection Tests")
    print("=" * 50)

    results = {
        "Facebook Ads": test_facebook_connection(),
        "Shopify": test_shopify_connection(),
        "Anthropic": test_anthropic_connection(),
    }

    print("\n" + "=" * 50)
    print("  Summary")
    print("=" * 50)

    all_passed = True
    for service, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {service:<15} {status}")
        if not passed:
            all_passed = False

    print("=" * 50)

    if all_passed:
        print("  All connections OK. Ready to go!")
        sys.exit(0)
    else:
        print("  Fix the failing connections above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
