import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import Sidebar from '../components/Sidebar.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { useI18n } from '../i18n/I18nProvider.jsx'

const dashTransition = { type: 'spring', stiffness: 300, damping: 30 }
const SIDEBAR_STATE_KEY = 'ciee.dashboard.sidebarOpen'

export default function DashboardLayout() {
  const { tr } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_STATE_KEY)
      if (raw === '0') return false
      if (raw === '1') return true
    } catch {
      // ignore and keep default
    }
    return true
  })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileSidebarOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, sidebarOpen ? '1' : '0')
    } catch {
      // ignore persistence errors
    }
  }, [sidebarOpen])

  return (
    <motion.div
      className="h-full min-h-screen p-4 md:p-6 bg-[#02040a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-[#02040a] to-[#02040a]"
      style={{ willChange: 'transform, opacity' }}
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={dashTransition}
    >
      <div className="md:hidden fixed top-4 left-4 z-[90]">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-white/15 bg-black/45 backdrop-blur-md text-white/90 hover:bg-black/60 transition"
          aria-label={tr('Abrir menu lateral', 'Open sidebar menu')}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <div className="h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] flex gap-4 md:gap-6">
        <div
          className={`hidden md:flex md:flex-col transition-[width] duration-300 ease-out ${sidebarOpen ? 'w-[270px]' : 'w-14'}`}
        >
          <Sidebar collapsed={!sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
        </div>

        <main className="glass overflow-hidden flex-1 relative">
          <div className="h-full flex flex-col pt-14 md:pt-0">
            <div className="flex-1 overflow-auto">
              <ErrorBoundary
                title={tr('La aplicacion fallo', 'The app crashed')}
                hint={tr(
                  'Ocurrio un error de ejecucion al renderizar. Los detalles debajo ayudan a identificar el problema.',
                  'A runtime error occurred while rendering. The error details below should tell us what to fix.',
                )}
              >
                <Outlet />
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>

      {mobileSidebarOpen ? (
        <div className="md:hidden fixed inset-0 z-[120]">
          <button
            type="button"
            className="absolute inset-0 bg-black/65"
            aria-label={tr('Cerrar menu lateral', 'Close sidebar menu')}
            onClick={() => setMobileSidebarOpen(false)}
          />

          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[340px] p-3">
            <div className="relative h-full">
              <div className="absolute top-2 right-2 z-20">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-white/15 bg-black/45 text-white/90"
                  aria-label={tr('Cerrar', 'Close')}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  )
}
