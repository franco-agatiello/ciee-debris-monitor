import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'

export default function LanguageToggle() {
  const { locale, toggleLocale } = useI18n()
  const location = useLocation()
  const [isFullscreen, setIsFullscreen] = useState(false)

  const isDashboard = location.pathname.startsWith('/dashboard')

  useEffect(() => {
    const onChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      setIsFullscreen(Boolean(fsEl))
    }

    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    onChange()

    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  if (isFullscreen) return null

  return (
    <button
      type="button"
      onClick={toggleLocale}
      className={`fixed z-[100000] px-3 py-1.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-[11px] font-bold tracking-wide text-white/90 hover:bg-black/65 transition ${
        isDashboard ? 'bottom-4 right-4 md:bottom-6 md:right-6' : 'top-3 right-3'
      }`}
      aria-label={locale === 'es' ? 'Cambiar idioma a ingles' : 'Switch language to Spanish'}
      title={locale === 'es' ? 'Cambiar a EN' : 'Switch to ES'}
    >
      {locale === 'es' ? 'ES | EN' : 'EN | ES'}
    </button>
  )
}
