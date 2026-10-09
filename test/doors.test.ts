import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { doorsHandler } from 'kehikot-module-protocol/serve'

import { BUILD, answer } from '../doors.ts'
import { MANIFEST } from '../manifest.ts'

/**
 * The doors, including the ones that are not there.
 *
 * The interesting half of this file is the absences. `manifest.ts` claims this
 * module cannot write, cannot edit, and never points the canvas, and a claim in a
 * comment is a claim until something fails when it stops being true. So there are
 * tests here that assert nothing happens — that a POST to `/api` is refused, that
 * the manifest declares no capabilities — and their job is to break on the day
 * somebody adds the obvious feature.
 */

const scratch = mkdtempSync(join(tmpdir(), 'source-doors-'))
mkdirSync(join(scratch, 'sub'), { recursive: true })
writeFileSync(join(scratch, 'a.ts'), 'const a = 1\nconst b = 2\n')
const root = realpathSync(scratch)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const get = (path: string, query: Record<string, string> = {}) =>
  answer('GET', path, new URLSearchParams(query), null)

const rpc = (method: string, params?: Record<string, unknown>) =>
  answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })

const said = (reply: ReturnType<typeof answer>): string => {
  const body = reply?.body as { result?: { content?: { text?: string }[] } }
  return body?.result?.content?.[0]?.text ?? ''
}

describe('what is not here', () => {
  test('nothing under /api accepts a POST', () => {
    /* The read-only claim, on the server, where it can be broken. `/mcp` is the
       one POST in this program and it is a JSON-RPC transport, not a write. */
    for (const path of ['/api/source', '/api/save', '/api/write', '/api/']) {
      const reply = answer('POST', path, new URLSearchParams(), { anything: true })
      expect(reply?.status).not.toBe(200)
    }
  })

  test('nothing under /api accepts a PUT, PATCH or DELETE either', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const reply = answer(method, '/api/source', new URLSearchParams({ projectPath: root, path: 'a.ts' }), null)
      expect(reply?.status).not.toBe(200)
    }
  })

  test('the manifest asks for no capabilities at all', () => {
    /* This module is the purest consumer on the canvas: it reads the context and
       calls nothing. If `passage:set` ever appears here, the question to answer
       first is what happens when the container next door disagrees about where
       the reader is. */
    expect(MANIFEST.declares.uses).toEqual([])
  })

  test('the manifest declares storage, which is what closes the CORS hole', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('an unknown path under /api is refused rather than passed to Vite', () => {
    expect(get('/api/nonsense')?.status).toBe(404)
  })

  test('a path that is not ours is not ours', () => {
    expect(answer('GET', '/src/main.tsx', new URLSearchParams(), null)).toBeNull()
    expect(answer('GET', '/@vite/client', new URLSearchParams(), null)).toBeNull()
  })
})

describe('/healthz', () => {
  test('says what this app is, and does not say where its roots are', () => {
    const body = get('/healthz')?.body as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.id).toBe('kehikot.source')
    expect(body.writes).toContain('none')
    /* A health check is the least authenticated door on this port. Printing the
       directories somebody's roots are set to would make it reconnaissance. */
    expect(JSON.stringify(body)).not.toContain('/Users')
  })
})

describe('/api/source', () => {
  test('a file comes back with its text and its language', () => {
    const reply = get('/api/source', { projectPath: root, path: 'a.ts' })
    expect(reply?.status).toBe(200)
    const body = reply?.body as { text: string; language: string; firstLine: number }
    expect(body.text).toBe('const a = 1\nconst b = 2')
    expect(body.language).toBe('typescript')
    expect(body.firstLine).toBe(1)
  })

  test('no project named is a refusal in the page’s words', () => {
    const reply = get('/api/source', { path: 'a.ts' })
    expect(reply?.status).toBe(400)
    expect(String((reply?.body as { error: string }).error)).toContain('which project is open')
  })

  test('no file named is a refusal rather than a default', () => {
    /* Unlike a directory listing, where a missing path plainly means the root, a
       viewer with no file named has nothing it could mean. */
    expect(get('/api/source', { projectPath: root })?.status).toBe(400)
  })

  test('a path outside the project is refused', () => {
    const reply = get('/api/source', { projectPath: root, path: '../../etc/passwd' })
    expect(reply?.status).toBe(404)
  })

  test('a half-range is refused rather than repaired', () => {
    const halves: Record<string, string>[] = [{ from: '5' }, { to: '9' }, { from: '9', to: '5' }, { from: '4', to: '4' }]
    for (const query of halves) {
      const reply = get('/api/source', { projectPath: root, path: 'a.ts', ...query })
      expect(reply?.status).toBe(400)
    }
  })

  test('a range comes back converted to character offsets', () => {
    const reply = get('/api/source', { projectPath: root, path: 'a.ts', from: '12', to: '23' })
    const body = reply?.body as { text: string; mark: { from: number; to: number } }
    expect(body.text.slice(body.mark.from, body.mark.to)).toBe('const b = 2')
  })

  test('a directory is answered as a directory rather than as a refusal', () => {
    const body = get('/api/source', { projectPath: root, path: 'sub' })?.body as { kind: string }
    expect(body.kind).toBe('folder')
  })
})

describe('/mcp', () => {
  test('only POST', () => {
    expect(answer('GET', '/mcp', new URLSearchParams(), null)?.status).toBe(405)
  })

  test('initialize names the module and says what it is for', () => {
    const body = rpc('initialize')?.body as { result: { serverInfo: { name: string }; instructions: string } }
    expect(body.result.serverInfo.name).toBe('kehikot.source')
    expect(body.result.instructions).toContain('read-only')
  })

  test('there is exactly one tool, and it is not a file reader', () => {
    const body = rpc('tools/list')?.body as { result: { tools: { name: string; description: string }[] } }
    expect(body.result.tools.map((one) => one.name)).toEqual(['shown'])
    /* The description has to send an agent to its own reader, because an agent
       that used this one instead would be taking a slower, bounded path to an
       answer it already had. */
    expect(body.result.tools[0]!.description).toContain('use your own reader')
  })

  test('shown returns the file with real line numbers', () => {
    const text = said(rpc('tools/call', { name: 'shown', arguments: { projectPath: root, path: 'a.ts' } }))
    expect(text).toContain('1 const a = 1')
    expect(text).toContain('2 const b = 2')
  })

  test('shown names the line a range is on rather than putting markers in the source', () => {
    /* Characters inserted into somebody's source to show a selection are
       characters an agent may quote back as though they were in the file. */
    const text = said(
      rpc('tools/call', { name: 'shown', arguments: { projectPath: root, path: 'a.ts', from: 12, to: 23 } }),
    )
    expect(text).toContain('highlights line 2')
    expect(text).not.toContain('>>>')
  })

  test('a refusal comes back as a tool error the agent reads, not a transport failure', () => {
    const reply = rpc('tools/call', { name: 'shown', arguments: { path: 'a.ts' } })
    expect(reply?.status).toBe(200)
    expect((reply?.body as { result: { isError?: boolean } }).result.isError).toBe(true)
    expect(said(reply)).toContain('projectPath')
  })

  test('an unknown tool is refused by name', () => {
    const reply = rpc('tools/call', { name: 'write_file', arguments: {} })
    expect((reply?.body as { result: { isError?: boolean } }).result.isError).toBe(true)
  })

  test('a notification is answered with nothing', () => {
    const reply = answer('POST', '/mcp', new URLSearchParams(), {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBeNull()
  })

  test('a body that is not a request is refused as one', () => {
    const reply = answer('POST', '/mcp', new URLSearchParams(), null)
    expect(reply?.status).toBe(400)
  })
})

/*
 * The doors as they are actually served: the protocol's `doorsHandler` over this module's
 * `answer`, with the same options `vite.config.ts` hands to `doors()`. What is asserted is this
 * module's half — no ticket in a page that never writes, the build said in every place a host or
 * the page reads it — rather than the protocol's own behaviour, which its own tests cover.
 */
describe('served through the protocol’s doors', () => {
  const handler = doorsHandler({ manifest: MANIFEST, answer, build: BUILD, page: { title: 'Source', head: '<style>html, body, #root { height: 100%; }</style>' } })
  const get = (url: string) =>
    new Promise<{ status: number; headers: Record<string, string>; text: string }>((resolve, reject) => {
      const headers: Record<string, string> = {}
      const response = {
        statusCode: 0,
        setHeader: (name: string, value: string) => void (headers[name] = value),
        write: () => {},
        end: (chunk?: string | Uint8Array) => resolve({ status: response.statusCode, headers, text: typeof chunk === 'string' ? chunk : '' }),
      }
      const request = { url, method: 'GET', headers: {}, on: () => request, [Symbol.asyncIterator]: async function* () {} }
      handler(request as never, response, (error) => reject(error ?? new Error(`${url} was handed on`)))
    })

  test('the page carries the build, the height rules and no ticket, and is never cached', async () => {
    const page = await get('/app')
    expect(page.status).toBe(200)
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.headers['content-security-policy']).toContain('frame-ancestors')
    expect(page.text).toContain('<title>Source</title>')
    expect(page.text).toContain('#root { height: 100%; }')
    expect(page.text).toContain('<script id="build" type="application/json">')
    /* No writes, so no ticket: there is nothing for one to gate. */
    expect(page.text).not.toContain('id="ticket"')
  })

  test('the health check and every answer say which build is answering', async () => {
    const health = await get('/healthz')
    const body = JSON.parse(health.text) as { ok: boolean; build: { version: string; protocol: string; started: string } }
    expect(body.ok).toBe(true)
    expect(body.build).toEqual(BUILD)
    expect(body.build.protocol).toBe('0.35.0')
    expect(health.headers['x-module-build']).toBeTruthy()
  })

  test('the manifest is served at both well-known paths, with the build', async () => {
    const now = JSON.parse((await get('/.well-known/kehikot-module.json')).text) as { id: string; build: unknown }
    expect(now.id).toBe('kehikot.source')
    expect(now.build).toEqual(BUILD)
    expect((await get('/.well-known/roadmap-module.json')).status).toBe(200)
  })
})
