import { useEffect, useRef } from 'react'
import LanguageToggle from './LanguageToggle.jsx'
import { NavLink } from 'react-router-dom'
import { Activity, Globe, LayoutGrid, Map, PanelLeftClose, PanelLeftOpen, Search, ShieldAlert } from 'lucide-react'
import { publicUrl } from '../utils/publicUrl'
import { useI18n } from '../i18n/I18nProvider.jsx'

const CIEE_URL = 'https://www.ciee.unlp.edu.ar/'

export default function Sidebar({ onNavigate, collapsed = false, onToggle, mobile = false }) {
  const { tr } = useI18n()
  const redirectTimerRef = useRef(null)

  const clearRedirectTimer = () => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
  }

  const scheduleRedirect = () => {
    clearRedirectTimer()
    redirectTimerRef.current = setTimeout(() => {
      window.location.href = CIEE_URL
    }, 550)
  }

  useEffect(
    () => () => {
      clearRedirectTimer()
    },
    [],
  )

  const links = [
    { to: '/', label: tr('Centro de mision', 'Mission Hub'), hint: tr('Inicio', 'Landing'), Icon: LayoutGrid },
    { to: '/dashboard/analytics', label: tr('Analitica', 'Analytics'), hint: tr('Tendencias globales', 'Global trends'), Icon: Activity },
    { to: '/dashboard/map', label: tr('Mapa de reingresos', 'Reentry Map'), hint: tr('Mapa 2D + orbita 3D', '2D map + 3D orbit'), Icon: Map },
    { to: '/dashboard/orbit', label: tr('Monitor orbital', 'Orbit Monitor'), hint: tr('Globo 3D', '3D globe'), Icon: Globe },
    { to: '/dashboard/risk', label: tr('Riesgo', 'Risk'), hint: tr('Proximamente', 'Coming soon'), Icon: ShieldAlert },
    { to: '/dashboard/search', label: tr('Buscador', 'Search'), hint: tr('Objetos y debris', 'Objects and debris'), Icon: Search },
  ]

  const handleNavigate = () => onNavigate?.()

  if (collapsed && !mobile) {
    return (
      <aside className="glass h-full px-2 py-3 flex flex-col items-center gap-3 relative">
        <button
          type="button"
          onClick={onToggle}
          className="group relative inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition"
          aria-label={tr('Abrir menu lateral', 'Open sidebar menu')}
          title={tr('Abrir menu lateral', 'Open sidebar menu')}
        >
          <img
            src={publicUrl('/img/icono.png')}
            alt="CIEE"
            className="h-7 w-7 object-contain transition-opacity duration-150 group-hover:opacity-0"
          />
          <PanelLeftOpen className="absolute h-4 w-4 text-white/90 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        </button>

        <nav className="mt-2 flex flex-col items-center gap-2">
          {links.map((l) => {
            const Icon = l.Icon
            return (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={handleNavigate}
                title={l.label}
                className={({ isActive }) =>
                  `inline-flex items-center justify-center w-10 h-10 rounded-xl border transition ${
                    isActive
                      ? 'bg-white/12 border-white/20 text-white'
                      : 'bg-transparent border-transparent text-white/70 hover:bg-white/10 hover:border-white/15'
                  }`
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </NavLink>
            )
          })}
        </nav>
        <div className="absolute left-1 right-1 bottom-3 flex items-center justify-center">
          <LanguageToggle />
        </div>
      </aside>
    )
  }

  return (
    <aside className="glass h-full px-5 py-4 flex flex-col gap-4 min-w-[255px] max-w-[275px] relative">
      <div className="flex items-center gap-2 relative mt-1 mb-2">
        <img
          src={publicUrl('/img/logo-ciee.png')}
          alt="CIEE"
          className="h-8 w-auto object-contain cursor-pointer ml-2"
          onMouseEnter={scheduleRedirect}
          onMouseLeave={clearRedirectTimer}
          title={tr('Ir a CIEE', 'Go to CIEE')}
        />
        {!mobile ? (
          <button
            type="button"
            onClick={onToggle}
            className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/15 bg-white/5 text-white/85 hover:bg-white/10 transition"
            aria-label={tr('Ocultar menu lateral', 'Hide sidebar menu')}
            title={tr('Ocultar menu lateral', 'Hide sidebar menu')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-col gap-2 mt-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            onClick={handleNavigate}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2.5 border transition ${
                isActive
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-transparent border-white/10 text-white/90 hover:bg-white/5 hover:border-white/15'
              }`
            }
          >
            {({ isActive }) => {
              const Icon = l.Icon
              return (
                <div className="flex items-center gap-3">
                  <Icon
                    className={
                      isActive
                        ? 'h-5 w-5 text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.45)]'
                        : 'h-5 w-5 text-white/65'
                    }
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className={isActive ? 'text-sm font-bold text-white' : 'text-sm font-bold text-white/90'}>
                      {l.label}
                    </div>
                    {/* Subtítulo oculto cuando la sidebar está abierta */}
                    {/*
                    <div className={isActive ? 'text-xs text-cyan-100/75' : 'text-xs text-white/60'}>{l.hint}</div>
                    */}
                  </div>
                </div>
              )
            }}
          </NavLink>
        ))}
      </nav>

      {/* Info de datos eliminada por pedido del usuario */}
      <div className="absolute left-3 bottom-4">
        <LanguageToggle />
      </div>
    </aside>
  )
}
