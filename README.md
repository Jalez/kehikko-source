# Source

The file the canvas is pointed at, shown.

This is a Kehikot **module**: a small self-contained web app that a host frames
in an iframe, in a resizable container, on a canvas beside other containers. It
runs from its own repository, on its own port, and serves three things — a
manifest so a host knows what it is, a page so a person can look at it, and an
MCP server so an agent can too.

It is the companion to **Explorer**. Explorer lists the files in a project and
points the canvas at one when you press it. This one shows what is in it.

```
./run.sh                 # start it on 7980
bun run register.ts      # tell the host on this machine where it is
```

Then reload the host; it sweeps `~/.roadmap/modules` on every read.

---

## What it does

The host broadcasts a **context** to every framed module. In it is a
`projectPath` — where the project is on disk — and a `passage`, which is where
on the canvas the reader is pointing. A passage names a path, optionally a page,
and optionally a byte range.

This module reads that and does one thing with it:

| the passage says | what you see |
| --- | --- |
| a file | that file, with syntax colours |
| a file and a byte range | the same, with the range highlighted and scrolled to |
| nothing | one line saying nothing is pointed at |
| a directory | one line saying it is a folder |
| a file that is not text | one line saying so, and how big it is |
| a file it may not open | one line saying so |

There is no file picker and no path box. A second answer to "which file are we
looking at" is a container that can disagree with every other container on the
canvas, and a viewer showing the wrong file looks exactly like one showing the
right file.

## What it will not do

**It never writes.** No edit, no save, no create, rename, move or delete. Files
are opened with `'r'`, spelled explicitly, and `test/doors.test.ts` asserts that
no door here accepts a `POST` except the MCP one — so adding a write is a test
failure rather than something that quietly starts working.

**It never points the canvas.** This is the purest *consumer* in the workspace:
it reads the context and calls nothing. `declares.uses` is empty and there is no
`request` anywhere in `src/wire/`. The reason is in `manifest.ts` at length; the
short version is that a module which both follows a value and sets it is a loop
with a person in it, and somebody has to be the one that only listens.

## Getting around the code

```
manifest.ts          what this app says about itself, and every bound it accepts
doors.ts             /healthz, /mcp and /api/source — deciding, without a socket
vite.config.ts       the one server: the page and the doors on one origin
file/confine.ts      the fence. The only file that decides what may be opened
file/read.ts         opening one file: the window, the sniff, the offsets
file/shape.ts        the bounds, the language table, and the words for sizes
src/lib/highlight.ts colours and the highlighted range, as one list of spans
src/view/room.ts     what fits, from two numbers, with no DOM
src/view/code.tsx    the lines
src/use-source.ts    fetching, and not fetching twice a second
dev/                 three probes that drive the real page in a real browser
```

### The parts worth reading first

**`file/confine.ts`** is the dangerous one. It is handed a path that a stranger's
program chose — the protocol calls a passage "a rumour with a protocol's name on
it" — and decides whether to open it. Resolve, check lexically with a separator
so `/project-evil` does not pass a `/project` check, `realpath`, check again on
the answer. Every refusal is the same refusal, because three distinguishable
refusals is an oracle. `test/confine.test.ts` exists entirely to get past it.

**`file/read.ts`** is where a 40 MB log stops being a problem. Nothing here reads
a whole file: every read is bounded at the syscall, the window moves onto a byte
range when the range is too far in to reach from the top, and the first line is
*counted* rather than assumed so the numbers in the gutter are the file's real
ones.

**`src/lib/highlight.ts`** explains why this uses `lowlight` rather than
highlight.js, Prism or Shiki directly. Short version: those all return an HTML
string, and this module has to overlay a byte range *across and inside* the spans
a grammar produced. lowlight returns a tree, so the offsets are known rather than
inferred, and nothing is ever serialised to HTML or parsed back.

## Running the probes

Each one drives the real page in a real headless Chromium, acting as the host.
They need `./run.sh` already listening.

```
node dev/following.mjs   # follows every passage; sends the host nothing, ever
node dev/measure.mjs     # no sideways overflow at 220x300 … 900x700
node dev/awkward.mjs     # a 50 MB log, a minified bundle, a PNG, an empty file
```

`dev/following.mjs` is the one that matters. It counts what the module *sends*,
and the assertion is that the number is zero.

## Tests

```
bun test
bun run typecheck
```

## Configuration

| variable | what it does |
| --- | --- |
| `PORT` | where to listen. Default 7980, which is also what `register.ts` writes |
| `SOURCE_ROOTS` | colon-separated absolute directories this app may be pointed at. Unset means "whatever the host names", which is the default and the honest one |
| `ROADMAP_ORIGIN` | who may frame this page. Default is the host in this workspace |

`SOURCE_ROOTS` never affects the other fence, which is unconditional: whatever
the root is, no path in any request can leave it.

## The numbers, and where they came from

- **256 KB** is the byte ceiling. It is set by how long syntax highlighting
  takes, which is the one part of showing a file that cannot be done partially.
- **4,000 lines** is the second ceiling, on a different axis, because 256 KB of a
  log with short lines is sixteen thousand of them.
- Neither is silent. When one bites, the container says `159 KB of 57 MB, from
  line 1.`

Measured on this machine: a 57 MB log draws in 184 ms, a range 49 MB into it in
227 ms, a 1.3 MB minified bundle in 574 ms. No horizontal overflow at 220x300,
320x200, 460x360 or 900x700, on source, LaTeX, a lock file or a minified bundle.

## House style

Comments explain **why**, what the alternative was, and what failure it prevents.
Several files open with an essay. That is deliberate and it is the convention
across this workspace — a comment that restates the code is worse than none.

On screen it is the opposite. Every empty state is one short sentence, because
the standing complaint about these modules is that they say too much in a column
220 pixels wide.
