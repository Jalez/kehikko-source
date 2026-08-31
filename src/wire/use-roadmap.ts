import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModuleContext } from 'roadmap-module-protocol'

import { connect, type Connection, type HostEvents } from 'roadmap-module-protocol/client'

/**
 * The bridge, as one React value.
 *
 * `roadmap-module-protocol/client` is the wire and knows no React; this is the
 * only file that turns messages into state, and it is deliberately the only one.
 * Two places driving "what can this page see" would eventually disagree.
 *
 * ## This hook has no `point`, and that is the whole design of the module
 *
 * The sibling this was adapted from has a `point` that calls `passage.set` when
 * a person presses a row. There is deliberately no equivalent here, and the
 * absence is enforced by there being no `request` call anywhere in this file:
 * this module reads `context.passage` and never writes one.
 *
 * `manifest.ts` argues it at length. The short version is that a module which
 * both follows a value and sets it is a loop with a person in it — two
 * containers taking turns disagreeing about where the reader is — and a viewer
 * is the natural one to be the listener, because everything it knows came from
 * somewhere else.
 *
 * If somebody adds a `request` to this file, the thing to check is whether they
 * meant to make this module a producer, and whether the container that was
 * already producing has been told.
 *
 * ## The passage is handed on whole and never remembered
 *
 * Applied on every context including when it is null, and never kept. A
 * container that held onto the last passage would go on showing a file the
 * reader closed ten minutes ago — indistinguishable, on screen, from it still
 * being open. The protocol makes the field nullable precisely so that "no
 * document" is a state a module can move INTO.
 *
 * ## The grace, and why there is one
 *
 * A page cannot know at load whether it is framed. The greeting arrives when the
 * host is ready rather than when we are, so a page that concluded "nobody is
 * there" in the first frame would say so and be greeted a moment later — the
 * reader sees the standalone paragraph flash past and be replaced, which teaches
 * them that paragraph is noise. So there is a `listening` state with its own
 * words, it lasts under a second, and only then does the page say the harder
 * thing.
 *
 * It is not a spinner. It says what it is waiting for.
 */
const GREETING_GRACE_MS = 700

/**
 * Whether anything is framing this page, in the three states that matter.
 *
 * Three rather than a boolean, because "we have not heard yet" is not "nobody is
 * there": one lasts under a second and the other is the standalone case. Drawing
 * the second while in the first is the flicker the grace prevents.
 */
export type Where = 'listening' | 'unhosted' | 'hosted'

/** A passage, as the context carries one. */
export type Passage = NonNullable<ModuleContext['passage']>

export interface Roadmap {
  where: Where
  /** What the project is called, as the host says it. Null when nobody has said. */
  project: string | null
  /**
   * Where that project is on disk. The root every path this app opens is
   * confined to, and the only reason it can open anything at all.
   *
   * Null is an ordinary state and not a fault: nobody has opened a project, this
   * page was opened directly on its own port, or the host has no filesystem of
   * its own to point at.
   */
  projectPath: string | null
  /**
   * Where the canvas is pointing, or null.
   *
   * The entire input to this module. It names the file to open and, when the
   * pointing module knew one, the byte range to highlight.
   *
   * It is a CLAIM and not a fact, and this app is built as though it were the
   * second only after its own server has checked it. The protocol says so
   * itself: a host relays a passage, it did not open the file, and it cannot say
   * that the path exists or that the offsets are inside it. So the path goes
   * through `file/confine.ts` before anything is read, and the offsets are
   * clamped to what was actually read.
   */
  passage: Passage | null
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
}

/**
 * What to do when the host says "go to this reference".
 *
 * Handed in rather than handled here, because the answer depends on what is on
 * screen, and that is the view's business. The contract is the protocol's:
 * `answer` must be called, and calling it late is the same as not calling it.
 */
export type GotoHandler = NonNullable<HostEvents['onGoto']>

export function useRoadmap(id: string, onGoto: GotoHandler): Roadmap {
  const [where, setWhere] = useState<Where>('listening')
  const [project, setProject] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [passage, setPassage] = useState<Passage | null>(null)
  const host = useRef<Connection | null>(null)

  /**
   * The handler, held in a ref and read at the moment a `goto` arrives.
   *
   * The view rebuilds this function whenever what is on screen changes, and
   * connecting to the window again on every render would mean a torn-down
   * listener during the one millisecond a host chose to greet in. So the listener
   * is established once and always calls the newest handler.
   */
  const goto = useRef(onGoto)
  goto.current = onGoto

  useEffect(() => {
    /**
     * What the greeting and every later context both do.
     *
     * The theme is applied here rather than in a component, because it is a fact
     * about the document rather than about any part of it. `light` is set
     * explicitly as well as `dark`, so that a host asking for light over a
     * machine set to dark actually gets it — see the media query in `index.css`.
     */
    const arrived = (context: ModuleContext) => {
      const root = document.documentElement
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')

      setWhere('hosted')
      setProject(context.project ?? null)
      /*
       * Compared before it is written, both of them, because a context arrives
       * after every change anywhere on the canvas.
       *
       * The passage is an OBJECT and is the one that matters here more than
       * anywhere else in this workspace: the host builds a fresh
       * `{path, page, from, to, quoted}` every couple of seconds, and a new
       * identity downstream means the effect that FETCHES re-runs. That is not a
       * wasted memo — it is a re-read of somebody's file, over HTTP, twice a
       * second, forever, in a container nobody is touching.
       */
      setProjectPath((was) => (was === (context.projectPath ?? null) ? was : (context.projectPath ?? null)))
      setPassage((was) => (same(was, context.passage ?? null) ? was : (context.passage ?? null)))
    }

    /**
     * The connection is stored BEFORE it is told to listen, and the order is the
     * whole of a bug that made a sibling module hang forever.
     *
     * `listen()` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost
     * always arrives before React mounts — that is the entire reason the mailbox
     * exists — so `onHello` fires on that line, and anything reading
     * `host.current` before the assignment finds null and quietly does nothing.
     *
     * Worse, it works often enough to look fine. When the host happens to greet
     * after this effect returns — a slow module, a reload, a busy machine — the
     * assignment has already happened and everything behaves. A race whose good
     * outcome is the common one is the kind that ships.
     */
    const live = connect(id, {
      onHello: (context) => arrived(context),
      onContext: (context) => arrived(context),
      onGoto: (message, answer) => goto.current(message, answer),
    })
    host.current = live
    live.listen()

    const grace = setTimeout(() => {
      setWhere((was) => (was === 'listening' ? 'unhosted' : was))
    }, GREETING_GRACE_MS)

    return () => {
      clearTimeout(grace)
      live.stop()
      /* Cleared only if it is still ours: under StrictMode the second mount has
         already assigned its own connection by the time some cleanups run. */
      if (host.current === live) host.current = null
    }
  }, [id])

  const resize = useCallback((height: number) => host.current?.resize(height), [])

  return useMemo(
    () => ({ where, project, projectPath, passage, resize }),
    [where, project, projectPath, passage, resize],
  )
}

/** Whether two passages say the same thing. Field by field, because the object is rebuilt every context. */
export function same(a: Passage | null, b: Passage | null): boolean {
  if (a === null || b === null) return a === b
  return a.path === b.path && a.page === b.page && a.from === b.from && a.to === b.to && a.quoted === b.quoted
}
