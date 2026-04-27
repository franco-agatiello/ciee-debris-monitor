import { publicUrl } from '../utils/publicUrl'
import { useI18n } from '../i18n/I18nProvider.jsx'

const CIEE_URL = 'https://www.ciee.unlp.edu.ar/'

export default function LoadingScreen({ title }) {
  const { tr } = useI18n()
  const safeTitle = title || tr('Suite CIEE de Monitoreo Espacial', 'CIEE Space Watch Suite')

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#02040a]" role="status" aria-live="polite">
      <div className="w-full max-w-md px-6 text-center">
        <img
          src={publicUrl('/img/logo-ciee.png')}
          alt="CIEE"
          className="h-14 w-auto mx-auto opacity-90 cursor-pointer"
          onMouseEnter={() => {
            window.location.href = CIEE_URL
          }}
          title={tr('Ir a CIEE', 'Go to CIEE')}
        />
        <div className="mt-4 text-lg font-extrabold tracking-tight text-white">{safeTitle}</div>
        <div className="mt-6 w-64 max-w-[70vw] mx-auto opacity-70">
          <div className="inline-loading-bar" />
        </div>
        <div className="mt-3 text-xs text-white/60 mono">{tr('Cargando…', 'Loading…')}</div>
      </div>
    </div>
  )
}
