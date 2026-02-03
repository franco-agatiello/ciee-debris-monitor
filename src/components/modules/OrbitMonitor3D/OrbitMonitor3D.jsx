import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as satellite from 'satellite.js'
import * as THREE from 'three'
import { loadCsv, toStringSafe } from '../../../utils/csv.js'
import { useDeferredRender } from '../../../hooks/useDeferredRender.js'

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function normalizeClassName(v) {
  const s = (v || '').trim()
  return s ? s.toUpperCase() : 'UNKNOWN'
}

function toFourClass(v) {
  const s = normalizeClassName(v)
  // Prefer exact standardized values
  if (s === 'PAYLOAD') return 'PAYLOAD'
  if (s === 'DEBRIS') return 'DEBRIS'
  if (s === 'ROCKET BODY' || s === 'ROCKET' || s === 'RB') return 'ROCKET BODY'

  // Fallback for richer descriptive labels (e.g. "Rocket Fragmentation Debris")
  if (s.includes('DEBRIS')) return 'DEBRIS'
  if (s.includes('ROCKET') && s.includes('BODY')) return 'ROCKET BODY'
  if (s.includes('PAYLOAD')) return 'PAYLOAD'
  if (s.includes('ROCKET')) return 'ROCKET BODY'
  return 'UNKNOWN'
}

function satToFourClass(sat) {
  return toFourClass(sat?.objectType || sat?.cls)
}

function hexToRgb01(hex) {
  const h = (hex || '').replace('#', '').trim()
  if (h.length !== 6) return [0.65, 0.65, 0.65]
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return [r, g, b]
}

function hashStringToIndex(str, mod) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % mod
}

function degToRad(d) {
  return (d * Math.PI) / 180
}

// Converts lat/lng (deg) + alt (Earth radii above surface) into XYZ in Earth radii.
function geoToUnitXYZ(latDeg, lngDeg, altR) {
  const lat = degToRad(latDeg)
  const lng = degToRad(lngDeg)
  const r = 1 + altR

  const cosLat = Math.cos(lat)
  const sinLat = Math.sin(lat)
  const cosLng = Math.cos(lng)
  const sinLng = Math.sin(lng)

  // Matches Globe.gl coordinate convention
  const x = r * cosLat * sinLng
  const y = r * sinLat
  const z = r * cosLat * cosLng
  return [x, y, z]
}

function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function OrbitMonitor3D() {
  const heavyReady = useDeferredRender({ delayMs: 800 })

  const globeRef = useRef(null)
  const containerRef = useRef(null)
  const pointsObjRef = useRef(null)
  const positionsAttrRef = useRef(null)
  const globeRadiusRef = useRef(0)
  const framesRef = useRef([])
  const baseDateRef = useRef(null)
  const playIndexRef = useRef(0)
  const firstFrameIndexRef = useRef(0)
  const builtFrameIndexRef = useRef(0)
  const rafRef = useRef(0)
  const lastTickRef = useRef(0)
  const buildCancelRef = useRef({ cancel: false })
  const filteredSatsRef = useRef([])

  const [hover, setHover] = useState(null) // { x, y, sat }

  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [maxObjects, setMaxObjects] = useState(33000)
  const [autoRotate, setAutoRotate] = useState(true)

  const [bufferStatus, setBufferStatus] = useState('idle') // idle | building | ready
  const [bufferProgress, setBufferProgress] = useState(0) // seconds buffered ahead
  const [bufferErr, setBufferErr] = useState('')
  const [showAll, setShowAll] = useState(true)

  const [globeImgUrl, setGlobeImgUrl] = useState('/img/earthmap_ref.jpg')

  const [isFullscreen, setIsFullscreen] = useState(false)

  const webglOk = useMemo(() => isWebGLAvailable(), [])

  useEffect(() => {
    const onChange = () => {
      const el = containerRef.current
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      setIsFullscreen(Boolean(el && fsEl === el))
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
    const el = containerRef.current
    if (!el) return
    try {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      if (fsEl) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.())
      } else {
        await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.())
      }
    } catch {
      // ignore
    }
  }

  const pointSprite = useMemo(() => {
    // Small radial gradient texture to create a subtle halo.
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const cx = size / 2
    const cy = size / 2
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.25)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)

    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    return tex
  }, [])

  useEffect(() => {
    // Prefer a user-provided higher-res texture, but fall back gracefully.
    const preferred = '/img/earthmap_ref.jpg'
    const fallback = '/img/earthmap1k.jpg'

    let done = false
    const img = new Image()
    img.onload = () => {
      if (done) return
      done = true
      setGlobeImgUrl(preferred)
    }
    img.onerror = () => {
      if (done) return
      done = true
      setGlobeImgUrl(fallback)
    }
    img.src = preferred

    return () => {
      done = true
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let ok = true
    if (!heavyReady) return () => {}
    loadCsv('/data/debris_orbita.csv', { requiredColumns: ['TLE_LINE1', 'TLE_LINE2'] })
      .then((r) => {
        if (!ok) return
        setRows(r)
        setErr('')
      })
      .catch((e) => {
        if (!ok) return
        setErr(String(e?.message || e))
      })

    return () => {
      ok = false
    }
  }, [heavyReady])

  const sats = useMemo(() => {
    const usable = []
    for (const r of rows) {
      const l1 = toStringSafe(r.TLE_LINE1)
      const l2 = toStringSafe(r.TLE_LINE2)
      if (!l1 || !l2) continue

      try {
        const satrec = satellite.twoline2satrec(l1, l2)
        if (!satrec) continue
        usable.push({
          norad: toStringSafe(r.NORAD_CAT_ID),
          name: toStringSafe(r.OBJECT_NAME),
          launchDate: toStringSafe(r.LAUNCH_DATE),
          objectType: toStringSafe(r.OBJECT_TYPE),
          cls: toStringSafe(r.clase_objeto),
          satrec,
        })
      } catch {
        // Skip invalid TLEs
        continue
      }
    }

    return usable
  }, [rows])

  useEffect(() => {
    if (!showAll) return
    if (sats.length) setMaxObjects(sats.length)
  }, [showAll, sats.length])

  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    const c = g.controls?.()
    if (!c) return
    c.autoRotate = autoRotate
    c.autoRotateSpeed = 0.25
  }, [])

  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    const c = g.controls?.()
    if (!c) return
    c.autoRotate = autoRotate
  }, [autoRotate])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const setFromRect = (r) => {
      if (!r) return
      const w = Math.max(320, Math.floor(r.width))
      const h = Math.max(320, Math.floor(r.height))
      setSize({ w, h })
    }

    // Some restricted/older environments don't have ResizeObserver and will crash.
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => setFromRect(el.getBoundingClientRect())
      window.addEventListener('resize', onResize)
      onResize()
      return () => window.removeEventListener('resize', onResize)
    }

    const ro = new ResizeObserver((entries) => {
      const r = entries?.[0]?.contentRect
      setFromRect(r)
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const classColorMap = useMemo(() => {
    // Fixed 4-category palette (requested).
    return {
      PAYLOAD: '#00ff4c',
      'ROCKET BODY': '#008cff',
      DEBRIS: '#ff6a00',
      UNKNOWN: '#9ca3af',
    }
  }, [])

  const filteredSats = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()

    let out = sats

    if (classFilter !== 'all') {
      out = out.filter((s) => satToFourClass(s).toLowerCase() === classFilter)
    }

    if (q) {
      out = out.filter((s) => {
        const norad = (s.norad || '').toLowerCase()
        const name = (s.name || '').toLowerCase()
        return norad.includes(q) || name.includes(q)
      })
    }

    return out.slice(0, Math.max(100, Math.min(50000, maxObjects)))
  }, [sats, debouncedQuery, classFilter, maxObjects])

  useEffect(() => {
    filteredSatsRef.current = filteredSats
  }, [filteredSats])

  useEffect(() => {
    // Hover picking via raycaster on the point cloud.
    const host = containerRef.current
    if (!host) return
    const g = globeRef.current
    if (!g) return

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points = { threshold: 1 }

    const onMove = (ev) => {
      const pts = pointsObjRef.current
      const attr = positionsAttrRef.current
      const radius = globeRadiusRef.current
      if (!pts || !attr || !radius) {
        setHover(null)
        return
      }

      // Make picking easier without being too jumpy.
      raycaster.params.Points.threshold = Math.max(0.5, radius * 0.012)

      const rect = host.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top

      const ndc = {
        x: (x / rect.width) * 2 - 1,
        y: -(y / rect.height) * 2 + 1,
      }

      const camera = typeof g.camera === 'function' ? g.camera() : null
      if (!camera) {
        setHover(null)
        return
      }

      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(pts, false)
      const hit = hits?.[0]
      const idx = hit?.index
      if (typeof idx !== 'number' || idx < 0) {
        setHover(null)
        return
      }

      // Ignore NaN points
      const o = idx * 3
      const ax = attr.array[o]
      if (!Number.isFinite(ax)) {
        setHover(null)
        return
      }

      const sat = filteredSatsRef.current?.[idx]
      if (!sat) {
        setHover(null)
        return
      }

      setHover({ x: x + 14, y: y + 12, sat })
    }

    const onLeave = () => setHover(null)

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [webglOk])

  const legendItems = useMemo(() => {
    const counts = new Map()
    for (const s of filteredSats) {
      const key = satToFourClass(s)
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    const order = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN']
    return order.map((key) => ({
      key,
      count: counts.get(key) || 0,
      color: classColorMap[key] || '#9ca3af',
    }))
  }, [filteredSats, classColorMap])

  // Streaming buffer settings
  const SIM_STEP_SEC = 1
  const FIXED_PLAY_FPS = 4 // slow + smooth; fixed (not user-adjustable)
  const MIN_START_FRAMES = 6
  const TARGET_AHEAD_FRAMES = 14
  const MAX_BUFFER_FRAMES = 26

  function applyFramePositions(framePositions) {
    const attr = positionsAttrRef.current
    if (!attr || !framePositions) return
    if (attr.array.length !== framePositions.length) return
    attr.array.set(framePositions)
    attr.needsUpdate = true
  }

  function getFrame(frameIndex) {
    const first = firstFrameIndexRef.current
    const offset = frameIndex - first
    const list = framesRef.current
    if (offset < 0 || offset >= list.length) return null
    return list[offset]
  }

  function trimOldFrames() {
    // Keep current frame as the earliest frame in the buffer
    const keepFrom = playIndexRef.current
    const first = firstFrameIndexRef.current
    const drop = keepFrom - first
    if (drop <= 0) return
    framesRef.current.splice(0, drop)
    firstFrameIndexRef.current = first + drop
  }

  useEffect(() => {
    // Reset render object when count changes
    pointsObjRef.current = null
    positionsAttrRef.current = null
    framesRef.current = []
    firstFrameIndexRef.current = 0
    builtFrameIndexRef.current = 0
    playIndexRef.current = 0
    baseDateRef.current = null
    setBufferStatus('idle')
    setBufferProgress(0)
    setBufferErr('')
  }, [filteredSats.length])

  useEffect(() => {
    if (!heavyReady) return
    if (!webglOk) return
    if (err) return
    if (!filteredSats.length) return

    // Cancel any previous build
    buildCancelRef.current.cancel = true
    buildCancelRef.current = { cancel: false }
    const token = buildCancelRef.current

    setBufferStatus('building')
    setBufferProgress(0)
    setBufferErr('')
    framesRef.current = []
    firstFrameIndexRef.current = 0
    builtFrameIndexRef.current = 0
    playIndexRef.current = 0
    baseDateRef.current = new Date()

    const buildOneFrame = async (frameIndex) => {
      const baseDate = baseDateRef.current
      const n = filteredSats.length
      const positions = new Float32Array(3 * n)
      const date = new Date(baseDate.getTime() + frameIndex * SIM_STEP_SEC * 1000)
      const gmst = satellite.gstime(date)

      for (let i = 0; i < n; i++) {
        if (token.cancel) return null

        const s = filteredSats[i]
        const o = i * 3

        let pv
        try {
          pv = satellite.propagate(s.satrec, date)
        } catch {
          positions[o] = Number.NaN
          positions[o + 1] = Number.NaN
          positions[o + 2] = Number.NaN
          continue
        }

        if (!pv || !pv.position) {
          positions[o] = Number.NaN
          positions[o + 1] = Number.NaN
          positions[o + 2] = Number.NaN
          continue
        }

        let geo
        try {
          geo = satellite.eciToGeodetic(pv.position, gmst)
        } catch {
          positions[o] = Number.NaN
          positions[o + 1] = Number.NaN
          positions[o + 2] = Number.NaN
          continue
        }

        const lat = satellite.degreesLat(geo.latitude)
        const lng = satellite.degreesLong(geo.longitude)
        const altKm = geo.height

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altKm)) {
          positions[o] = Number.NaN
          positions[o + 1] = Number.NaN
          positions[o + 2] = Number.NaN
          continue
        }

        const altR = clamp(altKm / 6371, 0.001, 0.35)
        const [x, y, z] = geoToUnitXYZ(lat, lng, altR)
        positions[o] = x
        positions[o + 1] = y
        positions[o + 2] = z

        if (i % 1400 === 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 0))
        }
      }

      return positions
    }

    ;(async () => {
      try {
        // Producer: keep buffer filled while component is mounted
        while (!token.cancel) {
          trimOldFrames()
          const ahead = builtFrameIndexRef.current - playIndexRef.current
          const canBuild = ahead < TARGET_AHEAD_FRAMES && framesRef.current.length < MAX_BUFFER_FRAMES

          if (!canBuild) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 30))
            continue
          }

          const frameIndex = builtFrameIndexRef.current
          const positions = await buildOneFrame(frameIndex)
          if (token.cancel) return
          if (!positions) return

          framesRef.current.push(positions)
          builtFrameIndexRef.current += 1

          const bufferedAhead = Math.max(0, builtFrameIndexRef.current - playIndexRef.current)
          setBufferProgress(Math.min(MAX_BUFFER_FRAMES, bufferedAhead))

          if (bufferStatus !== 'ready' && framesRef.current.length >= MIN_START_FRAMES) {
            setBufferStatus('ready')
          }

          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 0))
        }
      } catch (e) {
        if (token.cancel) return
        setBufferErr(String(e?.message || e))
        setBufferStatus('idle')
      }
    })()

    return () => {
      token.cancel = true
    }
  }, [filteredSats, webglOk, err, heavyReady])

  useEffect(() => {
    if (!heavyReady) return
    if (!webglOk) return
    if (err) return
    if (!filteredSats.length) return

    const frameMs = Math.floor(1000 / FIXED_PLAY_FPS)

    const tick = (ts) => {
      if (!lastTickRef.current) lastTickRef.current = ts

      const elapsed = ts - lastTickRef.current
      if (elapsed >= frameMs && bufferStatus === 'ready') {
        // Only advance if next frame exists
        const nextFrame = getFrame(playIndexRef.current + 1)
        if (nextFrame) {
          playIndexRef.current += 1
          applyFramePositions(nextFrame)
          trimOldFrames()
        } else {
          // If buffer is empty, keep showing current frame
          const cur = getFrame(playIndexRef.current)
          if (cur) applyFramePositions(cur)
        }
        lastTickRef.current = ts
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      lastTickRef.current = 0
    }
  }, [webglOk, err, filteredSats.length, bufferStatus, heavyReady])

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Orbit Monitor 3D</div>
          <div className="text-sm text-white/70 mt-1">
            Real-time TLE propagation (<span className="mono">satellite.js</span>) · Rendered on globe (<span className="mono">react-globe.gl</span>)
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-3 py-2 rounded-xl border text-sm font-bold transition bg-white/5 border-white/10 hover:bg-white/10"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <div className="text-xs text-white/60 mono">
            Objects: {filteredSats.length} / {sats.length}
            {bufferStatus === 'building' ? ` · Buffer: ${Math.round(bufferProgress * 100)}%` : ''}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <label className="text-xs text-white/60">Search</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="NORAD or name…"
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:bg-white/10 focus:border-white/20 w-full md:w-[320px]"
          />
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <label className="text-xs text-white/60">Class</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:bg-white/10 focus:border-white/20"
          >
            <option value="all">All</option>
            <option value="payload">Payload</option>
            <option value="rocket body">Rocket Body</option>
            <option value="debris">Debris</option>
            <option value="unknown">Unknown</option>
          </select>

          <label className="text-xs text-white/60 md:ml-2">Limit</label>
          <input
            type="number"
            min={100}
            max={50000}
            step={500}
            value={maxObjects}
            onChange={(e) => setMaxObjects(Number(e.target.value || 1500))}
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:bg-white/10 focus:border-white/20 w-full md:w-[120px] mono"
          />

          <label className="text-xs text-white/60 md:ml-2 flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Render all
          </label>

          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            className={`px-3 py-2 rounded-xl border text-sm font-bold transition ${
              autoRotate ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            Auto-rotate
          </button>
        </div>
      </div>

      <div className="flex-1 relative" ref={containerRef}>
        {err ? (
          <div className="p-5">
            <div className="glass rounded-2xl p-4">
              <div className="text-sm font-bold">Failed to load CSV</div>
              <div className="mono text-xs text-red-300 mt-2">{err}</div>
              <div className="text-xs text-white/60 mt-3">
                Verify the file exists at <span className="mono">/public/data/debris_orbita.csv</span> and includes <span className="mono">TLE_LINE1</span> + <span className="mono">TLE_LINE2</span>.
              </div>
            </div>
          </div>
        ) : heavyReady && !rows.length ? (
          <div className="absolute inset-0 p-5">
            <div className="glass rounded-2xl p-4 h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm font-bold">Fetching data…</div>
                <div className="text-xs text-white/60 mt-2">Parsing CSV in a web worker.</div>
              </div>
            </div>
          </div>
        ) : bufferErr ? (
          <div className="p-5">
            <div className="glass rounded-2xl p-4">
              <div className="text-sm font-bold">Failed to build buffer</div>
              <div className="mono text-xs text-red-300 mt-2 whitespace-pre-wrap">{bufferErr}</div>
            </div>
          </div>
        ) : !webglOk ? (
          <div className="p-5">
            <div className="glass rounded-2xl p-4">
              <div className="text-sm font-bold">WebGL not available</div>
              <div className="text-xs text-white/60 mt-2">
                The 3D globe needs WebGL. Try updating your GPU drivers, enabling hardware acceleration, or using a different browser.
              </div>
            </div>
          </div>
        ) : !heavyReady ? (
          <div className="absolute inset-0 p-5">
            <div className="glass rounded-2xl p-4 h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm font-bold">Preparing 3D scene…</div>
                <div className="text-xs text-white/60 mt-2">Mounting deferred until after transition.</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <Globe
              key={filteredSats.length}
              ref={globeRef}
              backgroundColor="#02040a"
              globeImageUrl={globeImgUrl}
              width={size.w}
              height={size.h}
              showAtmosphere
              atmosphereColor="#3d7cff"
              atmosphereAltitude={0.12}
              customLayerData={[
                { id: 'ref' },
                ...(filteredSats.length ? [{ id: 'sats' }] : []),
              ]}
              customThreeObject={(d, globeRadius) => {
                if (d?.id === 'ref') {
                  const group = new THREE.Group()

                  const axes = new THREE.AxesHelper(globeRadius * 1.35)
                  axes.renderOrder = -1
                  group.add(axes)

                  const makeCircle = (plane) => {
                    const segments = 128
                    const pts = []
                    for (let i = 0; i <= segments; i++) {
                      const a = (i / segments) * Math.PI * 2
                      const c = Math.cos(a)
                      const s = Math.sin(a)
                      if (plane === 'equator') pts.push(new THREE.Vector3(globeRadius * 1.003 * s, 0, globeRadius * 1.003 * c))
                      if (plane === 'meridian') pts.push(new THREE.Vector3(0, globeRadius * 1.003 * s, globeRadius * 1.003 * c))
                    }
                    const geo = new THREE.BufferGeometry().setFromPoints(pts)
                    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
                    const line = new THREE.Line(geo, mat)
                    line.frustumCulled = false
                    return line
                  }

                  group.add(makeCircle('equator'))
                  group.add(makeCircle('meridian'))
                  group.frustumCulled = false
                  return group
                }

                const n = filteredSats.length
                const geometry = new THREE.BufferGeometry()
                const positions = new Float32Array(3 * n)
                const colors = new Float32Array(3 * n)
                // Start hidden until we apply a real frame
                for (let i = 0; i < positions.length; i++) positions[i] = Number.NaN

                for (let i = 0; i < n; i++) {
                  const s = filteredSats[i]
                  const key = satToFourClass(s)
                  const hex = classColorMap[key] || classColorMap.UNKNOWN || '#9ca3af'
                  const [r, g, b] = hexToRgb01(hex)
                  const o = i * 3
                  colors[o] = r
                  colors[o + 1] = g
                  colors[o + 2] = b
                }

                const attr = new THREE.BufferAttribute(positions, 3)
                geometry.setAttribute('position', attr)
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

                const material = new THREE.PointsMaterial({
                  vertexColors: true,
                  size: 0.42,
                  sizeAttenuation: true,
                  transparent: true,
                  opacity: 1,
                  map: pointSprite,
                  alphaTest: 0.04,
                  blending: THREE.NormalBlending,
                  depthWrite: false,
                })

                const pts = new THREE.Points(geometry, material)
                pts.frustumCulled = false
                // Our positions are in Earth radii; scale to the actual globe radius.
                pts.scale.setScalar(globeRadius)

                globeRadiusRef.current = globeRadius

                pointsObjRef.current = pts
                positionsAttrRef.current = attr

                // Apply current frame immediately if available
                const frames = framesRef.current
                if (frames?.length) {
                  const frame = frames[playIndexRef.current] || frames[0]
                  if (frame && frame.length === attr.array.length) {
                    attr.array.set(frame)
                    attr.needsUpdate = true
                  }
                }

                return pts
              }}
            />

            {bufferStatus === 'building' ? (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="glass rounded-2xl px-5 py-4">
                  <div className="text-sm font-bold">Buffering next seconds…</div>
                  <div className="text-xs text-white/60 mt-2">
                    Buffered: {Math.round(bufferProgress)}s ahead · Playback starts when ready.
                  </div>
                </div>
              </div>
            ) : null}

            <div className="absolute left-4 bottom-4 glass rounded-2xl px-4 py-3">
              <div className="text-xs text-white/60">Playback</div>
              <div className="mono text-sm font-bold">{bufferStatus === 'ready' ? `Fixed slow speed · ~${Math.round(bufferProgress)}s buffered` : 'Buffering…'}</div>
            </div>

            <div className="absolute right-4 bottom-4 glass rounded-2xl px-4 py-3">
              <div className="text-xs text-white/60">Perf</div>
              <div className="mono text-xs mt-1">Mode: buffered points · Cap: {Math.min(50000, maxObjects)}</div>
            </div>

            <div className="absolute right-4 top-4 glass rounded-2xl px-4 py-3 max-w-[280px]">
              <div className="text-xs text-white/60">Legend (type)</div>
              <div className="mt-2 flex flex-col gap-1">
                {legendItems.slice(0, 8).map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-block w-3 h-3 rounded" style={{ background: it.color }} />
                      <span className="truncate">{it.key}</span>
                    </div>
                    <span className="mono text-white/70">{it.count}</span>
                  </div>
                ))}
                {legendItems.length > 8 ? (
                  <div className="text-[11px] text-white/50 mt-1">+ {legendItems.length - 8} more… (filter by Class to isolate)</div>
                ) : null}
              </div>
            </div>

            {hover?.sat ? (
              <div
                className="absolute z-20 glass rounded-xl px-3 py-2 pointer-events-none"
                style={{ left: hover.x, top: hover.y }}
              >
                <div className="text-xs font-bold truncate max-w-[320px]">{hover.sat.name || 'Unknown object'}</div>
                <div className="text-[11px] text-white/70 mono mt-1">NORAD: {hover.sat.norad || '—'}</div>
                <div className="text-[11px] text-white/70 mt-1">Type: <span className="mono">{satToFourClass(hover.sat)}</span></div>
                <div className="text-[11px] text-white/70 mt-1">Launch: <span className="mono">{hover.sat.launchDate || 'Unknown'}</span></div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export default memo(OrbitMonitor3D)
