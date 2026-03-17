import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { publicUrl } from '../utils/publicUrl'
import { useI18n } from '../i18n/I18nProvider.jsx'

function glowStyle(rgba) {
  return {
    boxShadow: `0 0 0 1px rgba(255,255,255,0.06), 0 0 34px ${rgba}, 0 0 72px rgba(0,0,0,0.25)`,
  }
}

export default function LandingPage() {
  const navigate = useNavigate()
  const { tr } = useI18n()

  const cards = useMemo(
    () => [
      {
        key: 'analytics',
        title: tr('Analitica', 'Analytics'),
        subtitle: tr('Tendencias e insights globales', 'Global insights & trends'),
        to: '/dashboard/analytics',
        border: 'border-purple-500/40',
        glow: glowStyle('rgba(168,85,247,0.35)'),
      },
      {
        key: 'map',
        title: tr('Mapa de reingresos', 'Reentry Map'),
        subtitle: tr('Eventos de reingreso de alta fidelidad', 'High-fidelity reentry events'),
        to: '/dashboard/map',
        border: 'border-blue-500/40',
        glow: glowStyle('rgba(59,130,246,0.35)'),
      },
      {
        key: 'orbit',
        title: tr('Monitor orbital', 'Orbit Monitor'),
        subtitle: tr('Globo 3D · vigilancia de catalogo', '3D globe · catalog watch'),
        to: '/dashboard/orbit',
        border: 'border-emerald-500/40',
        glow: glowStyle('rgba(16,185,129,0.35)'),
      },
      {
        key: 'risk',
        title: tr('Riesgo', 'Risk'),
        subtitle: tr('Riesgo de conjuncion y colision', 'Conjunction & collision risk'),
        to: '/dashboard/risk',
        border: 'border-red-500/40',
        glow: glowStyle('rgba(239,68,68,0.35)'),
      },
    ],
    [tr]
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
      <div className="min-h-screen w-full flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl">
          <div className="flex flex-col items-center text-center">
            <img src={publicUrl('/img/logo-ciee.png')} alt="CIEE" className="h-32 w-auto" />
            <div className="mt-6 text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              {tr('Suite de conciencia situacional espacial', 'Space Situational Awareness Suite')}
            </div>
            <div className="mt-3 text-sm text-gray-200/80 mono tracking-widest uppercase">{tr('Selecciona una mision', 'Select a mission')}</div>
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {cards.map((c) => (
              <motion.button
                key={c.key}
                type="button"
                onClick={() => navigate(c.to)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.99 }}
                className={`text-left rounded-2xl p-6 bg-black/40 backdrop-blur-xl border border-white/5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10)] ${c.border} transition will-change-transform`}
                style={c.glow}
              >
                <div className="text-xs uppercase tracking-[0.24em] text-gray-200/70 mono">{tr('Mision', 'Mission')}</div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">{c.title}</div>
                <div className="mt-2 text-sm text-gray-200/80">{c.subtitle}</div>
                <div className="mt-5 text-xs text-gray-200/70 mono">{tr('ENTRAR', 'ENTER')} →</div>
              </motion.button>
            ))}
          </div>

          <div className="mt-10 text-center text-xs text-gray-200/60">
            <span className="mono">CIEE</span> · {tr('Prototipo de interfaz de espacio profundo', 'Deep space interface prototype')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
