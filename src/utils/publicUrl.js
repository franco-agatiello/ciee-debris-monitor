export function publicUrl(path) {
  if (!path) return path

  // Leave absolute URLs untouched (http:, https:, //cdn...)
  if (/^(?:[a-z]+:)?\/\//i.test(path)) return path

  const base = import.meta.env.BASE_URL || '/'

  // Avoid double-prefixing if caller already used BASE_URL
  if (path.startsWith(base)) return path

  const clean = path.startsWith('/') ? path.slice(1) : path
  return base.endsWith('/') ? base + clean : `${base}/${clean}`
}
