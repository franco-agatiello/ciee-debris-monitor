import { Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import Sidebar from '../components/Sidebar.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { useI18n } from '../i18n/I18nProvider.jsx'

const dashTransition = { type: 'spring', stiffness: 300, damping: 30 }

export default function DashboardLayout() {
  const { tr } = useI18n()

  return (
    <motion.div
      className="h-full min-h-screen p-4 md:p-6 bg-[#02040a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/20 via-[#02040a] to-[#02040a]"
      style={{ willChange: 'transform, opacity' }}
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={dashTransition}
    >
      <div className="grid h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] grid-cols-1 md:grid-cols-[320px_1fr] gap-4 md:gap-6">
        <div className="hidden md:block">
          <Sidebar />
        </div>

        <main className="glass overflow-hidden">
          <div className="h-full flex flex-col">
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

      <div className="md:hidden mt-4">
        <Sidebar />
      </div>
    </motion.div>
  )
}
