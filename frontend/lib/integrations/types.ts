/**
 * Response shapes of the integration APIs (stores, Shopify, Facebook). Types
 * only, so client components can import them without pulling server code.
 *
 * None of these carries a token, a secret or a client secret: credentials stay
 * in the database and only their presence and health are reported.
 */

export type ShopifyConnection =
  /** Dev Dashboard app: client id + secret stored, 24h token re-minted by the collector. */
  | 'dev_dashboard'
  /** A permanent Admin API token (Partners-app OAuth or a pasted shpat_). */
  | 'token'
  | 'none'

export interface StoreSummary {
  id: string
  /** Shop name, disambiguated when two stores share one ("Dumpling Squishy · 8jcp3a"). */
  name: string
  shopName: string
  domain: string | null
  /** From Shopify, rewritten by the collector on every sync: read-only here. */
  timezone: string
  /** The Shopify store's currency (Hibikura: JPY). Opero shows US dollars. */
  currency: string | null
  archived: boolean
  archivedAt: string | null
  onboarded: boolean
  createdAt: string
  shopify: {
    connected: boolean
    connection: ShopifyConnection
    /** Dev Dashboard stores only: when the current 24h token expires. */
    tokenExpiresAt: string | null
  }
  facebook: {
    /** The store has a main Facebook token. */
    connected: boolean
    mainAdAccountId: string | null
    /** Extra ad accounts linked to the store (paused ones included). */
    extraAccounts: number
    activeExtraAccounts: number
  }
}

/** One ad account of a store, as listed in Settings. */
export interface StoreAdAccount {
  /** tenant_fb_accounts.id for extra accounts (use it in PATCH/DELETE); null otherwise. */
  id: number | null
  adAccountId: string
  /** main: tenants.fb_ad_account_id. extra: tenant_fb_accounts. historical: no
   *  longer linked, but its past spend is still in this store's books. */
  role: 'main' | 'extra' | 'historical'
  nickname: string | null
  /** Being collected now. Pausing an extra account stops collection only. */
  syncing: boolean
  hasToken: boolean
  /** Spend recorded under this store for this account in the last 30 days (USD). */
  spend30d: number
  lastSpendDate: string | null
}

/** Legacy shape of GET /api/facebook/extra-accounts `accounts` (extras only). */
export interface ExtraFbAccount {
  id: number
  tenant_id: string
  fb_ad_account_id: string
  nickname: string | null
  is_active: boolean
  created_at: string
}

/** An ad account offered in the picker. */
export interface PickerAdAccount {
  id: string
  name: string
  accountStatus: number
  /** account_status === 1. Disabled accounts are not collected. */
  active: boolean
  /** Already linked to this store, and how. */
  attachedHere: 'main' | 'extra' | null
  /** Linked to some other store (cannot be linked here). */
  attachedElsewhere: boolean
  /** That store's name, only when the viewer can see it. */
  attachedElsewhereTo: string | null
}

export interface FacebookTokenInfo {
  valid: boolean
  type: string | null
  expiresAt: string | null
  neverExpires: boolean
}

export interface FacebookPicker {
  storeId: string
  storeName: string
  /** pending: the token from the OAuth just completed. store: the store's own token. */
  source: 'pending' | 'store'
  /** pending only: what the OAuth was started for. */
  mode: 'main' | 'extra' | null
  accounts: PickerAdAccount[]
  /** pending only: the new token's type and expiry, and whether linking it
   *  would replace a permanent (system-user) token. */
  tokenInfo: (FacebookTokenInfo & { replacesPermanent: boolean }) | null
}

export type ShopifyTokenStatus = 'ok' | 'invalid' | 'missing' | 'error' | 'unreachable' | 'expired'

export interface StoreShopifyHealth {
  id: string
  name: string
  domain: string | null
  archived: boolean
  connection: ShopifyConnection
  /** Short hash of the stored token, to tell two tokens apart. Never the token. */
  fingerprint: string | null
  status: ShopifyTokenStatus
  httpStatus: number | null
  tokenExpiresAt: string | null
  missingScopes: { handle: string; why: string }[]
  scopeCount: number
  lastSync: SyncStatus | null
}

export interface SyncStatus {
  /** Latest run of this source for the store. */
  status: string
  at: string
  /** Last success in the last 7 days. */
  lastSuccessAt: string | null
  /** Error runs in the last 24h. */
  errors24h: number
  /** Short, sanitized message of the latest error in the last 24h. */
  lastError: string | null
}

export interface AdAccountHealth {
  adAccountId: string
  role: 'main' | 'extra'
  syncing: boolean
  name: string | null
  accountStatus: number | null
  /** The account's token can read it right now. */
  readable: boolean
  tokenInfo: FacebookTokenInfo | null
  /** Collector errors in the last 24h that name this account. */
  errors24h: number
  lastError: string | null
}

export interface StoreFacebookHealth {
  storeId: string
  storeName: string
  checkedAt: string
  lastSync: SyncStatus | null
  accounts: AdAccountHealth[]
}
