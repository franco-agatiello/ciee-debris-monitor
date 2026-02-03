import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'public', 'data')
const OUT_PATH = path.join(DATA_DIR, 'analytics.precomputed.json')

const COLORS = {
  payload: '#06b6d4',
  rocket: '#f97316',
  debris: '#fb923c',
  decayed: '#8b5cf6',
  unknown: '#94a3b8',
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

function readFileUtf8(p) {
  return fs.readFileSync(p, 'utf8')
}

async function parseCsvFile(filePath, onRow) {
  const text = readFileUtf8(filePath)
  return new Promise((resolve, reject) => {
    let rows = 0
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      delimiter: '',
      delimitersToGuess: [':', ',', ';', '\t', '|'],
      step: (result) => {
        const r = result?.data
        if (!r) return
        rows += 1
        onRow(r)
      },
      complete: () => resolve(rows),
      error: (e) => reject(e),
    })
  })
}

async function main() {
  const src = {
    catalog: path.join(DATA_DIR, 'debris_total.csv'),
    active: path.join(DATA_DIR, 'debris_orbita.csv'),
    decayed: path.join(DATA_DIR, 'debris_reingresados.csv'),
    impacts: path.join(DATA_DIR, 'debris_reingresados_con_pos.csv'),
  }

  for (const [k, p] of Object.entries(src)) {
    if (!fs.existsSync(p)) {
      throw new Error(`Missing ${k} CSV: ${p}`)
    }
  }

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

  const rowsCatalog = await parseCsvFile(src.catalog, (r) => {
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
  })

  const rowsActive = await parseCsvFile(src.active, (r) => {
    activeCount += 1
    const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
    activeCounts[t] = (activeCounts[t] || 0) + 1
    const m = toNumber(r.masa_en_orbita)
    if (Number.isFinite(m)) massOrbit += m
  })

  const rowsDecayed = await parseCsvFile(src.decayed, (r) => {
    decayedCount += 1
    const y = yearFromDate(r.DECAY_DATE)
    if (y) decayByYear.set(y, (decayByYear.get(y) || 0) + 1)
    const m = toNumber(r.masa_en_orbita)
    if (Number.isFinite(m)) massReentered += m
  })

  const rowsImpacts = await parseCsvFile(src.impacts, (r) => {
    impactsCount += 1
    const lat = toNumber(r.lat_caida)
    if (!Number.isFinite(lat)) return
    const clamped = Math.max(-90, Math.min(89.999, lat))
    const bucket = Math.floor((clamped + 90) / 10) * 10 - 90
    if (!latCounts.has(bucket)) return
    latCounts.set(bucket, (latCounts.get(bucket) || 0) + 1)
  })

  const kessler = buildYearSeries(launchByYear, decayByYear)
  const topPolluters = Array.from(polluters.values())
    .map((d) => ({ ...d, total: d.payload + d.rocketBody + d.debris }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)

  const composition = [
    { name: 'Payload', key: 'PAYLOAD', value: activeCounts.PAYLOAD || 0, color: COLORS.payload },
    { name: 'Rocket Body', key: 'ROCKET BODY', value: activeCounts['ROCKET BODY'] || 0, color: COLORS.rocket },
    { name: 'Debris', key: 'DEBRIS', value: activeCounts.DEBRIS || 0, color: COLORS.debris },
    { name: 'Unknown', key: 'UNKNOWN', value: activeCounts.UNKNOWN || 0, color: COLORS.unknown },
  ]

  const regimes = [
    { name: 'LEO (<128m)', value: regimesCounts.LEO, color: '#22c55e' },
    { name: 'MEO (128–1400m)', value: regimesCounts.MEO, color: COLORS.payload },
    { name: 'GEO (>1400m)', value: regimesCounts.GEO, color: COLORS.decayed },
    { name: 'Unknown', value: regimesCounts.UNKNOWN, color: COLORS.unknown },
  ]

  const latBands = buildLatBandsFromCounts(latCounts)
  const massBudget = { inOrbit: massOrbit, reentered: massReentered }

  const kpis = [
    { label: 'Catalog', value: catalogCount },
    { label: 'Active', value: activeCount },
    { label: 'Decayed', value: decayedCount },
    { label: 'Impacts', value: impactsCount },
    { label: 'In-Orbit Mass', value: `${Math.round(massOrbit)}` },
  ]

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      rows: {
        catalog: rowsCatalog,
        active: rowsActive,
        decayed: rowsDecayed,
        impacts: rowsImpacts,
      },
    },
    kessler,
    gabbard: scatter,
    massBudget,
    topPolluters,
    latBands,
    composition,
    regimes,
    kpis,
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload))
  console.log(`Wrote ${OUT_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
