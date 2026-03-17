import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import ignore from 'ignore'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

const dir = process.cwd()

async function readOptionalFileText(relPath) {
  const abs = path.join(dir, relPath)
  try {
    const t = await fsp.readFile(abs, 'utf8')
    return t.trim()
  } catch {
    return null
  }
}

function mustGetEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

async function getRepoUrl() {
  return (
    process.env.GITHUB_REPO_URL ||
    (await readOptionalFileText('.github-repo-url'))
  )
}

async function getToken() {
  return (
    process.env.GITHUB_TOKEN ||
    (await readOptionalFileText('.github-token'))
  )
}

function parseOwnerRepo(repoUrl) {
  const u = new URL(repoUrl)
  // Expect: /owner/repo(.git)
  const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
  if (parts.length < 2) throw new Error(`Could not parse owner/repo from ${repoUrl}`)
  const owner = parts[0]
  const repo = parts[1]
  return { owner, repo }
}

async function pathExists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function loadIgnore(dirPath) {
  const ig = ignore()

  // Hard defaults regardless of .gitignore
  ig.add([
    '.git/',
    'node_modules/',
    'dist/',
    '.vite/',
    '*.log',
  ])

  const gitignorePath = path.join(dirPath, '.gitignore')
  if (await pathExists(gitignorePath)) {
    const text = await fsp.readFile(gitignorePath, 'utf8')
    ig.add(text)
  }

  return ig
}

async function walkFiles(rootDir, ig, relDir = '') {
  const abs = path.join(rootDir, relDir)
  const entries = await fsp.readdir(abs, { withFileTypes: true })

  const out = []
  for (const ent of entries) {
    const rel = path.posix
      .join(relDir.split(path.sep).join(path.posix.sep), ent.name)
      .replace(/^\//, '')

    // ignore package wants posix paths
    const relPosix = rel

    if (ig.ignores(relPosix)) continue

    if (ent.isDirectory()) {
      out.push(...(await walkFiles(rootDir, ig, path.join(relDir, ent.name))))
    } else if (ent.isFile()) {
      out.push(relPosix)
    }
  }
  return out
}

async function ensureRepo() {
  if (!(await pathExists(path.join(dir, '.git')))) {
    await git.init({ fs, dir, defaultBranch: 'main' })
  }
}

async function ensureRemote(url) {
  const remotes = await git.listRemotes({ fs, dir })
  const hasOrigin = remotes.some((r) => r.remote === 'origin')
  if (!hasOrigin) {
    await git.addRemote({ fs, dir, remote: 'origin', url })
  }
}

async function stageAll() {
  const ig = await loadIgnore(dir)
  const files = await walkFiles(dir, ig)
  for (const filepath of files) {
    await git.add({ fs, dir, filepath })
  }

  // Also stage deletions and remove anything that is now ignored but tracked.
  // This avoids accidentally keeping secret/artifact files in the repo.
  let removed = 0
  const tracked = await git.listFiles({ fs, dir })
  for (const filepath of tracked) {
    const abs = path.join(dir, filepath.split('/').join(path.sep))
    const exists = await pathExists(abs)
    if (!exists || ig.ignores(filepath)) {
      await git.remove({ fs, dir, filepath })
      removed++
    }
  }

  return files.length + removed
}

async function runPrecomputeAnalytics() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/precompute-analytics.mjs'], {
      cwd: dir,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`precompute-analytics failed with exit code ${code}`))
    })
  })
}

async function hasStagedChanges() {
  // statusMatrix rows: [filepath, HEAD, workdir, stage]
  // We only care whether stage differs from HEAD (i.e. something to commit).
  const matrix = await git.statusMatrix({ fs, dir })
  return matrix.some((row) => {
    const head = row[1]
    const stage = row[3]
    return stage !== head
  })
}

async function commitAll() {
  const name = process.env.GIT_AUTHOR_NAME || 'CIEE'
  const email = process.env.GIT_AUTHOR_EMAIL || 'ciee@example.local'
  const message = process.env.COMMIT_MESSAGE || 'Initial commit'

  const sha = await git.commit({
    fs,
    dir,
    message,
    author: { name, email },
  })
  return sha
}

async function pushMain() {
  const token = (await getToken())
  if (!token) throw new Error('Missing GitHub token. Set GITHUB_TOKEN or create .github-token')
  const username = (process.env.GITHUB_USERNAME || '').trim() || 'x-access-token'

  await git.push({
    fs,
    http,
    dir,
    remote: 'origin',
    ref: 'main',
    onAuth: () => ({ username, password: token }),
    onAuthFailure: () => {
      throw new Error('GitHub auth failed. Check GITHUB_TOKEN permissions.')
    },
  })
}

async function pushWithFallback({ repoUrl, message }) {
  try {
    await pushMain()
    console.log('Pushed to origin/main')
  } catch (e) {
    const msg = String(e?.message || '')
    if (msg.includes('403') || msg.includes('not a simple fast-forward') || msg.includes('Push rejected')) {
      console.warn('Git push failed. Falling back to GitHub API publish…')
      await pushViaGitHubApi({ repoUrl, message })
      return
    }
    throw e
  }
}

async function githubRequest(token, url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'ciee-publish-script',
      'Accept': 'application/vnd.github+json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.message || text || `${res.status} ${res.statusText}`
    const err = new Error(`GitHub API ${res.status}: ${msg}`)
    err.status = res.status
    throw err
  }
  return json
}

function isBinaryPath(filepath) {
  const lower = filepath.toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff2'].some((ext) => lower.endsWith(ext))
}

async function pushViaGitHubApi({ repoUrl, message }) {
  const token = (await getToken())
  if (!token) throw new Error('Missing GitHub token. Set GITHUB_TOKEN or create .github-token')

  const { owner, repo } = parseOwnerRepo(repoUrl)
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`

  const ig = await loadIgnore(dir)
  const files = await walkFiles(dir, ig)
  if (files.length === 0) {
    console.log('No files to publish (everything ignored).')
    return
  }

  // Determine current main ref (if exists)
  let parentSha = null
  let baseTree = null
  try {
    const ref = await githubRequest(token, `${apiBase}/git/ref/heads/main`)
    parentSha = ref?.object?.sha || null
    if (parentSha) {
      const commit = await githubRequest(token, `${apiBase}/git/commits/${parentSha}`)
      baseTree = commit?.tree?.sha || null
    }
  } catch (e) {
    if (e?.status !== 404) throw e
  }

  const tree = []
  for (const filepath of files) {
    const abs = path.join(dir, filepath.split('/').join(path.sep))
    const buf = await fsp.readFile(abs)
    const isBinary = isBinaryPath(filepath)
    const body = isBinary
      ? { content: buf.toString('base64'), encoding: 'base64' }
      : { content: buf.toString('utf8'), encoding: 'utf-8' }

    const blob = await githubRequest(token, `${apiBase}/git/blobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    tree.push({
      path: filepath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })
  }

  const createdTree = await githubRequest(token, `${apiBase}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      base_tree: baseTree || undefined,
      tree,
    },
  })

  const commit = await githubRequest(token, `${apiBase}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      message,
      tree: createdTree.sha,
      parents: parentSha ? [parentSha] : [],
    },
  })

  // Update/create main ref
  if (parentSha) {
    await githubRequest(token, `${apiBase}/git/refs/heads/main`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { sha: commit.sha, force: false },
    })
  } else {
    await githubRequest(token, `${apiBase}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { ref: 'refs/heads/main', sha: commit.sha },
    })
  }

  console.log(`Published via GitHub API: ${commit.sha}`)
}

async function main() {
  const repoUrl = await getRepoUrl()
  if (!repoUrl) throw new Error('Missing repo URL. Set GITHUB_REPO_URL or create .github-repo-url')

  if (!repoUrl.startsWith('https://')) {
    throw new Error('GITHUB_REPO_URL must be an https URL (e.g. https://github.com/user/repo.git)')
  }

  await ensureRepo()
  await ensureRemote(repoUrl)

  console.log('Regenerating analytics precomputed JSON…')
  await runPrecomputeAnalytics()

  const count = await stageAll()
  if (count === 0) {
    console.log('No files to commit (everything ignored).')
    return
  }

  if (!(await hasStagedChanges())) {
    console.log('No changes to commit; attempting push anyway…')
    await pushWithFallback({ repoUrl, message: process.env.COMMIT_MESSAGE || 'Update' })
    return
  }

  const sha = await commitAll()
  console.log(`Committed ${count} files at ${sha}`)

  await pushWithFallback({ repoUrl, message: process.env.COMMIT_MESSAGE || 'Initial commit' })
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exitCode = 1
})
