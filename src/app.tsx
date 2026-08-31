import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { bytes } from '../file/shape.ts'
import { ID } from '../manifest.ts'

import { Button } from '@/components/ui/button.tsx'
import { useSource } from '@/use-source.ts'
import { Code } from '@/view/code.tsx'
import { label, room as measure } from '@/view/room.ts'
import { Binary, EmptyFile, Folder, Listening, NoPassage, NoProject, Trouble } from '@/view/screens.tsx'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'

/**
 * The tallest frame this container will ever ask a host for, and the strips
 * around the code that are not code.
 *
 * Every sibling module that holds a document measures its content and asks for
 * exactly that height. A viewer cannot: four thousand lines is eighty thousand
 * pixels, and asking a host for that on behalf of a container in the corner of a
 * canvas is absurd. So it asks for what it would like up to this, and scrolls
 * internally past it — the arrangement a sidebar has, and the reason
 * `page/document.ts` makes the body a fixed-height non-scrolling box.
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
 * anywhere: `manifest.ts` argues the case and `wire/use-roadmap.ts` has no
 * method to call. This is the purest consumer on the canvas and the absence is
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

  const { where, projectPath, passage, resize } = useRoadmap(ID, onGoto)
  const { seen, trouble } = useSource(projectPath, passage)

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

  const text = seen?.kind === 'text' ? seen : null
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

  if (where === 'listening') return <Listening />
  if (!projectPath) return <NoProject unhosted={where === 'unhosted'} />
  if (!passage) return <NoPassage />
  if (trouble) return <Trouble said={trouble} />
  if (seen?.kind === 'folder') return <Folder />
  if (seen?.kind === 'binary') return <Binary size={seen.size} looks={seen.looks} />
  /* Still reading: no screen at all rather than a spinner. It is one open and
     one read and it is done in single-digit milliseconds for the files this
     module is for; anything drawn here is a flash the person reads as a fault.
     The previous file stays on screen until the next one is ready, which is the
     behaviour every editor has and the reason `useSource` keeps `seen` until it
     has something to replace it with. */
  if (!text) return <div className="p-3" data-testid="reading" />
  if (!text.text.length) return <EmptyFile />

  const shown = label(text.path, projectPath, room.name)

  return (
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
          <span data-testid="name" title={text.path} className="min-w-0 flex-1 truncate text-[0.7rem] font-medium">
            {shown}
          </span>
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
          {text.mark ? (
            <Button
              size="container"
              variant="ghost"
              data-testid="to-mark"
              onClick={() => scroller.current?.querySelector('[data-marked]')?.scrollIntoView({ block: 'center' })}
            >
              selection
            </Button>
          ) : null}
        </div>
      ) : null}

      <div ref={scroller} data-testid="scroller" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-1">
        <Code text={text.text} language={text.language} firstLine={text.firstLine} mark={text.mark} room={room} />
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
      {!text.whole || text.markLost ? (
        <p data-testid="notice" className="min-w-0 shrink-0 border-t px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          {text.markLost
            ? 'The selection is outside what this shows.'
            : `${bytes(text.read)} of ${bytes(text.size)}, from line ${text.firstLine.toLocaleString()}.`}
        </p>
      ) : null}
    </div>
  )
}
