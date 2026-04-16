import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as satellite from 'satellite.js'
import * as THREE from 'three'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Search, Database, Globe as GlobeIcon, Orbit, Maximize2, Minimize2, AlertTriangle } from 'lucide-react'
import { loadCsv, toNumber, toStringSafe } from '../../../utils/csv.js'
import { COUNTRY_NAMES } from '../../../utils/countryNames.js'
import { useDeferredRender } from '../../../hooks/useDeferredRender.js'
import { useI18n } from '../../../i18n/I18nProvider.jsx'
import { publicUrl } from '../../../utils/publicUrl'

const EARTH_RADIUS_KM = 6371
const ORBIT_ALTITUDE_VISUAL_SCALE = 1.9
const MAX_ALTITUDE_RATIO = 6.2
const RESULTS_STEP = 200
const PREVIEW_REFRESH_MS = 30000
const SORT_MODE_RECENT = 'recent'
const SORT_MODE_OLDEST = 'oldest'
const SORT_MODE_ALPHA = 'alpha'
const PREVIEW_MIN_ALTITUDE = 3.2
const PREVIEW_MAX_ALTITUDE = 20
const ORBITAL_SNAPSHOT_REFRESH_MS = 1500
const ORBITAL_HISTORY_POINTS = 181
const ORBITAL_HISTORY_REFRESH_MS = 30000
const STARFIELD_NEAR_MIN_SCALE = 10
const STARFIELD_NEAR_MAX_SCALE = 24
const STARFIELD_FAR_MIN_SCALE = 22
const STARFIELD_FAR_MAX_SCALE = 56

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function safeParseDate(value) {
  const raw = toStringSafe(value)
  if (!raw) return null
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return d
  return null
}

function altitudeKmToVisualRatio(altKm) {
  if (!Number.isFinite(altKm)) return Number.NaN
  const physicalRatio = altKm / EARTH_RADIUS_KM
  return clamp(physicalRatio * ORBIT_ALTITUDE_VISUAL_SCALE, 0.001, MAX_ALTITUDE_RATIO)
}

function eciToPreviewVector(positionEci, globeRadius, gmst) {
  const ecf = satellite.eciToEcf(positionEci, gmst)
  const rx = Number(ecf?.x)
  const ry = Number(ecf?.y)
  const rz = Number(ecf?.z)
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) return null

  const rKm = Math.hypot(rx, ry, rz)
  if (!Number.isFinite(rKm) || rKm <= 0) return null

  const altR = altitudeKmToVisualRatio(rKm - EARTH_RADIUS_KM)
  if (!Number.isFinite(altR)) return null

  const invR = 1 / rKm
  const ux = ry * invR
  const uy = rz * invR
  const uz = rx * invR
  const radius = 1 + altR

  return new THREE.Vector3(ux * radius * globeRadius, uy * radius * globeRadius, uz * radius * globeRadius)
}

function createCircularHaloTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.62, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function createStarSpriteTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.38, 'rgba(255,255,255,0.95)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function createStarfieldObject(globeRadius, starSpriteTexture) {
  if (!starSpriteTexture) return null

  const createLayer = (count, minRadius, maxRadius, sizePx, opacity) => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const u = Math.random()
      const v = Math.random()
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      const radius = minRadius + (maxRadius - minRadius) * Math.pow(Math.random(), 0.72)
      const sinPhi = Math.sin(phi)
      const x = radius * sinPhi * Math.cos(theta)
      const y = radius * Math.cos(phi)
      const z = radius * sinPhi * Math.sin(theta)
      const idx = i * 3
      positions[idx] = x
      positions[idx + 1] = y
      positions[idx + 2] = z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      map: starSpriteTexture,
      alphaMap: starSpriteTexture,
      color: 0xffffff,
      size: sizePx,
      transparent: true,
      opacity,
      alphaTest: 0.02,
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: false,
      blending: THREE.AdditiveBlending,
    })

    return new THREE.Points(geometry, material)
  }

  const group = new THREE.Group()
  group.add(
    createLayer(
      1400,
      globeRadius * STARFIELD_NEAR_MIN_SCALE,
      globeRadius * STARFIELD_NEAR_MAX_SCALE,
      1.35,
      0.36,
    ),
  )
  group.add(
    createLayer(
      2200,
      globeRadius * STARFIELD_FAR_MIN_SCALE,
      globeRadius * STARFIELD_FAR_MAX_SCALE,
      1.0,
      0.22,
    ),
  )
  group.renderOrder = -10
  return group
}

function estimatePreviewViewAltitude(tle1, tle2, centerTime) {
  try {
    const satrec = satellite.twoline2satrec(String(tle1 || '').trim(), String(tle2 || '').trim())
    if (!satrec) return PREVIEW_MIN_ALTITUDE

    let periodMin = 90
    const meanMotion = satrec?.no ? (satrec.no * 1440) / (2 * Math.PI) : null
    if (meanMotion && Number.isFinite(meanMotion) && meanMotion > 0) periodMin = 1440 / meanMotion

    const referenceTime = centerTime instanceof Date && Number.isFinite(centerTime.getTime()) ? centerTime : new Date()
    const sampleCount = Math.max(24, Math.min(180, Math.round(periodMin / 2)))
    const stepMs = (Math.max(40, periodMin) * 60000) / sampleCount

    let maxRadius = 1
    const start = referenceTime.getTime() - (stepMs * sampleCount) / 2

    for (let i = 0; i <= sampleCount; i++) {
      const time = new Date(start + i * stepMs)
      const pv = satellite.propagate(satrec, time)
      if (!pv?.position) continue

      const rKm = Math.hypot(Number(pv.position.x), Number(pv.position.y), Number(pv.position.z))
      if (!Number.isFinite(rKm) || rKm <= 0) continue

      const altR = altitudeKmToVisualRatio(rKm - EARTH_RADIUS_KM)
      if (!Number.isFinite(altR)) continue

      maxRadius = Math.max(maxRadius, 1 + altR)
    }

    // Convert desired orbit radius in scene units to camera altitude over globe surface.
    // Add extra breathing room for large (e.g., GEO-like) orbits.
    const geoBonus = maxRadius >= 10 ? 1.8 : maxRadius >= 7 ? 0.9 : 0.3
    const targetAltitude = maxRadius * 1.9 - 0.4 + geoBonus
    return clamp(targetAltitude, PREVIEW_MIN_ALTITUDE, PREVIEW_MAX_ALTITUDE)
  } catch {
    return PREVIEW_MIN_ALTITUDE
  }
}

function computeOrbitPreviewObject(globeRadius, tle1, tle2, centerTime) {
  try {
    const satrec = satellite.twoline2satrec(String(tle1 || '').trim(), String(tle2 || '').trim())
    if (!satrec) return null

    let periodMin = 90
    const meanMotion = satrec?.no ? (satrec.no * 1440) / (2 * Math.PI) : null
    if (meanMotion && Number.isFinite(meanMotion) && meanMotion > 0) periodMin = 1440 / meanMotion

    const referenceTime = centerTime instanceof Date && Number.isFinite(centerTime.getTime()) ? centerTime : new Date()
    const minutesToPlot = Math.max(40, periodMin)
    const start = new Date(referenceTime.getTime() - (minutesToPlot * 60000) / 2)
    const end = new Date(referenceTime.getTime() + (minutesToPlot * 60000) / 2)
    const gmstRef = satellite.gstime(referenceTime)

    const points = []
    let currentPoint = null

    for (let t = start.getTime(); t <= end.getTime(); t += 60 * 1000) {
      const time = new Date(t)
      const pv = satellite.propagate(satrec, time)
      if (!pv?.position) continue

      const p = eciToPreviewVector(pv.position, globeRadius, gmstRef)
      if (!p) continue
      points.push(p)
      if (Math.abs(t - referenceTime.getTime()) < 30000) currentPoint = p
    }

    if (points.length < 2) return null

    const group = new THREE.Group()
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(lineGeo, lineMat)
    line.frustumCulled = false
    group.add(line)

    if (currentPoint) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.018 * globeRadius, 0.85), 20, 20),
        new THREE.MeshBasicMaterial({ color: 0x7ef9ff, transparent: true, opacity: 1 }),
      )
      marker.position.copy(currentPoint)

      const haloTexture = createCircularHaloTexture()

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: 0x4df4ff,
          map: haloTexture || undefined,
          transparent: true,
          opacity: 0.48,
          alphaTest: 0.02,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      const glowScale = Math.max(0.05 * globeRadius, 1.45)
      glow.scale.set(glowScale, glowScale, 1)
      glow.position.copy(currentPoint)

      const outerHalo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: 0x9ffbff,
          map: haloTexture || undefined,
          transparent: true,
          opacity: 0.2,
          alphaTest: 0.02,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      const outerHaloScale = Math.max(0.08 * globeRadius, 2.15)
      outerHalo.scale.set(outerHaloScale, outerHaloScale, 1)
      outerHalo.position.copy(currentPoint)

      group.add(marker)
      group.add(glow)
      group.add(outerHalo)
      group.userData.pulse = {
        marker,
        glow,
        outerHalo,
        markerBaseScale: marker.scale.x || 1,
        glowBaseScale: glowScale,
        outerHaloBaseScale: outerHaloScale,
      }
      group.userData.live = {
        satrec,
        globeRadius,
        marker,
        glow,
        outerHalo,
      }
    }

    return group
  } catch {
    return null
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = toStringSafe(v)
    if (s) return s
  }
  return ''
}

function normalizeType(v) {
  const s = toStringSafe(v).toUpperCase()
  if (!s) return 'UNKNOWN'
  if (s === 'PAYLOAD') return 'PAYLOAD'
  if (s === 'ROCKET BODY' || s === 'ROCKET' || s === 'RB') return 'ROCKET BODY'
  if (s === 'DEBRIS') return 'DEBRIS'
  if (s.includes('DEBRIS')) return 'DEBRIS'
  if (s.includes('ROCKET')) return 'ROCKET BODY'
  if (s.includes('PAYLOAD')) return 'PAYLOAD'
  return s
}

function fmtNum(v, d = 2) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(d) : '—'
}

function fmtDate(v) {
  const s = toStringSafe(v)
  return s || '—'
}

function fmtSigned(v, d = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toFixed(d)
  return `${n >= 0 ? '+' : '-'}${abs}`
}

function fmtUtcIso(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC')
}

function radiansToDegrees(rad) {
  const n = Number(rad)
  if (!Number.isFinite(n)) return Number.NaN
  return n * (180 / Math.PI)
}

function normalizeAngleDeg(deg) {
  const n = Number(deg)
  if (!Number.isFinite(n)) return Number.NaN
  const out = ((n % 360) + 360) % 360
  return out
}

function computeTrueAnomalyDeg(positionEci, velocityEci) {
  const rx = Number(positionEci?.x)
  const ry = Number(positionEci?.y)
  const rz = Number(positionEci?.z)
  const vx = Number(velocityEci?.x)
  const vy = Number(velocityEci?.y)
  const vz = Number(velocityEci?.z)
  if (![rx, ry, rz, vx, vy, vz].every(Number.isFinite)) return Number.NaN

  const rVec = new THREE.Vector3(rx, ry, rz)
  const vVec = new THREE.Vector3(vx, vy, vz)
  const r = rVec.length()
  const v = vVec.length()
  if (!Number.isFinite(r) || !Number.isFinite(v) || r <= 0 || v <= 0) return Number.NaN

  const mu = 398600.4418
  const hVec = new THREE.Vector3().crossVectors(rVec, vVec)
  const eVec = new THREE.Vector3()
    .crossVectors(vVec, hVec)
    .multiplyScalar(1 / mu)
    .sub(rVec.clone().multiplyScalar(1 / r))
  const e = eVec.length()
  if (!Number.isFinite(e) || e < 1e-8) return Number.NaN

  const cosNu = THREE.MathUtils.clamp(eVec.dot(rVec) / (e * r), -1, 1)
  let nu = Math.acos(cosNu)
  if (rVec.dot(vVec) < 0) nu = 2 * Math.PI - nu
  return normalizeAngleDeg(radiansToDegrees(nu))
}

function computeOsculatingElements(positionEci, velocityEci) {
  const rx = Number(positionEci?.x)
  const ry = Number(positionEci?.y)
  const rz = Number(positionEci?.z)
  const vx = Number(velocityEci?.x)
  const vy = Number(velocityEci?.y)
  const vz = Number(velocityEci?.z)
  if (![rx, ry, rz, vx, vy, vz].every(Number.isFinite)) return null

  const mu = 398600.4418
  const rVec = new THREE.Vector3(rx, ry, rz)
  const vVec = new THREE.Vector3(vx, vy, vz)
  const r = rVec.length()
  const v2 = vVec.lengthSq()
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(v2)) return null

  const hVec = new THREE.Vector3().crossVectors(rVec, vVec)
  const h = hVec.length()
  if (!Number.isFinite(h) || h <= 0) return null

  const kHat = new THREE.Vector3(0, 0, 1)
  const nVec = new THREE.Vector3().crossVectors(kHat, hVec)
  const n = nVec.length()

  const eVec = new THREE.Vector3()
    .crossVectors(vVec, hVec)
    .multiplyScalar(1 / mu)
    .sub(rVec.clone().multiplyScalar(1 / r))
  const e = eVec.length()

  const energy = v2 / 2 - mu / r
  const semiMajorAxisKm = Number.isFinite(energy) && Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Number.NaN

  const inclinationDeg = radiansToDegrees(Math.acos(THREE.MathUtils.clamp(hVec.z / h, -1, 1)))

  let raanDeg = Number.NaN
  if (n > 1e-8) {
    let raan = Math.acos(THREE.MathUtils.clamp(nVec.x / n, -1, 1))
    if (nVec.y < 0) raan = 2 * Math.PI - raan
    raanDeg = normalizeAngleDeg(radiansToDegrees(raan))
  }

  let argPerigeeDeg = Number.NaN
  if (n > 1e-8 && e > 1e-8) {
    let argp = Math.acos(THREE.MathUtils.clamp(nVec.dot(eVec) / (n * e), -1, 1))
    if (eVec.z < 0) argp = 2 * Math.PI - argp
    argPerigeeDeg = normalizeAngleDeg(radiansToDegrees(argp))
  }

  let periodMin = Number.NaN
  if (Number.isFinite(semiMajorAxisKm) && semiMajorAxisKm > 0) {
    periodMin = (2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxisKm, 3) / mu)) / 60
  }

  return {
    semiMajorAxisKm,
    eccentricity: e,
    inclinationDeg,
    raanDeg,
    argPerigeeDeg,
    periodMin,
  }
}

function computeAdaptiveDomain(data, key) {
  const values = []
  for (const row of data || []) {
    const n = Number(row?.[key])
    if (Number.isFinite(n)) values.push(n)
  }

  if (!values.length) return ['auto', 'auto']

  let min = values[0]
  let max = values[0]
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
  }

  // When series is almost flat, force a tiny symmetric window so variation remains visible.
  if (Math.abs(max - min) < 1e-12) {
    const base = Math.max(Math.abs(min), 1)
    const pad = Math.max(base * 0.02, 1e-6)
    return [min - pad, max + pad]
  }

  const span = max - min
  const pad = Math.max(span * 0.1, 1e-9)
  return [min - pad, max + pad]
}

function buildOrbitalHistorySeries(tle1, tle2, windowDays = 180) {
  try {
    const satrec = satellite.twoline2satrec(String(tle1 || '').trim(), String(tle2 || '').trim())
    if (!satrec || satrec.error) return []

    const safeWindowDays = clamp(Number(windowDays) || 180, 90, 365)
    const halfWindowDays = safeWindowDays / 2
    const stepDays = safeWindowDays / Math.max(1, ORBITAL_HISTORY_POINTS - 1)
    const now = Date.now()

    const series = []
    for (let i = 0; i < ORBITAL_HISTORY_POINTS; i += 1) {
      const deltaDays = -halfWindowDays + i * stepDays
      const time = new Date(now + deltaDays * 24 * 60 * 60000)
      const pv = satellite.propagate(satrec, time)
      if (!pv?.position || !pv?.velocity) continue

      const gmst = satellite.gstime(time)
      const geodetic = satellite.eciToGeodetic(pv.position, gmst)
      const osc = computeOsculatingElements(pv.position, pv.velocity)
      if (!osc) continue

      const speedKmS = Math.hypot(
        Number(pv.velocity.x),
        Number(pv.velocity.y),
        Number(pv.velocity.z),
      )

      const latDeg = satellite.degreesLat(geodetic.latitude)
      const lonDeg = satellite.degreesLong(geodetic.longitude)

      if (!Number.isFinite(geodetic.height) || !Number.isFinite(speedKmS) || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
        continue
      }

      series.push({
        tDay: Number(deltaDays.toFixed(2)),
        dateIso: time.toISOString(),
        altitudeKm: Number(geodetic.height),
        speedKmS,
        latDeg,
        lonDeg,
        periodMin: osc.periodMin,
        eccentricity: osc.eccentricity,
        inclinationDeg: osc.inclinationDeg,
        raanDeg: osc.raanDeg,
        argPerigeeDeg: osc.argPerigeeDeg,
        semiMajorAxisKm: osc.semiMajorAxisKm,
      })
    }

    return series
  } catch {
    return []
  }
}

function OrbitalHistoryCharts({ selected, tr }) {
  const hasTle = Boolean(toStringSafe(selected?.tle1) && toStringSafe(selected?.tle2))
  const isReentered = Boolean(selected?.sources?.reentry || safeParseDate(selected?.decayDate))
  const [windowDays, setWindowDays] = useState(180)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!hasTle || isReentered) return () => {}
    const id = window.setInterval(() => setTick((v) => v + 1), ORBITAL_HISTORY_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [hasTle, isReentered, selected?.id])

  const series = useMemo(() => {
    if (!hasTle || isReentered) return []
    return buildOrbitalHistorySeries(selected.tle1, selected.tle2, windowDays)
  }, [hasTle, isReentered, selected?.id, selected?.tle1, selected?.tle2, windowDays, tick])

  const chartRows = useMemo(
    () => [
      {
        key: 'altitude',
        title: tr('Altitud vs tiempo', 'Altitude vs time'),
        dataKey: 'altitudeKm',
        color: '#22d3ee',
        unit: 'km',
        digits: 2,
        legend: tr('Altitud', 'Altitude'),
      },
      {
        key: 'raan',
        title: tr('RAAN vs tiempo', 'RAAN vs time'),
        dataKey: 'raanDeg',
        color: '#60a5fa',
        unit: '°',
        digits: 2,
        legend: 'RAAN',
      },
      {
        key: 'argPerigee',
        title: tr('Argumento del perigeo vs tiempo', 'Argument of perigee vs time'),
        dataKey: 'argPerigeeDeg',
        color: '#f472b6',
        unit: '°',
        digits: 2,
        legend: tr('Arg. perigeo', 'Arg. perigee'),
      },
      {
        key: 'inclination',
        title: tr('Inclinación vs tiempo', 'Inclination vs time'),
        dataKey: 'inclinationDeg',
        color: '#34d399',
        unit: '°',
        digits: 4,
        legend: tr('Inclinación', 'Inclination'),
      },
      {
        key: 'eccentricity',
        title: tr('Excentricidad vs tiempo', 'Eccentricity vs time'),
        dataKey: 'eccentricity',
        color: '#f59e0b',
        unit: '',
        digits: 6,
        legend: tr('Excentricidad', 'Eccentricity'),
      },
      {
        key: 'period',
        title: tr('Período vs tiempo', 'Period vs time'),
        dataKey: 'periodMin',
        color: '#a78bfa',
        unit: 'min',
        digits: 3,
        legend: tr('Período', 'Period'),
      },
      {
        key: 'speed',
        title: tr('Velocidad vs tiempo', 'Speed vs time'),
        dataKey: 'speedKmS',
        color: '#22d3ee',
        unit: 'km/s',
        digits: 4,
        legend: tr('Velocidad', 'Speed'),
      },
    ],
    [tr],
  )

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-white/75 text-[11px] mb-2">
        <div className="flex items-center gap-2">
          <Orbit className="h-3.5 w-3.5" />
          {tr('Parámetros orbitales en función del tiempo', 'Orbital parameters over time')}
        </div>
        <MethodologyNotice tr={tr} />
      </div>

      {!isReentered ? (
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/60">{tr('Escala temporal', 'Time scale')}:</span>
        {[90, 180, 365].map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => setWindowDays(days)}
            className={`px-2 py-1 rounded-md border text-[11px] transition ${
              windowDays === days
                ? 'bg-cyan-400/10 border-cyan-300/40 text-cyan-100'
                : 'bg-white/5 border-white/15 text-white/80 hover:bg-white/10'
            }`}
          >
            {days === 90
              ? tr('3 meses', '3 months')
              : days === 180
                ? tr('6 meses', '6 months')
                : tr('12 meses', '12 months')}
          </button>
        ))}
      </div>
      ) : null}

      {isReentered ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No se pudo construir la serie temporal para este objeto.', 'Could not build a time series for this object.')}
        </div>
      ) : !hasTle ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No hay TLE suficiente para graficar evolución temporal.', 'No valid TLE available for time-series charts.')}
        </div>
      ) : !series.length ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No se pudo construir la serie temporal para este objeto.', 'Could not build a time series for this object.')}
        </div>
      ) : (
        <div className="space-y-2">
          {chartRows.map((row) => (
            <div key={row.key} className="rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="text-[11px] text-white/70 mb-1">{row.title}</div>
              <div className="h-[180px]">
                {(() => {
                  const leftDomain = computeAdaptiveDomain(series, row.dataKey)
                  return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis
                      dataKey="tDay"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={(v) => `${v}d`}
                      label={{ value: tr('Tiempo relativo (días)', 'Relative time (days)'), position: 'insideBottomRight', offset: -4, fill: '#94a3b8', fontSize: 10 }}
                    />
                    <YAxis
                      yAxisId="left"
                      domain={leftDomain}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={(v) => `${Number(v).toFixed(row.digits)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(2,6,23,0.94)',
                        border: '1px solid rgba(148,163,184,0.35)',
                        borderRadius: '8px',
                        color: '#e2e8f0',
                      }}
                      labelFormatter={(_label, payload) => {
                        const d = payload?.[0]?.payload?.dateIso
                        if (!d) return tr('Sin fecha', 'No date')
                        const date = new Date(d)
                        return Number.isFinite(date.getTime()) ? date.toUTCString() : String(d)
                      }}
                      formatter={(value) => {
                        const n = Number(value)
                        return [`${Number.isFinite(n) ? n.toFixed(row.digits) : '—'} ${row.unit}`, row.legend || row.title]
                      }}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey={row.dataKey}
                      stroke={row.color}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                  )
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getLaunchTs(row) {
  const launchTs = safeParseDate(row?.launchDate)?.getTime() ?? -1
  return launchTs
}

function getTextMatchScore(row, q) {
  if (!q) return 0

  const strongFields = [row?.name, row?.objectId, row?.country, row?.objectType]
  let score = 0

  for (const raw of strongFields) {
    const v = toStringSafe(raw).toLowerCase()
    if (!v) continue
    if (v === q) score = Math.max(score, 6)
    else if (v.startsWith(q)) score = Math.max(score, 4)
    else if (v.includes(q)) score = Math.max(score, 2)
  }

  // NORAD remains searchable but no longer drives ranking.
  const norad = toStringSafe(row?.norad).toLowerCase()
  if (norad === q) score = Math.max(score, 2)
  else if (norad.startsWith(q)) score = Math.max(score, 1)

  return score
}

function mergeRow(entry, row, source) {
  const norad = firstNonEmpty(row.NORAD_CAT_ID, row.norad)
  const name = firstNonEmpty(row.OBJECT_NAME, row.objeto, row.nombre)
  const objectId = firstNonEmpty(row.OBJECT_ID)
  const country = firstNonEmpty(row.COUNTRY_CODE)
  const objectType = normalizeType(firstNonEmpty(row.OBJECT_TYPE, row.clase_objeto))

  entry.norad = entry.norad || norad
  entry.name = entry.name || name
  entry.objectId = entry.objectId || objectId
  entry.country = entry.country || country
  entry.objectType = entry.objectType === 'UNKNOWN' ? objectType : entry.objectType

  entry.launchDate = entry.launchDate || firstNonEmpty(row.LAUNCH_DATE)
  entry.decayDate = entry.decayDate || firstNonEmpty(row.DECAY_DATE, row.fecha_caida_tip)
  entry.epoch = entry.epoch || firstNonEmpty(row.EPOCH)

  entry.period = entry.period ?? toNumber(row.PERIOD)
  entry.inclination = entry.inclination ?? toNumber(row.INCLINATION)
  entry.eccentricity = entry.eccentricity ?? toNumber(row.ECCENTRICITY)
  entry.apoapsis = entry.apoapsis ?? toNumber(row.APOAPSIS)
  entry.periapsis = entry.periapsis ?? toNumber(row.PERIGEE ?? row.PERIAPSIS)

  entry.massKg = entry.massKg ?? toNumber(row.masa_en_orbita)
  entry.constellation = entry.constellation || firstNonEmpty(row.constelacion_calc)
  entry.fallCountry = entry.fallCountry || firstNonEmpty(row.pais_caida_calc)
  entry.latFall = entry.latFall ?? toNumber(row.lat_caida)
  entry.lonFall = entry.lonFall ?? toNumber(row.lon_caida)
  entry.daysInOrbit = entry.daysInOrbit ?? toNumber(row.dias_en_orbita)
  entry.deltaDays = entry.deltaDays ?? toNumber(row.dias_diferencia)
  entry.deltaHours = entry.deltaHours ?? toNumber(row.horas_diferencia)

  entry.tle0 = entry.tle0 || firstNonEmpty(row.TLE_LINE0)
  entry.tle1 = entry.tle1 || firstNonEmpty(row.TLE_LINE1)
  entry.tle2 = entry.tle2 || firstNonEmpty(row.TLE_LINE2)

  entry.sources[source] = true

  // Derived flags from total catalog to avoid loading extra CSVs.
  const hasDecayDate = Boolean(firstNonEmpty(row.DECAY_DATE, row.fecha_caida_tip))
  entry.sources.orbit = entry.sources.orbit || !hasDecayDate
  entry.sources.reentry = entry.sources.reentry || hasDecayDate
  const lat = toNumber(row.lat_caida)
  const lon = toNumber(row.lon_caida)
  entry.sources.impact = entry.sources.impact || (Number.isFinite(lat) && Number.isFinite(lon))
}

function buildUnifiedCatalog(rowsTotal) {
  const map = new Map()

  const upsert = (row, source) => {
    const norad = firstNonEmpty(row.NORAD_CAT_ID, row.norad)
    const fallback = firstNonEmpty(row.OBJECT_ID, row.OBJECT_NAME)
    const key = norad || fallback
    if (!key) return

    if (!map.has(key)) {
      map.set(key, {
        id: key,
        norad: '',
        name: '',
        objectId: '',
        country: '',
        objectType: 'UNKNOWN',
        launchDate: '',
        decayDate: '',
        epoch: '',
        period: null,
        inclination: null,
        eccentricity: null,
        apoapsis: null,
        periapsis: null,
        massKg: null,
        constellation: '',
        fallCountry: '',
        latFall: null,
        lonFall: null,
        daysInOrbit: null,
        deltaDays: null,
        deltaHours: null,
        tle0: '',
        tle1: '',
        tle2: '',
        sources: { total: false, orbit: false, reentry: false, impact: false },
      })
    }

    mergeRow(map.get(key), row, source)
  }

  rowsTotal.forEach((r) => upsert(r, 'total'))

  return Array.from(map.values())
}

function statusBadge(active, es, en, tr) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full border text-[10px] font-semibold tracking-wide ${
        active ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100' : 'border-white/15 bg-white/5 text-white/55'
      }`}
    >
      {tr(es, en)}
    </span>
  )
}

function Field({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
      <div className="text-[10px] text-white/55">{label}</div>
      <div className={`mt-0.5 text-[14px] leading-tight text-white/90 ${mono ? 'mono break-all' : ''}`}>{value || '—'}</div>
    </div>
  )
}

function MethodologyNotice({ tr }) {
  const text = tr(
    'Nota metodológica: los valores mostrados son estimaciones con fines orientativos y académicos, obtenidas por propagación numérica a partir del último TLE disponible. No constituyen una determinación operacional en tiempo real y pueden diferir del estado orbital efectivo, especialmente porque no se incorpora un modelado completo de perturbaciones externas ni maniobras.',
    'Methodological note: displayed values are indicative, academic estimates obtained by numerical propagation from the latest available TLE. They are not an operational real-time determination and may differ from the effective orbital state, especially because a complete model of external perturbations and maneuvers is not included.',
  )

  return (
    <div className="relative group">
      <div
        className="inline-flex items-center justify-center rounded-md border border-amber-300/30 bg-amber-400/10 p-1.5 text-amber-100 cursor-help"
        aria-label={tr('Aviso metodológico', 'Methodology note')}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </div>
      <div className="pointer-events-none absolute right-0 top-full mt-2 hidden group-hover:block z-[90] w-[340px] max-w-[80vw] rounded-md border border-amber-300/25 bg-[#0a0f1dcc] px-3 py-2 text-[11px] leading-relaxed text-amber-50 shadow-xl backdrop-blur-md">
        {text}
      </div>
    </div>
  )
}

function OrbitPreview({ selected, tr }) {
  const containerRef = useRef(null)
  const expandedContainerRef = useRef(null)
  const fullscreenHostRef = useRef(null)
  const globeRef = useRef(null)
  const [size, setSize] = useState(280)
  const [expandedViewport, setExpandedViewport] = useState({ w: 1280, h: 720 })
  const [previewTick, setPreviewTick] = useState(0)
  const [viewAltitude, setViewAltitude] = useState(PREVIEW_MIN_ALTITUDE)
  const [isExpanded, setIsExpanded] = useState(false)
  const starSpriteTexture = useMemo(() => createStarSpriteTexture(), [])

  useEffect(() => {
    const el = isExpanded ? expandedContainerRef.current : containerRef.current
    if (!el) return () => {}

    const update = () => {
      const side = Math.floor(Math.min(el.clientWidth || 280, el.clientHeight || 280))
      if (isExpanded) {
        const w = Math.max(640, Math.floor(el.clientWidth || 1280))
        const h = Math.max(360, Math.floor(el.clientHeight || 720))
        setExpandedViewport({ w, h })
        setSize(Math.max(520, Math.min(1700, side - 8)))
      } else {
        setSize(Math.max(190, Math.min(300, side)))
      }
    }

    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isExpanded])

  const hasTle = Boolean(toStringSafe(selected?.tle1) && toStringSafe(selected?.tle2))
  const isReentered = Boolean(selected?.sources?.reentry || safeParseDate(selected?.decayDate))
  const shouldDrawOrbit = hasTle && !isReentered
  const centerTime = useMemo(() => new Date(), [selected?.id, size, previewTick])

  useEffect(() => {
    if (!hasTle) {
      setViewAltitude(PREVIEW_MIN_ALTITUDE)
      return
    }
    setViewAltitude(estimatePreviewViewAltitude(selected?.tle1, selected?.tle2, centerTime))
  }, [hasTle, selected?.id, selected?.tle1, selected?.tle2, centerTime])

  useEffect(() => {
    const id = window.setInterval(() => {
      setPreviewTick((v) => v + 1)
    }, PREVIEW_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!isExpanded) return () => {}
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isExpanded])

  useEffect(() => {
    if (!isExpanded) return () => {}
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [isExpanded])

  const enterNativeFullscreen = async () => {
    const host = fullscreenHostRef.current
    if (!host) return
    const req = host.requestFullscreen || host.webkitRequestFullscreen
    if (!req) return
    try {
      await req.call(host)
    } catch {
      // Keep modal overlay fallback when native fullscreen fails.
    }
  }

  const exitNativeFullscreen = async () => {
    const doc = document
    const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement
    if (!fsEl) return
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen
    if (!exit) return
    try {
      await exit.call(doc)
    } catch {
      // ignore and still close overlay
    }
  }

  useEffect(() => {
    if (!isExpanded) return () => {}
    enterNativeFullscreen()
    return () => {}
  }, [isExpanded])

  useEffect(() => {
    const onFsChange = () => {
      const doc = document
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement
      if (!fsEl) setIsExpanded(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  const lockPreviewControls = () => {
    const controls = globeRef.current?.controls?.()
    if (!controls) return
    controls.autoRotate = true
    controls.autoRotateSpeed = isExpanded ? 0.24 : 3.6
    controls.enableRotate = isExpanded
    controls.enableZoom = isExpanded
    controls.enablePan = isExpanded
    controls.enableDamping = true
    controls.dampingFactor = 0.08
  }

  const globeMaterial = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      shininess: 4,
    })
  }, [])

  const animatePreviewObject = (obj, layerData) => {
    if (layerData?.kind !== 'orbit') return
    const pulse = obj?.userData?.pulse
    if (!pulse?.marker || !pulse?.glow || !pulse?.outerHalo) return

    const phase = Date.now() * 0.0085
    const wave = 0.5 + 0.5 * Math.sin(phase)

    const markerOpacity = 0.72 + wave * 0.28
    const markerScale = pulse.markerBaseScale * (1.05 + wave * 0.45)
    pulse.marker.material.opacity = markerOpacity
    pulse.marker.scale.set(markerScale, markerScale, markerScale)

    const glowOpacity = 0.18 + wave * 0.34
    const glowScale = pulse.glowBaseScale * (0.95 + wave * 0.38)
    pulse.glow.material.opacity = glowOpacity
    pulse.glow.scale.set(glowScale, glowScale, 1)

    const outerHaloOpacity = 0.08 + wave * 0.18
    const outerHaloScale = pulse.outerHaloBaseScale * (0.96 + wave * 0.34)
    pulse.outerHalo.material.opacity = outerHaloOpacity
    pulse.outerHalo.scale.set(outerHaloScale, outerHaloScale, 1)

    const live = obj?.userData?.live
    if (!live?.satrec || !live?.marker || !live?.glow || !live?.outerHalo || !Number.isFinite(live?.globeRadius)) return

    const now = new Date()
    const pvNow = satellite.propagate(live.satrec, now)
    if (!pvNow?.position) return
    const pNow = eciToPreviewVector(pvNow.position, live.globeRadius, satellite.gstime(now))
    if (!pNow) return

    live.marker.position.copy(pNow)
    live.glow.position.copy(pNow)
    live.outerHalo.position.copy(pNow)
  }

  useEffect(() => {
    lockPreviewControls()
  }, [selected?.id, size, isExpanded])

  useEffect(() => {
    const globe = globeRef.current
    if (!globe) return
    const targetAltitude = isExpanded ? Math.min(PREVIEW_MAX_ALTITUDE, viewAltitude * 1.45 + 1.2) : viewAltitude
    globe.pointOfView({ lat: isExpanded ? 0 : 12, lng: 0, altitude: targetAltitude }, isExpanded ? 900 : 700)
  }, [viewAltitude, selected?.id, size, isExpanded])

  const globeFrameStyle = useMemo(() => {
    if (isExpanded) return { width: '100%', height: '100%' }
    return { width: `${size}px`, height: `${size}px` }
  }, [isExpanded, size])
  const globeWidth = isExpanded ? expandedViewport.w : size
  const globeHeight = isExpanded ? expandedViewport.h : size
  const previewLayerData = useMemo(() => {
    const out = [{ id: 'orbit-preview-stars', kind: 'stars' }]
    if (shouldDrawOrbit) out.push({ id: selected?.id || 'orbit-preview', kind: 'orbit' })
    return out
  }, [shouldDrawOrbit, selected?.id])

  const previewCanvas = (
    <div className="relative h-full w-full flex items-center justify-center">
      <div style={globeFrameStyle} className={`relative shrink-0 ${isReentered ? 'filter grayscale contrast-90' : ''}`}>
        <Globe
          ref={globeRef}
          key={`${selected?.id || 'x'}-${globeWidth}x${globeHeight}-${isExpanded ? 'expanded' : 'compact'}`}
          width={globeWidth}
          height={globeHeight}
          globeImageUrl={publicUrl('/img/earthmap1k.jpg')}
          globeMaterial={globeMaterial}
          backgroundColor="#000104"
          enablePointerInteraction={isExpanded}
          showAtmosphere
          atmosphereColor="#7cc8ff"
          atmosphereAltitude={0.13}
          onGlobeReady={lockPreviewControls}
          customLayerData={previewLayerData}
          customThreeObject={(d, globeRadius) => {
            if (!d?.id) return null
            if (d.kind === 'stars') return createStarfieldObject(globeRadius, starSpriteTexture)
            if (!shouldDrawOrbit) return null
            return computeOrbitPreviewObject(globeRadius, selected.tle1, selected.tle2, centerTime)
          }}
          customThreeObjectUpdate={shouldDrawOrbit ? animatePreviewObject : undefined}
        />
        {isReentered ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border border-white/35 bg-black/60 px-3 py-1.5 text-[11px] font-bold tracking-wide text-white/95 shadow-[0_4px_20px_rgba(0,0,0,0.45)]">
              {tr('Objeto reingresado', 'Reentered object')}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-black/25 p-2">
        <div className="flex items-center justify-between gap-2 text-white/70 text-xs mb-2">
          <div className="flex items-center gap-2">
            <GlobeIcon className="h-3.5 w-3.5" />
            {tr('Simulación orbital', 'Orbital simulation')}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] text-white/80 transition"
            title={tr('Ver en pantalla completa', 'Open fullscreen')}
          >
            <Maximize2 className="h-3 w-3" />
            {tr('Ampliar', 'Expand')}
          </button>
        </div>

        <div ref={containerRef} className="aspect-square w-full max-w-[300px] mx-auto rounded-lg overflow-hidden border border-white/10 bg-[#03060f]">
          {hasTle ? (
            previewCanvas
          ) : (
            <div className="h-full w-full flex items-center justify-center text-xs text-white/50 text-center px-4">
              {tr('Sin TLE disponible para simular órbita', 'No TLE available for orbit simulation')}
            </div>
          )}
        </div>
      </div>

      {isExpanded ? (
        <div ref={fullscreenHostRef} className="fixed inset-0 z-[120] bg-[#020611]/95 backdrop-blur-sm p-3 md:p-5">
          <div className="h-full w-full rounded-2xl border border-white/15 bg-black/30 p-3 flex flex-col">
            <div className="flex items-center justify-between gap-2 text-xs text-white/75 mb-2">
              <div className="flex items-center gap-2">
                <GlobeIcon className="h-4 w-4" />
                <span>{tr('Simulación orbital - pantalla completa', 'Orbital simulation - fullscreen')}</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await exitNativeFullscreen()
                  setIsExpanded(false)
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 px-2.5 py-1.5 text-[11px] text-white/85 transition"
                title={tr('Cerrar pantalla completa', 'Exit fullscreen')}
              >
                <Minimize2 className="h-3.5 w-3.5" />
                {tr('Cerrar', 'Close')}
              </button>
            </div>

            <div ref={expandedContainerRef} className="flex-1 min-h-0 w-full rounded-xl overflow-hidden border border-white/10 bg-[#03060f]">
              {hasTle ? (
                previewCanvas
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-white/50 text-center px-4">
                  {tr('Sin TLE disponible para simular órbita', 'No TLE available for orbit simulation')}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function OrbitalParamsTables({ selected, tr }) {
  const [snapshot, setSnapshot] = useState(null)
  const hasTle = Boolean(toStringSafe(selected?.tle1) && toStringSafe(selected?.tle2))
  const isReentered = Boolean(selected?.sources?.reentry || safeParseDate(selected?.decayDate))

  useEffect(() => {
    const tle1 = toStringSafe(selected?.tle1)
    const tle2 = toStringSafe(selected?.tle2)
    if (!tle1 || !tle2 || isReentered) {
      setSnapshot(null)
      return () => {}
    }

    let cancelled = false

    const updateSnapshot = () => {
      try {
        const satrec = satellite.twoline2satrec(tle1, tle2)
        if (!satrec || satrec.error) return

        const now = new Date()
        const pv = satellite.propagate(satrec, now)
        if (!pv?.position || !pv?.velocity) return

        const gmst = satellite.gstime(now)
        const geodetic = satellite.eciToGeodetic(pv.position, gmst)

        const meanMotionRevPerDay = Number.isFinite(satrec.no)
          ? (satrec.no * 1440) / (2 * Math.PI)
          : Number.NaN
        const periodMin = Number.isFinite(meanMotionRevPerDay) && meanMotionRevPerDay > 0
          ? 1440 / meanMotionRevPerDay
          : Number.NaN

        const eccentricity = Number(satrec.ecco)
        const semiMajorAxisEr = Number(satrec.a)
        const perigeeKm = Number.isFinite(semiMajorAxisEr) && Number.isFinite(eccentricity)
          ? (semiMajorAxisEr * (1 - eccentricity) - 1) * EARTH_RADIUS_KM
          : Number.NaN
        const apogeeKm = Number.isFinite(semiMajorAxisEr) && Number.isFinite(eccentricity)
          ? (semiMajorAxisEr * (1 + eccentricity) - 1) * EARTH_RADIUS_KM
          : Number.NaN

        const speedKmS = Math.hypot(
          Number(pv.velocity.x),
          Number(pv.velocity.y),
          Number(pv.velocity.z),
        )

        if (!cancelled) {
          setSnapshot({
            timestamp: now,
            latDeg: satellite.degreesLat(geodetic.latitude),
            lonDeg: satellite.degreesLong(geodetic.longitude),
            altitudeKm: Number(geodetic.height),
            speedKmS,
            eciXKm: Number(pv.position.x),
            eciYKm: Number(pv.position.y),
            eciZKm: Number(pv.position.z),
            meanMotionRevPerDay,
            periodMin,
            inclinationDeg: Number(satrec.inclo) * (180 / Math.PI),
            raanDeg: normalizeAngleDeg(radiansToDegrees(satrec.nodeo)),
            argPerigeeDeg: normalizeAngleDeg(radiansToDegrees(satrec.argpo)),
            meanAnomalyDeg: normalizeAngleDeg(radiansToDegrees(satrec.mo)),
            trueAnomalyDeg: computeTrueAnomalyDeg(pv.position, pv.velocity),
            eccentricity,
            bstar: Number(satrec.bstar),
            perigeeKm,
            apogeeKm,
          })
        }
      } catch {
        // Keep previous snapshot if a single propagation step fails.
      }
    }

    updateSnapshot()
    const id = window.setInterval(updateSnapshot, ORBITAL_SNAPSHOT_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selected?.id, selected?.tle1, selected?.tle2, isReentered])

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-white/75 text-[11px] mb-2">
        <div className="flex items-center gap-2">
          <Orbit className="h-3.5 w-3.5" />
          {tr('Parámetros orbitales (simulación)', 'Orbital parameters (simulation)')}
        </div>
        <MethodologyNotice tr={tr} />
      </div>

      {isReentered ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No hay simulación en tiempo real para objetos reingresados.', 'Live simulation is not available for reentered objects.')}
        </div>
      ) : !hasTle ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No hay TLE suficiente para calcular parámetros en vivo.', 'No valid TLE available for live orbital parameters.')}
        </div>
      ) : !snapshot ? (
        <div className="text-xs text-white/55 rounded-md border border-white/10 bg-black/20 px-2 py-2">
          {tr('No hay TLE suficiente para calcular parámetros en vivo.', 'No valid TLE available for live orbital parameters.')}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-white/55 mono">
            {tr('Última actualización', 'Last update')}: {fmtUtcIso(snapshot.timestamp)}
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-[11px]">
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">{tr('Latitud', 'Latitude')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtSigned(snapshot.latDeg, 3)}°</td>
                  <td className="px-2 py-1 text-white/60">{tr('Longitud', 'Longitude')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtSigned(snapshot.lonDeg, 3)}°</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">{tr('Altitud', 'Altitude')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.altitudeKm, 2)} km</td>
                  <td className="px-2 py-1 text-white/60">{tr('Velocidad', 'Speed')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.speedKmS, 4)} km/s</td>
                </tr>
                <tr>
                  <td className="px-2 py-1 text-white/60">ECI X</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.eciXKm, 1)} km</td>
                  <td className="px-2 py-1 text-white/60">ECI Y / Z</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.eciYKm, 1)} / {fmtNum(snapshot.eciZKm, 1)} km</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-[11px]">
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">{tr('Movimiento medio', 'Mean motion')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.meanMotionRevPerDay, 6)} rev/day</td>
                  <td className="px-2 py-1 text-white/60">{tr('Periodo', 'Period')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.periodMin, 3)} min</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">{tr('Inclinación', 'Inclination')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.inclinationDeg, 4)}°</td>
                  <td className="px-2 py-1 text-white/60">{tr('Excentricidad', 'Eccentricity')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.eccentricity, 7)}</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">RAAN</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.raanDeg, 4)}°</td>
                  <td className="px-2 py-1 text-white/60">{tr('Arg. perigeo', 'Arg. perigee')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.argPerigeeDeg, 4)}°</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="px-2 py-1 text-white/60">{tr('Anomalía media', 'Mean anomaly')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.meanAnomalyDeg, 4)}°</td>
                  <td className="px-2 py-1 text-white/60">{tr('Anomalía verdadera', 'True anomaly')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.trueAnomalyDeg, 4)}°</td>
                </tr>
                <tr>
                  <td className="px-2 py-1 text-white/60">{tr('Perigeo/Apogeo', 'Perigee/Apogee')}</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.perigeeKm, 2)} / {fmtNum(snapshot.apogeeKm, 2)} km</td>
                  <td className="px-2 py-1 text-white/60">B*</td>
                  <td className="px-2 py-1 mono text-white/90">{fmtNum(snapshot.bstar, 8)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


export default function ObjectSearchModule() {
  const { tr } = useI18n()
  const heavyReady = useDeferredRender({ delayMs: 500 })

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(RESULTS_STEP)
  const [selectedId, setSelectedId] = useState('')
  const [sortMode, setSortMode] = useState(SORT_MODE_RECENT)
  const [typeFilter, setTypeFilter] = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [orbitStatusFilter, setOrbitStatusFilter] = useState('all') // Nuevo filtro
  const [dataValidAt, setDataValidAt] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 220)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    setVisibleCount(RESULTS_STEP)
  }, [debouncedQuery])

  useEffect(() => {
    let ok = true
    if (!heavyReady) return () => {}

    setLoading(true)
    setError('')

    // Obtener fecha de validez de la data
    fetch('/data/debris_total.csv', { method: 'HEAD' })
      .then(res => {
        const lastModified = res.headers.get('last-modified')
        if (lastModified) setDataValidAt(lastModified)
      })
      .catch(() => {})

    Promise.all([
      loadCsv('/data/debris_total.csv'),
    ])
      .then(([total]) => {
        if (!ok) return
        const unified = buildUnifiedCatalog(total)
        setRows(unified)
        if (unified.length) setSelectedId(unified[0].id)
      })
      .catch((e) => {
        if (!ok) return
        setError(String(e?.message || e))
      })
      .finally(() => {
        if (!ok) return
        setLoading(false)
      })

    return () => {
      ok = false
    }
  }, [heavyReady])

  // Obtener países y tipos únicos para los selects
  const countryOptions = useMemo(() => {
    // Solo países presentes en los datos cargados
    const set = new Set()
    rows.forEach((r) => {
      if (r.country) set.add(r.country)
    })
    // Filtrar solo los que existen en COUNTRY_NAMES o tienen valor válido
    return Array.from(set)
      .filter((code) => code && (COUNTRY_NAMES[code] || code))
      .sort((a, b) => {
        const nameA = COUNTRY_NAMES[a] || a
        const nameB = COUNTRY_NAMES[b] || b
        return nameA.localeCompare(nameB)
      })
  }, [rows])

  const typeOptions = useMemo(() => {
    const set = new Set()
    rows.forEach((r) => {
      if (r.objectType) set.add(r.objectType)
    })
    return Array.from(set).sort()
  }, [rows])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    let out = q
      ? rows.filter((r) => {
          return [r.norad, r.name, r.objectId, r.country, r.objectType].some((v) => toStringSafe(v).toLowerCase().includes(q))
        })
      : rows.slice()

    if (typeFilter !== 'all') {
      out = out.filter((r) => r.objectType === typeFilter)
    }
    if (countryFilter !== 'all') {
      out = out.filter((r) => r.country === countryFilter)
    }
    if (orbitStatusFilter === 'orbit') {
      out = out.filter((r) => r.sources?.orbit)
    } else if (orbitStatusFilter === 'reentry') {
      out = out.filter((r) => r.sources?.reentry)
    }

    out.sort((a, b) => {
      if (sortMode === SORT_MODE_ALPHA) {
        const nameDiff = toStringSafe(a.name).localeCompare(toStringSafe(b.name))
        if (nameDiff !== 0) return nameDiff
        return toStringSafe(a.norad).localeCompare(toStringSafe(b.norad))
      }

      if (sortMode === SORT_MODE_OLDEST) {
        const oldestDiff = getLaunchTs(a) - getLaunchTs(b)
        if (oldestDiff !== 0) return oldestDiff
      } else if (sortMode === SORT_MODE_RECENT) {
        const dateDiff = getLaunchTs(b) - getLaunchTs(a)
        if (dateDiff !== 0) return dateDiff
      } else if (q) {
        const relevanceDiff = getTextMatchScore(b, q) - getTextMatchScore(a, q)
        if (relevanceDiff !== 0) return relevanceDiff
      }

      const fallbackRecentDiff = getLaunchTs(b) - getLaunchTs(a)
      if (fallbackRecentDiff !== 0) return fallbackRecentDiff

      return toStringSafe(a.name).localeCompare(toStringSafe(b.name))
    })

    return out
  }, [debouncedQuery, rows, sortMode, typeFilter, countryFilter, orbitStatusFilter])

  const visibleResults = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  const selected = useMemo(() => filtered.find((r) => r.id === selectedId) || filtered[0] || null, [filtered, selectedId])

  useEffect(() => {
    if (!selected) return
    setSelectedId(selected.id)
  }, [selected?.id])

  if (loading) {
    return (
      <div className="p-4 h-full min-h-[60vh] flex items-center justify-center">
        <div className="glass rounded-2xl p-5 w-full max-w-xl">
          <div className="text-sm font-bold text-white/90">{tr('Buscador de objetos', 'Object search')}</div>
          <div className="mt-3 inline-loading-bar" />
          <div className="mt-3 text-xs text-white/60 mono">{tr('Cargando catálogo unificado...', 'Loading unified catalog...')}</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5">
        <div className="glass rounded-2xl p-5 border border-red-500/35">
          <div className="text-sm font-bold text-red-200">{tr('No se pudo cargar el buscador', 'Search module failed to load')}</div>
          <div className="mt-2 text-xs text-red-100/90 mono whitespace-pre-wrap">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 h-screen min-h-0 flex flex-col gap-2.5">
      <div className="glass rounded-2xl p-4">
        <div className="relative">
          <Search className="h-4 w-4 text-white/45 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Ej: 3145, ATLAS, US, ROCKET BODY...', 'Ex: 3145, ATLAS, US, ROCKET BODY...')}
            className="w-full rounded-xl border border-white/15 bg-black/35 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-cyan-300/45"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {/* Filtro por tipo de objeto */}
          <label className="text-white/55" htmlFor="typeFilter">{tr('Tipo', 'Type')}:</label>
          <select
            id="typeFilter"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-white/80 text-xs focus:border-cyan-300/45"
          >
            <option value="all">{tr('Todos', 'All')}</option>
            {typeOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          {/* Filtro por país */}
          <label className="text-white/55" htmlFor="countryFilter">{tr('País', 'Country')}:</label>
          <select
            id="countryFilter"
            value={countryFilter}
            onChange={e => setCountryFilter(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-white/80 text-xs focus:border-cyan-300/45"
          >
            <option value="all">{tr('Todos', 'All')}</option>
            {countryOptions.map(opt => (
              <option key={opt} value={opt}>{COUNTRY_NAMES[opt] || opt}</option>
            ))}
          </select>

          {/* Filtro en órbita / reingresado */}
          <label className="text-white/55" htmlFor="orbitStatusFilter">{tr('Estado', 'Status')}:</label>
          <select
            id="orbitStatusFilter"
            value={orbitStatusFilter}
            onChange={e => setOrbitStatusFilter(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-white/80 text-xs focus:border-cyan-300/45"
          >
            <option value="all">{tr('Todos', 'All')}</option>
            <option value="orbit">{tr('En órbita', 'In orbit')}</option>
            <option value="reentry">{tr('Reingresado', 'Reentered')}</option>
          </select>

          {/* Filtro de orden */}
          <label className="text-white/55" htmlFor="sortMode">{tr('Orden', 'Sort')}:</label>
          <select
            id="sortMode"
            value={sortMode}
            onChange={e => setSortMode(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-white/80 text-xs focus:border-cyan-300/45"
          >
            <option value={SORT_MODE_RECENT}>{tr('Más recientes', 'Most recent')}</option>
            <option value={SORT_MODE_OLDEST}>{tr('Más antiguos', 'Oldest')}</option>
            <option value={SORT_MODE_ALPHA}>{tr('Alfabético', 'Alphabetical')}</option>
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[310px_1fr] gap-2.5 auto-rows-fr">
        <div className="glass rounded-2xl p-3 overflow-auto min-h-0">
          <div className="text-xs text-white/55 px-2 pb-2">
            {tr('Resultados', 'Results')}: <span className="mono">{filtered.length}</span>
            {filtered.length > visibleResults.length ? (
              <span className="ml-2 text-white/45">
                {tr('Mostrando', 'Showing')} <span className="mono">{visibleResults.length}</span>
              </span>
            ) : null}
          </div>

          <div className="space-y-2">
            {visibleResults.map((r) => {
              const isActive = r.id === selected?.id
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${
                    isActive
                      ? 'bg-cyan-400/10 border-cyan-300/35'
                      : 'bg-black/25 border-white/10 hover:bg-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-white/95 truncate">{r.name || tr('Objeto sin nombre', 'Unnamed object')}</div>
                    <div className="mono text-[11px] text-white/60">{r.norad || '—'}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-white/60">
                    {r.objectType || 'UNKNOWN'} · {r.country || '??'}
                  </div>
                </button>
              )
            })}
            {!filtered.length ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/60">
                {tr('No hay coincidencias para tu búsqueda.', 'No matches for your search.')}
              </div>
            ) : null}

            {filtered.length > visibleResults.length ? (
              <button
                type="button"
                onClick={() => setVisibleCount((v) => Math.min(filtered.length, v + RESULTS_STEP))}
                className="w-full rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-white/85 transition"
              >
                {tr('Mostrar más resultados', 'Show more results')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="glass rounded-2xl p-2.5 min-h-0">
          {selected ? (
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="text-lg md:text-xl font-extrabold tracking-tight text-white truncate">{selected.name || tr('Objeto sin nombre', 'Unnamed object')}</div>
                  <div className="mt-1 text-[11px] text-white/65 mono">NORAD: {selected.norad || '—'} · ID: {selected.objectId || '—'}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 min-w-0">
                {statusBadge(selected.sources.total, 'En catálogo', 'In catalog', tr)}
                {statusBadge(selected.sources.orbit, 'En órbita', 'In orbit', tr)}
                {statusBadge(selected.sources.reentry, 'Reingresado', 'Reentered', tr)}
                {statusBadge(selected.sources.impact, 'Con punto de caída', 'With impact point', tr)}
              </div>

              <div className="flex flex-col xl:flex-row gap-2 min-w-0">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-2">
                    <div className="text-[11px] text-white/75 mb-1.5">{tr('Fechas', 'Dates')}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
                      <Field label={tr('Lanzamiento', 'Launch')} value={fmtDate(selected.launchDate)} />
                      <Field label={tr('Reingreso', 'Reentry')} value={fmtDate(selected.decayDate)} />
                      <Field label={tr('Epoch', 'Epoch')} value={fmtDate(selected.epoch)} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 p-2">
                    <div className="flex items-center gap-2 text-white/75 text-[11px]"><Orbit className="h-3.5 w-3.5" /> {tr('Resumen orbital', 'Orbital summary')}</div>
                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-white/80 min-w-0">
                      <Field label={tr('Periodo', 'Period')} value={selected.period != null ? `${fmtNum(selected.period, 2)} min` : '—'} mono />
                      <Field label={tr('Inclinación', 'Inclination')} value={selected.inclination != null ? `${fmtNum(selected.inclination, 2)}°` : '—'} mono />
                      <Field label={tr('Excentricidad', 'Eccentricity')} value={selected.eccentricity != null ? fmtNum(selected.eccentricity, 6) : '—'} mono />
                      <Field label={tr('Apoapsis', 'Apoapsis')} value={selected.apoapsis != null ? `${fmtNum(selected.apoapsis, 1)} km` : '—'} mono />
                      <Field label={tr('Periapsis', 'Periapsis')} value={selected.periapsis != null ? `${fmtNum(selected.periapsis, 1)} km` : '—'} mono />
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0 min-w-[220px] max-w-full xl:max-w-[280px]">
                  <OrbitPreview selected={selected} tr={tr} />
                </div>
              </div>

              <div className="flex flex-col xl:flex-row gap-2 min-w-0">
                <div className="flex-1 min-w-0 rounded-xl border border-white/10 bg-black/25 p-2 h-full">
                  <div className="text-[11px] text-white/75 mb-1.5">{tr('Identificación', 'Identification')}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 min-w-0">
                    <Field label={tr('Tipo de objeto', 'Object type')} value={selected.objectType} />
                    <Field label={tr('País', 'Country')} value={COUNTRY_NAMES[selected.country] || selected.country || '??'} />
                    <Field label={tr('Masa', 'Mass')} value={selected.massKg != null ? `${fmtNum(selected.massKg, 0)} kg` : '—'} />
                    <Field label={tr('Constelación', 'Constellation')} value={selected.constellation || '—'} />
                    <Field label={tr('País de caída', 'Fall country')} value={selected.fallCountry || '—'} />
                    <Field label={tr('Lat/Lon', 'Lat/Lon')} value={`${selected.latFall != null ? fmtNum(selected.latFall, 3) : '—'} / ${selected.lonFall != null ? fmtNum(selected.lonFall, 3) : '—'}`} mono />
                  </div>
                </div>

                <div className="flex-shrink-0 min-w-[220px] max-w-full xl:max-w-[420px] rounded-xl border border-white/10 bg-black/25 p-2 h-full flex flex-col">
                  <div className="flex items-center gap-2 text-white/75 text-[11px]"><Database className="h-3.5 w-3.5" /> TLE</div>
                  <div className="mt-1.5 text-[11px] text-white/85 space-y-1.5 min-h-[4.5rem]">
                    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1 mono break-all whitespace-pre-line" title={selected.tle0 || ''}>TLE 0: {selected.tle0 || '—'}</div>
                    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1 mono break-all whitespace-pre-line" title={selected.tle1 || ''}>TLE 1: {selected.tle1 || '—'}</div>
                    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1 mono break-all whitespace-pre-line" title={selected.tle2 || ''}>TLE 2: {selected.tle2 || '—'}</div>
                  </div>
                </div>
              </div>

              <OrbitalParamsTables selected={selected} tr={tr} />

              <OrbitalHistoryCharts selected={selected} tr={tr} />
            </div>
          ) : (
            <div className="text-sm text-white/65">{tr('Selecciona un resultado para ver su ficha unificada.', 'Select a result to view its unified profile.')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

