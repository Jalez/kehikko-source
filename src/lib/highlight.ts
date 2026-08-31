import dart from 'highlight.js/lib/languages/dart'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import elixir from 'highlight.js/lib/languages/elixir'
import haskell from 'highlight.js/lib/languages/haskell'
import latex from 'highlight.js/lib/languages/latex'
import scala from 'highlight.js/lib/languages/scala'
import vim from 'highlight.js/lib/languages/vim'
import { common, createLowlight } from 'lowlight'

/**
 * Syntax colours, and the range a passage carries, as one list of spans.
 *
 * ## Which highlighter, and why not the accurate one
 *
 * Shiki is the best of them and it is the wrong choice here. It is a real
 * TextMate grammar engine with a real theme system, which is why it is right in
 * a documentation site: it produces exactly what VS Code produces. What it costs
 * is asynchrony and weight — grammars and themes are loaded, the API is
 * promise-shaped, and the WASM regex engine is megabytes. In a container that is
 * often 220 pixels wide, on a canvas with a dozen other frames, the first paint
 * would be a blank box waiting on a network of imports, and the difference the
 * person could see afterwards is whether a nested template literal inside a
 * regular expression is coloured correctly.
 *
 * highlight.js is synchronous, one dependency, and correct for everything short
 * of that. Prism was the other candidate and is lighter still; it loses on the
 * thing that decided this, which is below.
 *
 * ## lowlight rather than highlight.js directly, and this is the load-bearing
 * choice
 *
 * `hljs.highlight()` returns an HTML STRING. Every one of these libraries does,
 * and it is the reason this file exists. This module has to do something none of
 * their examples do: overlay a byte range on top of the colouring — highlighting
 * a passage's selection across, and inside, and partway through the spans the
 * grammar produced. With an HTML string the options are to parse it back, to
 * inject markers into the source text before highlighting (which corrupts the
 * grammar), or to `dangerouslySetInnerHTML` and give up on the overlay. All
 * three are bad, and the third is the one that gets shipped by accident.
 *
 * lowlight is highlight.js with the HTML step removed: it returns a tree. So
 * this file walks the tree, flattens it into spans with character offsets that
 * are known rather than inferred, and cuts them at the range's edges and at line
 * breaks. Nothing is ever serialised to HTML, nothing is ever parsed back, and
 * React builds elements out of plain data. That is also why there is no
 * `dangerouslySetInnerHTML` anywhere in this repository, in a program whose
 * entire job is to display files it did not write.
 *
 * ## The languages
 *
 * `common` is highlight.js's own set of about thirty-seven, which covers nearly
 * everything this workspace opens. Seven are added by hand: the ones
 * `file/shape.ts` names that `common` leaves out. LaTeX is the one that matters
 * — the thesis this whole workspace was built around is `.tex`, and a viewer
 * that showed it as plain text would be missing its main document.
 *
 * `all` was the alternative and is a hundred and ninety grammars, most of a
 * megabyte, parsed in every container. Seven imports is the cost of not doing
 * that, and the failure when a grammar is missing is visible and harmless: the
 * file draws plain.
 */
const lowlight = createLowlight(common)
lowlight.register({ dart, dockerfile, elixir, haskell, latex, scala, vim })

/** A run of characters that share a colour and a highlight state. */
export interface Span {
  text: string
  /** The highlight.js class names for it, space-joined, or null for "the ordinary colour". */
  cls: string | null
  /** Whether the passage's range covers this run. */
  marked: boolean
}

/** One line of the file, already cut at the range's edges. */
export interface Line {
  /** Its number in the FILE, not in what is on screen. */
  number: number
  spans: Span[]
  /** Whether any of the passage's range falls on this line. */
  marked: boolean
}

/**
 * The whole thing: text in, lines out.
 *
 * One function rather than three, because the three steps share offsets and the
 * offsets are the only part that can be wrong in a way nobody notices. Cutting
 * spans at newlines and cutting them at the range's edges are the same
 * operation over the same coordinate system, and doing them in two passes over
 * two representations is how a highlight ends up one character off on lines
 * containing an emoji.
 *
 * `mark` is in CHARACTERS, converted from the passage's bytes by the server —
 * see the essay on `place` in `file/read.ts` for why that conversion cannot
 * happen on this side.
 */
export function lines(
  text: string,
  language: string | null,
  firstLine: number,
  mark: { from: number; to: number } | null,
): Line[] {
  const out: Line[] = []
  let current: Span[] = []
  let marked = false
  let number = firstLine

  const finish = () => {
    out.push({ number, spans: current, marked })
    current = []
    marked = false
    number += 1
  }

  let at = 0
  for (const piece of flatten(text, language)) {
    /* Split on the newline first, because a line is the unit everything else is
       expressed in — a span that crossed one would have to be cut anyway, and
       cutting it here means the range arithmetic below never has to think about
       lines at all. */
    const parts = piece.text.split('\n')
    for (let i = 0; i < parts.length; i += 1) {
      /* The newline that separated this part from the one before it. One
         convention, applied once per break: the offset for a `\n` is added
         AFTER the part it follows, and the line is closed BEFORE the part it
         precedes. Two conventions is how a highlight ends up one character out
         on every line after the first. */
      if (i > 0) finish()
      const part = parts[i]!
      if (part) {
        for (const cut of slice(part, at, mark)) {
          current.push({ text: cut.text, cls: piece.cls, marked: cut.marked })
          if (cut.marked) marked = true
        }
        at += part.length
      }
      if (i < parts.length - 1) at += 1
    }
  }
  finish()
  return out
}

/**
 * One span, cut into the parts that are inside the range and the parts that are
 * not.
 *
 * At most three pieces, and usually one. Written as an explicit list rather than
 * with two `slice` calls and a filter so that a zero-length piece is never
 * produced: an empty span renders as nothing and counts as something, which is
 * how a `key` collision appears in a list that looks fine.
 */
function slice(text: string, at: number, mark: { from: number; to: number } | null): { text: string; marked: boolean }[] {
  if (!mark) return [{ text, marked: false }]
  const end = at + text.length
  if (mark.to <= at || mark.from >= end) return [{ text, marked: false }]

  const from = Math.max(mark.from - at, 0)
  const to = Math.min(mark.to - at, text.length)
  const parts: { text: string; marked: boolean }[] = []
  if (from > 0) parts.push({ text: text.slice(0, from), marked: false })
  if (to > from) parts.push({ text: text.slice(from, to), marked: true })
  if (to < text.length) parts.push({ text: text.slice(to), marked: false })
  return parts
}

/**
 * The grammar's tree, flattened into a list of coloured runs.
 *
 * Class names ACCUMULATE down the tree rather than being taken from the nearest
 * element, because highlight.js nests: a `hljs-string` inside a `hljs-meta` is
 * both, and several grammars rely on the pair to distinguish, say, a string in a
 * preprocessor line from a string in code. Taking only the innermost throws away
 * the distinction the grammar went to the trouble of expressing.
 *
 * An unregistered language is not an error and is not a fallback to
 * auto-detection — see the essay on `tongue` in `file/shape.ts`. It is one
 * uncoloured run, which is exactly what a file this app has no grammar for
 * should look like.
 */
function flatten(text: string, language: string | null): { text: string; cls: string | null }[] {
  if (!language || !lowlight.registered(language)) return [{ text, cls: null }]

  let tree
  try {
    tree = lowlight.highlight(language, text)
  } catch {
    /* A grammar that throws on a particular file is a bug in highlight.js and
       not a reason for this container to show nothing. The file draws plain. */
    return [{ text, cls: null }]
  }

  const out: { text: string; cls: string | null }[] = []
  walk(tree.children as Node[], null, out)
  return out
}

/** As much of hast as this file touches. Declared rather than imported: three fields. */
type Node =
  | { type: 'text'; value: string }
  | { type: 'element'; properties?: { className?: unknown }; children?: Node[] }
  | { type: string }

function walk(nodes: Node[], cls: string | null, out: { text: string; cls: string | null }[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      const value = (node as { value: string }).value
      if (value) out.push({ text: value, cls })
      continue
    }
    if (node.type !== 'element') continue
    const element = node as { properties?: { className?: unknown }; children?: Node[] }
    const own = Array.isArray(element.properties?.className)
      ? (element.properties.className as unknown[]).filter((one) => typeof one === 'string').join(' ')
      : null
    walk(element.children ?? [], own ? (cls ? `${cls} ${own}` : own) : cls, out)
  }
}
