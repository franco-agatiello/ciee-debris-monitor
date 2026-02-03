import Papa from 'papaparse'

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
  url,
  {
    worker,
    requiredColumns,
    timeoutMs = 15000,
    delimitersToGuess = [',', ';', '\t', '|', ':'],
  } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId = null

    const finish = (fn) =>
      (value) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        fn(value)
      }

    const onResolve = finish(resolve)
    const onReject = finish((err) => reject(err instanceof Error ? err : new Error(String(err))))

    const parser = Papa.parse(url, {
      download: true,
      worker: Boolean(worker),
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
                `CSV header mismatch for ${url}. Missing columns: ${missing.join(
                  ', ',
                )}. This usually indicates a delimiter/encoding issue.`
              )
            )
            return
          }
        }

        onResolve(rows)
      },
      error: onReject,
    })

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          parser?.abort?.()
        } catch {
          // ignore
        }
        onReject(new Error(`CSV parse timed out after ${timeoutMs}ms for ${url}`))
      }, timeoutMs)
    }
  })
}

export async function loadCsv(url, { cacheKey = url, requiredColumns = null } = {}) {
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const p = (async () => {
    try {
      return await parseCsv(url, { worker: true, requiredColumns, timeoutMs: 15000 })
    } catch (err) {
      console.warn('CSV worker parse failed; retrying without worker:', err)
      return await parseCsv(url, { worker: false, requiredColumns, timeoutMs: 30000 })
    }
  })()

  // If it fails, don't poison the cache.
  p.catch(() => {
    cache.delete(cacheKey)
  })

  cache.set(cacheKey, p)
  return p
}
