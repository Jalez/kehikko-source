import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

import { MAX_BYTES, bytes } from './file/shape.ts'

export const ID = 'roadmap.source'
export const VERSION = '1.0.0'

/**
 * What this app says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads, so it is where the BOUNDS go — the things this module has decided
 * not to be, written down at the one place somebody deciding whether to place it
 * will look.
 *
 * ## This module is the purest consumer on the canvas, and `passage:set` is the
 * capability it deliberately does not have
 *
 * Every other module here produces something. Paper publishes the range a
 * reader selected. Notes publishes the passage a note is about. Diff publishes
 * the hunk somebody pressed. The explorer, next door and newer than any of
 * them, exists precisely to publish "this file, nothing selected in it".
 *
 * This one publishes nothing. It reads `context.passage`, opens what it names,
 * and draws it. That is the whole program, and the absence is a decision rather
 * than an unfinished feature.
 *
 * The tempting version has a press: click a line, and the canvas points at that
 * line. It is one call, it feels obviously useful, and it is wrong here for a
 * reason that only shows up with two containers open. This module FOLLOWS the
 * passage. A module that both follows a value and sets it is a loop with a
 * person in it: the explorer points here, this points somewhere a pixel
 * different, the explorer's row unmarks itself, and the reader watches two
 * containers argue about where they are. Somebody has to be the one that only
 * listens, and a viewer is the natural one — it is the container with the least
 * claim to know where the reader wants to go next, because everything it knows
 * came from somewhere else.
 *
 * If a selection here ever needs to reach the rest of the canvas, the honest
 * shape is `selection:set` on a deliberate gesture, argued out on its own
 * merits, in a version that has watched two containers not fight. Not a click
 * handler added because it was easy.
 *
 * ## Read-only, and it is a stronger claim than the explorer's
 *
 * There is no create, no rename, no move, no delete, no save, no edit. Not "not
 * yet" — not at all. This module opens files with `'r'`, spelled explicitly, and
 * `test/doors.test.ts` asserts that no door here accepts a POST except `/mcp`,
 * so adding a write is a test failure rather than a thing that quietly starts
 * working.
 *
 * A viewer is the shape of program where an editor is the obvious next feature,
 * and it is the wrong feature for this container. It is 220 pixels wide on
 * somebody's canvas, it is reachable by anything on this machine that finds the
 * port, and the path it is looking at was chosen by a message from another
 * program. Every one of those is fine for showing bytes and none of them is
 * fine for changing them. The person has an editor; they do not have a small
 * pane that shows them what the thing they just pressed actually says.
 *
 * ## What is not declared
 *
 * - **`passage:set` — no**, for the whole page of reasons above.
 * - **`selection:set` — no.** Same argument arriving by a different road: this
 *   app knows about a selection only because it was told about one, and
 *   repeating it back is noise on the wire at best and a loop at worst.
 * - **`epics:read`, `steps:read`, `live:read` — no.** A file's contents are not
 *   derived from a tracker. A capability asked for and never used is the fastest
 *   way to teach somebody to press yes without reading.
 * - **`stage:report` — no.** Saying where work is belongs to whoever is doing
 *   it. A file viewer has no opinion about that.
 * - **`view:navigate` — no.** `view.goto` names an epic, a step or a tracker
 *   ref; this container holds none of the three, and says so quickly when asked
 *   so the reader gets the host's fallback instead of a timeout.
 * - **`events:emit` — no, and `emits` is empty.** Nothing happens here that
 *   somebody would otherwise miss. A person who pointed the canvas at a file
 *   already knows they did.
 * - **`state:keep` — no.** What this container shows is entirely determined by
 *   the passage, and the passage arrives on every context. State restored from
 *   yesterday would be a container confidently showing a file the reader is not
 *   looking at, which is indistinguishable on screen from it being right.
 *
 * ## `consumes` is empty, and it is not the field this module wishes it had
 *
 * `extensions.consumes` names extension PAYLOAD FORMATS — the notification
 * shapes and activity records a module will render. This app renders none of
 * them; it renders a file. So the list is honestly empty.
 *
 * What is missing from the protocol at the time of writing is a way to declare
 * which parts of the CONTEXT a module follows, which for this one is the whole
 * of its behaviour and is currently visible only by reading its source. There is
 * no field for it in `declares` in protocol 2 / package 0.13.0, and inventing
 * one would mean writing a key every host ignores and every reader mistakes for
 * a contract. If such a field lands, this module should be among the first to
 * fill it in, and the value is `passage`.
 *
 * ## `prompt: false`
 *
 * A prompt is a paragraph a person writes on the canvas aimed at one container.
 * There is no work here to describe: what this app shows is entirely determined
 * by the passage and by what is on disk, and no paragraph changes what a file
 * says.
 *
 * ## The mode is epic-scoped, because the context only arrives there
 *
 * One mode, which becomes an ordinary tab in the mode row. `scope: 'epic'`
 * because an epic-scoped mode is the one that receives `roadmap.context` — and
 * the context is the only thing this module has. A `global` mode is never sent
 * one, which for this app means a container that can never learn what to show.
 *
 * ## Storage, and why a module that holds nothing still asks for it
 *
 * `storage: true` makes the host frame this page with `allow-same-origin`, so it
 * keeps its real origin instead of running opaque. The usual rule is that a
 * module holding no material of its own declares `false`, because an origin
 * would be a thing it had no use for. This one holds no material and declares
 * `true` anyway, and the reason is the `/api` rather than a store.
 *
 * Opaque, this page's fetches to its own `/api/source` are CROSS-origin — an
 * opaque origin is `null` and matches nothing — so the server would have to
 * answer with permissive CORS or the app could not read its own file contents.
 * Permissive CORS on this origin means any page in any tab can ask this port
 * for the CONTENTS of any file inside somebody's project and read the answer.
 *
 * That is worse here than at the module this reasoning was copied from. The
 * explorer's equivalent hole is a filesystem enumeration oracle: a stranger's
 * tab learns what your files are CALLED. This one hands over what they SAY —
 * `.env`, a private key checked into a working tree, an unpushed draft. A
 * sibling module demonstrated the shape of the hole rather than theorising it,
 * with a `curl -H 'Origin: https://evil.example'` that came back carrying the
 * permissive header.
 *
 * Declaring storage closes it at the root: with a real origin this page's
 * scripts and its `/api` calls are ordinary same-origin requests, no CORS header
 * is sent at all, and a stranger's page gets nothing back. The sandbox is
 * weakened by exactly what that costs, which is little — the origin this page
 * regains is `127.0.0.1:7980` and the host is on `127.0.0.1:4180`, and different
 * ports are different origins, so the page can only reach itself.
 *
 * It does not close the door to a program on this machine that speaks HTTP
 * directly; nothing on loopback can. What it closes is the browser-shaped hole,
 * which is the one an ordinary person is actually exposed to.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  /**
   * Parsed rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on
   * the wire. That cuts both ways: running it HERE is the cheapest way for this
   * app to learn it has written a manifest no host will accept, and to learn it
   * when this file is imported rather than from a host's refusal in somebody
   * else's log.
   */
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Source',
  version: VERSION,
  summary:
    'The file the canvas is pointed at, shown — with the range a passage carries highlighted. It reads and never writes.',
  /**
   * What an agent should do about this module, given that it is here.
   *
   * Not the summary. The summary says what this IS, for a person deciding
   * whether to place it. This says what its PRESENCE OBLIGES, and a host
   * composes it into the prompt every agent on the canvas is handed.
   *
   * The honest thing to tell an agent about this module is that it almost
   * certainly should not call it. An agent has its own file reader, which is
   * faster and unbounded; this one exists so an agent can see what the PERSON is
   * looking at, with the same truncation and the same line numbers, when that
   * is the actual question. Saying so plainly is what stops a tool surface from
   * being a menu of equally-plausible options. Bounded at 1024 characters by the
   * protocol.
   */
  guidance:
    'Source is the container the person is reading a file in. It follows the canvas passage and shows nothing else. '
    + 'Use your own file reader for file contents — it is faster and has no ceiling. Call `shown` only when the '
    + `question is what the PERSON can see: it applies this container's own bounds (${bytes(MAX_BYTES)}, first line `
    + 'numbered as it really is) and returns exactly what is on their screen, which is what to reference when you '
    + 'talk to them about a line. This module writes nothing: it cannot edit, save, create, rename or delete, and it '
    + 'never points the canvas anywhere — it is a consumer only, so do not expect pressing anything here to move the '
    + 'other containers.',
  entry: '/app',
  modes: [{ id: 'source', label: 'Source', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'What the Source container on the canvas is showing of a file, with its bounds and its line numbers.',
  },
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    /* Empty, and the essay above is mostly about why. This module calls nothing
       on the host: it listens, it draws, and it answers `view.goto` with a no. */
    uses: [],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
