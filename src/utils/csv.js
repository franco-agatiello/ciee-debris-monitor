import Papa from 'papaparse'
import { publicUrl } from './publicUrl'

const cache = new Map()

export function toNumber(value) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  // supports decimal comma as well
  const normalized = s.replace(/\./g, '').replace(',', '.').replace(/\s+/g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function toStringSafe(value) {
  if (value == null) return ''
  return String(value).trim()
}

function trimRowStrings(row) {
  if (!row || typeof row !== 'object') return row
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (typeof v === 'string') row[k] = v.trim()
  }
  return row
}

function parseCsv(
  csvText,
  {
    requiredColumns,
    delimitersToGuess = [',', ';', '\t', '|', ':'],
  } = {}
) {
  return new Promise((resolve, reject) => {
    const onReject = (err) => reject(err instanceof Error ? err : new Error(String(err)))

    Papa.parse(csvText, {
      worker: false,
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimiter: '',
      delimitersToGuess,
      complete: (results) => {
        if (results?.errors?.length) {
          console.warn('PapaParse errors:', results.errors.slice(0, 3))
        }

        const rows = (results?.data || []).filter(Boolean).map(trimRowStrings)

        if (requiredColumns && rows.length) {
          const head = rows[0]
          const missing = requiredColumns.filter((c) => !(c in head))
          if (missing.length) {
            onReject(
              new Error(
                `CSV header mismatch. Missing columns: ${missing.join(
                  ', ',
                )}. This usually indicates a delimiter/encoding issue.`
              )
            )
            return
          }
        }

        resolve(rows)
      },
      error: onReject,
    })
  })
}

async function fetchCsvText(url, timeoutMs = 60000) {
  const controller = new AbortController()
  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort()
        }, timeoutMs)
      : null

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`Failed to load CSV ${url}: ${response.status} ${response.statusText}`)
    }

    return await response.text()
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`CSV fetch timed out after ${timeoutMs}ms for ${url}`)
    }
    throw err
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function loadCsv(url, { cacheKey = url, requiredColumns = null } = {}) {
  const resolvedUrl = publicUrl(url)
  const resolvedCacheKey = cacheKey === url ? resolvedUrl : cacheKey

  if (cache.has(resolvedCacheKey)) return cache.get(resolvedCacheKey)

  const p = (async () => {
    const csvText = await fetchCsvText(resolvedUrl, 90000)
    return await parseCsv(csvText, { requiredColumns })
  })()

  // If it fails, don't poison the cache.
  p.catch(() => {
    cache.delete(resolvedCacheKey)
  })

  cache.set(resolvedCacheKey, p)
  return p
}
