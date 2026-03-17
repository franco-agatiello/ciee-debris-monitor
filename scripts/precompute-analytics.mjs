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
    return { year, count, ma5: Number(ma5.toFixed(2)) }
  })
}

function buildLifetimeByType(lifeStats) {
  const order = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN']
  const labels = {
    PAYLOAD: 'Payload',
    'ROCKET BODY': 'Rocket Body',
    DEBRIS: 'Debris',
    UNKNOWN: 'Unknown',
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

function buildLifetimeStatsTable(lifeSamples) {
  const order = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS', 'UNKNOWN']
  const labels = {
    PAYLOAD: 'Payload',
    'ROCKET BODY': 'Rocket Body',
    DEBRIS: 'Debris',
    UNKNOWN: 'Unknown',
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
  })

  const rowsActive = await parseCsvFile(src.active, (r) => {
    activeCount += 1
    const t = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
    activeCounts[t] = (activeCounts[t] || 0) + 1
    const m = toNumber(r.masa_en_orbita)
    if (Number.isFinite(m)) massOrbit += m

    const c = ensureCountry(r.COUNTRY_CODE)
    if (Number.isFinite(m)) c.massTotal += m
  })

  const rowsDecayed = await parseCsvFile(src.decayed, (r) => {
    decayedCount += 1
    const y = yearFromDate(r.DECAY_DATE)
    if (y) decayByYear.set(y, (decayByYear.get(y) || 0) + 1)

    const type = normalizeType(r.OBJECT_TYPE ?? r.clase_objeto)
    const days = orbitDaysFromRow(r)
    if (Number.isFinite(days)) {
      lifeStats[type].totalDays += days
      lifeStats[type].count += 1
      lifeSamples[type].push(days)
    }

    const c = ensureCountry(r.COUNTRY_CODE)
    c.reentered += 1
    const m = toNumber(r.masa_en_orbita)
    if (Number.isFinite(m)) {
      massReentered += m
      c.massTotal += m
    }

    const cohort = cohortKeyFromYear(yearFromDate(r.LAUNCH_DATE))
    if (cohort) {
      if (!cohortMap.has(cohort)) cohortMap.set(cohort, { launched: 0, reentered: 0, totalDaysToReentry: 0 })
      const cohortRow = cohortMap.get(cohort)
      cohortRow.reentered += 1
      if (Number.isFinite(days)) cohortRow.totalDaysToReentry += days
    }
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
  const reentryTrend = buildReentryTrend(decayByYear)
  const topPolluters = Array.from(polluters.values())
    .map((d) => ({ ...d, total: d.payload + d.rocketBody + d.debris }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
  const lifetimeByType = buildLifetimeByType(lifeStats)
  const fragmentationIndex = buildFragmentationIndex(topPolluters)
  const countryFootprint = buildCountryFootprintTable(countryStats)
  const lifetimeStatsTable = buildLifetimeStatsTable(lifeSamples)
  const launchCohorts = buildCohortTable(cohortMap)

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
    reentryTrend,
    lifetimeByType,
    fragmentationIndex,
    gabbard: scatter,
    massBudget,
    topPolluters,
    countryFootprint,
    lifetimeStatsTable,
    launchCohorts,
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
