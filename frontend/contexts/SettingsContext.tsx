'use client'
import { createContext, useContext, useEffect, useState } from 'react'

export type Theme         = 'dark' | 'light'
export type Language      = 'pt' | 'en' | 'es'
export type Currency      = 'USD' | 'BRL' | 'EUR' | 'GBP'
export type DateFormat    = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
export type AttributionWindow = '1d' | '7d' | '28d'

export interface KpiGoals {
  targetRoas:       number
  targetMargin:     number
  targetDailyRevenue: number
  targetCac:        number
}

export interface AlertSettings {
  roasDropEnabled:  boolean
  roasDropThreshold: number
  spendSpikeEnabled: boolean
  spendSpikeThreshold: number
  marginDropEnabled: boolean
  marginDropThreshold: number
}

export interface Settings {
  theme:             Theme
  language:          Language
  currency:          Currency
  dateFormat:        DateFormat
  attributionWindow: AttributionWindow
  storeName:         string
  storeUrl:          string
  timezone:          string
  goals:             KpiGoals
  alerts:            AlertSettings
}

interface SettingsCtx extends Settings {
  setTheme:             (t: Theme)             => void
  setLanguage:          (l: Language)          => void
  setCurrency:          (c: Currency)          => void
  setDateFormat:        (f: DateFormat)        => void
  setAttributionWindow: (w: AttributionWindow) => void
  setStoreName:         (s: string)            => void
  setStoreUrl:          (s: string)            => void
  setTimezone:          (s: string)            => void
  setGoals:             (g: Partial<KpiGoals>) => void
  setAlerts:            (a: Partial<AlertSettings>) => void
}

const defaults: Settings = {
  theme: 'dark', language: 'pt', currency: 'USD',
  dateFormat: 'DD/MM/YYYY', attributionWindow: '7d',
  storeName: '', storeUrl: '', timezone: 'America/Sao_Paulo',
  goals: { targetRoas: 2.0, targetMargin: 20, targetDailyRevenue: 0, targetCac: 0 },
  alerts: { roasDropEnabled: true, roasDropThreshold: 1.5, spendSpikeEnabled: false, spendSpikeThreshold: 200, marginDropEnabled: true, marginDropThreshold: 10 },
}

const Ctx = createContext<SettingsCtx>({
  ...defaults,
  setTheme: () => {}, setLanguage: () => {}, setCurrency: () => {},
  setDateFormat: () => {}, setAttributionWindow: () => {},
  setStoreName: () => {}, setStoreUrl: () => {}, setTimezone: () => {},
  setGoals: () => {}, setAlerts: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('opero_settings')
      if (saved) setSettings({ ...defaults, ...JSON.parse(saved) })
    } catch {}
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem('opero_settings', JSON.stringify(settings))
    document.documentElement.setAttribute('data-theme', settings.theme)
    // Write cookies so server components can read language/theme
    const maxAge = 'max-age=31536000; path=/'
    document.cookie = `opero_lang=${settings.language}; ${maxAge}`
    document.cookie = `opero_theme=${settings.theme}; ${maxAge}`
  }, [settings, mounted])

  function setTheme(theme: Theme)                         { setSettings(s => ({ ...s, theme })) }
  function setLanguage(language: Language)                 { setSettings(s => ({ ...s, language })) }
  function setCurrency(currency: Currency)                 { setSettings(s => ({ ...s, currency })) }
  function setDateFormat(dateFormat: DateFormat)           { setSettings(s => ({ ...s, dateFormat })) }
  function setAttributionWindow(attributionWindow: AttributionWindow) { setSettings(s => ({ ...s, attributionWindow })) }
  function setStoreName(storeName: string)                 { setSettings(s => ({ ...s, storeName })) }
  function setStoreUrl(storeUrl: string)                   { setSettings(s => ({ ...s, storeUrl })) }
  function setTimezone(timezone: string)                   { setSettings(s => ({ ...s, timezone })) }
  function setGoals(g: Partial<KpiGoals>)                  { setSettings(s => ({ ...s, goals: { ...s.goals, ...g } })) }
  function setAlerts(a: Partial<AlertSettings>)            { setSettings(s => ({ ...s, alerts: { ...s.alerts, ...a } })) }

  return (
    <Ctx.Provider value={{ ...settings, setTheme, setLanguage, setCurrency, setDateFormat, setAttributionWindow, setStoreName, setStoreUrl, setTimezone, setGoals, setAlerts }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() { return useContext(Ctx) }
