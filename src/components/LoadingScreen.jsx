import { publicUrl } from '../utils/publicUrl'

export default function LoadingScreen({ title = 'CIEE Space Watch Suite' }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#02040a]" role="status" aria-live="polite">
      <div className="w-full max-w-md px-6 text-center">
        <img src={publicUrl('/img/logo-ciee.png')} alt="CIEE" className="h-14 w-auto mx-auto opacity-90" />
        <div className="mt-4 text-lg font-extrabold tracking-tight text-white">{title}</div>
        <div className="mt-6 w-64 max-w-[70vw] mx-auto opacity-70">
          <div className="inline-loading-bar" />
        </div>
        <div className="mt-3 text-xs text-white/60 mono">Loading…</div>
      </div>
    </div>
  )
}
