import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = new Set(process.argv.slice(2))
const portArgIndex = process.argv.findIndex((a) => a === '--port')
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 5173

const root = path.resolve(__dirname, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

function safeJoin(base, requestPath) {
  const joined = path.resolve(base, '.' + requestPath)
  if (!joined.startsWith(base)) return null
  return joined
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)

    if (pathname === '/' || pathname === '') pathname = '/index.html'

    const filePath = safeJoin(root, pathname)
    if (!filePath) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback: for non-asset routes
        if (!path.extname(filePath)) {
          fs.readFile(path.join(root, 'index.html'), (err2, html) => {
            if (err2) {
              res.statusCode = 404
              res.end('Not found')
              return
            }
            res.setHeader('Content-Type', MIME['.html'])
            res.end(html)
          })
          return
        }

        res.statusCode = 404
        res.end('Not found')
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      res.end(data)
    })
  } catch (e) {
    res.statusCode = 500
    res.end(String(e?.message || e))
  }
})

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Serving dist from ${root}`)
  // eslint-disable-next-line no-console
  console.log(`Open: http://localhost:${port}`)
  if (args.has('--open')) {
    // no-op here; we open via VS Code Simple Browser
  }
})
