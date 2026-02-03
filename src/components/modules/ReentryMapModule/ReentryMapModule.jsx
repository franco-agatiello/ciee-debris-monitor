import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet'
import Globe from 'react-globe.gl'
import * as satellite from 'satellite.js'
import * as THREE from 'three'
import { loadCsv, toNumber, toStringSafe } from '../../../utils/csv.js'
import { useDeferredRender } from '../../../hooks/useDeferredRender.js'
import HeatLayer from '../ReentryMap2D/HeatLayer.jsx'

const RECENCY_BUCKETS = [
  { key: 'lt1', label: '< 1 Year ago', color: '#ef4444' },
  { key: '1to5', label: '1 - 5 Years ago', color: '#eab308' },
  { key: '5to10', label: '5 - 10 Years ago', color: '#22c55e' },
  { key: 'gt10', label: '> 10 Years ago', color: '#1e40af' },
]

const MASS_BUCKETS = [
  { key: 'light', label: 'Light (< 100 kg)' },
  { key: 'medium', label: 'Medium (100–1000 kg)' },
  { key: 'heavy', label: 'Heavy (> 1000 kg)' },
]

function classifyObjectType(claseObj) {
  const raw = stripQuotes(claseObj)
  const s = String(raw || '').trim().toUpperCase()

  // Strict mapping requested by user
  if (!s || s.includes('TBA') || s.includes('UNKNOWN')) return { normKey: 'unknown', label: 'Unknown', raw: s }

  // IMPORTANT: Debris must win even if the string also contains PAYLOAD/ROCKET
  // Examples: "PAYLOAD FRAGMENTATION DEBRIS" and "ROCKET FRAGMENTATION DEBRIS" => Debris
  if (s.includes('DEBRIS') || s.includes('DEB')) return { normKey: 'debris', label: 'Debris', raw: s }

  // Mission related objects are assigned by parent (payload vs rocket)
  if (s.includes('MISSION RELATED OBJECT')) {
    if (s.includes('PAYLOAD')) return { normKey: 'payload', label: 'Payload', raw: s }
    if (s.includes('ROCKET') || s.includes('R/B')) return { normKey: 'rocket', label: 'Rocket Body', raw: s }
    return { normKey: 'unknown', label: 'Unknown', raw: s }
  }

  if (s.includes('PAYLOAD')) return { normKey: 'payload', label: 'Payload', raw: s }
  if (s.includes('ROCKET') || s.includes('R/B') || s.includes('ROCKET BODY')) return { normKey: 'rocket', label: 'Rocket Body', raw: s }

  // Fallbacks (keep some tolerance for mixed datasets)
  if (s.includes('CUERPO') || s.includes('BODY')) return { normKey: 'rocket', label: 'Rocket Body', raw: s }
  if (s.includes('CARGA')) return { normKey: 'payload', label: 'Payload', raw: s }
  return { normKey: 'unknown', label: 'Unknown', raw: s }
}

function massBucketKey(massKg) {
  if (!Number.isFinite(massKg)) return null
  if (massKg < 100) return 'light'
  if (massKg <= 1000) return 'medium'
  return 'heavy'
}

function normalizeConstellation(value) {
  const raw = stripQuotes(value)
  if (!raw) return ''
  return raw.trim()
}

function yearsSince(d, now) {
  const ms = now.getTime() - d.getTime()
  if (!Number.isFinite(ms)) return null
  return ms / (365.25 * 24 * 60 * 60 * 1000)
}

function getColorByDate(dateStr, now = new Date()) {
  const d = safeParseDate(dateStr)
  if (!d) return '#94a3b8'
  const yrs = yearsSince(d, now)
  if (yrs == null) return '#94a3b8'
  if (yrs < 1) return '#ef4444'
  if (yrs < 5) return '#eab308'
  if (yrs < 10) return '#22c55e'
  return '#1e40af'
}

function stripQuotes(s) {
  const v = String(s || '').trim()
  if (!v) return ''
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}

function safeParseDate(value) {
  const raw = stripQuotes(value)
  if (!raw) return null

  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return d

  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const dd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0))
  return Number.isNaN(dd.getTime()) ? null : dd
}

function yearFromDateString(value) {
  if (!value) return null
  const s = String(value)
  const m = s.match(/\b(19\d{2}|20\d{2})\b/)
  return m ? Number(m[1]) : null
}

function normalizeLon(lon) {
  if (!Number.isFinite(lon)) return lon
  return ((lon + 180) % 360 + 360) % 360 - 180
}

function computeGroundTrackSegments(tle1, tle2, centerTime, orbitsToPlot = 3) {
  try {
    const satrec = satellite.twoline2satrec(tle1, tle2)
    if (!satrec) return { segments: [], periodMin: 90 }

    let periodMin = 90
    try {
      const meanMotion = satrec?.no ? (satrec.no * 1440) / (2 * Math.PI) : null
      if (meanMotion && Number.isFinite(meanMotion) && meanMotion > 0) periodMin = 1440 / meanMotion
    } catch {
      // ignore
    }

    const minutesToPlot = Math.max(30, periodMin * Math.max(1, Number(orbitsToPlot) || 1))
    const startTime = new Date(centerTime.getTime() - minutesToPlot * 60000)
    const endTime = centerTime
    const stepMinutes = 1

    const segments = []
    let segment = []
    let prevLon = null

    for (let t = startTime.getTime(); t <= endTime.getTime(); t += stepMinutes * 60000) {
      const time = new Date(t)
      const gmst = satellite.gstime(time)
      const posVel = satellite.propagate(satrec, time)
      if (!posVel?.position) continue

      const geo = satellite.eciToGeodetic(posVel.position, gmst)
      const lat = satellite.degreesLat(geo.latitude)
      let lon = satellite.degreesLong(geo.longitude)

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue
      lon = normalizeLon(lon)

      if (prevLon != null) {
        const delta = Math.abs(lon - prevLon)
        if (delta > 180) {
          if (segment.length > 1) segments.push(segment)
          segment = []
        }
      }

      segment.push([lat, lon])
      prevLon = lon
    }

    if (segment.length > 1) segments.push(segment)
    return { segments, periodMin }
  } catch {
    return { segments: [], periodMin: 90 }
  }
}

function degToRad(d) {
  return (d * Math.PI) / 180
}

function geoToUnitXYZ(latDeg, lngDeg, altR) {
  const lat = degToRad(latDeg)
  const lng = degToRad(lngDeg)
  const r = 1 + altR

  const cosLat = Math.cos(lat)
  const sinLat = Math.sin(lat)
  const cosLng = Math.cos(lng)
  const sinLng = Math.sin(lng)

  const x = r * cosLat * sinLng
  const y = r * sinLat
  const z = r * cosLat * cosLng
  return [x, y, z]
}

function computeOrbitLine(globeRadius, tle1, tle2, centerTime, orbitsToPlot = 3) {
  const satrec = satellite.twoline2satrec(tle1, tle2)
  if (!satrec) return null

  let periodMin = 90
  try {
    const meanMotion = satrec?.no ? (satrec.no * 1440) / (2 * Math.PI) : null
    if (meanMotion && Number.isFinite(meanMotion) && meanMotion > 0) periodMin = 1440 / meanMotion
  } catch {
    // ignore
  }

  const minutesToPlot = Math.max(30, periodMin * Math.max(1, Number(orbitsToPlot) || 1))
  const start = new Date(centerTime.getTime() - minutesToPlot * 60000)
  const end = centerTime
  const stepMin = minutesToPlot > 8 * 60 ? 2 : 1

  const EARTH_RADIUS_KM = 6371
  const pts = []

  for (let t = start.getTime(); t <= end.getTime(); t += stepMin * 60000) {
    const time = new Date(t)
    const gmst = satellite.gstime(time)
    const posVel = satellite.propagate(satrec, time)
    if (!posVel?.position) continue
    const geo = satellite.eciToGeodetic(posVel.position, gmst)
    const lat = satellite.degreesLat(geo.latitude)
    const lon = satellite.degreesLong(geo.longitude)
    const heightKm = geo.height
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(heightKm)) continue

    const altR = heightKm / EARTH_RADIUS_KM
    const [ux, uy, uz] = geoToUnitXYZ(lat, lon, altR)
    pts.push(new THREE.Vector3(ux * globeRadius, uy * globeRadius, uz * globeRadius))
  }

  if (pts.length < 2) return null
  const geometry = new THREE.BufferGeometry().setFromPoints(pts)
  const material = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.92 })
  const line = new THREE.Line(geometry, material)
  line.frustumCulled = false
  return line
}

function GlassCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`glass rounded-2xl p-4 ${className}`}>
      {title ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold tracking-tight">{title}</div>
            {subtitle ? <div className="text-xs text-white/60 mt-1">{subtitle}</div> : null}
          </div>
        </div>
      ) : null}
      <div className={title ? 'mt-3' : ''}>{children}</div>
    </div>
  )
}

function GlassModal({ open, title, children, blockClose = false, onClose }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/70"
            onClick={blockClose ? undefined : onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="relative w-full max-w-2xl bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-300">{title}</div>
              {blockClose ? null : (
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
                  onClick={onClose}
                >
                  Close
                </button>
              )}
            </div>
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function FilterAccordion({ id, title, openId, setOpenId, children }) {
  const open = openId === id
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpenId((prev) => (prev === id ? '' : id))}
        className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left bg-transparent hover:bg-white/5 transition"
      >
        <div className="text-sm font-extrabold text-white">{title}</div>
        <div className="text-gray-200 text-sm">{open ? '▾' : '▸'}</div>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key={`${id}-content`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 text-gray-200">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Orbit3DModal({ open, point, onClose }) {
  const containerRef = useRef(null)
  const [size, setSize] = useState({ w: 900, h: 540 })

  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(320, Math.floor(r.height)) })
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  const tle1 = stripQuotes(point?.tle1)
  const tle2 = stripQuotes(point?.tle2)
  const centerTime = safeParseDate(point?.date) || new Date()
  const dias = Number.isFinite(point?.diasDiff) ? point.diasDiff : null
  const horas = Number.isFinite(point?.horasDiff) ? point.horasDiff : null

  return (
    <GlassModal open={open} title="3D Orbit View" onClose={onClose}>
      <div className="text-sm text-white/80">
        <div className="font-extrabold">{point?.name || 'Unknown object'}</div>
        <div className="text-xs text-white/60 mono mt-1">NORAD: {point?.norad || '—'}</div>
      </div>

      <div className="mt-4 relative" ref={containerRef}>
        <div className="absolute left-4 top-4 z-10 pointer-events-none">
          <div className="glass rounded-2xl px-4 py-3 max-w-[360px] pointer-events-auto">
            <div className="text-xs text-white/60">Time Difference</div>
            <div className="mt-1 text-sm font-extrabold text-white">
              {dias == null && horas == null ? '—' : `${dias == null ? '—' : dias.toFixed(2)} days, ${horas == null ? '—' : horas.toFixed(2)} hours`}
            </div>
            <div className="mt-2 text-[11px] text-white/60 leading-relaxed">
              This visualizes the trajectory calculated from the last available TLE vs the actual impact point.
            </div>
          </div>
        </div>

        {!tle1 || !tle2 ? (
          <div className="bg-black/40 border border-red-500/30 rounded-xl p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-red-300">Missing TLE</div>
            <div className="mt-2 text-xs text-red-200 mono">This object does not have TLE_LINE1/TLE_LINE2 in the CSV.</div>
          </div>
        ) : (
          <div className="h-[520px] w-full rounded-2xl overflow-hidden border border-white/10">
            <Globe
              key={`${point?.norad || 'x'}-${open ? 'open' : 'closed'}`}
              backgroundColor="#02040a"
              globeImageUrl="/img/earthmap1k.jpg"
              showAtmosphere
              atmosphereColor="#3d7cff"
              atmosphereAltitude={0.12}
              width={size.w}
              height={size.h}
              customLayerData={[{ id: 'orbit' }]}
              customThreeObject={(d, globeRadius) => {
                if (d?.id !== 'orbit') return null
                return computeOrbitLine(globeRadius, tle1, tle2, centerTime, 3)
              }}
            />
          </div>
        )}
      </div>
    </GlassModal>
  )
}

function ReentryMapModule() {
  const heavyReady = useDeferredRender({ delayMs: 750 })

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [ack, setAck] = useState(false)

  const [mode, setMode] = useState('points') // points | heat

  const [selectedCountries, setSelectedCountries] = useState(() => new Set())
  const [countrySearch, setCountrySearch] = useState('')

  const [yearFrom, setYearFrom] = useState(null)
  const [yearTo, setYearTo] = useState(null)

  const [showPayload, setShowPayload] = useState(true)
  const [showRocket, setShowRocket] = useState(true)
  const [showDebris, setShowDebris] = useState(true)
  const [showUnknown, setShowUnknown] = useState(true)

  const [showMassLight, setShowMassLight] = useState(true)
  const [showMassMedium, setShowMassMedium] = useState(true)
  const [showMassHeavy, setShowMassHeavy] = useState(true)

  const [selectedConstellation, setSelectedConstellation] = useState('')

  const [openFilterId, setOpenFilterId] = useState('date')

  const [trackSegments, setTrackSegments] = useState([])
  const [trackMeta, setTrackMeta] = useState(null)

  const [orbitOpen, setOrbitOpen] = useState(false)
  const [orbitPoint, setOrbitPoint] = useState(null)

  const mapHostRef = useRef(null)
  const mapRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => {
      const el = mapHostRef.current
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      setIsFullscreen(Boolean(el && fsEl === el))
      const map = mapRef.current
      if (map) setTimeout(() => map.invalidateSize(), 50)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    onChange()
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  const toggleFullscreen = async () => {
    const el = mapHostRef.current
    if (!el) return
    try {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      if (fsEl) await (document.exitFullscreen?.() || document.webkitExitFullscreen?.())
      else await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let ok = true
    if (!heavyReady) return () => {}
    setLoading(true)
    loadCsv('/data/debris_reingresados_con_pos.csv', { requiredColumns: ['lat_caida', 'lon_caida'] })
      .then((r) => {
        if (!ok) return
        setRows(r)
        setErr('')
      })
      .catch((e) => {
        if (!ok) return
        setErr(String(e?.message || e))
      })
      .finally(() => {
        if (!ok) return
        setLoading(false)
      })
    return () => {
      ok = false
    }
  }, [heavyReady])

  const hasParsedRows = rows.length > 0

  const points = useMemo(() => {
    const out = []
    for (const r of rows) {
      const lat = toNumber(r.lat_caida)
      const lng = toNumber(r.lon_caida)
      if (lat == null || lng == null) continue

      const date = toStringSafe(r.fecha_caida_tip) || toStringSafe(r.DECAY_DATE)
      const year = yearFromDateString(date)

      const claseRaw = toStringSafe(r.clase_objeto)
      const clsInfo = classifyObjectType(claseRaw)

      const massKg = toNumber(r.masa_en_orbita)
      const constellation = normalizeConstellation(toStringSafe(r.constelacion_calc))

      out.push({
        norad: toStringSafe(r.NORAD_CAT_ID),
        name: toStringSafe(r.OBJECT_NAME),
        country: toStringSafe(r.COUNTRY_CODE),
        fallCountry: toStringSafe(r.pais_caida_calc),
        clase: clsInfo.label,
        claseRaw: clsInfo.raw,
        normClass: clsInfo.normKey,
        date,
        year,
        massKg,
        constellation,
        tle1: stripQuotes(toStringSafe(r.TLE_LINE1)),
        tle2: stripQuotes(toStringSafe(r.TLE_LINE2)),
        diasDiff: toNumber(r.dias_diferencia),
        horasDiff: toNumber(r.horas_diferencia),
        lat,
        lng,
      })
    }
    return out
  }, [rows])

  const allCountries = useMemo(() => {
    const set = new Set()
    for (const p of points) {
      if (p.country) set.add(p.country)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [points])

  const allYears = useMemo(() => {
    const set = new Set()
    for (const p of points) {
      if (p.year != null) set.add(p.year)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [points])

  const yearMin = allYears.length ? allYears[0] : 1957
  const yearMax = allYears.length ? allYears[allYears.length - 1] : new Date().getUTCFullYear()

  const allConstellations = useMemo(() => {
    const byKey = new Map()
    for (const p of points) {
      const raw = p.constellation
      if (!raw) continue
      const key = raw.toLowerCase()
      if (key === 'noconstelacion') continue
      if (!byKey.has(key)) byKey.set(key, raw)
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
  }, [points])

  useEffect(() => {
    if (!allCountries.length) return
    setSelectedCountries((prev) => {
      if (prev.size) return prev
      return new Set(allCountries)
    })
  }, [allCountries])

  useEffect(() => {
    if (!allYears.length) return
    setYearFrom((v) => (v == null ? allYears[0] : v))
    setYearTo((v) => (v == null ? allYears[allYears.length - 1] : v))
  }, [allYears])

  useEffect(() => {
    // Keep slider bounds coherent if dataset changes
    setYearFrom((v) => {
      if (v == null) return v
      return Math.min(Math.max(v, yearMin), yearMax)
    })
    setYearTo((v) => {
      if (v == null) return v
      return Math.min(Math.max(v, yearMin), yearMax)
    })
  }, [yearMin, yearMax])

  const filteredPoints = useMemo(() => {
    const from = yearFrom
    const to = yearTo
    const countries = selectedCountries
    const constellationFilter = selectedConstellation

    const massFilterActive = !(showMassLight && showMassMedium && showMassHeavy)

    return points.filter((p) => {
      // Country filter semantics:
      // - size === 0 => user selected none => show nothing
      // - size > 0 => show only checked countries
      if (countries.size === 0) return false
      if (!p.country) return false
      if (!countries.has(p.country)) return false

      if (from != null || to != null) {
        if (p.year == null) return false
        if (from != null && p.year < from) return false
        if (to != null && p.year > to) return false
      }

      if (p.normClass === 'payload' && !showPayload) return false
      if (p.normClass === 'rocket' && !showRocket) return false
      if (p.normClass === 'debris' && !showDebris) return false
      if (p.normClass === 'unknown' && !showUnknown) return false

      if (constellationFilter) {
        const key = (p.constellation || '').toLowerCase()
        if (!key) return false
        if (key !== constellationFilter.toLowerCase()) return false
      }

      if (massFilterActive) {
        const b = massBucketKey(p.massKg)
        if (!b) return false
        if (b === 'light' && !showMassLight) return false
        if (b === 'medium' && !showMassMedium) return false
        if (b === 'heavy' && !showMassHeavy) return false
      }

      return true
    })
  }, [
    points,
    selectedCountries,
    yearFrom,
    yearTo,
    showPayload,
    showRocket,
    showDebris,
    showUnknown,
    showMassLight,
    showMassMedium,
    showMassHeavy,
    selectedConstellation,
  ])

  const heatPoints = useMemo(() => filteredPoints.map((p) => [p.lat, p.lng, 0.7]), [filteredPoints])

  const visibleCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase()
    if (!q) return allCountries
    return allCountries.filter((c) => c.toLowerCase().includes(q))
  }, [allCountries, countrySearch])

  const counterText = loading ? 'loading…' : `${filteredPoints.length}`

  const clearTrack = () => {
    setTrackSegments([])
    setTrackMeta(null)
  }

  const resetFilters = () => {
    setSelectedCountries(new Set(allCountries))
    setCountrySearch('')
    setYearFrom(yearMin)
    setYearTo(yearMax)
    setShowPayload(true)
    setShowRocket(true)
    setShowDebris(true)
    setShowUnknown(true)
    setShowMassLight(true)
    setShowMassMedium(true)
    setShowMassHeavy(true)
    setSelectedConstellation('')
  }

  return (
    <div className="h-full flex flex-col">
      <style>{`
        /* Dual-thumb range slider: only thumbs capture pointer events */
        .rm-dual-range {
          -webkit-appearance: none;
          appearance: none;
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          background: transparent;
          pointer-events: none;
          outline: none;
        }
        .rm-dual-range::-webkit-slider-runnable-track {
          height: 6px;
          background: rgba(255,255,255,0.18);
          border-radius: 9999px;
        }
        .rm-dual-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          pointer-events: auto;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background: #e2e8f0;
          border: 2px solid rgba(255,255,255,0.35);
          box-shadow: 0 0 0 2px rgba(2,4,10,0.55);
        }
        .rm-dual-range::-moz-range-track {
          height: 6px;
          background: rgba(255,255,255,0.18);
          border-radius: 9999px;
        }
        .rm-dual-range::-moz-range-thumb {
          pointer-events: auto;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background: #e2e8f0;
          border: 2px solid rgba(255,255,255,0.35);
          box-shadow: 0 0 0 2px rgba(2,4,10,0.55);
        }
      `}</style>
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Reentry Map 2D</div>
          <div className="text-sm text-white/70 mt-1">Cyberpunk HUD · IGN basemap · TLE ground tracks</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button
            type="button"
            onClick={() => setMode('points')}
            className={`px-3 py-2 rounded-xl border text-sm font-bold transition ${
              mode === 'points' ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            Points
          </button>
          <button
            type="button"
            onClick={() => setMode('heat')}
            className={`px-3 py-2 rounded-xl border text-sm font-bold transition ${
              mode === 'heat' ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            Heat
          </button>
        </div>
      </div>

      <div className="flex-1 relative w-full h-full" ref={mapHostRef}>
        {err ? (
          <div className="p-5">
            <GlassCard title="Failed to load CSV" subtitle="/public/data/debris_reingresados_con_pos.csv">
              <div className="mono text-xs text-red-300">{err}</div>
            </GlassCard>
          </div>
        ) : !heavyReady ? (
          <div className="absolute inset-0 p-5">
            <div className="glass rounded-2xl p-4 h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm font-bold">Preparing map…</div>
                <div className="text-xs text-white/60 mt-2">Mounting deferred until after transition.</div>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 p-5">
            <div className="glass rounded-2xl p-4 h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm font-bold">Fetching data…</div>
                <div className="text-xs text-white/60 mt-2">Parsing CSV in a web worker.</div>
              </div>
            </div>
          </div>
        ) : !points.length ? (
          <div className="absolute inset-0 p-5">
            <div className="glass rounded-2xl p-4 h-full flex items-center justify-center">
              <div className="text-center max-w-[560px]">
                <div className="text-sm font-bold">No map points available</div>
                <div className="text-xs text-white/70 mt-2">
                  {hasParsedRows
                    ? 'Rows were parsed, but no valid lat/lon points were produced. This can happen if CSV headers don’t match (delimiter issue) or the dataset lacks location columns.'
                    : 'No rows were parsed from the CSV.'}
                </div>
                <div className="text-[11px] text-white/60 mt-3 mono">Expected columns: lat_caida, lon_caida</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute inset-0 z-0">
              <MapContainer
                center={[0, 0]}
                zoom={2}
                worldCopyJump
                className="h-full w-full"
                preferCanvas
                whenCreated={(m) => {
                  mapRef.current = m
                }}
              >
                <TileLayer
                  attribution="© IGN Argentina"
                  url="https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG%3A3857@png/{z}/{x}/{-y}.png"
                  minZoom={1}
                  maxZoom={20}
                />

                {trackSegments.length
                  ? trackSegments.map((seg, i) => (
                      <Polyline
                        key={`trk-${i}`}
                        positions={seg}
                        pathOptions={{ color: '#fbbf24', weight: 2, opacity: 0.95 }}
                      />
                    ))
                  : null}

                {mode === 'heat' ? (
                  <HeatLayer points={heatPoints} radius={26} blur={16} />
                ) : (
                  filteredPoints.map((p) => (
                    <CircleMarker
                      key={`${p.norad}-${p.lat}-${p.lng}`}
                      center={[p.lat, p.lng]}
                      radius={4}
                      pathOptions={{
                        color: '#ffffff',
                        weight: 1,
                        opacity: 0.95,
                        fillColor: getColorByDate(p.date),
                        fillOpacity: 0.9,
                      }}
                    >
                      <Popup className="reentry-popup" maxWidth={360}>
                      <div className="text-xs text-white/70">NORAD</div>
                      <div className="text-sm font-extrabold text-white">{p.norad || '—'}</div>
                      <div className="mt-1 text-sm text-white/90">{p.name || 'Unknown object'}</div>

                      <div className="mt-2 text-xs text-white/80 leading-relaxed">
                        <div>
                          <span className="text-white/60">Type:</span> {p.clase || '—'}
                        </div>
                        <div>
                          <span className="text-white/60">Country:</span> {p.country || '—'}
                        </div>
                        <div>
                          <span className="text-white/60">Reentry:</span> {p.date || '—'}
                        </div>
                        <div>
                          <span className="text-white/60">Constellation:</span> {p.constellation || '—'}
                        </div>
                        <div>
                          <span className="text-white/60">Mass:</span> {Number.isFinite(p.massKg) ? `${p.massKg.toFixed(0)} kg` : '—'}
                        </div>
                        <div>
                          <span className="text-white/60">Time Delta:</span>{' '}
                          <span className="mono">
                            {p.diasDiff == null && p.horasDiff == null
                              ? '—'
                              : `${p.diasDiff == null ? '—' : p.diasDiff.toFixed(2)} days, ${p.horasDiff == null ? '—' : p.horasDiff.toFixed(2)} hours`}
                          </span>
                        </div>
                        {p.fallCountry ? (
                          <div>
                            <span className="text-white/60">Fall country:</span> {p.fallCountry}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          className="flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
                          onClick={() => {
                            setOrbitPoint(p)
                            setOrbitOpen(true)
                          }}
                          disabled={!p.tle1 || !p.tle2}
                          title={!p.tle1 || !p.tle2 ? 'No TLE available for this object' : 'Open 3D orbit viewer'}
                        >
                          View 3D Orbit
                        </button>

                        <button
                          type="button"
                          className="flex-1 px-3 py-2 rounded-xl border text-xs font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
                          onClick={() => {
                            if (!p.tle1 || !p.tle2) return
                            const t = safeParseDate(p.date) || new Date()
                            const { segments, periodMin } = computeGroundTrackSegments(p.tle1, p.tle2, t, 3)
                            setTrackSegments(segments)
                            setTrackMeta({ norad: p.norad, periodMin, orbits: 3 })
                          }}
                          disabled={!p.tle1 || !p.tle2}
                          title={!p.tle1 || !p.tle2 ? 'No TLE available for this object' : 'Compute ground track'}
                        >
                          Show 2D Track
                        </button>
                      </div>

                      {trackSegments.length ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            className="px-3 py-2 rounded-xl border text-xs font-bold transition bg-white/0 border-white/10 hover:bg-white/5"
                            onClick={clearTrack}
                          >
                            Clear Track
                          </button>
                        </div>
                      ) : null}

                      {!p.tle1 || !p.tle2 ? (
                        <div className="mt-2 text-[11px] text-yellow-200/80">
                          Missing TLE_LINE1/TLE_LINE2 → ground track unavailable.
                        </div>
                      ) : null}
                    </Popup>
                    </CircleMarker>
                  ))
                )}
              </MapContainer>
            </div>

            {/* HUD overlays (critical): z-index above Leaflet panes */}
            <div className="absolute inset-0 z-[1000] pointer-events-none">
              <div className="absolute top-4 right-4 pointer-events-auto">
                <div className="rounded-2xl px-4 py-3 bg-[#02040a]/95 backdrop-blur-md border border-white/10 shadow-2xl">
                  <div className="text-xs text-gray-200">Visualized Objects</div>
                  <div className="mono text-lg font-extrabold">{counterText}</div>
                </div>
              </div>

              <div className="absolute bottom-4 right-4 pointer-events-auto">
                <div className="rounded-2xl px-4 py-3 bg-[#02040a]/95 backdrop-blur-md border border-white/10 shadow-2xl">
                  <div className="text-xs text-gray-200">Legend (Recency)</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    {RECENCY_BUCKETS.map((b) => (
                      <div key={b.key} className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ background: b.color }} /> {b.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="absolute left-4 top-4 bottom-4 w-[320px] max-w-[80vw] pointer-events-auto">
                <div className="h-full flex flex-col rounded-2xl overflow-hidden bg-[#02040a]/95 backdrop-blur-md border border-white/10 shadow-2xl text-gray-200">
                  <div className="px-4 py-4 border-b border-white/10">
                    <div className="text-sm font-extrabold text-white">Filters</div>
                    <div className="text-xs text-gray-200 mt-1">Date · Type · Country · Mass · Constellation</div>
                  </div>

                  <div className="flex-1 overflow-auto">
                    <FilterAccordion id="date" title="📅 Date Range" openId={openFilterId} setOpenId={setOpenFilterId}>
                      <div className="text-xs text-gray-200">Year range</div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                        <div className="mono">{yearFrom ?? yearMin}</div>
                        <div className="text-gray-200">→</div>
                        <div className="mono">{yearTo ?? yearMax}</div>
                      </div>

                      <div className="mt-3">
                        {(() => {
                          const fromVal = Math.min(yearFrom ?? yearMin, yearTo ?? yearMax)
                          const toVal = Math.max(yearTo ?? yearMax, yearFrom ?? yearMin)
                          // When thumbs are close, bring the lower slider thumb above so it's draggable.
                          const fromOnTop = fromVal >= toVal - 1
                          return (
                            <div className="relative h-10">
                              <input
                                type="range"
                                min={yearMin}
                                max={yearMax}
                                step={1}
                                value={fromVal}
                                onChange={(e) => {
                                  const v = Number(e.target.value)
                                  const nextFrom = Math.min(v, toVal)
                                  setYearFrom(nextFrom)
                                  setYearTo((t) => {
                                    const tt = t ?? yearMax
                                    return tt < nextFrom ? nextFrom : tt
                                  })
                                }}
                                className={`rm-dual-range ${fromOnTop ? 'z-20' : 'z-10'}`}
                                aria-label="Start year"
                              />
                              <input
                                type="range"
                                min={yearMin}
                                max={yearMax}
                                step={1}
                                value={toVal}
                                onChange={(e) => {
                                  const v = Number(e.target.value)
                                  const nextTo = Math.max(v, fromVal)
                                  setYearTo(nextTo)
                                  setYearFrom((f) => {
                                    const ff = f ?? yearMin
                                    return ff > nextTo ? nextTo : ff
                                  })
                                }}
                                className={`rm-dual-range ${fromOnTop ? 'z-10' : 'z-20'}`}
                                aria-label="End year"
                              />
                            </div>
                          )
                        })()}
                        <div className="flex items-center justify-between text-[11px] text-gray-200">
                          <span className="mono">{yearMin}</span>
                          <span className="mono">{yearMax}</span>
                        </div>
                      </div>
                    </FilterAccordion>

                    <FilterAccordion id="type" title="🧩 Object Type" openId={openFilterId} setOpenId={setOpenFilterId}>
                      <div className="grid grid-cols-1 gap-2">
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showPayload} onChange={(e) => setShowPayload(e.target.checked)} />
                          <span className="text-sm text-gray-200">Payload</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showRocket} onChange={(e) => setShowRocket(e.target.checked)} />
                          <span className="text-sm text-gray-200">Rocket Body</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showDebris} onChange={(e) => setShowDebris(e.target.checked)} />
                          <span className="text-sm text-gray-200">Debris</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showUnknown} onChange={(e) => setShowUnknown(e.target.checked)} />
                          <span className="text-sm text-gray-200">Unknown</span>
                        </label>
                      </div>
                    </FilterAccordion>

                    <FilterAccordion id="country" title="🌎 Country" openId={openFilterId} setOpenId={setOpenFilterId}>
                      <input
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        placeholder="Search country code…"
                        className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-gray-200 placeholder:text-gray-200/70 outline-none focus:border-white/20"
                      />

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border text-xs font-extrabold transition bg-white/10 border-white/10 hover:bg-white/15"
                          onClick={() => setSelectedCountries(new Set(allCountries))}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border text-xs font-extrabold transition bg-black/40 border-white/10 hover:bg-black/50"
                          onClick={() => setSelectedCountries(new Set())}
                        >
                          None
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {visibleCountries.slice(0, 120).map((c) => {
                          const checked = selectedCountries.has(c)
                          return (
                            <label
                              key={c}
                              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedCountries((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(c)) next.delete(c)
                                    else next.add(c)
                                    return next
                                  })
                                }}
                              />
                              <span className="mono text-xs text-gray-200">{c}</span>
                            </label>
                          )
                        })}
                      </div>

                      {visibleCountries.length > 120 ? (
                        <div className="mt-2 text-[11px] text-gray-200">Showing first 120 matches. Refine search to see others.</div>
                      ) : null}
                    </FilterAccordion>

                    <FilterAccordion id="mass" title="⚖️ Mass Category" openId={openFilterId} setOpenId={setOpenFilterId}>
                      <div className="grid grid-cols-1 gap-2">
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showMassLight} onChange={(e) => setShowMassLight(e.target.checked)} />
                          <span className="text-sm text-gray-200">Light (&lt; 100 kg)</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showMassMedium} onChange={(e) => setShowMassMedium(e.target.checked)} />
                          <span className="text-sm text-gray-200">Medium (100–1000 kg)</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                          <input type="checkbox" checked={showMassHeavy} onChange={(e) => setShowMassHeavy(e.target.checked)} />
                          <span className="text-sm text-gray-200">Heavy (&gt; 1000 kg)</span>
                        </label>
                        <div className="mt-2 text-[11px] text-gray-200">
                          Tip: unknown masses are included by default. Once you uncheck any bucket, only objects with known mass matching selected buckets remain.
                        </div>
                      </div>
                    </FilterAccordion>

                    <FilterAccordion id="constellation" title="🛰️ Constellation" openId={openFilterId} setOpenId={setOpenFilterId}>
                      <select
                        value={selectedConstellation}
                        onChange={(e) => setSelectedConstellation(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-gray-200 outline-none focus:border-white/20"
                      >
                        <option value="">All constellations</option>
                        {allConstellations.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-[11px] text-gray-200">“NoConstelacion” is excluded from the dropdown but remains visible when no filter is selected.</div>
                    </FilterAccordion>

                    {trackMeta ? (
                      <FilterAccordion id="track" title="🧭 Ground Track" openId={openFilterId} setOpenId={setOpenFilterId}>
                        <div className="text-sm text-gray-200">
                          NORAD <span className="mono">{trackMeta.norad || '—'}</span>
                        </div>
                        <div className="mt-1 text-sm text-gray-200">
                          ~{trackMeta.periodMin.toFixed(1)} min · {trackMeta.orbits || 3} orbits
                        </div>
                        <div className="mt-3">
                          <button
                            type="button"
                            className="px-3 py-2 rounded-xl border text-xs font-extrabold transition bg-black/40 border-white/10 hover:bg-black/50"
                            onClick={clearTrack}
                          >
                            Clear Track
                          </button>
                        </div>
                      </FilterAccordion>
                    ) : null}
                  </div>

                  <div className="p-4 border-t border-white/10">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="w-full px-4 py-2 rounded-xl border text-sm font-extrabold transition bg-white/10 border-white/20 hover:bg-white/15"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modals must be inside the fullscreen container to remain visible in fullscreen mode */}
            <Orbit3DModal
              open={orbitOpen}
              point={orbitPoint}
              onClose={() => {
                setOrbitOpen(false)
                setOrbitPoint(null)
              }}
            />

            <GlassModal open={!ack} title="High Fidelity Notice" blockClose onClose={() => {}}>
              <div className="text-lg font-extrabold text-white/90">WARNING</div>
              <div className="mt-3 text-sm text-white/80 leading-relaxed">
                This visualization only represents reentry events with high-fidelity location data. It does NOT represent the entire decayed population.
              </div>
              <div className="mt-5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setAck(true)}
                  className="px-4 py-2 rounded-xl border text-sm font-extrabold transition bg-white/10 border-white/20 hover:bg-white/15"
                >
                  Acknowledge
                </button>
              </div>
            </GlassModal>
          </>
        )}
      </div>
    </div>
  )
}

export default memo(ReentryMapModule)
