import { locationLabel, readTrackerRef, trackerReadingResult, type CodeLocation, type Passage, type SharedLocation } from 'kehikot-module-protocol'
import { useEffect, useState } from 'react'

/**
 * Which file of which change to show, when it is a change's file and not the
 * disk's (protocol 2.13.0).
 *
 * Two ways the canvas says so:
 *
 *  1. **A code location** (`context.location`): somebody pointed at a line of a
 *     change — a comment's reference in Review, a line number in Diff. Its
 *     change, path, lines, side and commit are exactly what is shown.
 *  2. **A change picked, and a file chosen**: the selection holds exactly one
 *     change and the canvas's passage names a file inside the project. Then it
 *     is that file at the change's head — what the change makes of the file
 *     the person is looking at — with no line marked.
 *
 * Neither: `null`, and the page shows the passage's file off the disk, as it
 * always has.
 */

export interface CodeTarget {
  change: string
  /** Repository-relative. */
  path: string
  line: number | null
  endLine: number | null
  side: 'new' | 'old'
  /** The commit the location names, or null for "the change's head (or base)". */
  commit: string | null
  /** The change's URL, from the tracker reading, when it has been read: how the server finds its repository. */
  url: string | null
  /** The location's `at`: new on every pointing, so pointing again at the same line scrolls again. */
  at: string | null
  /** Why it was pointed at, when it was. */
  intent: 'show' | 'comment' | null
}

/** What the tracker reading says of a ref: whether it is a change, and where. */
export interface Row {
  kind: 'issue' | 'change'
  url: string
}

/** A ref the spelling alone says is a change (`!7`, `gl:group/p!7`), whatever the reading says. */
const spelledAsChange = (ref: string) => readTrackerRef(ref)?.kind === 'change'

export function targetFrom(input: {
  location: SharedLocation | null
  passage: Passage | null
  projectPath: string | null
  selection: readonly string[]
  rows: ReadonlyMap<string, Row>
}): CodeTarget | null {
  const { location, passage, projectPath, selection, rows } = input
  if (location) {
    return {
      change: location.change,
      path: location.path,
      line: location.line,
      endLine: location.endLine ?? null,
      side: location.side,
      commit: location.commit ?? null,
      url: rows.get(location.change)?.url ?? null,
      at: location.at ?? null,
      intent: location.intent,
    }
  }
  if (!passage || !projectPath) return null
  const changes = selection.filter((ref) => rows.get(ref)?.kind === 'change' || spelledAsChange(ref))
  if (changes.length !== 1) return null
  const change = changes[0]!
  const base = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  if (!passage.path.startsWith(base)) return null
  const path = passage.path.slice(base.length)
  if (!path) return null
  return { change, path, line: null, endLine: null, side: 'new', commit: null, url: rows.get(change)?.url ?? null, at: null, intent: null }
}

/** "!123 · src/app.ts:42 at abc1234", the header of a change's file. */
export function changeHeader(target: Pick<CodeTarget, 'change' | 'path' | 'line' | 'endLine'>, commit: string | null): string {
  const where =
    target.line === null ? target.path : locationLabel({ path: target.path, line: target.line, ...(target.endLine === null ? {} : { endLine: target.endLine }) })
  return `${target.change} · ${where}${commit ? ` at ${commit.slice(0, 7)}` : ''}`
}

/** The location "Comment on this line" sends: the place shown, at the commit it was read at. */
export function commentAt(target: Pick<CodeTarget, 'change' | 'path' | 'side'>, commit: string, first: number, last: number): CodeLocation {
  const line = Math.min(first, last)
  const endLine = Math.max(first, last)
  return { change: target.change, path: target.path, line, ...(endLine > line ? { endLine } : {}), side: target.side, commit }
}

/** What a tracker reading says of these refs. Unreadable answers say nothing. */
export function rowsIn(answer: unknown): Map<string, Row> {
  const out = new Map<string, Row>()
  const parsed = trackerReadingResult.safeParse(answer)
  if (!parsed.success) return out
  for (const row of parsed.data.rows) out.set(row.ref, { kind: row.kind === 'change' ? 'change' : 'issue', url: row.url })
  return out
}

type Ask = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * The tracker reading's word on these refs, asked again when the reading
 * moves (`context.tracker.at`). A summary: what kind each is and its URL.
 * Keyed on the refs as one string, so a context that says the same refs
 * again asks nothing.
 */
export function useRows(request: Ask, refs: readonly string[], readingAt: string | null): ReadonlyMap<string, Row> {
  const [rows, setRows] = useState<ReadonlyMap<string, Row>>(new Map())
  const key = refs.join('\n')
  useEffect(() => {
    if (!key) {
      setRows(new Map())
      return
    }
    let cancelled = false
    request('tracker.get', { refs: key.split('\n') })
      .then((answer) => {
        if (!cancelled) setRows(rowsIn(answer))
      })
      .catch(() => {
        /* A host that does not read trackers, or not for this module: a short spelling still works on its own. */
      })
    return () => {
      cancelled = true
    }
  }, [request, key, readingAt])
  return rows
}
