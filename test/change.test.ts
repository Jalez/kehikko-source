import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer, setHostAsk } from '../doors.ts'
import {
  blobAt,
  changeFile,
  forgetBlobs,
  linesToBytes,
  setRunner,
  targetOfRef,
  targetOfUrl,
  type Ran,
  type Runner,
} from '../file/change.ts'

/**
 * A change's file, read out of a commit (1.2.0, protocol 2.13.0). The CLIs are
 * stood in for: what is tested is which commands are run, with which
 * arguments, in what order — and that nothing a message named reaches them
 * as anything but one argument.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), 'source-change-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const FILE = 'line one\nline two\n\nline four\nline five\n'
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const MERGED = 'c'.repeat(40)

let ran: { cmd: string; args: string[]; env: Record<string, string> }[] = []
let answers: (cmd: string, args: string[]) => Ran

const fake: Runner = async (cmd, args, { env }) => {
  ran.push({ cmd, args, env })
  return answers(cmd, args)
}
const okJson = (value: unknown): Ran => ({ ok: true, out: Buffer.from(JSON.stringify(value)) })
const okText = (text: string): Ran => ({ ok: true, out: Buffer.from(text) })
const no = (error = 'no'): Ran => ({ ok: false, error })

beforeEach(() => {
  ran = []
  forgetBlobs()
  setRunner(fake)
  answers = (cmd, args) => {
    if (cmd === 'git') return okText(FILE)
    if (cmd === 'gh' && args[0] === 'pr') return okJson({ headRefOid: HEAD, baseRefOid: BASE })
    if (cmd === 'gh' && args[0] === 'api' && args[1]?.includes('/compare/')) return okJson({ merge_base_commit: { sha: MERGED } })
    if (cmd === 'glab') return okJson({ diff_refs: { head_sha: HEAD, base_sha: BASE } })
    return no()
  }
})
afterEach(() => setRunner(null))

describe('which change', () => {
  test('a pull request or a merge request URL', () => {
    expect(targetOfUrl('https://github.com/o/r/pull/41')).toEqual({ forge: 'github', repo: 'o/r', number: 41 })
    expect(targetOfUrl('https://gitlab.com/g/sub/p/-/merge_requests/7')).toEqual({ forge: 'gitlab', repo: 'g/sub/p', number: 7 })
    expect(targetOfUrl('https://git.example.org/g/p/-/merge_requests/7')).toEqual({ forge: 'gitlab', repo: 'g/p', number: 7, host: 'git.example.org' })
    for (const bad of ['https://github.com/o/r/issues/41', 'file:///etc/passwd', 'not a url', 'https://github.com/o/-r;x/pull/1', null]) {
      expect(targetOfUrl(bad)).toBeNull()
    }
  })
  test('a ref spelling, when it can name a change', () => {
    expect(targetOfRef('!7')).toEqual({ forge: 'gitlab', repo: null, number: 7 })
    expect(targetOfRef('gl:g/p!7')).toEqual({ forge: 'gitlab', repo: 'g/p', number: 7 })
    expect(targetOfRef('gh#41')).toEqual({ forge: 'github', repo: null, number: 41 })
    expect(targetOfRef('#12')).toBeNull()
    expect(targetOfRef('nonsense')).toBeNull()
  })
})

describe('lines to bytes', () => {
  const content = Buffer.from(FILE)
  test('one line, a range, an empty line, past the end', () => {
    expect(content.subarray(...Object.values(linesToBytes(content, 2)!) as [number, number]).toString()).toBe('line two')
    expect(content.subarray(...Object.values(linesToBytes(content, 4, 5)!) as [number, number]).toString()).toBe('line four\nline five')
    expect(linesToBytes(content, 3)).toEqual({ from: 18, to: 19 })
    expect(linesToBytes(content, 99)).toBeNull()
  })
})

describe('reading a change’s file', () => {
  const asked = (over: Record<string, unknown> = {}) => ({
    root,
    change: 'gh#41',
    url: 'https://github.com/o/r/pull/41',
    path: 'src/app.ts',
    side: 'new',
    line: '2',
    endLine: undefined,
    commit: undefined,
    ...over,
  })

  test('at the commit the location names, from the checkout, read-only, with the line marked', async () => {
    const read = await changeFile(asked({ commit: 'abc1234' }))
    expect(read.ok).toBe(true)
    if (!read.ok || read.seen.kind !== 'text') throw new Error('not text')
    expect(ran).toEqual([
      {
        cmd: 'git',
        args: ['-C', root, 'cat-file', 'blob', 'abc1234:src/app.ts'],
        env: { GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
    ])
    expect(read.commit).toBe('abc1234')
    expect(read.seen.text.slice(read.seen.mark!.from, read.seen.mark!.to)).toBe('line two')
    expect(read.seen.firstLine).toBe(1)
  })

  test('with no commit: the head, asked of gh; the old side is the merge base', async () => {
    const head = await changeFile(asked())
    expect(head.ok && head.commit).toBe(HEAD)
    expect(ran[0]).toMatchObject({ cmd: 'gh', args: ['pr', 'view', '41', '--json', 'headRefOid,baseRefOid', '--repo', 'o/r'] })
    ran = []
    forgetBlobs()
    const base = await changeFile(asked({ side: 'old' }))
    expect(base.ok && base.commit).toBe(MERGED)
    expect(ran.map((one) => one.args.slice(0, 2))).toEqual([
      ['pr', 'view'],
      ['api', `repos/o/r/compare/${BASE}...${HEAD}`],
      ['-C', root],
    ])
  })

  test('GitLab: diff_refs, the host its URL names, and a short ref finds its project from the checkout', async () => {
    const read = await changeFile(asked({ change: '!7', url: 'https://git.example.org/g/p/-/merge_requests/7', side: 'old' }))
    expect(read.ok && read.commit).toBe(BASE)
    expect(ran[0]).toEqual({ cmd: 'glab', args: ['api', 'projects/g%2Fp/merge_requests/7'], env: { GITLAB_HOST: 'git.example.org' } })
    ran = []
    await changeFile(asked({ change: '!8', url: undefined }))
    expect(ran[0]?.args).toEqual(['api', 'projects/:id/merge_requests/8'])
  })

  test('a commit the checkout lacks is read from the forge, one file, raw', async () => {
    answers = (cmd) => (cmd === 'git' ? no('fatal: bad object') : okText(FILE))
    const gh = await changeFile(asked({ commit: HEAD, path: 'src/a b.ts' }))
    expect(gh.ok).toBe(true)
    expect(ran[1]).toMatchObject({
      cmd: 'gh',
      args: ['api', '-H', 'Accept: application/vnd.github.raw', `repos/o/r/contents/src/a%20b.ts?ref=${HEAD}`],
    })
    ran = []
    await changeFile(asked({ change: '!7', url: 'https://gitlab.com/g/p/-/merge_requests/7', commit: HEAD }))
    expect(ran[1]).toMatchObject({ cmd: 'glab', args: ['api', `projects/g%2Fp/repository/files/src%2Fapp.ts/raw?ref=${HEAD}`] })
  })

  test('a commit’s file is kept: asked again, nothing runs', async () => {
    await blobAt(root, { forge: 'github', repo: 'o/r', number: 41 }, HEAD, 'src/app.ts')
    ran = []
    const again = await blobAt(root, { forge: 'github', repo: 'o/r', number: 41 }, HEAD, 'src/app.ts')
    expect(again.ok).toBe(true)
    expect(ran).toEqual([])
  })

  test('refused before anything runs: a path that climbs, a private file, a bad commit, a bad line, an issue', async () => {
    for (const over of [
      { path: '../etc/passwd' },
      { path: '/etc/passwd' },
      { path: '.git/config' },
      { path: 'keys/id_rsa' },
      { commit: 'HEAD; rm -rf /' },
      { line: '0' },
      { line: '3', endLine: '2' },
      { change: '#12', url: undefined },
    ]) {
      const read = await changeFile(asked(over))
      expect(read.ok).toBe(false)
    }
    expect(ran).toEqual([])
  })

  test('a line past the end of the file at that commit is said, not invented', async () => {
    const read = await changeFile(asked({ commit: HEAD, line: '99' }))
    expect(read.ok && read.seen.kind === 'text' && read.seen.markLost).toBe(true)
  })

  test('a CLI that fails is its own sentence', async () => {
    answers = () => no('gh: not logged in')
    const read = await changeFile(asked())
    expect(read).toMatchObject({ ok: false, error: 'gh: not logged in' })
  })
})

describe('the page’s door', () => {
  setHostAsk(async () => true)
  const get = (query: Record<string, string>, ticket: string | null = TICKET) =>
    answer('GET', '/api/change', new URLSearchParams(query), null, ticket)

  test('answers only this app’s own page', async () => {
    const said = await get({ projectPath: root, change: 'gh#41', path: 'a.ts' }, 'someone-else')
    expect(said?.status).not.toBe(200)
    expect(ran).toEqual([])
  })

  test('reads the file at the commit and says which', async () => {
    const said = await get({ projectPath: root, change: 'gh#41', url: 'https://github.com/o/r/pull/41', path: 'src/app.ts', line: '4', commit: 'abc1234' })
    expect(said?.status).toBe(200)
    expect(said?.body).toMatchObject({ ok: true, kind: 'text', commit: 'abc1234', change: 'gh#41', side: 'new', from: 'git', path: 'src/app.ts' })
  })

  test('takes no POST', async () => {
    expect(await answer('POST', '/api/change', new URLSearchParams(), {}, TICKET)).toMatchObject({ status: 404 })
  })
})
