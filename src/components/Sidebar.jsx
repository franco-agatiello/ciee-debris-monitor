import { NavLink } from 'react-router-dom'
import { Activity, Globe, LayoutGrid, Map, ShieldAlert } from 'lucide-react'
import { publicUrl } from '../utils/publicUrl'

const links = [
  { to: '/', label: 'Mission Hub', hint: 'Landing', Icon: LayoutGrid },
  { to: '/dashboard/analytics', label: 'Analytics', hint: 'Global trends', Icon: Activity },
  { to: '/dashboard/map', label: 'Reentry Map', hint: '2D map + 3D orbit', Icon: Map },
  { to: '/dashboard/orbit', label: 'Orbit Monitor', hint: '3D globe', Icon: Globe },
  { to: '/dashboard/risk', label: 'Risk', hint: 'Coming soon', Icon: ShieldAlert },
]

export default function Sidebar() {
  return (
    <aside className="glass h-full p-5 flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-3">
          <img src={publicUrl('/img/logo-ciee.png')} alt="CIEE" className="h-10 w-auto" />
          <div>
            <div className="text-lg font-extrabold tracking-tight">CIEE Space Watch Suite</div>
            <div className="text-xs text-white/60 mono">2026-02-03 · local</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-2">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `rounded-xl px-3 py-3 border transition ${
                isActive
                  ? 'bg-white/10 border-white/20'
                  : 'bg-white/0 border-white/10 hover:bg-white/5 hover:border-white/15'
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
                        ? 'h-5 w-5 text-cyan-200 drop-shadow-[0_0_12px_rgba(34,211,238,0.55)]'
                        : 'h-5 w-5 text-gray-400/80'
                    }
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className={isActive ? 'text-sm font-bold text-white' : 'text-sm font-bold text-white/90'}>
                      {l.label}
                    </div>
                    <div className={isActive ? 'text-xs text-cyan-100/75' : 'text-xs text-white/60'}>{l.hint}</div>
                  </div>
                </div>
              )
            }}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto text-xs text-white/55 leading-relaxed">
        Data from <span className="mono">/public/data</span>. Run via dev server (not file://).
      </div>
    </aside>
  )
}
