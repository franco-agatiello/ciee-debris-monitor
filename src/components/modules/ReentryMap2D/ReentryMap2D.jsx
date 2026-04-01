import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import Globe from 'react-globe.gl'
import * as satellite from 'satellite.js'
import * as THREE from 'three'
import { loadCsv, toNumber, toStringSafe } from '../../../utils/csv.js'
import { publicUrl } from '../../../utils/publicUrl'
import HeatLayer from './HeatLayer.jsx'

const CLASS_COLORS = {
  payload: '#06b6d4',
  rocket: '#f97316',
  unknown: '#94a3b8',
}

const EARTH_RADIUS_KM = 6371
const ORBIT_ALTITUDE_VISUAL_SCALE = 1.9
const MAX_ALTITUDE_RATIO = 6.2

function normalizeClass(clase) {
  const s = String(clase || '').toLowerCase()
  if (s.includes('payload') || s.includes('carga')) return 'payload'
  if (s.includes('rocket') || s.includes('body') || s.includes('cuerpo')) return 'rocket'
  return 'unknown'
}

const iconCache = new Map()
function pinIcon(color) {
  const key = String(color)
  if (iconCache.has(key)) return iconCache.get(key)

  const html = `
    <div style="transform: translate3d(0,0,0);">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="1.2" />
        <circle cx="12" cy="10" r="3" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.65)" stroke-width="1" />
      </svg>
    </div>
  `.trim()

  const icon = L.divIcon({
    html,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 27],
    popupAnchor: [0, -26],
  })

  iconCache.set(key, icon)
  return icon
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

  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/) // fallback
  if (!m) return null
  const dd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0))
  return Number.isNaN(dd.getTime()) ? null : dd
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function altitudeKmToVisualRatio(altKm) {
  if (!Number.isFinite(altKm)) return Number.NaN
  const physicalRatio = altKm / EARTH_RADIUS_KM
  return clamp(physicalRatio * ORBIT_ALTITUDE_VISUAL_SCALE, 0.001, MAX_ALTITUDE_RATIO)
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

function computeOrbitLine(globeRadius, tle1, tle2, centerTime) {
  const satrec = satellite.twoline2satrec(tle1, tle2)
  if (!satrec) return null

  let periodMin = 90
  try {
    const meanMotion = satrec?.no ? (satrec.no * 1440) / (2 * Math.PI) : null
    if (meanMotion && Number.isFinite(meanMotion) && meanMotion > 0) periodMin = 1440 / meanMotion
  } catch {
    // ignore
  }

  const start = new Date(centerTime.getTime() - periodMin * 60000)
  const end = centerTime
  const stepMin = periodMin > 360 ? 3 : 1

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
    const altR = altitudeKmToVisualRatio(heightKm)

    const [ux, uy, uz] = geoToUnitXYZ(lat, lon, altR)
    pts.push(new THREE.Vector3(ux * globeRadius, uy * globeRadius, uz * globeRadius))
  }

  if (pts.length < 2) return null
  const geometry = new THREE.BufferGeometry().setFromPoints(pts)
  const material = new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9 })
  const line = new THREE.Line(geometry, material)
  line.frustumCulled = false
  return line
}

function GlassModal({ open, title, children, onClose }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="relative w-full max-w-3xl bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-gray-400 font-inter">{title}</div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
                onClick={onClose}
              >
                Close
              </button>
            </div>
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
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

  return (
    <GlassModal open={open} title="Last Orbit 3D" onClose={onClose}>
      <div className="text-sm text-white/80">
        <div className="font-extrabold">{point?.name || 'Unknown object'}</div>
        <div className="text-xs text-white/60 mono mt-1">NORAD: {point?.norad || '—'}</div>
        <div className="text-xs text-white/60 mt-1">
          This draws the last orbit segment derived from the object’s TLE.
        </div>
      </div>

      {!tle1 || !tle2 ? (
        <div className="mt-4 bg-black/40 border border-red-500/30 rounded-xl p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-red-300">Missing TLE</div>
          <div className="mt-2 text-xs text-red-200 mono">This object does not have TLE_LINE1/TLE_LINE2 in the CSV.</div>
        </div>
      ) : (
        <div ref={containerRef} className="mt-4 h-[520px] w-full rounded-2xl overflow-hidden border border-white/10">
          <Globe
            key={`${point?.norad || 'x'}-${open ? 'open' : 'closed'}`}
            backgroundColor="#02040a"
            globeImageUrl={publicUrl('/img/BlackMarble_2016_3km.jpg')}
            showAtmosphere
            atmosphereColor="#3d7cff"
            atmosphereAltitude={0.12}
            width={size.w}
            height={size.h}
            customLayerData={[{ id: 'orbit' }]}
            customThreeObject={(d, globeRadius) => {
              if (d?.id !== 'orbit') return null
              return computeOrbitLine(globeRadius, tle1, tle2, centerTime)
            }}
          />
        </div>
      )}
    </GlassModal>
  )
}

export default function ReentryMap2D() {
  const [rows, setRows] = useState([])
  const [mode, setMode] = useState('points') // points | heat
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const mapHostRef = useRef(null)
  const mapRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [ack, setAck] = useState(false)
  const [orbitOpen, setOrbitOpen] = useState(false)
  const [orbitPoint, setOrbitPoint] = useState(null)

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
    setLoading(true)
    loadCsv('/data/debris_reingresados_con_pos.csv')
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
  }, [])

  const points = useMemo(() => {
    const out = []
    for (const r of rows) {
      const lat = toNumber(r.lat_caida)
      const lng = toNumber(r.lon_caida)
      if (lat == null || lng == null) continue

      out.push({
        norad: toStringSafe(r.NORAD_CAT_ID),
        name: toStringSafe(r.OBJECT_NAME),
        country: toStringSafe(r.COUNTRY_CODE),
        clase: toStringSafe(r.clase_objeto),
        date: toStringSafe(r.fecha_caida_tip) || toStringSafe(r.DECAY_DATE),
        fallCountry: toStringSafe(r.pais_caida_calc),
        diasDiff: toNumber(r.dias_diferencia),
        horasDiff: toNumber(r.horas_diferencia),
        tle1: toStringSafe(r.TLE_LINE1),
        tle2: toStringSafe(r.TLE_LINE2),
        lat,
        lng,
      })
    }
    return out
  }, [rows])

  const heatPoints = useMemo(() => points.map((p) => [p.lat, p.lng, 0.7]), [points])

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Reentry Map 2D</div>
          <div className="text-sm text-white/70 mt-1">
            Data: <span className="mono">debris_reingresados_con_pos.csv</span>
          </div>
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
            Pins
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
            <div className="glass rounded-2xl p-4">
              <div className="text-sm font-bold">Failed to load CSV</div>
              <div className="mono text-xs text-red-300 mt-2">{err}</div>
              <div className="text-xs text-white/60 mt-3">
                Verify the file exists at <span className="mono">/public/data/debris_reingresados_con_pos.csv</span>.
              </div>
            </div>
          </div>
        ) : (
          <>
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

              {mode === 'heat' ? (
                <HeatLayer points={heatPoints} radius={28} blur={18} />
              ) : (
                points.map((p) => {
                  const cls = normalizeClass(p.clase)
                  const c = CLASS_COLORS[cls] || CLASS_COLORS.unknown
                  return (
                    <Marker key={`${p.norad}-${p.lat}-${p.lng}`} position={[p.lat, p.lng]} icon={pinIcon(c)}>
                      <Popup>
                        <div className="text-sm font-extrabold text-white/90">{p.name || 'Unknown object'}</div>
                        <div className="mono text-xs text-white/60 mt-1">NORAD: {p.norad || '—'}</div>
                        <div className="text-xs text-white/70 mt-2">
                          <span className="text-white/60">Country:</span> {p.country || '—'}
                          {p.fallCountry ? <span className="text-white/50"> · Fall: {p.fallCountry}</span> : null}
                        </div>

                        <div className="mt-3 bg-black/40 border border-white/10 rounded-xl p-3">
                          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400">TLE vs Reentry Time Delta</div>
                          <div className="mt-2 flex items-center justify-between gap-4">
                            <div className="text-xs text-white/70">Days</div>
                            <div className="mono text-xs text-white/90">{p.diasDiff == null ? '—' : p.diasDiff.toFixed(3)}</div>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-4">
                            <div className="text-xs text-white/70">Hours</div>
                            <div className="mono text-xs text-white/90">{p.horasDiff == null ? '—' : p.horasDiff.toFixed(3)}</div>
                          </div>
                          <div className="mt-2 text-[11px] text-white/50">
                            This indicates the estimated lag between reentry time and the last available orbital TLE epoch.
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="px-3 py-2 rounded-xl border text-xs font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
                            onClick={() => {
                              setOrbitPoint(p)
                              setOrbitOpen(true)
                            }}
                          >
                            Visualize Last Orbit 3D
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  )
                })
              )}
            </MapContainer>

            <div className="absolute left-4 bottom-4 glass rounded-2xl px-4 py-3">
              <div className="text-xs text-white/60">Visible</div>
              <div className="mono text-sm font-bold">{loading ? 'loading…' : `${points.length} events`}</div>
            </div>

            <div className="absolute right-4 bottom-4 glass rounded-2xl px-4 py-3">
              <div className="text-xs text-white/60">Legend</div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: CLASS_COLORS.payload }} /> Payload</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: CLASS_COLORS.rocket }} /> Rocket Body</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: CLASS_COLORS.unknown }} /> Other</div>
              </div>
            </div>
          </>
        )}
      </div>

      <GlassModal open={!ack} title="High Fidelity Notice" onClose={() => {}}>
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

      <Orbit3DModal
        open={orbitOpen}
        point={orbitPoint}
        onClose={() => {
          setOrbitOpen(false)
          setOrbitPoint(null)
        }}
      />
    </div>
  )
}
