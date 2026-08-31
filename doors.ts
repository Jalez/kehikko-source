import { rootOf } from './file/confine.ts'
import { open, type Wanted } from './file/read.ts'
import { MAX_BYTES, MAX_LINES, MAX_PATH, bytes, offset, str } from './file/shape.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * ## Why this is a file of functions rather than a server
 *
 * A module is ONE ORIGIN or it is nothing. The protocol refuses a manifest whose
 * `entry` points anywhere but the origin that served the manifest, and it is
 * right to — a program that could name somebody else's page would be a program
 * that could have the host frame somebody else. The page is served by Vite,
 * because a `dist/` served off disk has cost this workspace whole afternoons of
 * a stale page answering 200 with every symptom of a working app and none of the
 * changes. So the manifest, the health check, the MCP door and this app's own
 * `/api` have to be Vite's too — they cannot be a second process on a second
 * port however much tidier that would look.
 *
 * Hence: no listener here. `answer()` takes a method, a path and a query and
 * returns a status and a document, and `vite.config.ts` adapts a node request to
 * it in a dozen lines.
 *
 * ## There is no ticket here, and the absence is the point
 *
 * The sibling modules that hold material mint a per-process ticket, print it
 * into their page, and gate every write on it. This module has no writes to gate
 * — see the bound in `manifest.ts` — so a ticket would be a credential
 * protecting nothing, and a credential that protects nothing is a thing the next
 * person adds a write behind.
 *
 * What is left is reads, and what protects those is `storage: true` plus the
 * absence of `server.cors`: with a real origin, this page's fetches are
 * same-origin, no CORS header is offered to anybody, and a page on another
 * origin gets nothing back from this port.
 *
 * ## Nothing here trusts its caller, and here that is not a formality
 *
 * The page is one caller, an agent over MCP is another, and a third is whatever
 * else on this machine found the port — this listens on loopback, which is a
 * fence around the machine and not around the programs on it. Every string is
 * bounded before it is looked at, every number is refused rather than defaulted,
 * and every path goes through `file/confine.ts`, which is the one file that
 * decides what may be opened.
 *
 * The page's own caller is worth naming separately: the path it sends came out
 * of `context.passage`, which the protocol describes as "a rumour with a
 * protocol's name on it" — a claim by whichever module last pointed the canvas.
 * So there is no privileged path into this file. What the page sends is checked
 * exactly as hard as what a stranger sends, because it is the same kind of thing.
 */

/** A status and a document. Nothing here writes bytes; the adapter does that. */
export interface Reply {
  status: number
  /** `null` means "answer with no body", which is what a notification gets. */
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

/**
 * The refusals when nobody said which project, in one place and in two voices.
 *
 * The page's version names the state it is in — no project on the canvas — and
 * the agent's version names the argument to send, because an agent has one and a
 * person does not. Two audiences, two sentences, each naming the remedy the
 * reader actually has.
 */
const NO_ROOT_PAGE = 'Nothing has said which project is open, so there is nothing to show.'
const NO_ROOT_AGENT =
  'That did not say which project, or named one this app may not read. Send projectPath as an absolute directory. '
  + 'This app will not guess: the only folder it could pick is its own, and its own source is not an answer to a '
  + 'question about your file.'

/**
 * A half-range is refused rather than repaired.
 *
 * The protocol refuses one on the wire for the reason worth repeating at every
 * door: "a consumer reading `from` with no `to` has to invent an end, and the
 * end it invents is a claim about somebody's document". This app would have to
 * invent one to highlight anything, so it declines to.
 */
const HALF_RANGE =
  'A range needs both from and to, with to greater. One end alone is not a coarser answer; it is a malformed one.'

/**
 * The range, or null, or a complaint.
 *
 * Three outcomes rather than two because "no range was asked for" and "a range
 * was asked for and it was nonsense" must not collapse into the same silence.
 * The first is the ordinary case — the explorer points at files with no range —
 * and the second is a bug in whatever pointed, which nobody finds if this app
 * quietly shows the top of the file instead.
 */
function range(from: unknown, to: unknown): Wanted | null | 'bad' {
  const a = from === undefined || from === null || from === '' ? null : offset(from)
  const b = to === undefined || to === null || to === '' ? null : offset(to)
  if (a === null && b === null) return null
  if (a === null || b === null || b <= a) return 'bad'
  return { from: a, to: b }
}

/* ------------------------------------------------------------------ *
 * The MCP door
 * ------------------------------------------------------------------ */

/**
 * One tool, and the reason there is exactly one — and the reason it nearly was
 * none.
 *
 * An agent on this canvas already has a file reader that is faster than an HTTP
 * hop, has no byte ceiling, and does not need a project root spelled out. A
 * `read_file` here would be a worse copy of a tool the caller already holds,
 * and two answers to one question is how a tool surface stops being trusted.
 * That argument came very close to leaving this module with no MCP door at all.
 *
 * What survives it is the one question an agent cannot otherwise answer: **what
 * can the person actually see.** The container is 220 pixels wide and shows at
 * most a quarter of a megabyte, starting wherever the passage sent it, numbered
 * from wherever that is in the file. An agent about to say "as you can see on
 * line 12,000" is about to be wrong in a way it has no other means of checking.
 *
 * So the tool is `shown`, it is named after the question rather than after the
 * operation, and its description says outright that a file reader is the right
 * tool for reading files.
 */
function tools() {
  return [
    {
      name: 'shown',
      description:
        'What the Source container on the canvas is showing of a file, with this container’s own bounds applied. '
        + 'This is NOT the tool for reading a file — use your own reader, which is faster and unbounded. Use this when '
        + 'the question is what the person can see: it caps at '
        + `${bytes(MAX_BYTES)} and ${MAX_LINES.toLocaleString()} lines, numbers lines as they really are in the file, `
        + 'moves its window onto a byte range when one is given, and says plainly what it left out. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description:
              'The absolute directory of the project. Required. This is the root, and nothing outside it can be '
              + 'reached through any other argument.',
          },
          path: {
            type: 'string',
            description: 'The file, absolute or relative to the project. Required.',
          },
          from: {
            type: 'integer',
            description:
              'First byte of the range to highlight — bytes, not characters, as a passage carries them. Needs `to`.',
          },
          to: {
            type: 'integer',
            description: 'One past the last byte of the range. Needs `from`, and must be greater than it.',
          },
        },
        required: ['projectPath', 'path'],
      },
    },
  ]
}

/**
 * What this container is showing, as an agent reads it.
 *
 * Numbered lines, in the file's real numbering, because the line number is the
 * thing this tool exists to be right about. A range, when there is one, is named
 * by its line numbers rather than reproduced with markers around it: an agent
 * has the text right there, and characters inserted into somebody's source to
 * indicate a selection are characters an agent may then quote back as though
 * they were in the file.
 *
 * The bounds are stated at the bottom rather than the top, and only when they
 * bit. A header saying "nothing was truncated" on every answer is a line every
 * caller learns to skip, which is exactly the line that has to be read on the
 * one occasion it says something else.
 */
function report(seen: ReturnType<typeof open>, asked: Wanted | null): string {
  if (seen.kind === 'refused') return seen.error
  if (seen.kind === 'folder') return `${seen.path} is a directory. This container shows one file at a time.`
  if (seen.kind === 'binary') {
    return `${seen.path} — ${bytes(seen.size)}, and not text${seen.looks ? ` (looks like ${seen.looks})` : ''}. `
      + 'Nothing here decodes it, so there is nothing for the person to see but that sentence.'
  }

  const lines = seen.text.length ? seen.text.split('\n') : []
  const head = `${seen.path} — ${bytes(seen.size)}`
  if (!lines.length) return `${head}, and empty.`

  const width = String(seen.firstLine + lines.length - 1).length
  const body = lines.map((line, i) => `${String(seen.firstLine + i).padStart(width)} ${line}`).join('\n')

  const notes: string[] = []
  if (seen.mark) {
    const before = seen.text.slice(0, seen.mark.from).split('\n').length - 1
    const within = seen.text.slice(seen.mark.from, seen.mark.to).split('\n').length - 1
    notes.push(
      `The passage highlights line ${seen.firstLine + before}`
      + `${within ? ` through ${seen.firstLine + before + within}` : ''}, and it is scrolled to.`,
    )
  } else if (asked) {
    notes.push('The range that was asked for is not inside what this container can show.')
  }
  if (!seen.whole) {
    notes.push(
      `Showing ${bytes(seen.read)} of ${bytes(seen.size)}, from line ${seen.firstLine}. `
      + 'The rest is not on the person’s screen.',
    )
  }

  return notes.length ? `${head}\n\n${body}\n\n${notes.join(' ')}` : `${head}\n\n${body}`
}

function call(name: string, args: Record<string, unknown>): string {
  if (name !== 'shown') throw new Error(`no tool "${name.slice(0, 60)}" here`)

  const root = rootOf(str(args.projectPath, MAX_PATH))
  if (!root) throw new Error(NO_ROOT_AGENT)

  const at = str(args.path, MAX_PATH)
  if (!at) throw new Error('That did not name a file. Send path, absolute or relative to the project.')

  const wanted = range(args.from, args.to)
  if (wanted === 'bad') throw new Error(HALF_RANGE)

  return report(open(root, at, wanted), wanted)
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (s: string, isError = false) =>
    reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions:
        'The container a person reads a file in, on a canvas. It follows the passage the canvas is pointed at and '
        + 'shows that file, bounded and with real line numbers. It is read-only and it never points the canvas '
        + 'anywhere. For reading files, use your own reader; ask this what the person can SEE.',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
    try {
      return text(call(name, args))
    } catch (e) {
      /* A refusal is an answer, and the sentence is the useful half — every one
         of them names what to do instead. So it comes back as a tool error the
         agent reads, not as a transport failure it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }

  return {
    status: 404,
    body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } },
  }
}

/* ------------------------------------------------------------------ *
 * Every door, as one function
 * ------------------------------------------------------------------ */

/**
 * `null` means "this path is not ours", and the caller passes it on to Vite —
 * which is how the page, the client module and Vite's own hot-reload socket keep
 * working without being enumerated here.
 */
export function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
): Reply | null {
  /*
   * The health check, which reports what this app IS rather than what it holds.
   *
   * There is nothing to count: no store, no cache on disk, no index. So it says
   * it is up, says its version, and says the two operational facts worth
   * monitoring here — the ceiling, and whether `SOURCE_ROOTS` is confining it,
   * and to how many directories. Not to WHICH directories: a health check is the
   * least authenticated door on this port, and printing the paths somebody's
   * roots are set to would make it a reconnaissance endpoint.
   */
  if (path === '/healthz') {
    const configured = (process.env.SOURCE_ROOTS ?? '').split(':').filter((one) => one.trim()).length
    return ok({
      ok: true,
      id: ID,
      version: VERSION,
      roots: configured === 0 ? 'whatever the host names' : `${configured} configured`,
      ceiling: bytes(MAX_BYTES),
      writes: 'none — this module opens files read-only and nothing else',
    })
  }

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  /*
   * One file.
   *
   * A GET with the root, the path and the range in the query, because that is
   * what it is: a read, idempotent, and safe to repeat. There is no POST
   * anywhere under `/api` and there is no route that takes a body — the absence
   * is checked by `test/doors.test.ts`, so that adding one is a test failure
   * rather than a thing that quietly starts working.
   *
   * There is no default for `path`, unlike the explorer's tree where a missing
   * path plainly means the root. A file viewer with no file named has nothing it
   * could mean, and the page has its own sentence for that state; answering with
   * something would be inventing a document.
   */
  if (path === '/api/source' && method === 'GET') {
    const root = rootOf(str(query.get('projectPath'), MAX_PATH))
    if (!root) return bad(NO_ROOT_PAGE)
    const at = str(query.get('path'), MAX_PATH)
    if (!at) return bad('Nothing named a file to show.')

    const wanted = range(query.get('from'), query.get('to'))
    if (wanted === 'bad') return bad(HALF_RANGE)

    const seen = open(root, at, wanted)
    if (seen.kind === 'refused') return bad(seen.error, 404)
    return ok({ ok: true, root, ...seen })
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }
