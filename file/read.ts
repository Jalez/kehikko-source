import { closeSync, openSync, readSync, statSync } from 'node:fs'

import { inside } from './confine.ts'
import {
  BYTE_LEAD,
  LINE_LEAD,
  MAX_BYTES,
  MAX_LINES,
  SNIFF_BYTES,
  looksLike,
  tongue,
  type Seen,
} from './shape.ts'

/**
 * Opening one file, which is the only thing this program does on disk.
 *
 * ## Nothing here reads a whole file
 *
 * Every read below is a `readSync` into a buffer this module allocated, at an
 * offset this module chose, of a length this module bounded. There is no
 * `readFileSync` anywhere in this repository and there must not be one: the
 * caller is a passage, a passage names a path a stranger's program chose, and
 * `readFileSync` on a path somebody else picked is a program that allocates
 * however many gigabytes it is told to. The bound has to be at the syscall
 * rather than after it, because after it is too late by definition.
 *
 * The consequence is the shape of this file: a descriptor, a sniff, a decision
 * about where to start, one bounded read, and a close. In that order, once.
 *
 * ## The window, and why it moves
 *
 * The obvious reader shows the first `MAX_BYTES` of a file and stops. That is
 * right for a file somebody is browsing and wrong for the case this module
 * exists to serve: paper, notes and diff all publish passages carrying a BYTE
 * RANGE, and a range twelve megabytes into a log is a range the first quarter
 * of a megabyte does not contain. A container that answered "here is the top of
 * the file" to "look at this specific thing" would be answering a different
 * question and looking like it had answered the right one.
 *
 * So the window is anchored on the range when there is one and the range is out
 * of reach from the top, and it starts at a line boundary either way — a view
 * that opens halfway through a line of code is a view that shows a fragment as
 * though it were a statement.
 *
 * The cost is one extra pass: `firstLine` has to be counted rather than assumed,
 * because a reader shown line 4,012 of a file needs to be told that is what it
 * is. That pass streams a megabyte at a time and never holds the prefix.
 *
 * ## Nothing here writes
 *
 * `openSync` with no flag is `'r'`. It is spelled explicitly below anyway, for
 * the same reason the manifest spends a paragraph on it: a default that happens
 * to be read-only is one careless edit from being read-write, and the whole of
 * this module's claim about itself rests on that character.
 */

/**
 * The one refusal, in the page's voice.
 *
 * One sentence for "outside the project", "does not exist" and "cannot be
 * read", because three distinguishable answers is an oracle: a caller that can
 * tell them apart can ask whether a file it may not see exists, one question at
 * a time. See the essay in `confine.ts`.
 */
export const REFUSED = 'That file is not somewhere this app can look.'

/** A refusal, or what was seen. */
export type Reading = Seen | { kind: 'refused'; error: string }

/** The range a passage asked to have highlighted, in bytes, as it arrives. */
export interface Wanted {
  from: number
  to: number
}

export function open(root: string, at: string, wanted: Wanted | null): Reading {
  const path = inside(root, at)
  if (path === null) return { kind: 'refused', error: REFUSED }

  let stat
  try {
    stat = statSync(path)
  } catch {
    return { kind: 'refused', error: REFUSED }
  }

  /*
   * A directory is not a refusal.
   *
   * It is a real thing at a real path that the caller is perfectly entitled to
   * have named — the explorer next door points at files, but nothing stops
   * another module from publishing a passage naming a folder, and a person can
   * type one at `/mcp`. Answering "not somewhere this app can look" would be
   * saying something false about a directory that is right there. So it is its
   * own answer with its own sentence, and the page says the true short thing.
   */
  if (stat.isDirectory()) return { kind: 'folder', path }
  /* A socket, a fifo, a device. `isFile` is the only kind with contents that
     can be read once and be the same twice, and a reader that opened a fifo
     would block this server forever on a path a message named. */
  if (!stat.isFile()) return { kind: 'refused', error: REFUSED }

  const size = stat.size
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return { kind: 'refused', error: REFUSED }
  }

  try {
    if (size === 0) {
      return {
        kind: 'text',
        path,
        size: 0,
        read: 0,
        at: 0,
        text: '',
        firstLine: 1,
        whole: true,
        mark: null,
        markLost: wanted !== null,
        language: tongue(path),
      }
    }

    const sniff = Buffer.alloc(Math.min(size, SNIFF_BYTES))
    readSync(fd, sniff, 0, sniff.length, 0)
    if (binary(sniff)) return { kind: 'binary', path, size, looks: looksLike(path) }

    const start = anchor(fd, size, wanted)
    const length = Math.min(MAX_BYTES, size - start)
    let window = Buffer.alloc(length)
    readSync(fd, window, 0, length, start)

    /*
     * A window that stopped short of the end is trimmed back to the last
     * newline, so the bottom of the view is a whole line rather than however
     * many characters were left in the budget.
     *
     * Unless there is no newline in it at all, which is what a minified bundle
     * looks like: 256 KiB of one line. Trimming that to the last newline would
     * leave nothing, and answering an empty document for a file that is plainly
     * full is worse than showing a quarter of a very long line. The page wraps
     * it and says how much is missing.
     */
    const cutShort = start + length < size
    if (cutShort) {
      const lastBreak = window.lastIndexOf(0x0a)
      if (lastBreak > 0) window = window.subarray(0, lastBreak)
    }

    let text = window.toString('utf8')
    const read = window.length
    /*
     * The trailing newline of a complete file is dropped, and it is not counted
     * as something missing.
     *
     * A file that ends in a newline has, by every editor's reckoning, as many
     * lines as it has newlines — not one more. Splitting the text as-is
     * produces a final empty string, which draws as a phantom blank line at the
     * bottom of every well-formed file in the project.
     */
    if (!cutShort && text.endsWith('\n')) text = text.slice(0, -1)

    const mark = place(window, start, wanted, text.length)
    const firstLine = 1 + newlinesBefore(fd, start)

    const trimmed = capLines(text, mark)
    /*
     * The byte offset of the first line SHOWN, which is not the offset the read
     * started at once lines have been dropped from the front.
     *
     * Measured rather than tracked, because the alternative is carrying a byte
     * offset alongside a character offset through three transformations and
     * having them agree. `Buffer.byteLength` over at most 256 KiB is cheap and
     * cannot drift.
     */
    const shownAt = start + Buffer.byteLength(text.slice(0, trimmed.shift), 'utf8')

    return {
      kind: 'text',
      path,
      size,
      read: trimmed.dropped ? Buffer.byteLength(trimmed.text, 'utf8') : read,
      at: shownAt,
      text: trimmed.text,
      firstLine: firstLine + trimmed.firstLineShift,
      whole: start === 0 && !cutShort && !trimmed.dropped,
      mark: trimmed.mark,
      /* A range was asked for and none of it survived to the screen. Different
         from "nothing was selected", and the page says a different sentence. */
      markLost: wanted !== null && trimmed.mark === null,
      language: tongue(path),
    }
  } catch {
    return { kind: 'refused', error: REFUSED }
  } finally {
    closeSync(fd)
  }
}

/**
 * Whether a chunk of a file is not text.
 *
 * ## A NUL byte, first, because that is what git says
 *
 * `git` calls a file binary if there is a zero byte in its first 8000, and the
 * number and the rule are both copied here rather than invented. A person's
 * sense of which of their files are binary is trained almost entirely by what
 * `git diff` does, and a module that disagreed with git about a file would be
 * the one that looks wrong even where it is right in principle.
 *
 * ## Then a proportion of control characters, which catches what NUL does not
 *
 * UTF-16 text is caught by the NUL rule. A JPEG usually is. A short binary that
 * happens to have no zero byte in its first few kilobytes is not, and it decodes
 * into a screenful of replacement characters — mojibake presented with syntax
 * highlighting, which is the exact failure this whole function exists to avoid.
 *
 * So: control characters that no text file uses, over a tenth of the chunk. Tab,
 * newline, vertical tab, form feed and carriage return are text and are excluded.
 * So is ESC, deliberately: a captured terminal log is full of ANSI escapes and is
 * entirely text, and this workspace has a terminal module whose output somebody
 * will point this at.
 *
 * ## What it does not do
 *
 * It does not validate UTF-8. A file of Latin-1 prose is not binary and would
 * fail that check; it decodes with a few replacement characters and is perfectly
 * readable, which is a better outcome than refusing to show it.
 */
export function binary(chunk: Buffer): boolean {
  if (chunk.length === 0) return false
  let odd = 0
  for (let i = 0; i < chunk.length; i += 1) {
    const byte = chunk[i]!
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27) || byte === 127) odd += 1
  }
  return odd / chunk.length > 0.1
}

/**
 * Where to start reading, given what somebody asked to have highlighted.
 *
 * Zero in the ordinary case, and the ordinary case is nearly every case: a file
 * small enough to show whole, or a range inside the first `MAX_BYTES` of a large
 * one. The window only moves when it has to, because a view that opens at line
 * 1 of a file is what a reader expects and a view that opens somewhere else has
 * to earn it.
 *
 * When it does move, it lands on a line boundary. The probe backwards is a
 * bounded read of its own — a file with no newline in the four kilobytes before
 * the range gets an unaligned start rather than an unbounded search, which is
 * the right trade: one ragged first line beats scanning backwards through a
 * minified bundle looking for a break that is not there.
 */
function anchor(fd: number, size: number, wanted: Wanted | null): number {
  if (!wanted || wanted.from < MAX_BYTES || wanted.from >= size) return 0

  const desired = Math.max(0, wanted.from - BYTE_LEAD)
  if (desired === 0) return 0

  const probeAt = Math.max(0, desired - 4096)
  const probe = Buffer.alloc(desired - probeAt)
  readSync(fd, probe, 0, probe.length, probeAt)
  const lastBreak = probe.lastIndexOf(0x0a)
  return lastBreak === -1 ? desired : probeAt + lastBreak + 1
}

/**
 * The passage's byte range, as character indices into the decoded window.
 *
 * ## The conversion has to happen here and cannot happen in the page
 *
 * The protocol is explicit that `from` and `to` are BYTES, "because the consumer
 * that opens the file reads bytes and a character count would need the encoding
 * to be agreed on as well". A browser holds a UTF-16 string and can only slice
 * it by code unit. The two are the same number only for a file that is pure
 * ASCII up to the selection — which describes most source and none of the
 * thesis this workspace was built around, where one `ä` before the range shifts
 * every offset after it.
 *
 * Only this process has the bytes, so only this process can do the arithmetic.
 * It is `subarray().toString().length`, which is the definition of the answer
 * rather than an approximation of it.
 *
 * ## A range that starts inside a character
 *
 * `subarray` at a non-boundary produces one replacement character where a
 * partial sequence was, so the count comes out one high. That is a passage
 * whose offsets were computed against different bytes than these — the file
 * changed, or the pointing module counted characters and called them bytes —
 * and being off by one in the highlight is the correct amount of wrong to be
 * about it. The protocol says the same thing at more length: a passage is a
 * claim by the pointing module, and `quoted` is there so a consumer can tell a
 * good anchor from a rotten one by looking.
 */
function place(window: Buffer, start: number, wanted: Wanted | null, chars: number): { from: number; to: number } | null {
  if (!wanted) return null
  const from = wanted.from - start
  const to = wanted.to - start
  if (to <= 0 || from >= window.length) return null

  const first = window.subarray(0, Math.max(0, Math.min(from, window.length))).toString('utf8').length
  const last = window.subarray(0, Math.max(0, Math.min(to, window.length))).toString('utf8').length
  /* Clamped to the text as it will actually be drawn, because the trailing
     newline may have been dropped since. A highlight one character past the end
     of a string is a range no `slice` can honour. */
  const a = Math.min(first, chars)
  const b = Math.min(last, chars)
  return b > a ? { from: a, to: b } : null
}

/**
 * The line cap, applied last and anchored on the highlight.
 *
 * It runs after the byte window rather than instead of it, because the two
 * bounds catch different files. A log with sixteen-byte lines fits 16,000 of
 * them inside the byte ceiling; a file of long paragraphs hits the byte ceiling
 * at 300 lines. Both have to be bounded and neither bound implies the other.
 *
 * Anchored on the mark for the same reason the byte window is: showing the top
 * of a file to somebody who asked about line 9,000 of it is answering a
 * different question. `LINE_LEAD` lines are kept above the mark so it does not
 * sit against the top edge, which reads as the start of the file.
 */
function capLines(
  text: string,
  mark: { from: number; to: number } | null,
): { text: string; mark: { from: number; to: number } | null; shift: number; firstLineShift: number; dropped: boolean } {
  const lines = text.split('\n')
  if (lines.length <= MAX_LINES) return { text, mark, shift: 0, firstLineShift: 0, dropped: false }

  /* Where each line begins, so the cut can be expressed as a character offset
     without a second pass over the text. */
  const starts: number[] = [0]
  for (let i = 0; i < lines.length; i += 1) starts.push(starts[i]! + lines[i]!.length + 1)

  let markLine = 0
  if (mark) {
    while (markLine + 1 < lines.length && starts[markLine + 1]! <= mark.from) markLine += 1
  }
  const first = Math.max(0, Math.min(markLine - LINE_LEAD, lines.length - MAX_LINES))
  const shift = starts[first]!
  const kept = lines.slice(first, first + MAX_LINES).join('\n')

  const moved = mark ? { from: mark.from - shift, to: mark.to - shift } : null
  const survives = moved !== null && moved.from >= 0 && moved.from < kept.length
  return {
    text: kept,
    mark: survives ? { from: moved.from, to: Math.min(moved.to, kept.length) } : null,
    shift,
    firstLineShift: first,
    dropped: true,
  }
}

/**
 * How many newlines come before a byte offset, streamed.
 *
 * The only reason this exists is so the page can put a true number in the
 * gutter. A view of a log that starts at byte 12,000,000 and numbers its first
 * line `1` is worse than a view with no numbers at all: it invites somebody to
 * quote a line number to a colleague, and the number is wrong.
 *
 * A megabyte at a time, and the buffer is reused. A 40 MB file costs forty
 * reads and one allocation, which is single-digit milliseconds and no memory
 * worth measuring — and it only happens when the window has moved, which is
 * rare. Reading the prefix into one string to call `split` on it is the version
 * that would have to allocate the forty megabytes this whole file is arranged to
 * avoid.
 */
function newlinesBefore(fd: number, offset: number): number {
  if (offset <= 0) return 0
  const chunk = Buffer.alloc(Math.min(offset, 1024 * 1024))
  let seen = 0
  let at = 0
  while (at < offset) {
    const want = Math.min(chunk.length, offset - at)
    const got = readSync(fd, chunk, 0, want, at)
    if (got <= 0) break
    for (let i = 0; i < got; i += 1) if (chunk[i] === 0x0a) seen += 1
    at += got
  }
  return seen
}
