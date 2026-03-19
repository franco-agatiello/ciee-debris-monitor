import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, ArrowRight, Globe, LayoutGrid, Map, ShieldAlert } from 'lucide-react'
import { publicUrl } from '../utils/publicUrl'
import { useI18n } from '../i18n/I18nProvider.jsx'

const CIEE_URL = 'https://www.ciee.unlp.edu.ar/'

export default function LandingPage() {
  const navigate = useNavigate()
  const { tr } = useI18n()

  const cards = useMemo(
    () => [
      {
        key: 'analytics',
        Icon: Activity,
        title: tr('Analitica', 'Analytics'),
        subtitle: tr('Tendencias y metricas globales', 'Global trends and metrics'),
        to: '/dashboard/analytics',
        accent: 'from-cyan-400/25 to-cyan-300/5',
        iconTone: 'text-cyan-100',
      },
      {
        key: 'map',
        Icon: Map,
        title: tr('Mapa de reingresos', 'Reentry Map'),
        subtitle: tr('Eventos, impacto y traza orbital', 'Events, impact and orbital trace'),
        to: '/dashboard/map',
        accent: 'from-blue-400/25 to-blue-300/5',
        iconTone: 'text-blue-100',
      },
      {
        key: 'orbit',
        Icon: Globe,
        title: tr('Monitor orbital', 'Orbit Monitor'),
        subtitle: tr('Vigilancia 3D del catalogo activo', '3D active catalog surveillance'),
        to: '/dashboard/orbit',
        accent: 'from-emerald-400/25 to-emerald-300/5',
        iconTone: 'text-emerald-100',
      },
      {
        key: 'risk',
        Icon: ShieldAlert,
        title: tr('Riesgo', 'Risk'),
        subtitle: tr('Conjuncion y colision', 'Conjunction and collision'),
        to: '/dashboard/risk',
        accent: 'from-red-400/25 to-red-300/5',
        iconTone: 'text-red-100',
      },
    ],
    [tr],
  )

  return (
    <motion.div
      className="min-h-screen w-full bg-[#02040a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-[#02040a] to-[#02040a]"
      style={{ willChange: 'transform, opacity' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.5, filter: 'blur(10px)' }}
      transition={{ duration: 0.42, ease: [0.43, 0.13, 0.23, 0.96] }}
    >
      <div className="min-h-screen w-full px-6 py-10 flex items-center justify-center">
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex flex-col items-center text-center">
            <img
              src={publicUrl('/img/logo-ciee.png')}
              alt="CIEE"
              className="h-14 md:h-16 w-auto cursor-pointer"
              onMouseEnter={() => {
                window.location.href = CIEE_URL
              }}
              title={tr('Ir a CIEE', 'Go to CIEE')}
            />

            <h1 className="mt-5 text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              {tr('Selecciona un modulo', 'Select a module')}
            </h1>
            <p className="mt-2 text-sm md:text-base text-white/65 max-w-2xl">
              {tr('Acceso directo a los componentes operativos.', 'Direct access to operational modules.')}
            </p>

            <div className="mt-4 text-[11px] px-2 py-1 rounded-full border border-cyan-300/30 bg-cyan-400/10 text-cyan-100/85 mono uppercase tracking-wider">
              {tr('Centro de mision', 'Mission hub')}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cards.map((c) => (
              <motion.button
                key={c.key}
                type="button"
                onClick={() => navigate(c.to)}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="relative overflow-hidden text-left rounded-2xl p-5 border border-white/10 bg-black/40 hover:bg-black/55 hover:border-white/20 transition will-change-transform"
              >
                <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${c.accent}`} />

                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/15 bg-white/5">
                    <c.Icon className={`h-5 w-5 ${c.iconTone}`} />
                  </div>
                  <ArrowRight className="h-4 w-4 text-cyan-100/70 mt-0.5" />
                </div>

                <h2 className="mt-4 text-xl font-bold tracking-tight text-white">{c.title}</h2>
                <p className="mt-1.5 text-sm text-white/65 leading-relaxed">{c.subtitle}</p>
              </motion.button>
            ))}
          </div>

          <div className="mt-6 text-center text-xs text-gray-200/55">
            <span className="mono">CIEE</span> · {tr('Interfaz operativa', 'Operational interface')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
