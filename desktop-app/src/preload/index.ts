import { contextBridge, ipcRenderer } from 'electron'

export type StoreStats = {
  tenantId: string; displayName: string; domain: string
  orders: number; revenue: number; cogs: number; fees: number
  fbSpend: number; profit: number; margin: number; configured: boolean
}

export type DailyPoint = { date: string; revenue: number; profit: number; fbSpend: number }
export type Alert = { level: 'error' | 'warning' | 'info'; store: string; message: string }
export type Tenant = { id: string; shopify_domain: string; display_name: string; timezone: string }

contextBridge.exposeInMainWorld('api', {
  testConnection: (): Promise<boolean> => ipcRenderer.invoke('test-connection'),
  getTenants: (): Promise<Tenant[]> => ipcRenderer.invoke('get-tenants'),
  getStoreStats: (tenantId: string, from: string, to: string): Promise<StoreStats> =>
    ipcRenderer.invoke('get-store-stats', tenantId, from, to),
  getAllStoresStats: (from: string, to: string): Promise<StoreStats[]> =>
    ipcRenderer.invoke('get-all-stores-stats', from, to),
  getDailyData: (tenantId: string, days: number): Promise<DailyPoint[]> =>
    ipcRenderer.invoke('get-daily-data', tenantId, days),
  getAlerts: (): Promise<Alert[]> => ipcRenderer.invoke('get-alerts'),
  getState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('get-state'),
  setState: (data: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('set-state', data),
  openUrl: (url: string): Promise<void> => ipcRenderer.invoke('open-url', url),
  refreshCache: (): Promise<void> => ipcRenderer.invoke('refresh-cache'),
})

declare global {
  interface Window {
    api: {
      testConnection(): Promise<boolean>
      getTenants(): Promise<Tenant[]>
      getStoreStats(tenantId: string, from: string, to: string): Promise<StoreStats>
      getAllStoresStats(from: string, to: string): Promise<StoreStats[]>
      getDailyData(tenantId: string, days: number): Promise<DailyPoint[]>
      getAlerts(): Promise<Alert[]>
      getState(): Promise<Record<string, unknown>>
      setState(data: Record<string, unknown>): Promise<void>
      openUrl(url: string): Promise<void>
      refreshCache(): Promise<void>
    }
  }
}
