import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { PACKAGE_VERSION, toolEffect } from 'kehikot-module-protocol'
import { doorsHandler, resolveDoorProject } from 'kehikot-module-protocol/serve'

import { BUILD, TICKET, answer, setHostAsk, setHostResolve } from '../doors.ts'
import { forgetKnown } from '../file/confine.ts'
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

/* A host that holds every folder; the tests of the host answer set their own below. */
setHostAsk(async () => true)

/* As this app's own page asks: with the ticket this process printed into it. */
const get = (path: string, query: Record<string, string> = {}, ticket: string | null = TICKET) =>
  answer('GET', path, new URLSearchParams(query), null, ticket)

const rpc = (method: string, params?: Record<string, unknown>) =>
  answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })

const said = (reply: Awaited<ReturnType<typeof answer>>): string => {
  const body = reply?.body as { result?: { content?: { text?: string }[] } }
  return body?.result?.content?.[0]?.text ?? ''
}

describe('what is not here', () => {
  test('nothing under /api accepts a POST', async () => {
    /* The read-only claim, on the server, where it can be broken. `/mcp` is the
       one POST in this program and it is a JSON-RPC transport, not a write. */
    for (const path of ['/api/source', '/api/save', '/api/write', '/api/']) {
      const reply = (await answer('POST', path, new URLSearchParams(), { anything: true }))
      expect(reply?.status).not.toBe(200)
    }
  })

  test('nothing under /api accepts a PUT, PATCH or DELETE either', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const reply = (await answer(method, '/api/source', new URLSearchParams({ projectPath: root, path: 'a.ts' }), null))
      expect(reply?.status).not.toBe(200)
    }
  })

  test('the manifest asks for the tracker reading and a code location, and never to point a passage or a selection', async () => {
    /* It reads the context, asks which picked refs are changes, and points only
       on "Comment on this line" (1.2.0). If `passage:set` ever appears here, the
       question to answer first is what happens when the container next door
       disagrees about where the reader is. */
    expect(MANIFEST.declares.uses).toEqual(['trackers:read', 'location:set'])
    expect(MANIFEST.declares.uses).not.toContain('passage:set')
    expect(MANIFEST.declares.uses).not.toContain('selection:set')
  })

  test('the manifest declares storage, which is what closes the CORS hole', async () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('an unknown path under /api is refused rather than passed to Vite', async () => {
    expect((await get('/api/nonsense'))?.status).toBe(404)
  })

  test('a path that is not ours is not ours', async () => {
    expect((await answer('GET', '/src/main.tsx', new URLSearchParams(), null))).toBeNull()
    expect((await answer('GET', '/@vite/client', new URLSearchParams(), null))).toBeNull()
  })
})

describe('/healthz', () => {
  test('says what this app is, and does not say where its roots are', async () => {
    const body = (await get('/healthz'))?.body as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.id).toBe('kehikot.source')
    expect(body.writes).toContain('none')
    /* A health check is the least authenticated door on this port. Printing the
       directories somebody's roots are set to would make it reconnaissance. */
    expect(JSON.stringify(body)).not.toContain('/Users')
  })
})

describe('/api/source', () => {
  test('answers only this app’s own page: a read without its ticket is refused, and marked so', async () => {
    for (const carried of [null, '', 'not-the-ticket']) {
      const reply = (await get('/api/source', { projectPath: root, path: 'a.ts' }, carried))
      expect(reply?.status).toBe(403)
      expect((reply?.body as { refused?: string }).refused).toBe('ticket')
    }
  })

  test('the disk’s root and a home folder are not taken as a project', async () => {
    for (const projectPath of ['/', homedir(), join(homedir(), '..')]) {
      const reply = (await get('/api/source', { projectPath, path: 'a.ts' }))
      expect([projectPath, reply?.status]).toEqual([projectPath, 400])
      expect((reply?.body as { error: string }).error).toContain('not shown as a project')
    }
  })

  test('a file that holds what a program signs in with is shown to the page, marked, and refused to the door', async () => {
    writeFileSync(join(scratch, '.env'), 'TOKEN=FAKE-CONTENTS\n')
    writeFileSync(join(scratch, '.gitignore'), 'node_modules\n')
    const reply = (await get('/api/source', { projectPath: root, path: '.env' }))
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ text: 'TOKEN=FAKE-CONTENTS', hidden: true })
    expect((await get('/api/source', { projectPath: root, path: '.gitignore' }))?.body).toMatchObject({ hidden: false })
    /* The same path, at the door. */
    const rpc = (await answer('POST', '/mcp', new URLSearchParams(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'shown', arguments: { projectPath: root, path: '.env' } },
    }))
    const text = JSON.stringify(rpc?.body)
    expect(text).not.toContain('FAKE-CONTENTS')
    expect(text).toContain('does not show that file')
  })

  test('.git internals and a private key are refused to the page', async () => {
    mkdirSync(join(scratch, '.git'), { recursive: true })
    writeFileSync(join(scratch, '.git', 'config'), '[core]\n')
    writeFileSync(join(scratch, 'id_rsa'), 'FAKE\n')
    for (const at of ['.git/config', 'id_rsa']) {
      const reply = (await get('/api/source', { projectPath: root, path: at }))
      expect([at, reply?.status]).toEqual([at, 404])
    }
  })

  test('a file comes back with its text and its language', async () => {
    const reply = (await get('/api/source', { projectPath: root, path: 'a.ts' }))
    expect(reply?.status).toBe(200)
    const body = reply?.body as { text: string; language: string; firstLine: number }
    expect(body.text).toBe('const a = 1\nconst b = 2')
    expect(body.language).toBe('typescript')
    expect(body.firstLine).toBe(1)
  })

  test('no project named is a refusal in the page’s words', async () => {
    const reply = (await get('/api/source', { path: 'a.ts' }))
    expect(reply?.status).toBe(400)
    expect(String((reply?.body as { error: string }).error)).toContain('which project is open')
  })

  test('no file named is a refusal rather than a default', async () => {
    /* Unlike a directory listing, where a missing path plainly means the root, a
       viewer with no file named has nothing it could mean. */
    expect((await get('/api/source', { projectPath: root }))?.status).toBe(400)
  })

  test('a path outside the project is refused', async () => {
    const reply = (await get('/api/source', { projectPath: root, path: '../../etc/passwd' }))
    expect(reply?.status).toBe(404)
  })

  test('a half-range is refused rather than repaired', async () => {
    const halves: Record<string, string>[] = [{ from: '5' }, { to: '9' }, { from: '9', to: '5' }, { from: '4', to: '4' }]
    for (const query of halves) {
      const reply = (await get('/api/source', { projectPath: root, path: 'a.ts', ...query }))
      expect(reply?.status).toBe(400)
    }
  })

  test('a range comes back converted to character offsets', async () => {
    const reply = (await get('/api/source', { projectPath: root, path: 'a.ts', from: '12', to: '23' }))
    const body = reply?.body as { text: string; mark: { from: number; to: number } }
    expect(body.text.slice(body.mark.from, body.mark.to)).toBe('const b = 2')
  })

  test('a directory is answered as a directory rather than as a refusal', async () => {
    const body = (await get('/api/source', { projectPath: root, path: 'sub' }))?.body as { kind: string }
    expect(body.kind).toBe('folder')
  })
})

describe('/mcp', () => {
  test('only POST', async () => {
    expect((await answer('GET', '/mcp', new URLSearchParams(), null))?.status).toBe(405)
  })

  test('initialize names the module and says what it is for', async () => {
    const body = (await rpc('initialize'))?.body as { result: { serverInfo: { name: string }; instructions: string } }
    expect(body.result.serverInfo.name).toBe('kehikot.source')
    expect(body.result.instructions).toContain('read-only')
  })

  test('there is exactly one tool, and it is not a file reader', async () => {
    const body = (await rpc('tools/list'))?.body as { result: { tools: { name: string; description: string }[] } }
    expect(body.result.tools.map((one) => one.name)).toEqual(['shown'])
    /* The description has to send an agent to its own reader, because an agent
       that used this one instead would be taking a slower, bounded path to an
       answer it already had. */
    expect(body.result.tools[0]!.description).toContain('use your own reader')
  })

  test('the tool says it only reads, and takes the project as `project`', async () => {
    const body = (await rpc('tools/list'))?.body as { result: { tools: { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }; inputSchema: { properties: Record<string, unknown>; required: string[] } }[] } }
    const [tool] = body.result.tools
    expect(toolEffect(tool!)).toBe('reads')
    expect(Object.keys(tool!.inputSchema.properties)).toContain('project')
    expect(Object.keys(tool!.inputSchema.properties)).not.toContain('projectPath')
    expect(tool!.inputSchema.required).toEqual(['project', 'path'])
  })

  /* An agent is shown a file of a project this app's own page has been opened on, so the page opens it first. */
  beforeEach(async () => {
    forgetKnown()
    await get('/api/source', { projectPath: root, path: 'a.ts' })
  })

  const shown = async (args: Record<string, unknown>) => {
    const reply = (await rpc('tools/call', { name: 'shown', arguments: args }))
    return { text: said(reply), isError: (reply?.body as { result?: { isError?: boolean } })?.result?.isError === true }
  }

  test('\`project\` is read, and so is \`projectPath\`, the name before; a dotfile is still withheld from both', async () => {
    const now = await shown({ project: root, path: 'a.ts' })
    const before = await shown({ projectPath: root, path: 'a.ts' })
    expect([now.isError, before.isError]).toEqual([false, false])
    expect(now.text).toContain('const a = 1')
    expect(before.text).toBe(now.text)
    writeFileSync(join(scratch, '.env'), 'TOKEN=FAKE-CONTENTS\n')
    for (const args of [{ project: root }, { projectPath: root }]) {
      const withheld = await shown({ ...args, path: '.env' })
      expect(withheld.text).toContain('does not show that file')
      expect(withheld.text).not.toContain('FAKE-CONTENTS')
    }
  })

  test('a project the page has not been opened on is not read, and the refusal says what to do', async () => {
    forgetKnown()
    const refused = await shown({ projectPath: root, path: 'a.ts' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('open in the host with the Source container on its canvas')
    expect(refused.text).not.toContain('const a = 1')
    /* A read that did not carry the page's ticket does not make it known. */
    await get('/api/source', { projectPath: root, path: 'a.ts' }, 'not-the-ticket')
    expect((await shown({ projectPath: root, path: 'a.ts' })).isError).toBe(true)
    await get('/api/source', { projectPath: root, path: 'a.ts' })
    expect((await (await shown({ projectPath: root, path: 'a.ts' }))).text).toContain('const a = 1')
  })

  test('the disk’s root, a home folder and a folder nobody opened are refused alike', async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'source-elsewhere-')))
    writeFileSync(join(elsewhere, 'far.txt'), 'FAR-WORDS\n')
    try {
      for (const [projectPath, path] of [['/', 'etc/hosts'], ['/etc', 'hosts'], [homedir(), '.zshrc'], [elsewhere, 'far.txt']] as const) {
        const { text, isError } = await shown({ projectPath, path })
        expect([projectPath, isError]).toEqual([projectPath, true])
        expect(text).toContain('Send project as')
        expect(text).not.toContain('FAR-WORDS')
      }
      /* And a file elsewhere named absolutely, from a project that is known, is no nearer. */
      expect((await (await shown({ projectPath: root, path: join(elsewhere, 'far.txt') }))).text).not.toContain('FAR-WORDS')
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  test('an agent is not shown a file the page would not be', async () => {
    writeFileSync(join(scratch, '.env'), 'TOKEN=THE-CONTENTS\n')
    const { text } = await shown({ projectPath: root, path: '.env' })
    expect(text).toContain('does not show that file')
    expect(text).not.toContain('THE-CONTENTS')
  })

  test('shown returns the file with real line numbers', async () => {
    const text = said((await rpc('tools/call', { name: 'shown', arguments: { projectPath: root, path: 'a.ts' } })))
    expect(text).toContain('1 const a = 1')
    expect(text).toContain('2 const b = 2')
  })

  test('shown names the line a range is on rather than putting markers in the source', async () => {
    /* Characters inserted into somebody's source to show a selection are
       characters an agent may quote back as though they were in the file. */
    const text = said(
      (await rpc('tools/call', { name: 'shown', arguments: { projectPath: root, path: 'a.ts', from: 12, to: 23 } })),
    )
    expect(text).toContain('highlights line 2')
    expect(text).not.toContain('>>>')
  })

  test('a refusal comes back as a tool error the agent reads, not a transport failure', async () => {
    const reply = (await rpc('tools/call', { name: 'shown', arguments: { path: 'a.ts' } }))
    expect(reply?.status).toBe(200)
    expect((reply?.body as { result: { isError?: boolean } }).result.isError).toBe(true)
    expect(said(reply)).toContain('`project` is its absolute folder')
  })

  test('an unknown tool is refused by name', async () => {
    const reply = (await rpc('tools/call', { name: 'write_file', arguments: {} }))
    expect((reply?.body as { result: { isError?: boolean } }).result.isError).toBe(true)
  })

  test('a notification is answered with nothing', async () => {
    const reply = (await answer('POST', '/mcp', new URLSearchParams(), {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }))
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBeNull()
  })

  test('a body that is not a request is refused as one', async () => {
    const reply = (await answer('POST', '/mcp', new URLSearchParams(), null))
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
    const page = await (await get('/app'))
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
    const health = await (await get('/healthz'))
    const body = JSON.parse(health.text) as { ok: boolean; build: { version: string; protocol: string; started: string } }
    expect(body.ok).toBe(true)
    expect(body.build).toEqual(BUILD)
    expect(body.build.protocol).toBe(PACKAGE_VERSION)
    expect(health.headers['x-module-build']).toBeTruthy()
  })

  test('the manifest is served at the well-known path, with the build', async () => {
    const now = JSON.parse((await (await get('/.well-known/kehikot-module.json'))).text) as { id: string; build: unknown }
    expect(now.id).toBe('kehikot.source')
    expect(now.build).toEqual(BUILD)
  })
})

describe('the host holds the folder (protocol 1.4.0)', () => {
  const asked: string[] = []
  const says = (word: boolean) => {
    asked.length = 0
    setHostAsk(async (folder) => {
      asked.push(folder)
      return word
    })
  }
  const shown = async (project: string) => {
    const reply = await rpc('tools/call', { name: 'shown', arguments: { project, path: 'a.ts' } })
    return { text: said(reply), isError: (reply?.body as { result?: { isError?: boolean } })?.result?.isError === true }
  }

  afterEach(() => setHostAsk(async () => true))

  test('the page route reads a file of a folder the host holds, asking about the folder it was told', async () => {
    says(true)
    const reply = await get('/api/source', { projectPath: root, path: 'a.ts' })
    expect(reply?.status).toBe(200)
    expect(asked).toEqual([root])
  })

  test('the page route refuses a folder the host does not hold, in the sentence it already uses', async () => {
    says(false)
    const reply = await get('/api/source', { projectPath: root, path: 'a.ts' })
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('not shown as a project')
    expect(JSON.stringify(reply?.body)).not.toContain('const a = 1')
  })

  test('no host answering is a refusal too: it fails closed', async () => {
    setHostResolve((folder) => resolveDoorProject(folder, { env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:9' }, fetch: (async () => { throw new Error('nobody is listening') }) as unknown as typeof fetch }))
    expect((await get('/api/source', { projectPath: root, path: 'a.ts' }))?.status).toBe(400)
    const refused = await shown(root)
    expect(refused.isError).toBe(true)
    expect(refused.text).toBe(`${root} is not a project open in Kehikot.`)
    expect(refused.text).not.toContain('const a = 1')
  })

  /* A host stub: `held` are the folders it holds (path to id), `former` the paths a project had (path to where it is now). */
  const hostThat = (held: Record<string, string>, former: Record<string, string> = {}) =>
    setHostResolve((folder) =>
      resolveDoorProject(folder, {
        env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:9' },
        fetch: (async (url: string) => {
          const path = new URL(url).searchParams.get('path')!
          const body = held[path] ? { ok: true, project: true, path, id: held[path] }
            : former[path] ? { ok: true, project: false, movedTo: former[path], id: held[former[path]] }
            : { ok: true, project: false }
          return new Response(JSON.stringify(body), { status: 200 })
        }) as unknown as typeof fetch,
      }),
    )
  const ID = 'a1b2c3d4-0000-4000-8000-000000000001'

  test('a former path is followed to where the project is now, and the answer says so', async () => {
    hostThat({ [root]: ID }, { '/was/here': root })
    const read = await shown('/was/here')
    expect(read.isError).toBe(false)
    expect(read.text).toContain('const a = 1')
    expect(read.text).toContain(`The project at /was/here has moved to ${root}`)
    const page = await get('/api/source', { projectPath: '/was/here', path: 'a.ts' })
    expect(page?.status).toBe(200)
    expect((page?.body as { root: string }).root).toBe(root)
  })

  test('an unrelated folder at the old path is refused and nothing of it is read', async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'source-other-')))
    writeFileSync(join(other, 'a.ts'), 'SECRET-WORDS\n')
    try {
      /* The old path moved somewhere the host does not hold as the same project. */
      hostThat({}, { [other]: root })
      const read = await shown(other)
      expect(read.isError).toBe(true)
      expect(read.text).not.toContain('SECRET-WORDS')
      expect(read.text).toContain(`was moved to ${root}`)
      expect((await get('/api/source', { projectPath: other, path: 'a.ts' }))?.status).toBe(400)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test('the shown tool reads what the host holds and refuses what it does not', async () => {
    says(true)
    await get('/api/source', { projectPath: root, path: 'a.ts' })
    expect((await shown(root)).text).toContain('const a = 1')
    says(false)
    const refused = await shown(root)
    expect(refused.isError).toBe(true)
    expect(refused.text).not.toContain('const a = 1')
  })

  test('the module’s own roots check still applies when the host says yes', async () => {
    says(true)
    expect((await get('/api/source', { projectPath: homedir(), path: 'a.ts' }))?.status).toBe(400)
    expect((await get('/api/source', { projectPath: '/', path: 'a.ts' }))?.status).toBe(400)
  })
})
