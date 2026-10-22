import type { HostEvents } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useHost, useServerStanding, type CoverState, useFocus } from 'kehikot-module-protocol/client/react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { bytes } from '../file/shape.ts'
import { ID } from '../manifest.ts'

import { Button } from '@/components/ui/button.tsx'
import { changeHeader, commentAt, targetFrom, useRows } from '@/live/change.ts'
import { useChange } from '@/use-change.ts'
import { useSource } from '@/use-source.ts'
import { Code } from '@/view/code.tsx'
import { NOUN, anchorOf, inHand } from '@/view/focus.ts'
import { label, room as measure } from '@/view/room.ts'
import { Binary, EmptyFile, Folder, NoPassage, NoneInFocus, Trouble } from '@/view/screens.tsx'

/** What to do when the host says "go to this reference". The contract is the protocol's: `answer` must be called. */
type GotoHandler = NonNullable<HostEvents['onGoto']>

/**
 * The tallest frame this container will ever ask a host for, and the strips
 * around the code that are not code.
 *
 * Every sibling module that holds a document measures its content and asks for
 * exactly that height. A viewer cannot: four thousand lines is eighty thousand
 * pixels, and asking a host for that on behalf of a container in the corner of a
 * canvas is absurd. So it asks for what it would like up to this, and scrolls
 * internally past it — the arrangement a sidebar has, and the reason
 * `PAGE_HEAD` in `vite.config.ts` makes the body a fixed-height non-scrolling box.
 */
const MOST_WE_WILL_ASK_FOR = 420
/** The header, and the notice line when there is one. */
const CHROME = 44

/**
 * The page.
 *
 * ## What it shows, and the one thing it refuses to do
 *
 * The file the canvas is pointed at, and nothing else. There is no file picker,
 * no path box, no recently-opened list — a second answer to "which file are we
 * looking at" is a container that can disagree with every other container on the
 * canvas, and a viewer showing the wrong file looks exactly like a viewer
 * showing the right one.
 *
 * The thing it refuses is to point. There is no `passage.set` in this module,
 * anywhere: `manifest.ts` argues the case, and the `point` the protocol's
 * `useHost` offers is deliberately never taken off it below. This is the purest consumer on the canvas and the absence is
 * the design. If a press is ever added here, the question to answer first is
 * what happens when the container next door disagrees.
 *
 * ## Two measurements, and neither one is a viewport breakpoint
 *
 * Width and height both come out of a `ResizeObserver` and go into
 * `view/room.ts`, which is a pure function with the awkward sizes in its tests.
 * The container query in the CSS still does what container queries are for —
 * spacing and type size — but what EXISTS on screen is decided here, because a
 * gutter hidden with `display: none` is still in the DOM being measured, and
 * because `container: inline-size` says nothing at all about how tall a frame is.
 */
export function App() {
  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This container shows a
       file and none of those three is one — saying so quickly is what gets the
       reader the host's fallback instead of a twelve-second wait. */
    answer(
      false,
      message.ref
        ? 'This container shows the file the canvas is pointed at, so there is nothing here to walk to by reference.'
        : 'This container shows the file the canvas is pointed at, not epics or steps.',
    )
  }, [])

  /* The protocol's host hook: where the page stands, the theme on `<html>`, the flattened context.
     The passage is applied on every context including when it is null, and never remembered: a
     container that held onto the last one would go on showing a file the reader closed. */
  const { where, projectPath, passage, parts, epic, resize, location, selection, request, locate, context } = useHost(ID, { onGoto })
  /* How this page's own server last answered: `down` when nothing did, `stale` when it restarted under this page. */
  const server = useServerStanding()

  /*
   * A change's file, when the canvas points at one (protocol 2.13.0): a code
   * location, or one change picked with a file chosen. See `live/change.ts`.
   * The tracker reading says which picked refs are changes and where they are;
   * it is asked again when the reading moves.
   */
  const asking = useMemo(
    () => [...new Set([...(location ? [location.change] : []), ...selection])].slice(0, 16),
    [location, selection],
  )
  const rows = useRows(request, asking, context?.tracker.at ?? null)
  const target = useMemo(
    () => targetFrom({ location, passage, projectPath, selection, rows }),
    [location, passage, projectPath, selection, rows],
  )
  const fromChange = useChange(projectPath, target)
  /* The disk only while no change's file is asked for: one file at a time, from one place. */
  const fromDisk = useSource(projectPath, target ? null : passage)
  const { seen, trouble, retry } = target ? fromChange : fromDisk
  const commit = target && fromChange.seen ? fromChange.seen.commit : null
  const markLines = target && target.line !== null ? { from: target.line, to: target.endLine ?? target.line } : null

  /*
   * The scroll container, measured on both axes.
   *
   * An observer rather than a read on mount, because the size that matters is
   * the one after somebody drags the container's edge, and a measurement taken
   * once at mount is the one number guaranteed to be stale.
   *
   * The state is written through a comparison, which is not premature: a
   * `ResizeObserver` fires on every animation frame of a drag, and a `setState`
   * per frame with an unchanged number would re-render the whole file — four
   * thousand elements — sixty times a second while somebody resizes.
   */
  const scroller = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const read = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }))
    }
    const observer = new ResizeObserver(read)
    observer.observe(element)
    read()
    return () => observer.disconnect()
  }, [where, trouble, seen?.kind])

  /*
   * The one file this page shows, through the one rule every module narrows by. It is the file the
   * canvas points at, which is in hand, so a pick of the epic's parts takes nothing away and
   * nothing is said about it. See `view/focus.ts`.
   */
  const focus = useFocus({ parts, epic, projectPath })
  const read = seen?.kind === 'text' ? seen : null
  const narrowed = focus.narrow(read ? [read] : [], anchorOf, { noun: NOUN, keep: () => inHand(passage) || target !== null })
  const text = narrowed.shown[0] ?? null

  /*
   * "Comment on this line": the one place this page points the canvas, and only
   * at a change's file, on a press. It sends a code location with intent
   * `comment` for whoever writes reviews on the canvas (Review) to open a
   * comment there. Lines picked with a text selection, or the line
   * right-clicked; the commit is the one the file was read at.
   */
  const [lines, setLines] = useState<{ from: number; to: number } | null>(null)
  useEffect(() => {
    const lineOf = (node: Node | null): number | null => {
      const element = node === null ? null : node.nodeType === 1 ? (node as Element) : node.parentElement
      const row = element?.closest('[data-line]') as HTMLElement | null | undefined
      return row && scroller.current?.contains(row) ? Number(row.dataset.line) : null
    }
    const heard = () => {
      const picked = document.getSelection()
      const a = picked && !picked.isCollapsed ? lineOf(picked.anchorNode) : null
      const b = picked && !picked.isCollapsed ? lineOf(picked.focusNode) : null
      const next = a === null || b === null ? null : { from: Math.min(a, b), to: Math.max(a, b) }
      setLines((was) => (was?.from === next?.from && was?.to === next?.to ? was : next))
    }
    document.addEventListener('selectionchange', heard)
    return () => document.removeEventListener('selectionchange', heard)
  }, [])
  const [menu, setMenu] = useState<{ from: number; to: number; x: number; y: number } | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => setSaid(null), [target?.change, target?.path])
  const comment = useCallback(
    async (from: number, to: number) => {
      setMenu(null)
      if (!target || !commit) return
      const answer = await locate(commentAt(target, commit, from, to), 'comment')
      setSaid(
        answer === null
          ? 'The host did not take it: nothing framing this page points at code.'
          : answer.outcome === 'taken'
            ? null
            : answer.why || 'The host did not take it.',
      )
    },
    [target, commit, locate],
  )
  const onLineMenu = useCallback(
    (line: number, event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const within = lines && line >= lines.from && line <= lines.to ? lines : { from: line, to: line }
      setMenu({ ...within, x: event.clientX, y: event.clientY })
    },
    [lines],
  )
  useEffect(() => {
    if (!menu) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Element && event.target.closest('[data-testid="line-menu"]')) return
      setMenu(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])

  const lastLine = text ? text.firstLine + (text.text ? text.text.split('\n').length - 1 : 0) : 1
  const room = useMemo(() => measure(size, lastLine), [size, lastLine])

  /*
   * How tall this page would like its frame to be.
   *
   * CAPPED, for the reason at the top of this file, and asked for only when the
   * room on screen is genuinely short of it — a container already tall enough
   * does not need a message, and a page that sent one on every context would be
   * asking a host to relayout the canvas twice a second.
   */
  useEffect(() => {
    if (!text || !size.height) return
    const wanted = Math.min((lastLine - text.firstLine + 1) * (room.dense ? 15 : 18), MOST_WE_WILL_ASK_FOR)
    if (size.height >= wanted) return
    resize(wanted + CHROME)
  }, [resize, text, lastLine, size.height, room.dense])

  /*
   * Every not-ready moment is the protocol's one cover, and the order is what makes it true: a
   * page that has not been greeted is `waiting`, never "no project"; then nothing framing it, then
   * no project. Its own server not answering is said only while there is a file being asked for.
   *
   * There is no press on any of them, deliberately: a box to type a path into would make this a
   * viewer that can disagree with the canvas about which file is open.
   */
  const ready: CoverState | null = coverFor({ where, projectPath, server })
  const cover = ready === 'down' && !passage && !target ? null : ready
  if (cover && cover !== 'down') return <Cover state={cover} name="Source" />

  const shown = target ? changeHeader(target, commit) : text && projectPath ? label(text.path, projectPath, room.name) : ''
  const whole = target
    ? `${changeHeader(target, commit)}\n${target.side === 'old' ? 'Before the change (its base)' : 'As the change has it (its head)'}${commit ? `, commit ${commit}` : ''}`
    : (text?.path ?? '')

  const screen = !passage && !target ? (
    <NoPassage />
  ) : trouble ? (
    <Trouble said={trouble} />
  ) : seen?.kind === 'folder' ? (
    <Folder />
  ) : seen?.kind === 'binary' ? (
    <Binary size={seen.size} looks={seen.looks} />
  ) : narrowed.empty ? (
    /* The rule's one sentence, for a view a pick left with nothing. The pointed file is in hand,
       so this is not reached while the canvas points; it is here so the page says what the rule says. */
    <NoneInFocus said={narrowed.empty} />
  ) : !text ? (
    /* Still reading: no screen at all rather than a spinner. It is one open and
       one read and it is done in single-digit milliseconds for the files this
       module is for; anything drawn here is a flash the person reads as a fault.
       The previous file stays on screen until the next one is ready, which is the
       behaviour every editor has and the reason `useSource` keeps `seen` until it
       has something to replace it with. */
    <div className="p-3" data-testid="reading" />
  ) : !text.text.length ? (
    <EmptyFile />
  ) : (
    <div className="flex h-full min-w-0 flex-col">
      {/*
       * The header: what file this is, and nothing else.
       *
       * `truncate` rather than wrapping, because this is the one string on the
       * page that is allowed to be clipped — a path clipped in the middle is
       * still recognisable by its end, and a header that wrapped to three lines
       * would take a fifth of a short container to say something the reader
       * already knows. The whole path is in a `title` for the case where it does
       * not.
       */}
      {room.header ? (
        <div className="flex min-w-0 shrink-0 items-baseline gap-2 border-b px-2 py-1">
          {/* The name, and its whole path one hover away. Nothing here is about the picked parts of the
              epic: the file is in hand and is drawn the same whatever is picked. */}
          <span
            data-testid="name"
            title={text.hidden ? `${whole}\nAgents cannot read this file.` : whole}
            className="min-w-0 flex-1 truncate text-[0.7rem] font-medium"
          >
            {shown}
          </span>
          {/* Beside the name, in the same row: no row of its own. Only for a file agents are refused. */}
          {text.hidden ? (
            <span data-testid="private" title="Agents cannot read this file." className="shrink-0 text-[0.65rem] text-muted-foreground">
              private
            </span>
          ) : null}
          {/*
           * The one press in this module, and it exists only when it has
           * something to do.
           *
           * Scrolling back to the highlighted range is entirely local: it moves
           * this container's own scrollbar and sends nothing to anybody. That is
           * what makes it allowed here — it is not the module pointing, it is
           * the module returning to where it was pointed. Hidden when there is
           * no range, because a permanently disabled control in a strip this
           * narrow is width spent on a thing that never works.
           */}
          {/* The press that points: only at a change's file, and only while lines are picked. */}
          {target && commit && lines ? (
            <Button
              size="container"
              variant="ghost"
              data-testid="comment"
              title="Ask for a review comment on the picked lines"
              onClick={() => void comment(lines.from, lines.to)}
            >
              {lines.from === lines.to ? 'Comment on this line' : 'Comment on these lines'}
            </Button>
          ) : null}
          {text.mark || markLines ? (
            <Button
              size="container"
              variant="ghost"
              data-testid="to-mark"
              onClick={() => scroller.current?.querySelector('[data-tinted], [data-marked]')?.scrollIntoView({ block: 'center' })}
            >
              selection
            </Button>
          ) : null}
        </div>
      ) : null}

      <div ref={scroller} data-testid="scroller" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-1">
        <Code
          text={text.text}
          language={text.language}
          firstLine={text.firstLine}
          /* A location marks whole lines; a passage marks the bytes it carries. */
          mark={target ? null : text.mark}
          markLines={markLines}
          scrollKey={target?.at ?? null}
          room={room}
          onLineMenu={target && commit ? onLineMenu : undefined}
        />
      </div>

      {/*
       * What was left out, said only when something was.
       *
       * The explorer's `15,000 more here than this shows` is the register: a
       * number and a short sentence, in a strip that does not move the content.
       * A container that drew a quarter of a file with nothing saying so would be
       * lying about the disk in the one place somebody is looking to find out
       * what is on it.
       *
       * There is no press beside it and there should not be: "show the rest"
       * would be a request for forty megabytes to draw twelve lines from. A file
       * that large is one to search rather than to read.
       */}
      {said || !text.whole || text.markLost ? (
        <p data-testid="notice" className="min-w-0 shrink-0 border-t px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          {said
            ? said
            : text.markLost
              ? target
                ? 'That line is not in what this shows of the file at this commit.'
                : 'The selection is outside what this shows.'
              : `${bytes(text.read)} of ${bytes(text.size)}, from line ${text.firstLine.toLocaleString()}.`}
        </p>
      ) : null}
      {menu ? (
        <div
          data-testid="line-menu"
          role="menu"
          className="fixed z-10 rounded-md border bg-background p-0.5 shadow-md"
          style={{ left: menu.x, top: menu.y }}
        >
          <Button size="container" variant="ghost" role="menuitem" onClick={() => void comment(menu.from, menu.to)}>
            {menu.from === menu.to ? 'Comment on this line' : `Comment on lines ${menu.from}–${menu.to}`}
          </Button>
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {/* Nothing answered the last read. Try again asks for the same file again. */}
      {cover === 'down' ? <Cover state="down" name="Source" onRetry={retry} /> : null}
      {/* Kept mounted under the cover, so the file that was on screen and where it was scrolled
          to are still there when the server answers again. */}
      <div hidden={cover === 'down'} className="h-full min-w-0">
        {screen}
      </div>
    </>
  )
}
