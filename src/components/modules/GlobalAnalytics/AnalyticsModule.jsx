import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { publicUrl } from '../../../utils/publicUrl'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useDeferredRender } from '../../../hooks/useDeferredRender.js'
import { useI18n } from '../../../i18n/I18nProvider.jsx'

const COLORS = {
  payload: '#06b6d4',
  rocket: '#f97316',
  debris: '#fb923c',
  decayed: '#8b5cf6',
  unknown: '#94a3b8',
  grid: '#334155',
}

function GlassCard({ title, subtitle, children, className = '', warningText = '' }) {
  return (
    <div className={`bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="text-xs leading-none font-bold uppercase tracking-widest text-gray-400 font-inter">{title}</div>
        {warningText ? (
          <div className="relative group">
            <span className="inline-flex items-center justify-center w-4 h-4 text-amber-300/95 cursor-help" aria-label="warning">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3.5L21 19.5H3L12 3.5Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 9V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="17.25" r="1.1" fill="currentColor" />
              </svg>
            </span>
            <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-[80] min-w-[240px] max-w-[320px] bg-black/90 border border-amber-300/30 rounded-md px-2 py-1.5 text-[10px] leading-relaxed text-amber-100 font-mono normal-case tracking-normal">
              {warningText}
            </div>
          </div>
        ) : null}
      </div>
      {subtitle ? <div className="text-[11px] text-gray-500 font-mono mt-1">{subtitle}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function DeferredViz({ ready, children }) {
  if (ready) return children
  return <div className="h-full w-full rounded-lg bg-white/5 border border-white/10 animate-pulse" />
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2">
      {label != null ? <div className="text-xs font-bold text-white/90 mb-1">{label}</div> : null}
      <div className="space-y-1">
        {payload
          .filter((p) => p && p.value != null)
          .map((p) => (
            <div key={p.dataKey || p.name} className="flex items-center justify-between gap-4">
              <div className="text-[11px] text-white/70">
                <span className="inline-block w-2 h-2 rounded-sm mr-2" style={{ background: p.color || p.fill }} />
                {p.name || p.dataKey}
              </div>
              <div className="text-[11px] text-white font-mono">{String(p.value)}</div>
            </div>
          ))}
      </div>
    </div>
  )
}

function yearFromDate(value) {
  if (!value) return null
  const s = String(value)
  const m = s.match(/\b(19\d{2}|20\d{2})\b/)
  return m ? Number(m[1]) : null
}

function normalizeType(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return 'UNKNOWN'
  if (s === 'PAYLOAD') return 'PAYLOAD'
  if (s === 'ROCKET BODY' || s === 'ROCKET' || s === 'RB') return 'ROCKET BODY'
  if (s === 'DEBRIS') return 'DEBRIS'
  if (s.includes('DEBRIS')) return 'DEBRIS'
  if (s.includes('ROCKET') && s.includes('BODY')) return 'ROCKET BODY'
  if (s.includes('PAYLOAD')) return 'PAYLOAD'
  if (s.includes('ROCKET')) return 'ROCKET BODY'
  return 'UNKNOWN'
}

function toNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return Number(value)
  const raw = value.trim()
  if (!raw) return NaN

  const numericLike = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(raw) || /^-?\d+(?:,\d+)?$/.test(raw)
  if (!numericLike) return NaN

  let s = raw
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.')
  return Number(s)
}

function reservoirPush(arr, seenRef, item, cap) {
  seenRef.count += 1
  if (arr.length < cap) {
    arr.push(item)
    return
  }
  const j = Math.floor(Math.random() * seenRef.count)
  if (j < cap) arr[j] = item
}

function buildLatBandsFromCounts(counts) {
  const out = []
  for (let start = -90; start < 90; start += 10) {
    out.push({ band: `${start}–${start + 10}°`, count: counts.get(start) || 0 })
  }
  return out
}

function buildYearSeries(launchByYear, decayByYear) {
  const years = Array.from(new Set([...launchByYear.keys(), ...decayByYear.keys()])).sort((a, b) => a - b)
  let cumLaunch = 0
  let cumDecay = 0
  return years.map((y) => {
    cumLaunch += launchByYear.get(y) || 0
    cumDecay += decayByYear.get(y) || 0
    return { year: y, launches: cumLaunch, decays: cumDecay }
  })
}

function orbitDaysFromRow(r) {
  const raw = toNumber(r.dias_en_orbita)
  if (Number.isFinite(raw) && raw >= 0) return raw

  const launch = r.LAUNCH_DATE ? new Date(r.LAUNCH_DATE) : null
  const decay = r.DECAY_DATE ? new Date(r.DECAY_DATE) : null
  if (!launch || !decay || Number.isNaN(launch.valueOf()) || Number.isNaN(decay.valueOf())) return NaN

  const days = (decay - launch) / (1000 * 60 * 60 * 24)
  return Number.isFinite(days) && days >= 0 ? days : NaN
}

function buildReentryTrend(decayByYear) {
  const years = Array.from(decayByYear.keys()).sort((a, b) => a - b)
  return years.map((year, idx) => {
    const count = decayByYear.get(year) || 0
    const from = Math.max(0, idx - 4)
    const window = years.slice(from, idx + 1)
    const sum = window.reduce((acc, y) => acc + (decayByYear.get(y) || 0), 0)
    const ma5 = window.length ? sum / window.length : 0
    return {
      year,
      count,
      ma5: Number(ma5.toFixed(2)),
    }
  })
}

function buildReentryTrendFromKesslerSeries(kesslerSeries) {
  if (!Array.isArray(kesslerSeries) || !kesslerSeries.length) return []
  return kesslerSeries.map((row, idx) => {
    const prev = idx > 0 ? Number(kesslerSeries[idx - 1]?.decays || 0) : 0
    const current = Number(row?.decays || 0)
    const count = Math.max(0, current - prev)

    const from = Math.max(0, idx - 4)
    const window = kesslerSeries.slice(from, idx + 1)
    const movingCounts = window.map((w, wi) => {
      const absoluteIdx = from + wi
      const prevW = absoluteIdx > 0 ? Number(kesslerSeries[absoluteIdx - 1]?.decays || 0) : 0
      return Math.max(0, Number(w?.decays || 0) - prevW)
    })
    const ma5 = movingCounts.length ? movingCounts.reduce((a, b) => a + b, 0) / movingCounts.length : 0

    return {
      year: row.year,
      count,
      ma5: Number(ma5.toFixed(2)),
    }
  })
}

function buildLifetimeByType(lifeStats, tr) {
  const order = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN']
  const labels = {
    PAYLOAD: tr('Carga util', 'Payload'),
    'ROCKET BODY': tr('Cuerpo de cohete', 'Rocket Body'),
    DEBRIS: tr('Basura', 'Debris'),
    UNKNOWN: tr('Desconocido', 'Unknown'),
  }

  return order
    .map((key) => {
      const stats = lifeStats[key] || { totalDays: 0, count: 0 }
      const avgDays = stats.count ? stats.totalDays / stats.count : 0
      return {
        key,
        name: labels[key],
        count: stats.count,
        avgYears: Number((avgDays / 365.25).toFixed(2)),
      }
    })
    .filter((d) => d.count > 0)
}

function buildFragmentationIndex(polluters) {
  if (!Array.isArray(polluters)) return []
  return polluters
    .filter((d) => Number(d?.total || 0) > 0)
    .map((d) => {
      const total = Number(d.total || 0)
      const debris = Number(d.debris || 0)
      return {
        country: d.country,
        total,
        debris,
        fragPct: Number(((debris / total) * 100).toFixed(1)),
      }
    })
    .sort((a, b) => b.fragPct - a.fragPct)
    .slice(0, 12)
}

function quantile(sortedValues, q) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0
  const pos = (sortedValues.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const a = sortedValues[base]
  const b = sortedValues[base + 1]
  if (b == null) return a
  return a + (b - a) * rest
}

function buildLifetimeStatsByType(lifeSamples, tr) {
  const order = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN']
  const labels = {
    PAYLOAD: tr('Carga util', 'Payload'),
    'ROCKET BODY': tr('Cuerpo de cohete', 'Rocket Body'),
    DEBRIS: tr('Basura', 'Debris'),
    UNKNOWN: tr('Desconocido', 'Unknown'),
  }

  return order
    .map((key) => {
      const arr = Array.isArray(lifeSamples[key]) ? lifeSamples[key].filter((n) => Number.isFinite(n) && n >= 0) : []
      if (!arr.length) return null
      const sorted = arr.slice().sort((a, b) => a - b)
      const avgDays = sorted.reduce((acc, v) => acc + v, 0) / sorted.length
      return {
        key,
        type: labels[key],
        count: sorted.length,
        avgYears: Number((avgDays / 365.25).toFixed(2)),
        medianYears: Number((quantile(sorted, 0.5) / 365.25).toFixed(2)),
        p90Years: Number((quantile(sorted, 0.9) / 365.25).toFixed(2)),
        minYears: Number((sorted[0] / 365.25).toFixed(2)),
        maxYears: Number((sorted[sorted.length - 1] / 365.25).toFixed(2)),
      }
    })
    .filter(Boolean)
}

function cohortKeyFromYear(year) {
  if (!Number.isFinite(year)) return null
  const decade = Math.floor(year / 10) * 10
  return `${decade}s`
}

function buildCohortTable(cohortMap) {
  return Array.from(cohortMap.entries())
    .map(([cohort, v]) => {
      const reentryRate = v.launched > 0 ? (v.reentered / v.launched) * 100 : 0
      const avgYearsToReentry = v.reentered > 0 ? v.totalDaysToReentry / v.reentered / 365.25 : 0
      return {
        cohort,
        launched: v.launched,
        reentered: v.reentered,
        reentryRate: Number(reentryRate.toFixed(1)),
        avgYearsToReentry: Number(avgYearsToReentry.toFixed(2)),
      }
    })
    .sort((a, b) => Number(a.cohort.slice(0, 4)) - Number(b.cohort.slice(0, 4)))
}

function buildCountryFootprintTable(countryStats) {
  return Array.from(countryStats.values())
    .map((v) => {
      const total = v.total || 0
      return {
        country: v.country,
        total,
        debrisPct: total > 0 ? Number(((v.debris / total) * 100).toFixed(1)) : 0,
        payloadPct: total > 0 ? Number(((v.payload / total) * 100).toFixed(1)) : 0,
        massTotal: Number(v.massTotal || 0),
        reentered: Number(v.reentered || 0),
      }
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)
}

function buildFragmentationFromCountryFootprint(countryFootprint) {
  if (!Array.isArray(countryFootprint)) return []
  return countryFootprint
    .map((d) => ({
      country: d.country,
      total: Number(d.total || 0),
      debris: Number(((Number(d.debrisPct || 0) / 100) * Number(d.total || 0)).toFixed(0)),
      fragPct: Number(Number(d.debrisPct || 0).toFixed(1)),
    }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.fragPct - a.fragPct)
    .slice(0, 12)
}

function TableWrap({ children }) {
  return <div className="overflow-x-auto border border-white/10 rounded-lg">{children}</div>
}

function DataTable({ columns, rows, searchPlaceholder, initialSort }) {
  const [query, setQuery] = useState('')
  const [sortState, setSortState] = useState(
    initialSort && initialSort.key
      ? { key: initialSort.key, dir: initialSort.dir === 'asc' ? 'asc' : 'desc' }
      : { key: columns?.[0]?.key || '', dir: 'asc' },
  )

  const normalizedQuery = query.trim().toLowerCase()

  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows
    return rows.filter((row) =>
      columns.some((col) => {
        const raw = col.searchValue ? col.searchValue(row[col.key], row) : row[col.key]
        return String(raw ?? '')
          .toLowerCase()
          .includes(normalizedQuery)
      }),
    )
  }, [columns, normalizedQuery, rows])

  const sortedRows = useMemo(() => {
    const key = sortState.key
    if (!key) return filteredRows
    const col = columns.find((c) => c.key === key)
    if (!col) return filteredRows

    const factor = sortState.dir === 'asc' ? 1 : -1
    const out = filteredRows.slice()
    out.sort((a, b) => {
      const av = col.sortValue ? col.sortValue(a[key], a) : a[key]
      const bv = col.sortValue ? col.sortValue(b[key], b) : b[key]
      const an = Number(av)
      const bn = Number(bv)
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * factor

      return String(av ?? '')
        .localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base', numeric: true }) * factor
    })
    return out
  }, [columns, filteredRows, sortState])

  const toggleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { key, dir: 'desc' }
    })
  }

  const arrowFor = (key) => {
    if (sortState.key !== key) return ''
    return sortState.dir === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <div>
      <div className="p-2 border-b border-white/10 bg-white/[0.03]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder || 'Buscar...'}
          className="w-full md:w-[320px] bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white/90 placeholder:text-white/35 outline-none focus:border-cyan-400/50"
        />
      </div>

      <table className="min-w-full text-xs">
        <thead className="bg-white/5">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 text-left font-semibold text-white/75 whitespace-nowrap">
                <div className="inline-flex items-center gap-1">
                  <button type="button" onClick={() => toggleSort(col.key)} className="hover:text-white transition-colors">
                    {col.label}
                    {arrowFor(col.key)}
                  </button>
                  {col.headerTooltip ? (
                    <div className="relative group">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] font-bold text-white/70 cursor-help">?</span>
                      <div className="pointer-events-none absolute right-0 top-full mt-2 hidden group-hover:block z-[80] w-64 max-w-[80vw] bg-black/90 border border-cyan-300/30 rounded-md px-2 py-1.5 text-[10px] leading-relaxed text-cyan-100 normal-case tracking-normal whitespace-normal break-words">
                        {col.headerTooltip}
                      </div>
                    </div>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length ? (
            sortedRows.map((row, idx) => (
              <tr key={`${row.country || row.type || row.cohort || idx}-${idx}`} className="border-t border-white/10">
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-white/85 font-mono whitespace-nowrap">
                    {col.format ? col.format(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr className="border-t border-white/10">
              <td colSpan={columns.length} className="px-3 py-4 text-white/50 font-mono">
                Sin resultados
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function formatKg(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gkg`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} Mkg`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} t`
  return `${n.toFixed(0)} kg`
}

function formatPct(n) {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

function parseValidDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.valueOf())) return null
  return d
}

function formatDateTime(value) {
  const d = parseValidDate(value)
  if (!d) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
  }).format(d)
}

function resolveDataValidAt(payload, response) {
  const candidates = []

  const generated = parseValidDate(payload?.generatedAt)
  if (generated) candidates.push(generated.valueOf())

  const lastModifiedRaw = response?.headers?.get?.('last-modified')
  const lastModified = parseValidDate(lastModifiedRaw)
  if (lastModified) candidates.push(lastModified.valueOf())

  if (!candidates.length) return ''
  return new Date(Math.max(...candidates)).toISOString()
}

function sumValues(rows, key) {
  if (!Array.isArray(rows)) return 0
  return rows.reduce((acc, r) => acc + Number(r?.[key] || 0), 0)
}

function buildCompositionDataset(counts, tr) {
  return [
    { name: tr('Carga util', 'Payload'), key: 'PAYLOAD', value: counts.PAYLOAD || 0, color: COLORS.payload },
    { name: tr('Cuerpo de cohete', 'Rocket Body'), key: 'ROCKET BODY', value: counts['ROCKET BODY'] || 0, color: COLORS.rocket },
    { name: tr('Basura', 'Debris'), key: 'DEBRIS', value: counts.DEBRIS || 0, color: COLORS.debris },
    { name: tr('Desconocido', 'Unknown'), key: 'UNKNOWN', value: counts.UNKNOWN || 0, color: COLORS.unknown },
  ]
}

function TinyDot(props) {
  const { cx, cy, fill, opacity = 0.6 } = props
  return <circle cx={cx} cy={cy} r={1} fill={fill} opacity={opacity} />
}

async function parseCsvStream(url, onRow, onProgress, signal) {
  const resolvedUrl = publicUrl(url)

  const run = (worker, stallTimeoutMs) =>
    new Promise((resolve, reject) => {
      let rows = 0
      let lastUpdate = 0
      let settled = false
      let timeoutId = null

      const finish = (err) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        if (err) reject(err)
        else resolve({ rows })
      }

      let parser = null
      const abort = (reason) => {
        try {
          parser?.abort?.()
        } catch {
          // ignore
        }
        finish(reason || new Error('Aborted'))
      }

      const bumpTimeout = () => {
        if (!stallTimeoutMs) return
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          abort(new Error(`CSV stream stalled for ${stallTimeoutMs}ms: ${resolvedUrl}`))
        }, stallTimeoutMs)
      }

      if (signal) {
        if (signal.aborted) return abort(new Error('Aborted'))
        signal.addEventListener('abort', () => abort(new Error('Aborted')), { once: true })
      }

      bumpTimeout()
      parser = Papa.parse(resolvedUrl, {
        download: true,
        worker: Boolean(worker),
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        delimiter: '',
        delimitersToGuess: [':', ',', ';', '\t', '|'],
        chunkSize: 512 * 1024,
        chunk: (results) => {
          bumpTimeout()

          const data = results?.data || []
          for (const r of data) {
            if (!r) continue
            rows += 1
            onRow(r)
          }

          const now = performance.now()
          if (onProgress && now - lastUpdate > 120) {
            lastUpdate = now
            onProgress(rows)
          }
        },
        complete: () => finish(null),
        error: (e) => finish(e),
      })
    })

  try {
    return await run(true, 20000)
  } catch (err) {
    console.warn('CSV stream worker parse failed; retrying without worker:', err)
    return await run(false, 45000)
  }
}

function AnalyticsModule() {
  const { tr } = useI18n()
  const chartsReady = useDeferredRender({ delayMs: 750 })

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ stage: 'En espera', rows: 0 })
  const [sourceMode, setSourceMode] = useState('')

  const [kessler, setKessler] = useState([])
  const [gabbard, setGabbard] = useState({ payload: [], rocket: [], debris: [], unknown: [] })
  const [massBudget, setMassBudget] = useState({ inOrbit: 0, reentered: 0 })
  const [topPolluters, setTopPolluters] = useState([])
  const [latBands, setLatBands] = useState([])
  const [compositionScopes, setCompositionScopes] = useState({ total: [], orbit: [], reentered: [] })
  const [compositionMode, setCompositionMode] = useState('orbit')
  const [regimes, setRegimes] = useState([])
  const [reentryTrend, setReentryTrend] = useState([])
  const [lifetimeByType, setLifetimeByType] = useState([])
  const [fragmentationIndex, setFragmentationIndex] = useState([])
  const [countryFootprint, setCountryFootprint] = useState([])
  const [lifetimeStatsTable, setLifetimeStatsTable] = useState([])
  const [launchCohorts, setLaunchCohorts] = useState([])
  const [kpis, setKpis] = useState([])
  const [generatedAt, setGeneratedAt] = useState('')
  const [dataValidAt, setDataValidAt] = useState('')

  const abortRef = useRef(null)

  useEffect(() => {
    abortRef.current?.abort?.()
    const ac = new AbortController()
    abortRef.current = ac

    const updateStage = (stage, rows) => setProgress({ stage, rows })

    const applyPrecomputed = (payload) => {
      const preKessler = Array.isArray(payload?.kessler) ? payload.kessler : []
      const prePolluters = Array.isArray(payload?.topPolluters) ? payload.topPolluters : []
      const preCountryFootprint = Array.isArray(payload?.countryFootprint) ? payload.countryFootprint : []

      setKessler(preKessler)
      setGabbard(
        payload?.gabbard && typeof payload.gabbard === 'object'
          ? {
              payload: payload.gabbard.payload || [],
              rocket: payload.gabbard.rocket || [],
              debris: payload.gabbard.debris || [],
              unknown: payload.gabbard.unknown || [],
            }
          : { payload: [], rocket: [], debris: [], unknown: [] },
      )
      setMassBudget(payload?.massBudget || { inOrbit: 0, reentered: 0 })
      setTopPolluters(prePolluters)
      setLatBands(Array.isArray(payload?.latBands) ? payload.latBands : [])
      const preCompositionScopes = payload?.compositionScopes && typeof payload.compositionScopes === 'object' ? payload.compositionScopes : null
      if (preCompositionScopes) {
        setCompositionScopes({
          total: Array.isArray(preCompositionScopes.total) ? preCompositionScopes.total : [],
          orbit: Array.isArray(preCompositionScopes.orbit) ? preCompositionScopes.orbit : [],
          reentered: Array.isArray(preCompositionScopes.reentered) ? preCompositionScopes.reentered : [],
        })
      } else {
        const orbit = Array.isArray(payload?.composition) ? payload.composition : []
        setCompositionScopes({ total: [], orbit, reentered: [] })
      }
      setRegimes(Array.isArray(payload?.regimes) ? payload.regimes : [])
      setReentryTrend(Array.isArray(payload?.reentryTrend) ? payload.reentryTrend : buildReentryTrendFromKesslerSeries(preKessler))
      setLifetimeByType(Array.isArray(payload?.lifetimeByType) ? payload.lifetimeByType : [])
      setCountryFootprint(preCountryFootprint)
      setFragmentationIndex(
        preCountryFootprint.length
          ? buildFragmentationFromCountryFootprint(preCountryFootprint)
          : Array.isArray(payload?.fragmentationIndex)
            ? payload.fragmentationIndex
            : buildFragmentationIndex(prePolluters),
      )
      setLifetimeStatsTable(Array.isArray(payload?.lifetimeStatsTable) ? payload.lifetimeStatsTable : [])
      setLaunchCohorts(Array.isArray(payload?.launchCohorts) ? payload.launchCohorts : [])
      setKpis(Array.isArray(payload?.kpis) ? payload.kpis : [])
      setGeneratedAt(String(payload?.generatedAt || ''))
    }

    const runLiveAggregation = async () => {
      const launchByYear = new Map()
      const decayByYear = new Map()
      const polluters = new Map()
      const latCounts = new Map()
      for (let start = -90; start < 90; start += 10) latCounts.set(start, 0)

      const regimesCounts = { LEO: 0, MEO: 0, GEO: 0, UNKNOWN: 0 }
      const totalCounts = { PAYLOAD: 0, 'ROCKET BODY': 0, DEBRIS: 0, UNKNOWN: 0 }
      const activeCounts = { PAYLOAD: 0, 'ROCKET BODY': 0, DEBRIS: 0, UNKNOWN: 0 }
      const decayedCounts = { PAYLOAD: 0, 'ROCKET BODY': 0, DEBRIS: 0, UNKNOWN: 0 }
      const lifeStats = {
        PAYLOAD: { totalDays: 0, count: 0 },
        'ROCKET BODY': { totalDays: 0, count: 0 },
        DEBRIS: { totalDays: 0, count: 0 },
        UNKNOWN: { totalDays: 0, count: 0 },
      }
      const lifeSamples = { PAYLOAD: [], 'ROCKET BODY': [], DEBRIS: [], UNKNOWN: [] }
      const countryStats = new Map()
      const cohortMap = new Map()

      const ensureCountry = (country) => {
        const key = String(country || '').trim() || '??'
        if (!countryStats.has(key)) {
          countryStats.set(key, {
            country: key,
            total: 0,
            payload: 0,
            debris: 0,
            massTotal: 0,
            reentered: 0,
          })
        }
        return countryStats.get(key)
      }

      let catalogCount = 0
      let activeCount = 0
      let decayedCount = 0
      let impactsCount = 0

      let massOrbit = 0
      let massReentered = 0

      const MAX_SCATTER_PER_TYPE = 3500
      const seenPayload = { count: 0 }
      const seenRocket = { count: 0 }
      const seenDebris = { count: 0 }
      const seenUnknown = { count: 0 }
      const scatter = { payload: [], rocket: [], debris: [], unknown: [] }

      updateStage('Procesando catalogo…', 0)
      await parseCsvStream(
        '/data/debris_total.csv',
        (r) => {
          catalogCount += 1

          const y = yearFromDate(r.LAUNCH_DATE)
          if (y) launchByYear.set(y, (launchByYear.get(y) || 0) + 1)

          const country = String(r.COUNTRY_CODE || '').trim() || '??'
          const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
          totalCounts[t] = (totalCounts[t] || 0) + 1
          if (!polluters.has(country)) polluters.set(country, { country, payload: 0, rocketBody: 0, debris: 0 })
          const obj = polluters.get(country)
          if (t === 'PAYLOAD') obj.payload += 1
          else if (t === 'ROCKET BODY') obj.rocketBody += 1
          else if (t === 'DEBRIS') obj.debris += 1

          const c = ensureCountry(country)
          c.total += 1
          if (t === 'PAYLOAD') c.payload += 1
          if (t === 'DEBRIS') c.debris += 1

          const cohort = cohortKeyFromYear(y)
          if (cohort) {
            if (!cohortMap.has(cohort)) cohortMap.set(cohort, { launched: 0, reentered: 0, totalDaysToReentry: 0 })
            cohortMap.get(cohort).launched += 1
          }

          const period = toNumber(r.PERIOD)
          if (Number.isFinite(period)) {
            if (period < 128) regimesCounts.LEO += 1
            else if (period <= 1400) regimesCounts.MEO += 1
            else regimesCounts.GEO += 1
          } else {
            regimesCounts.UNKNOWN += 1
          }

          const apo = toNumber(r.APOAPSIS)
          const per = toNumber(r.PERIGEE ?? r.PERIAPSIS)
          if (!Number.isFinite(period) || !Number.isFinite(apo) || !Number.isFinite(per)) return
          const alt = (apo + per) / 2
          if (!Number.isFinite(alt) || alt < 0 || alt > 40000) return

          const p = { x: period, y: alt }
          if (t === 'PAYLOAD') reservoirPush(scatter.payload, seenPayload, p, MAX_SCATTER_PER_TYPE)
          else if (t === 'ROCKET BODY') reservoirPush(scatter.rocket, seenRocket, p, MAX_SCATTER_PER_TYPE)
          else if (t === 'DEBRIS') reservoirPush(scatter.debris, seenDebris, p, MAX_SCATTER_PER_TYPE)
          else reservoirPush(scatter.unknown, seenUnknown, p, MAX_SCATTER_PER_TYPE)
        },
        (rows) => updateStage('Procesando catalogo…', rows),
        ac.signal,
      )

      updateStage('Procesando activos…', 0)
      await parseCsvStream(
        '/data/debris_orbita.csv',
        (r) => {
          activeCount += 1
          const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
          activeCounts[t] = (activeCounts[t] || 0) + 1
          const m = toNumber(r.masa_en_orbita)
          if (Number.isFinite(m)) massOrbit += m

          const c = ensureCountry(r.COUNTRY_CODE)
          if (Number.isFinite(m)) c.massTotal += m
        },
        (rows) => updateStage('Procesando activos…', rows),
        ac.signal,
      )

      updateStage('Procesando reingresados…', 0)
      await parseCsvStream(
        '/data/debris_reingresados.csv',
        (r) => {
          decayedCount += 1
          const y = yearFromDate(r.DECAY_DATE)
          if (y) decayByYear.set(y, (decayByYear.get(y) || 0) + 1)

          const type = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
          decayedCounts[type] = (decayedCounts[type] || 0) + 1
          const days = orbitDaysFromRow(r)
          if (Number.isFinite(days)) {
            lifeStats[type].totalDays += days
            lifeStats[type].count += 1
            lifeSamples[type].push(days)
          }

          const m = toNumber(r.masa_en_orbita)
          if (Number.isFinite(m)) massReentered += m

          const c = ensureCountry(r.COUNTRY_CODE)
          c.reentered += 1
          if (Number.isFinite(m)) c.massTotal += m

          const cohort = cohortKeyFromYear(yearFromDate(r.LAUNCH_DATE))
          if (cohort) {
            if (!cohortMap.has(cohort)) cohortMap.set(cohort, { launched: 0, reentered: 0, totalDaysToReentry: 0 })
            const cohortRow = cohortMap.get(cohort)
            cohortRow.reentered += 1
            if (Number.isFinite(days)) cohortRow.totalDaysToReentry += days
          }
        },
        (rows) => updateStage('Procesando reingresados…', rows),
        ac.signal,
      )

      updateStage('Procesando impactos…', 0)
      await parseCsvStream(
        '/data/debris_reingresados_con_pos.csv',
        (r) => {
          impactsCount += 1
          const lat = toNumber(r.lat_caida)
          if (!Number.isFinite(lat)) return
          const clamped = Math.max(-90, Math.min(89.999, lat))
          const bucket = Math.floor((clamped + 90) / 10) * 10 - 90
          if (!latCounts.has(bucket)) return
          latCounts.set(bucket, (latCounts.get(bucket) || 0) + 1)
        },
        (rows) => updateStage('Procesando impactos…', rows),
        ac.signal,
      )

      const yearSeries = buildYearSeries(launchByYear, decayByYear)
      const annualReentries = buildReentryTrend(decayByYear)
      const poll = Array.from(polluters.values())
        .map((d) => ({ ...d, total: d.payload + d.rocketBody + d.debris }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12)
      const lifeByType = buildLifetimeByType(lifeStats, tr)
      const countryRows = buildCountryFootprintTable(countryStats)
      const fragIndex = buildFragmentationFromCountryFootprint(countryRows)
      const lifetimeTableRows = buildLifetimeStatsByType(lifeSamples, tr)
      const cohortRows = buildCohortTable(cohortMap)

      const compScopes = {
        total: buildCompositionDataset(totalCounts, tr),
        orbit: buildCompositionDataset(activeCounts, tr),
        reentered: buildCompositionDataset(decayedCounts, tr),
      }

      const reg = [
        { name: 'LEO (<128m)', value: regimesCounts.LEO, color: '#22c55e' },
        { name: 'MEO (128-1400m)', value: regimesCounts.MEO, color: COLORS.payload },
        { name: 'GEO (>1400m)', value: regimesCounts.GEO, color: COLORS.decayed },
        { name: tr('Desconocido', 'Unknown'), value: regimesCounts.UNKNOWN, color: COLORS.unknown },
      ]

      const lat = buildLatBandsFromCounts(latCounts)
      const budget = { inOrbit: massOrbit, reentered: massReentered }

      const kpiList = [
        { label: tr('Catalogo', 'Catalog'), value: catalogCount },
        { label: tr('Activos', 'Active'), value: activeCount },
        { label: tr('Reingresados', 'Decayed'), value: decayedCount },
        { label: tr('Impactos', 'Impacts'), value: impactsCount },
        { label: tr('Masa en orbita', 'In-Orbit Mass'), value: formatKg(massOrbit) },
      ]

      setKessler(yearSeries)
      setGabbard(scatter)
      setTopPolluters(poll)
      setLatBands(lat)
      setMassBudget(budget)
      setCompositionScopes(compScopes)
      setRegimes(reg)
      setReentryTrend(annualReentries)
      setLifetimeByType(lifeByType)
      setFragmentationIndex(fragIndex)
      setCountryFootprint(countryRows)
      setLifetimeStatsTable(lifetimeTableRows)
      setLaunchCohorts(cohortRows)
      setKpis(kpiList)
      setGeneratedAt('')
    }

    const run = async () => {
      try {
        setLoading(true)
        setError('')

        updateStage(tr('Cargando preprocesado…', 'Loading precomputed…'), 0)
        const res = await fetch(`${publicUrl('/data/analytics.precomputed.json')}?ts=${Date.now()}`)
        if (res.ok) {
          const payload = await res.json()
          applyPrecomputed(payload)
          setSourceMode('precomputed')
          setDataValidAt(resolveDataValidAt(payload, res))

          setLoading(false)
          updateStage(tr('Listo', 'Ready'), 0)
          return
        }

        setSourceMode('live')
        await runLiveAggregation()
        setDataValidAt(new Date().toISOString())
        setLoading(false)
        updateStage(tr('Listo', 'Ready'), 0)
      } catch (e) {
        if (ac.signal.aborted) return
        setError(String(e?.message || e))
        setLoading(false)
      }
    }

    run()
    return () => ac.abort()
  }, [tr])

  const massBudgetData = useMemo(
    () => [
      { name: tr('En orbita', 'In-Orbit'), value: massBudget.inOrbit },
      { name: tr('Reingresada', 'Reentered'), value: massBudget.reentered },
    ],
    [massBudget, tr],
  )

  const emptyComposition = useMemo(
    () => buildCompositionDataset({ PAYLOAD: 0, 'ROCKET BODY': 0, DEBRIS: 0, UNKNOWN: 0 }, tr),
    [tr],
  )

  const selectedComposition = useMemo(() => {
    const current = compositionScopes[compositionMode] || []
    return current.length ? current : emptyComposition
  }, [compositionMode, compositionScopes, emptyComposition])

  const countryFootprintColumns = useMemo(
    () => [
      { key: 'country', label: tr('Pais', 'Country') },
      { key: 'total', label: tr('Objetos', 'Objects') },
      { key: 'debrisPct', label: tr('% Basura', '% Debris'), format: (v) => formatPct(Number(v)) },
      { key: 'payloadPct', label: tr('% Carga util', '% Payload'), format: (v) => formatPct(Number(v)) },
      { key: 'massTotal', label: tr('Masa total', 'Total Mass'), format: (v) => formatKg(Number(v)) },
      { key: 'reentered', label: tr('Reingresados', 'Reentered') },
    ],
    [tr],
  )

  const lifetimeStatsColumns = useMemo(
    () => [
      { key: 'type', label: tr('Tipo', 'Type') },
      { key: 'count', label: tr('Muestras válidas', 'Valid samples') },
      { key: 'avgYears', label: tr('Promedio (años)', 'Average (years)') },
      { key: 'medianYears', label: tr('Mediana (años)', 'Median (years)') },
      {
        key: 'p90Years',
        label: tr('P90 (años)', 'P90 (years)'),
        headerTooltip: tr(
          'P90 es el percentil 90: el 90% de los objetos reingresa en ese tiempo o menos; el 10% tarda más.',
          'P90 is the 90th percentile: 90% of objects reenter in that time or less; 10% take longer.',
        ),
      },
      { key: 'minYears', label: tr('Min (años)', 'Min (years)') },
      { key: 'maxYears', label: tr('Max (años)', 'Max (years)') },
    ],
    [tr],
  )

  const cohortColumns = useMemo(
    () => [
      { key: 'cohort', label: tr('Cohorte', 'Cohort') },
      { key: 'launched', label: tr('Lanzados', 'Launched') },
      { key: 'reentered', label: tr('Reingresados', 'Reentered') },
      { key: 'reentryRate', label: tr('Tasa reingreso', 'Reentry rate'), format: (v) => formatPct(Number(v)) },
      { key: 'avgYearsToReentry', label: tr('Promedio hasta reingreso (años)', 'Avg until reentry (years)') },
    ],
    [tr],
  )

  const filterMetrics = useMemo(() => {
    const reenteredTotal = sumValues(compositionScopes?.reentered, 'value')
    const lifetimeValid = sumValues(lifetimeStatsTable, 'count')
    const lifetimeCoverage = reenteredTotal > 0 ? (lifetimeValid / reenteredTotal) * 100 : 0
    const impactsRows = sumValues(latBands, 'count')
    return {
      reenteredTotal,
      lifetimeValid,
      lifetimeCoverage,
      impactsRows,
    }
  }, [compositionScopes, lifetimeStatsTable, latBands])

  return (
    <div className="p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xl font-extrabold tracking-tight">{tr('Analitica global', 'Global Analytics')}</div>
          <div className="text-sm text-white/70 mt-1">
            {tr('Panel estilo AEI', 'AEI-style dashboard')} · {sourceMode === 'precomputed' ? tr('Preprocesado', 'Precomputed') : sourceMode === 'live' ? tr('Agregacion en vivo', 'Live aggregation') : '—'}
            {sourceMode === 'precomputed' && (dataValidAt || generatedAt)
              ? ` · ${tr('Validez de datos', 'Data validity')}: ${formatDateTime(dataValidAt || generatedAt)}`
              : ''}
          </div>
        </div>
        <div className="hidden md:flex gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2">
              <div className="text-[11px] text-gray-500 font-mono">{k.label}</div>
              <div className="text-sm font-bold text-white/90 mt-0.5">{String(k.value)}</div>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-5 bg-black/40 backdrop-blur-md border border-red-500/30 rounded-xl p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-red-300 font-inter">Error</div>
          <div className="mt-2 text-xs font-mono text-red-200 whitespace-pre-wrap">{error}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <GlassCard title={tr('Sindrome de Kessler', 'Kessler Syndrome')} subtitle={tr('Lanzamientos acumulados vs decaimientos acumulados', 'Cumulative launches vs cumulative decays')} className="md:col-span-2">
          <div className="h-[260px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={kessler} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradLaunch" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.payload} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={COLORS.payload} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradDecay" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.decayed} stopOpacity={0.38} />
                      <stop offset="100%" stopColor={COLORS.decayed} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="year" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="launches" name={tr('Lanzamientos acumulados', 'Cumulative Launches')} stroke={COLORS.payload} fill="url(#gradLaunch)" strokeWidth={2} />
                  <Area type="monotone" dataKey="decays" name={tr('Decaimientos acumulados', 'Cumulative Decays')} stroke={COLORS.decayed} fill="url(#gradDecay)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title={tr('Balance de masa', 'Mass Budget')} subtitle={tr('Masa total en orbita vs reingresada', 'Total in-orbit mass vs reentered')} className="md:col-span-1">
          <div className="h-[260px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={massBudgetData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} tickFormatter={() => ''} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name={tr('Masa', 'Mass')} radius={[10, 10, 6, 6]}>
                    <Cell fill={COLORS.payload} />
                    <Cell fill={COLORS.decayed} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
          <div className="text-[11px] text-gray-500 font-mono mt-2">
            {tr('En orbita', 'In-Orbit')}: <span className="text-white/80">{formatKg(massBudget.inOrbit)}</span> · {tr('Reingresada', 'Reentered')}:{' '}
            <span className="text-white/80">{formatKg(massBudget.reentered)}</span>
          </div>
        </GlassCard>

        <GlassCard title={tr('Mayores contaminadores', 'Top Polluters')} subtitle={tr('Codigo de pais · apilado por tipo', 'Country code · stacked by type')} className="md:col-span-2">
          <div className="h-[320px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topPolluters} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis type="category" dataKey="country" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} width={50} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
                  <Bar dataKey="payload" name={tr('Carga util', 'Payload')} stackId="a" fill={COLORS.payload} />
                  <Bar dataKey="rocketBody" name={tr('Cuerpo de cohete', 'Rocket Body')} stackId="a" fill={COLORS.rocket} />
                  <Bar dataKey="debris" name={tr('Basura', 'Debris')} stackId="a" fill={COLORS.debris} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title={tr('Composición por estado', 'Composition by Scope')} subtitle={tr('Total, en órbita o reingresado', 'Total, in-orbit or reentered')} className="md:col-span-1">
          <div className="mb-2 inline-flex rounded-lg border border-white/10 bg-black/30 p-1 gap-1">
            {[
              { key: 'total', label: tr('Total', 'Total') },
              { key: 'orbit', label: tr('Órbita', 'Orbit') },
              { key: 'reentered', label: tr('Reingresado', 'Reentered') },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setCompositionMode(opt.key)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${compositionMode === opt.key ? 'bg-cyan-400/25 text-cyan-100 border border-cyan-300/40' : 'text-white/70 hover:bg-white/10'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="h-[300px] flex items-center justify-between gap-3">
            <div className="flex-1 h-full">
              <DeferredViz ready={chartsReady}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<CustomTooltip />} />
                    <Pie data={selectedComposition} dataKey="value" nameKey="name" innerRadius={60} outerRadius={80} paddingAngle={2}>
                      {selectedComposition.map((e) => (
                        <Cell key={e.key} fill={e.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </DeferredViz>
            </div>
            <div className="w-[140px]">
              {selectedComposition.map((e) => (
                <div key={e.key} className="flex items-center justify-between gap-3 text-xs mb-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: e.color }} />
                    <span className="text-white/70">{e.name}</span>
                  </div>
                  <span className="font-mono text-gray-500">{e.value}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard title={tr('Tendencia de reingresos', 'Reentry Trend')} subtitle={tr('Anual y promedio móvil de 5 años', 'Annual and 5-year moving average')} className="md:col-span-2">
          <div className="h-[260px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={reentryTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradReentry" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.decayed} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={COLORS.decayed} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="year" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="count" name={tr('Reingresos', 'Reentries')} stroke={COLORS.decayed} fill="url(#gradReentry)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ma5" name={tr('Promedio móvil 5a', '5y Moving Avg')} stroke={COLORS.payload} fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard
          title={tr('Vida en órbita por tipo', 'Orbital Lifetime by Type')}
          subtitle={tr('Promedio de años hasta reingreso (solo muestras válidas)', 'Average years until reentry (valid samples only)')}
          className="md:col-span-1"
          warningText={tr(
            `Solo incluye reingresados con tiempo en órbita válido (${filterMetrics.lifetimeValid}/${filterMetrics.reenteredTotal} · ${formatPct(filterMetrics.lifetimeCoverage)}).`,
            `Only includes reentries with valid orbit-time (${filterMetrics.lifetimeValid}/${filterMetrics.reenteredTotal} · ${formatPct(filterMetrics.lifetimeCoverage)}).`,
          )}
        >
          <div className="h-[260px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lifetimeByType} layout="vertical" margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'monospace' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="avgYears" name={tr('Años promedio', 'Avg years')} fill={COLORS.payload} radius={[8, 8, 8, 8]} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title={tr('Indice de fragmentacion', 'Fragmentation Index')} subtitle={tr('Porcentaje de basura sobre total por pais', 'Debris share over country total')} className="md:col-span-1">
          <div className="h-[320px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fragmentationIndex} layout="vertical" margin={{ top: 10, right: 10, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis type="category" dataKey="country" width={50} tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip formatter={(v) => formatPct(Number(v))} />
                  <Bar dataKey="fragPct" name={tr('% Basura', '% Debris')} fill={COLORS.debris} radius={[8, 8, 8, 8]} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard
          title={tr('Latitud de reingreso', 'Reentry Latitude')}
          subtitle={tr('Impactos agrupados en bandas de 10 grados', 'Impacts binned in 10° bands')}
          className="md:col-span-1"
          warningText={tr(
            `Usa solo eventos de reingreso con posición de alta fidelidad (${filterMetrics.impactsRows} eventos).`,
            `Uses only high-fidelity positioned reentry events (${filterMetrics.impactsRows} events).`,
          )}
        >
          <div className="h-[320px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latBands} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="band" interval={2} angle={-35} textAnchor="end" height={60} tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name={tr('Cuenta', 'Count')} fill={COLORS.decayed} radius={[8, 8, 4, 4]} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title={tr('Regimenes orbitales', 'Orbital Regimes')} subtitle={tr('LEO/MEO/GEO por periodo (min)', 'LEO/MEO/GEO by period (min)')} className="md:col-span-1">
          <div className="h-[240px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<CustomTooltip />} />
                  <Pie data={regimes} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                    {regimes.map((e) => (
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title={tr('Top paises por huella orbital', 'Top Countries by Orbital Footprint')} subtitle={tr('Objetos, composicion, masa y reingresos', 'Objects, composition, mass and reentries')} className="md:col-span-3">
          <TableWrap>
            <DataTable
              columns={countryFootprintColumns}
              rows={countryFootprint}
              searchPlaceholder={tr('Buscar pais o valor...', 'Search country or value...')}
              initialSort={{ key: 'total', dir: 'desc' }}
            />
          </TableWrap>
        </GlassCard>

        <GlassCard
          title={tr('Vida orbital por tipo (detallada)', 'Orbital Lifetime by Type (Detailed)')}
          subtitle={tr('Promedio, mediana y percentiles (solo muestras con tiempo en órbita válido)', 'Average, median and percentiles (valid orbit-time samples only)')}
          className="md:col-span-3"
          warningText={tr(
            `Solo muestra registros con tiempo en órbita válido (${filterMetrics.lifetimeValid}/${filterMetrics.reenteredTotal} · ${formatPct(filterMetrics.lifetimeCoverage)}).`,
            `Only shows records with valid orbit-time (${filterMetrics.lifetimeValid}/${filterMetrics.reenteredTotal} · ${formatPct(filterMetrics.lifetimeCoverage)}).`,
          )}
        >
          <TableWrap>
            <DataTable
              columns={lifetimeStatsColumns}
              rows={lifetimeStatsTable}
              searchPlaceholder={tr('Buscar tipo o metrica...', 'Search type or metric...')}
              initialSort={{ key: 'avgYears', dir: 'desc' }}
            />
          </TableWrap>
        </GlassCard>

        <GlassCard title={tr('Cohortes de lanzamiento', 'Launch Cohorts')} subtitle={tr('Decadas de lanzamiento y comportamiento de reingreso', 'Launch decades and reentry behavior')} className="md:col-span-3">
          <TableWrap>
            <DataTable
              columns={cohortColumns}
              rows={launchCohorts}
              searchPlaceholder={tr('Buscar cohorte o valor...', 'Search cohort or value...')}
              initialSort={{ key: 'cohort', dir: 'asc' }}
            />
          </TableWrap>
        </GlassCard>
      </div>

      {loading ? (
        <div className="mt-5 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-widest text-gray-400 font-inter">{tr('Cargando', 'Loading')}</div>
          <div className="text-[11px] text-gray-500 font-mono mt-1">
            {progress.stage} <span className="text-white/60">{progress.rows ? `· ${tr('filas', 'rows')}: ${progress.rows}` : ''}</span>
          </div>
          {sourceMode === 'live' ? (
            <div className="text-[11px] text-gray-500 font-mono mt-2">{tr('El modo en vivo parsea en web worker y agrega en tiempo real.', 'Live mode parses in a web worker and aggregates on the fly.')}</div>
          ) : (
            <div className="text-[11px] text-gray-500 font-mono mt-2">{tr('Se recomienda generar JSON preprocesado para carga instantanea.', 'Prefer generating precomputed JSON for instant loads.')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default memo(AnalyticsModule)
