import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ignore from 'ignore'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

const dir = process.cwd()

function mustGetEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
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
  return files.length
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
  const token = mustGetEnv('GITHUB_TOKEN')

  await git.push({
    fs,
    http,
    dir,
    remote: 'origin',
    ref: 'main',
    onAuth: () => ({ username: 'x-access-token', password: token }),
    onAuthFailure: () => {
      throw new Error('GitHub auth failed. Check GITHUB_TOKEN permissions.')
    },
  })
}

async function main() {
  const repoUrl = mustGetEnv('GITHUB_REPO_URL')

  if (!repoUrl.startsWith('https://')) {
    throw new Error('GITHUB_REPO_URL must be an https URL (e.g. https://github.com/user/repo.git)')
  }

  await ensureRepo()
  await ensureRemote(repoUrl)

  const count = await stageAll()
  if (count === 0) {
    console.log('No files to commit (everything ignored).')
    return
  }

  const sha = await commitAll()
  console.log(`Committed ${count} files at ${sha}`)

  await pushMain()
  console.log('Pushed to origin/main')
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  process.exitCode = 1
})
