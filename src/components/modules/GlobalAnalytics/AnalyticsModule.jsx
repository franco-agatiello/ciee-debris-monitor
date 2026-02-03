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

const COLORS = {
  payload: '#06b6d4',
  rocket: '#f97316',
  debris: '#fb923c',
  decayed: '#8b5cf6',
  unknown: '#94a3b8',
  grid: '#334155',
}

function GlassCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 ${className}`}>
      <div className="text-xs font-bold uppercase tracking-widest text-gray-400 font-inter">{title}</div>
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

function formatKg(n) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gkg`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} Mkg`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} t`
  return `${n.toFixed(0)} kg`
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
  const chartsReady = useDeferredRender({ delayMs: 750 })

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ stage: 'Idle', rows: 0 })
  const [sourceMode, setSourceMode] = useState('')

  const [kessler, setKessler] = useState([])
  const [gabbard, setGabbard] = useState({ payload: [], rocket: [], debris: [], unknown: [] })
  const [massBudget, setMassBudget] = useState({ inOrbit: 0, reentered: 0 })
  const [topPolluters, setTopPolluters] = useState([])
  const [latBands, setLatBands] = useState([])
  const [composition, setComposition] = useState([])
  const [regimes, setRegimes] = useState([])
  const [kpis, setKpis] = useState([])
  const [generatedAt, setGeneratedAt] = useState('')

  const abortRef = useRef(null)

  useEffect(() => {
    abortRef.current?.abort?.()
    const ac = new AbortController()
    abortRef.current = ac

    const updateStage = (stage, rows) => setProgress({ stage, rows })

    const applyPrecomputed = (payload) => {
      setKessler(Array.isArray(payload?.kessler) ? payload.kessler : [])
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
      setTopPolluters(Array.isArray(payload?.topPolluters) ? payload.topPolluters : [])
      setLatBands(Array.isArray(payload?.latBands) ? payload.latBands : [])
      setComposition(Array.isArray(payload?.composition) ? payload.composition : [])
      setRegimes(Array.isArray(payload?.regimes) ? payload.regimes : [])
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
      const activeCounts = { PAYLOAD: 0, 'ROCKET BODY': 0, DEBRIS: 0, UNKNOWN: 0 }

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

      updateStage('Parsing catalog…', 0)
      await parseCsvStream(
        '/data/debris_total.csv',
        (r) => {
          catalogCount += 1

          const y = yearFromDate(r.LAUNCH_DATE)
          if (y) launchByYear.set(y, (launchByYear.get(y) || 0) + 1)

          const country = String(r.COUNTRY_CODE || '').trim() || '??'
          const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
          if (!polluters.has(country)) polluters.set(country, { country, payload: 0, rocketBody: 0, debris: 0 })
          const obj = polluters.get(country)
          if (t === 'PAYLOAD') obj.payload += 1
          else if (t === 'ROCKET BODY') obj.rocketBody += 1
          else if (t === 'DEBRIS') obj.debris += 1

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
        (rows) => updateStage('Parsing catalog…', rows),
        ac.signal,
      )

      updateStage('Parsing active…', 0)
      await parseCsvStream(
        '/data/debris_orbita.csv',
        (r) => {
          activeCount += 1
          const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
          activeCounts[t] = (activeCounts[t] || 0) + 1
          const m = toNumber(r.masa_en_orbita)
          if (Number.isFinite(m)) massOrbit += m
        },
        (rows) => updateStage('Parsing active…', rows),
        ac.signal,
      )

      updateStage('Parsing decayed…', 0)
      await parseCsvStream(
        '/data/debris_reingresados.csv',
        (r) => {
          decayedCount += 1
          const y = yearFromDate(r.DECAY_DATE)
          if (y) decayByYear.set(y, (decayByYear.get(y) || 0) + 1)
          const m = toNumber(r.masa_en_orbita)
          if (Number.isFinite(m)) massReentered += m
        },
        (rows) => updateStage('Parsing decayed…', rows),
        ac.signal,
      )

      updateStage('Parsing impacts…', 0)
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
        (rows) => updateStage('Parsing impacts…', rows),
        ac.signal,
      )

      const yearSeries = buildYearSeries(launchByYear, decayByYear)
      const poll = Array.from(polluters.values())
        .map((d) => ({ ...d, total: d.payload + d.rocketBody + d.debris }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12)

      const comp = [
        { name: 'Payload', key: 'PAYLOAD', value: activeCounts.PAYLOAD || 0, color: COLORS.payload },
        { name: 'Rocket Body', key: 'ROCKET BODY', value: activeCounts['ROCKET BODY'] || 0, color: COLORS.rocket },
        { name: 'Debris', key: 'DEBRIS', value: activeCounts.DEBRIS || 0, color: COLORS.debris },
        { name: 'Unknown', key: 'UNKNOWN', value: activeCounts.UNKNOWN || 0, color: COLORS.unknown },
      ]

      const reg = [
        { name: 'LEO (<128m)', value: regimesCounts.LEO, color: '#22c55e' },
        { name: 'MEO (128–1400m)', value: regimesCounts.MEO, color: COLORS.payload },
        { name: 'GEO (>1400m)', value: regimesCounts.GEO, color: COLORS.decayed },
        { name: 'Unknown', value: regimesCounts.UNKNOWN, color: COLORS.unknown },
      ]

      const lat = buildLatBandsFromCounts(latCounts)
      const budget = { inOrbit: massOrbit, reentered: massReentered }

      const kpiList = [
        { label: 'Catalog', value: catalogCount },
        { label: 'Active', value: activeCount },
        { label: 'Decayed', value: decayedCount },
        { label: 'Impacts', value: impactsCount },
        { label: 'In-Orbit Mass', value: formatKg(massOrbit) },
      ]

      setKessler(yearSeries)
      setGabbard(scatter)
      setTopPolluters(poll)
      setLatBands(lat)
      setMassBudget(budget)
      setComposition(comp)
      setRegimes(reg)
      setKpis(kpiList)
      setGeneratedAt('')
    }

    const run = async () => {
      try {
        setLoading(true)
        setError('')

        updateStage('Loading precomputed…', 0)
        const res = await fetch(`${publicUrl('/data/analytics.precomputed.json')}?ts=${Date.now()}`)
        if (res.ok) {
          const payload = await res.json()
          applyPrecomputed(payload)
          setSourceMode('precomputed')
          setLoading(false)
          updateStage('Ready', 0)
          return
        }

        setSourceMode('live')
        await runLiveAggregation()
        setLoading(false)
        updateStage('Ready', 0)
      } catch (e) {
        if (ac.signal.aborted) return
        setError(String(e?.message || e))
        setLoading(false)
      }
    }

    run()
    return () => ac.abort()
  }, [])

  const massBudgetData = useMemo(
    () => [
      { name: 'In-Orbit', value: massBudget.inOrbit },
      { name: 'Reentered', value: massBudget.reentered },
    ],
    [massBudget],
  )

  return (
    <div className="p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Global Analytics</div>
          <div className="text-sm text-white/70 mt-1">
            AEI-style dashboard · {sourceMode === 'precomputed' ? 'Precomputed' : sourceMode === 'live' ? 'Live aggregation' : '—'}
            {sourceMode === 'precomputed' && generatedAt ? ` · ${generatedAt}` : ''}
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
        <GlassCard title="Kessler Syndrome" subtitle="Cumulative launches vs cumulative decays" className="md:col-span-2">
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
                  <Area type="monotone" dataKey="launches" name="Cumulative Launches" stroke={COLORS.payload} fill="url(#gradLaunch)" strokeWidth={2} />
                  <Area type="monotone" dataKey="decays" name="Cumulative Decays" stroke={COLORS.decayed} fill="url(#gradDecay)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title="Mass Budget" subtitle="Total in-orbit mass vs reentered" className="md:col-span-1">
          <div className="h-[260px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={massBudgetData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} tickFormatter={() => ''} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Mass" radius={[10, 10, 6, 6]}>
                    <Cell fill={COLORS.payload} />
                    <Cell fill={COLORS.decayed} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
          <div className="text-[11px] text-gray-500 font-mono mt-2">
            In-Orbit: <span className="text-white/80">{formatKg(massBudget.inOrbit)}</span> · Reentered:{' '}
            <span className="text-white/80">{formatKg(massBudget.reentered)}</span>
          </div>
        </GlassCard>

        <GlassCard title="Gabbard Diagram" subtitle="Period (min) vs altitude (km), 0–40,000km" className="md:col-span-2">
          <div className="h-[300px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis type="number" dataKey="x" name="Period" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} tickLine={false} axisLine={{ stroke: COLORS.grid, opacity: 0.6 }} />
                  <YAxis type="number" dataKey="y" name="Altitude" domain={[0, 40000]} tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} tickLine={false} axisLine={{ stroke: COLORS.grid, opacity: 0.6 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Scatter name="Payload" data={gabbard.payload} fill={COLORS.payload} shape={<TinyDot opacity={0.65} />} />
                  <Scatter name="Rocket Body" data={gabbard.rocket} fill={COLORS.rocket} shape={<TinyDot opacity={0.65} />} />
                  <Scatter name="Debris" data={gabbard.debris} fill={COLORS.debris} shape={<TinyDot opacity={0.6} />} />
                  <Scatter name="Unknown" data={gabbard.unknown} fill={COLORS.unknown} shape={<TinyDot opacity={0.35} />} />
                </ScatterChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
          {sourceMode === 'live' ? (
            <div className="text-[11px] text-gray-500 font-mono mt-2">Downsampled via reservoir sampling to keep the UI responsive.</div>
          ) : null}
        </GlassCard>

        <GlassCard title="Active Composition" subtitle="Current subset (donut)" className="md:col-span-1">
          <div className="h-[300px] flex items-center justify-between gap-3">
            <div className="flex-1 h-full">
              <DeferredViz ready={chartsReady}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<CustomTooltip />} />
                    <Pie data={composition} dataKey="value" nameKey="name" innerRadius={60} outerRadius={80} paddingAngle={2}>
                      {composition.map((e) => (
                        <Cell key={e.key} fill={e.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </DeferredViz>
            </div>
            <div className="w-[140px]">
              {composition.map((e) => (
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

        <GlassCard title="Top Polluters" subtitle="Country code · stacked by type" className="md:col-span-2">
          <div className="h-[320px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topPolluters} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis type="category" dataKey="country" tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} width={50} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 11 }} />
                  <Bar dataKey="payload" name="Payload" stackId="a" fill={COLORS.payload} />
                  <Bar dataKey="rocketBody" name="Rocket Body" stackId="a" fill={COLORS.rocket} />
                  <Bar dataKey="debris" name="Debris" stackId="a" fill={COLORS.debris} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title="Reentry Latitude" subtitle="Impacts binned in 10° bands" className="md:col-span-1">
          <div className="h-[320px]">
            <DeferredViz ready={chartsReady}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latBands} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <XAxis dataKey="band" interval={2} angle={-35} textAnchor="end" height={60} tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="Count" fill={COLORS.decayed} radius={[8, 8, 4, 4]} />
                </BarChart>
              </ResponsiveContainer>
            </DeferredViz>
          </div>
        </GlassCard>

        <GlassCard title="Orbital Regimes" subtitle="LEO/MEO/GEO by period (min)" className="md:col-span-1">
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
      </div>

      {loading ? (
        <div className="mt-5 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-widest text-gray-400 font-inter">Loading</div>
          <div className="text-[11px] text-gray-500 font-mono mt-1">
            {progress.stage} <span className="text-white/60">{progress.rows ? `· rows: ${progress.rows}` : ''}</span>
          </div>
          {sourceMode === 'live' ? (
            <div className="text-[11px] text-gray-500 font-mono mt-2">Live mode parses in a web worker and aggregates on the fly.</div>
          ) : (
            <div className="text-[11px] text-gray-500 font-mono mt-2">Prefer generating precomputed JSON for instant loads.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default memo(AnalyticsModule)
