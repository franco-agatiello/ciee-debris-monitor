import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { Languages } from 'lucide-react'

export default function LanguageToggle({ compact = false }) {
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
      className={`rounded-xl px-3 py-2.5 border transition bg-transparent border-white/10 text-white/90 hover:bg-white/5 hover:border-white/15 flex items-center justify-center ${compact ? 'w-10 h-10 p-0' : ''}`}
      aria-label={locale === 'es' ? 'Cambiar idioma a ingles' : 'Switch language to Spanish'}
      title={locale === 'es' ? 'Cambiar a EN' : 'Switch to ES'}
    >
      <Languages className="w-5 h-5" />
    </button>
  )
}
