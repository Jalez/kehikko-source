import { useEffect, useState } from 'react'

import type { Passage } from '@/wire/use-roadmap.ts'

/**
 * One file, fetched from this app's own door, and nothing else kept.
 *
 * ## What this hook is careful about, which is not the fetch
 *
 * The fetch is four lines. The care is in WHEN it happens, because the input is
 * a context the host rebroadcasts every couple of seconds: a fresh
 * `{path, page, from, to, quoted}` object, identical in content and new in
 * identity. An effect keyed on the passage object re-reads somebody's file over
 * HTTP twice a second, forever, in a container nobody is touching. So the effect
 * is keyed on the four PRIMITIVES that change what gets read, and the wire hook
 * compares before it stores — two defences, because this one is the difference
 * between an idle container and a program hammering a disk.
 *
 * `page` and `quoted` are deliberately not among the keys. `page` is a filter a
 * paginating reader applies to its own view and says nothing about which bytes
 * are on screen here; `quoted` is what the pointing module saw when it
 * selected, which this app has no use for — it reads the file itself, so it does
 * not need somebody else's copy of a fragment of it, and treating a changed
 * quote as a reason to re-read would mean re-reading whenever a note was edited.
 *
 * ## Every answer is discarded if it is late
 *
 * The abort is not an optimisation. A person pressing three files in the
 * explorer inside a second starts three reads, and without the guard the
 * container shows whichever one the disk finished last — which on a warm cache
 * and a cold one is genuinely not the one they pressed. The controller aborts
 * the outgoing request AND the `cancelled` flag drops a response that has
 * already arrived, because those are two different races and only one of them is
 * `AbortController`'s.
 */

/** What came back, or what went wrong. */
export interface Source {
  /** The file as this app's server described it. See `file/shape.ts`. */
  seen: Seen | null
  /** The server's own sentence, when it refused. Never reworded on the way here. */
  trouble: string | null
  /** True between asking and answering, and used only to keep the previous file on screen. */
  reading: boolean
}

export type Seen =
  | { kind: 'folder'; path: string }
  | { kind: 'binary'; path: string; size: number; looks: string | null }
  | {
      kind: 'text'
      path: string
      size: number
      read: number
      at: number
      text: string
      firstLine: number
      whole: boolean
      mark: { from: number; to: number } | null
      markLost: boolean
      language: string | null
    }

export function useSource(projectPath: string | null, passage: Passage | null): Source {
  const [seen, setSeen] = useState<Seen | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const path = passage?.path ?? null
  const from = passage?.from ?? null
  const to = passage?.to ?? null

  useEffect(() => {
    if (!projectPath || !path) {
      setSeen(null)
      setTrouble(null)
      setReading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setReading(true)

    const query = new URLSearchParams({ projectPath, path })
    /*
     * The range is passed through UNTOUCHED when it is a range and left out
     * entirely when it is not.
     *
     * No repair, no half-range sent hopefully. The protocol refuses a half-range
     * on the wire and this app's door refuses one too, and the reason is worth
     * keeping at the call site: a `from` with no `to` would make this program
     * invent an end, and the end it invented would be drawn on somebody's screen
     * as though a module had chosen it.
     */
    if (from !== null && to !== null) {
      query.set('from', String(from))
      query.set('to', String(to))
    }

    void fetch(`./api/source?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; error?: string } & Partial<Seen>
        if (cancelled) return
        if (!response.ok || !body.ok) {
          setSeen(null)
          /* The server's sentence, verbatim. It gives ONE refusal for "outside
             the project", "does not exist" and "cannot be read", deliberately —
             see `file/confine.ts` — and rewording it here would be this page
             inventing a distinction the server refused to draw. */
          setTrouble(body.error ?? 'That file could not be read.')
          return
        }
        setTrouble(null)
        setSeen(body as Seen)
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return
        setSeen(null)
        /* A transport failure, which for a page fetching its own origin means
           the server it was served by has stopped. Said in the reader's terms
           rather than as a status code, because there is nothing they can do
           with the code. */
        setTrouble('This module’s own server did not answer.')
      })
      .finally(() => {
        if (!cancelled) setReading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [projectPath, path, from, to])

  return { seen, trouble, reading }
}
