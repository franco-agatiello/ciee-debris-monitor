import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const I18nContext = createContext(null)

function normalizeLocale(value) {
  return value === 'en' ? 'en' : 'es'
}

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(() => {
    try {
      const stored = localStorage.getItem('app.locale')
      if (stored) return normalizeLocale(stored)
    } catch {
      // ignore
    }
    return 'es'
  })

  useEffect(() => {
    try {
      localStorage.setItem('app.locale', locale)
    } catch {
      // ignore
    }
    document.documentElement.lang = locale === 'en' ? 'en' : 'es'
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale: () => setLocale((v) => (v === 'es' ? 'en' : 'es')),
      tr: (esText, enText) => (locale === 'es' ? esText : enText),
    }),
    [locale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
