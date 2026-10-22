import { spawn } from 'node:child_process'

import { COMMIT_SHA, LIMITS, readTrackerRef, repoPath } from 'kehikot-module-protocol'

import { shapeBuffer, type Wanted } from './read.ts'
import type { Seen } from './shape.ts'
import { WITHHELD_PAGE, withheld, withheldFrom } from './withheld.ts'

/**
 * A file as it is in a change: at the change's head (`side: 'new'`) or at its
 * base (`side: 'old'`), read out of a commit and never off the disk.
 *
 * ## Read-only, the whole way down
 *
 * Nothing here writes. The commit is read with `git cat-file blob` in the
 * project's own checkout — which reads the object database and changes
 * nothing, with lazy fetching and optional locks turned off — and, when the
 * checkout does not have that commit, through the tracker's CLI that already
 * holds the person's login (`gh api`, `glab api`), asked for one file's raw
 * contents. No fetch, no checkout, no worktree: the person's repository is in
 * exactly the state it was.
 *
 * Every command is spawned with `shell: false` and its arguments as an array,
 * so nothing a message named is ever a shell word. The path is held to the
 * protocol's `repoPath` (no leading slash, no `..`), the commit to `COMMIT_SHA`,
 * the repository to segments a forge would accept.
 *
 * ## Which commit
 *
 * The one the location names (`commit`) when it names one. Otherwise the
 * change's head for `new`, and its merge base for `old` — the commit a diff's
 * left side is counted on (GitLab's `diff_refs.base_sha`, GitHub's
 * `merge_base_commit`).
 */

export type Forge = 'github' | 'gitlab'

export interface Target {
  forge: Forge
  /** `owner/repo` or `group/sub/project`, or null for "the repository of the checkout". */
  repo: string | null
  number: number
  /** A self-hosted GitLab's host, when the change's URL names one. */
  host?: string
}

/** How long one CLI call may take. */
const RUN_TIMEOUT_MS = 20_000
/** The most of a file read out of a commit, in bytes. The page shows a window of it (`MAX_BYTES`). */
export const MAX_BLOB = 8_000_000
/** How many blobs are kept: a commit's file never changes, so a re-read is the same bytes. */
const KEEP = 16

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/
const repoOk = (repo: string) => {
  const parts = repo.split('/')
  return parts.length >= 2 && parts.length <= 8 && parts.every((one) => SEGMENT.test(one))
}

/**
 * The change a URL names: a GitHub pull request or a GitLab merge request.
 * The same reading Diff makes of a tracker row's `url`.
 */
export function targetOfUrl(url: unknown): Target | null {
  if (typeof url !== 'string' || !url || url.length > LIMITS.URL) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)
  const number = (raw: string | undefined) => (raw && /^[0-9]{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null)
  if (host === 'github.com' || host === 'www.github.com') {
    const [owner, repo, kind, id] = parts
    const n = number(id)
    if (!owner || !repo || kind !== 'pull' || n === null) return null
    const name = `${owner}/${repo}`
    return repoOk(name) ? { forge: 'github', repo: name, number: n } : null
  }
  const dash = parts.indexOf('-')
  if (dash > 0 && parts[dash + 1] === 'merge_requests') {
    const n = number(parts[dash + 2])
    const repo = parts.slice(0, dash).join('/')
    if (n === null || !repoOk(repo)) return null
    const onPublic = host === 'gitlab.com' || host === 'www.gitlab.com'
    return { forge: 'gitlab', repo, number: n, ...(onPublic ? {} : { host: parsed.host }) }
  }
  return null
}

/** The change a ref spelling names, when it can only be a change or its tracker is known. */
export function targetOfRef(change: string): Target | null {
  const name = readTrackerRef(change)
  if (!name || name.kind === 'issue') return null
  if (name.repo !== null && !repoOk(name.repo)) return null
  return { forge: name.tracker === 'gitlab' ? 'gitlab' : 'github', repo: name.repo, number: name.number }
}

/* ------------------------------------------------------------------ *
 * Running a CLI
 * ------------------------------------------------------------------ */

export type Ran = { ok: true; out: Buffer } | { ok: false; error: string; missing?: boolean }
export type Runner = (cmd: string, args: string[], options: { cwd: string; env: Record<string, string>; max: number }) => Promise<Ran>

/** The real one: no shell, a deadline, bounded output, a sentence on failure. */
export const spawnRunner: Runner = (cmd, args, { cwd, env, max }) =>
  new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, shell: false, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, error: `${cmd} could not be started: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    const out: Buffer[] = []
    let size = 0
    let over = false
    let err = ''
    let done = false
    const finish = (ran: Ran) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ran)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `${cmd} did not answer within ${Math.round(RUN_TIMEOUT_MS / 1000)} seconds.` })
    }, RUN_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        over = true
        child.kill('SIGKILL')
        return
      }
      out.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (err.length < 2000) err += chunk.toString('utf8')
    })
    child.on('error', (e: NodeJS.ErrnoException) =>
      finish(
        e.code === 'ENOENT'
          ? { ok: false, missing: true, error: `\`${cmd}\` is not installed on this machine, or is not on this server's PATH.` }
          : { ok: false, error: `${cmd} could not be run: ${e.message}` },
      ),
    )
    child.on('close', (code) => {
      if (over) return finish({ ok: false, error: `That file is larger than ${Math.round(max / 1_000_000)} MB, so it is not shown here.` })
      if (code === 0) return finish({ ok: true, out: Buffer.concat(out) })
      finish({ ok: false, error: err.trim().slice(0, 400) || `${cmd} exited ${code} without saying why.` })
    })
  })

let runner: Runner = spawnRunner
/** For tests: what runs a command. `null` puts the real one back. */
export function setRunner(next: Runner | null): void {
  runner = next ?? spawnRunner
}

/** Git, read-only: never fetch a missing object, never take an optional lock, never ask for a password. */
const GIT_ENV = { GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
const forgeEnv = (target: Target): Record<string, string> =>
  target.forge === 'gitlab' && target.host ? { GITLAB_HOST: target.host } : {}
const enc = encodeURIComponent

async function json(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const ran = await runner(cmd, args, { cwd, env, max: 2_000_000 })
  if (!ran.ok) return ran
  try {
    return { ok: true, value: JSON.parse(ran.out.toString('utf8')) }
  } catch {
    return { ok: false, error: `${cmd} answered with something that is not JSON.` }
  }
}

const sha = (value: unknown): string | null => (typeof value === 'string' && COMMIT_SHA.test(value) ? value : null)
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), value)

/**
 * The commit a side of a change is counted on: its head for `new`, its merge
 * base for `old`. Asked of the tracker's CLI in the project's checkout, which
 * is how a short ref (`gh#41`, `!7`) finds its repository.
 */
export async function commitOf(root: string, target: Target, side: 'new' | 'old'): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  const env = forgeEnv(target)
  if (target.forge === 'github') {
    const args = ['pr', 'view', String(target.number), '--json', 'headRefOid,baseRefOid', ...(target.repo ? ['--repo', target.repo] : [])]
    const read = await json('gh', args, root, env)
    if (!read.ok) return read
    const head = sha(field(read.value, 'headRefOid'))
    if (side === 'new') return head ? { ok: true, sha: head } : { ok: false, error: 'GitHub named no head commit for that pull request.' }
    const base = sha(field(read.value, 'baseRefOid'))
    if (!head || !base) return { ok: false, error: 'GitHub named no base commit for that pull request.' }
    const repo = target.repo ?? '{owner}/{repo}'
    const compared = await json('gh', ['api', `repos/${repo}/compare/${base}...${head}`], root, env)
    if (!compared.ok) return compared
    const merged = sha(field(compared.value, 'merge_base_commit', 'sha'))
    return merged ? { ok: true, sha: merged } : { ok: false, error: 'GitHub named no merge base for that pull request.' }
  }
  const project = target.repo ? enc(target.repo) : ':id'
  const read = await json('glab', ['api', `projects/${project}/merge_requests/${target.number}`], root, env)
  if (!read.ok) return read
  const which = side === 'new' ? 'head_sha' : 'base_sha'
  const found = sha(field(read.value, 'diff_refs', which)) ?? (side === 'new' ? sha(field(read.value, 'sha')) : null)
  return found ? { ok: true, sha: found } : { ok: false, error: `GitLab named no ${side === 'new' ? 'head' : 'base'} commit for that merge request.` }
}

const blobs = new Map<string, { content: Buffer; from: 'git' | 'forge' }>()
/** For tests. */
export function forgetBlobs(): void {
  blobs.clear()
}

/**
 * One file at one commit: from the checkout when it has the commit, else from
 * the forge. A commit's file never changes, so what was read is kept.
 */
export async function blobAt(
  root: string,
  target: Target,
  commit: string,
  path: string,
): Promise<{ ok: true; content: Buffer; from: 'git' | 'forge' } | { ok: false; error: string }> {
  const key = `${target.forge}|${target.host ?? ''}|${target.repo ?? root}|${commit}|${path}`
  const had = blobs.get(key)
  if (had) return { ok: true, ...had }

  const keep = (content: Buffer, from: 'git' | 'forge') => {
    blobs.set(key, { content, from })
    while (blobs.size > KEEP) blobs.delete(blobs.keys().next().value as string)
    return { ok: true as const, content, from }
  }

  /* The checkout first: no network, and it is the bytes the person has. */
  const local = await runner('git', ['-C', root, 'cat-file', 'blob', `${commit}:${path}`], { cwd: root, env: GIT_ENV, max: MAX_BLOB })
  if (local.ok) return keep(local.out, 'git')

  const env = forgeEnv(target)
  const forge =
    target.forge === 'github'
      ? await runner(
          'gh',
          ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${target.repo ?? '{owner}/{repo}'}/contents/${path.split('/').map(enc).join('/')}?ref=${commit}`],
          { cwd: root, env, max: MAX_BLOB },
        )
      : await runner('glab', ['api', `projects/${target.repo ? enc(target.repo) : ':id'}/repository/files/${enc(path)}/raw?ref=${commit}`], {
          cwd: root,
          env,
          max: MAX_BLOB,
        })
  if (forge.ok) return keep(forge.out, 'forge')
  return { ok: false, error: `That file could not be read at ${commit.slice(0, 7)}: ${forge.error}` }
}

/**
 * The bytes from the start of `line` to the end of `endLine` (the newline
 * after it not included), or null when the file is shorter than `line`. What
 * a location's lines are to `shapeBuffer`'s byte-range mark.
 */
export function linesToBytes(content: Buffer, line: number, endLine: number = line): Wanted | null {
  let at = 0
  let current = 1
  while (current < line) {
    const next = content.indexOf(0x0a, at)
    if (next === -1) return null
    at = next + 1
    current += 1
  }
  const from = at
  while (current < endLine) {
    const next = content.indexOf(0x0a, at)
    if (next === -1) break
    at = next + 1
    current += 1
  }
  const close = content.indexOf(0x0a, at)
  const to = close === -1 ? content.length : close
  /* An empty line is still a line: mark the newline that ends it, so it shows. */
  return to > from ? { from, to } : from < content.length ? { from, to: from + 1 } : null
}

export interface Asked {
  root: string
  change: string
  url: unknown
  path: unknown
  side: unknown
  line: unknown
  endLine: unknown
  commit: unknown
}

export type ChangeFile =
  | { ok: true; seen: Seen; commit: string; change: string; side: 'new' | 'old'; from: 'git' | 'forge' }
  | { ok: false; error: string; status: number }

const count = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= LIMITS.CODE_LINE ? n : null
}

/** Everything the page's `/api/change` asks for, checked, read and shaped. */
export async function changeFile(asked: Asked): Promise<ChangeFile> {
  const target = targetOfUrl(asked.url) ?? targetOfRef(asked.change)
  if (!target) return { ok: false, status: 400, error: `${asked.change.slice(0, 64)} is not a change this app can read: it needs a GitHub pull request or a GitLab merge request.` }
  const path = repoPath.safeParse(asked.path)
  if (!path.success) return { ok: false, status: 400, error: 'That is not a path inside a repository.' }
  if (withheldFrom(path.data, 'page')) return { ok: false, status: 404, error: WITHHELD_PAGE }
  const side = asked.side === 'old' ? 'old' : 'new'
  const line = count(asked.line)
  const endLine = count(asked.endLine)
  if (asked.line !== undefined && asked.line !== null && asked.line !== '' && line === null) {
    return { ok: false, status: 400, error: 'A line is a whole number from 1.' }
  }
  if (line !== null && endLine !== null && endLine < line) return { ok: false, status: 400, error: 'A range of lines ends at or after it starts.' }

  let commit = asked.commit === undefined || asked.commit === null || asked.commit === '' ? null : sha(asked.commit)
  if (asked.commit && commit === null) return { ok: false, status: 400, error: 'That is not a commit.' }
  if (!commit) {
    const found = await commitOf(asked.root, target, side)
    if (!found.ok) return { ok: false, status: 502, error: found.error }
    commit = found.sha
  }

  const blob = await blobAt(asked.root, target, commit, path.data)
  if (!blob.ok) return { ok: false, status: 404, error: blob.error }
  const wanted = line === null ? null : linesToBytes(blob.content, line, endLine ?? line)
  const seen = shapeBuffer(path.data, blob.content, wanted, withheld(path.data))
  /* A line that is past the end of the file at this commit is said, not invented. */
  const lost = line !== null && seen.kind === 'text' && wanted === null ? { ...seen, markLost: true } : seen
  return { ok: true, seen: lost, commit, change: asked.change, side, from: blob.from }
}
