import { useEffect, useMemo, useRef, type Ref } from 'react'

import { lines as split, type Line } from '@/lib/highlight.ts'
import type { Room } from '@/view/room.ts'

/**
 * The file, drawn.
 *
 * ## Wrapping, and the virtualization this module therefore cannot have
 *
 * The container is routinely 220 pixels wide and the thing in it is lines of
 * code whose length nobody chose. There are three ways that can go and only one
 * of them is allowed here.
 *
 * *Truncate* is out. The end of a line of code is not decoration; a viewer that
 * hid it would be lying about the file in the one place somebody is looking to
 * find out what it says.
 *
 * *Scroll sideways* is out, because this workspace's standing rule is that
 * nothing scrolls horizontally, and because at this width a horizontal scrollbar
 * means reading every line in two gestures.
 *
 * So lines *wrap*, which is right for a narrow column and costs one thing: lines
 * are no longer a fixed height, and a virtualized list cannot have that. The
 * sibling module next door virtualizes four thousand rows because its rows are
 * 22 pixels each, always; here a single line can be one row or forty depending on
 * the width of a container somebody is dragging. Measuring every line to feed a
 * virtualizer would mean laying out the whole file to decide what not to lay out.
 *
 * The bound is therefore on the DATA rather than on the DOM: `MAX_LINES` in
 * `file/shape.ts` caps what the server sends at four thousand lines, and four
 * thousand simple elements render in well under a frame. Which is the trade
 * stated plainly — a cap that is visible and said out loud, instead of a
 * virtualizer that would have to be fought at every width.
 *
 * ## The gutter is `sticky`, not a column
 *
 * A grid with a numbers column and a code column is the obvious build and it
 * breaks on the one case that matters: a wrapped line's number would sit beside
 * the first visual row and leave the other nine rows unnumbered but indented,
 * which reads as nine unnumbered lines rather than as one long one. So the number
 * is an inline block that does not wrap, `select: none` so it never lands in a
 * copied selection, and the code beside it is what wraps. A wrapped line looks
 * like one numbered line with a hanging indent, which is what it is.
 */

/** The height of one unwrapped line, dense and comfortable, in pixels. */
export const LINE_HEIGHT = { dense: 15, roomy: 18 }

export interface CodeProps {
  text: string
  language: string | null
  firstLine: number
  mark: { from: number; to: number } | null
  room: Room
}

export function Code({ text, language, firstLine, mark, room }: CodeProps) {
  /*
   * Highlighting is memoized on the four things that change it and on nothing
   * else.
   *
   * It is the most expensive thing this page does — a grammar over a quarter of
   * a megabyte — and it is synchronous, so a re-run on an unrelated render is a
   * dropped frame the person sees while scrolling. `room` is deliberately not a
   * key: how wide the container is changes how the lines are DRAWN and not what
   * they say, and re-tokenising a file because somebody dragged an edge is the
   * exact mistake this memo exists to prevent.
   */
  const rows = useMemo(() => split(text, language, firstLine, mark), [text, language, firstLine, mark])

  /*
   * The first marked line, scrolled to when it changes.
   *
   * `block: 'center'` rather than `'nearest'`, and the difference is the whole
   * point of the behaviour: a passage brought to the very bottom edge of a
   * 300-pixel container is technically in view and useless, because there is
   * nothing after it to read. Centring costs nothing when the file is short —
   * the browser will not scroll past the end — and is the difference between
   * "it is on screen" and "you can read around it".
   *
   * Not smooth. A smooth scroll on a container that just replaced its contents
   * animates from a position that belonged to a different file, which reads as
   * the wrong thing being shown and then corrected.
   */
  const marked = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [text, mark])

  const leading = room.dense ? LINE_HEIGHT.dense : LINE_HEIGHT.roomy
  let first = true

  return (
    <div
      data-testid="code"
      className="min-w-0 font-mono text-[0.6875rem] @sm/container:text-xs"
      style={{ lineHeight: `${leading}px` }}
    >
      {rows.map((row) => {
        const anchor = row.marked && first
        if (anchor) first = false
        return (
          <Row
            key={row.number}
            row={row}
            gutter={room.numbers ? room.gutter : 0}
            ref={anchor ? marked : null}
          />
        )
      })}
    </div>
  )
}

function Row({ row, gutter, ref }: { row: Line; gutter: number; ref: Ref<HTMLDivElement> | null }) {
  return (
    <div
      ref={ref}
      data-testid="line"
      data-line={row.number}
      data-marked={row.marked ? 'yes' : undefined}
      className="min-w-0"
    >
      {gutter ? (
        <span
          aria-hidden
          className="inline-block shrink-0 select-none pr-2 text-right tabular-nums text-muted-foreground/70"
          style={{ width: `${gutter + 1}ch` }}
        >
          {row.number}
        </span>
      ) : null}
      {/*
        `whitespace-pre-wrap` keeps every space and tab that is in the file, and
        `overflow-wrap: anywhere` is what actually prevents the horizontal
        overflow: the more common `break-word` only breaks a word that could not
        fit on a line of ITS OWN, so a hundred-thousand-character token — which
        is what a minified bundle is — sails straight past the container edge.
        The distinction is the entire difference between this rule working and
        this rule appearing to work.

        Spelled as an arbitrary property rather than a named utility, because the
        utility for it has changed name across Tailwind versions and a class that
        silently does not exist produces exactly the overflow it was added to
        prevent — with nothing in the markup to say so.
      */}
      <code className="whitespace-pre-wrap align-top [overflow-wrap:anywhere]">
        {row.spans.length ? (
          row.spans.map((span, i) => (
            <span
              key={i}
              className={
                span.marked
                  ? span.cls
                    ? `${span.cls} bg-mark rounded-[1px]`
                    : 'bg-mark rounded-[1px]'
                  : (span.cls ?? undefined)
              }
            >
              {span.text}
            </span>
          ))
        ) : (
          /* An empty line still has to occupy one. A `<br>` would be a second
             kind of thing in this list; a zero-width space keeps every row the
             same shape and the same height. */
          <>{'​'}</>
        )}
      </code>
    </div>
  )
}

/*
 * The index key above, which is correct here and would not be in most lists.
 *
 * A span has no identity of its own — it is a slice of a line, produced fresh
 * every time the line is tokenised, and two spans with the same text and class
 * are genuinely interchangeable. The failure an index key causes is state landing
 * on the wrong element after a reorder, and these elements hold no state and are
 * never reordered: a line is rebuilt wholesale or not at all. The alternative is
 * a synthetic id per span, which is bookkeeping for a list that is thrown away
 * on every change.
 */
