import type { Currency } from '@/contexts/SettingsContext'

const CURRENCY_META: Record<Currency, { locale: string; symbol: string }> = {
  USD: { locale: 'en-US', symbol: '$'  },
  BRL: { locale: 'pt-BR', symbol: 'R$' },
  EUR: { locale: 'de-DE', symbol: '€'  },
  GBP: { locale: 'en-GB', symbol: '£'  },
}

export function makeFmt(currency: Currency) {
  const { locale, symbol } = CURRENCY_META[currency] ?? CURRENCY_META.USD
  return (n: number) => {
    const abs = Math.abs(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${n < 0 ? '-' : ''}${symbol}${abs}`
  }
}

export function currencySymbol(currency: Currency): string {
  return (CURRENCY_META[currency] ?? CURRENCY_META.USD).symbol
}
