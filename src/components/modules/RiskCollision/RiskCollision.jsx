import { useI18n } from '../../../i18n/I18nProvider.jsx'

export default function RiskCollision() {
  const { tr } = useI18n()

  return (
    <div className="p-5">
      <div className="text-xl font-extrabold tracking-tight">{tr('Riesgo y colision', 'Risk & Collision')}</div>
      <div className="text-sm text-white/70 mt-1">{tr('Modulo D - Proximamente.', 'Module D - Coming Soon.')}</div>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-300" />
        <span className="text-[11px] font-bold tracking-wide text-amber-200">{tr('PROXIMAMENTE', 'COMING SOON')}</span>
      </div>

      <div className="glass rounded-2xl p-6 mt-5">
        <div className="mono text-xs text-white/60">{tr('MODULO FUTURO', 'FUTURE MODULE')}</div>
        <div className="text-2xl font-extrabold tracking-tight mt-2">{tr('Consola de riesgo de conjuncion', 'Conjunction Risk Console')}</div>
        <div className="text-sm text-white/70 mt-2">
          {tr('Planificado: cribado, alertas, lineas de tiempo de acercamientos y resumenes listos para exportar.', 'Planned: screening, alerts, close-approach timelines, and export-ready summaries.')}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">{tr('Estado', 'Status')}</div>
            <div className="mono text-sm mt-1">{tr('INICIALIZANDO…', 'INITIALIZING…')}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Pipeline</div>
            <div className="mono text-sm mt-1">TBD</div>
          </div>
        </div>
      </div>
    </div>
  )
}
