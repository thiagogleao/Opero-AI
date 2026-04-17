export class ShopifyAdmin {
  private base: string
  private headers: Record<string, string>

  constructor(domain: string, accessToken: string) {
    const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    this.base = `https://${clean}/admin/api/2024-01`
    this.headers = {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    }
  }

  async get(path: string) {
    const res = await fetch(`${this.base}${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async post(path: string, body: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST', headers: this.headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async put(path: string, body: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PUT', headers: this.headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async delete(path: string) {
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE', headers: this.headers })
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    return res.status === 200 ? res.json() : { success: true }
  }
}
