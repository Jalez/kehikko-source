/**
 * What fits, decided from two numbers and nothing else.
 *
 * ## Why this is a pure function with its own test file
 *
 * Because every decision in it is invisible until the container is small, and
 * small is this module's NORMAL size. A viewer at 900 pixels wide is correct
 * under every rule in here; the bugs live at 220, where a five-character line
 * number gutter is a fifth of the reading width and a header, a path, a
 * truncation notice and a scrollbar between them can leave four lines of the
 * file on screen.
 *
 * Deciding it in a function that touches no DOM means the cases can be written
 * down: `test/room.test.ts` runs the sizes this workspace actually uses.
 *
 * ## Width comes from a container query, height from a ResizeObserver, and this
 * function takes both as numbers
 *
 * The width decisions could have been `@sm/container:` classes and are not,
 * because they are the same KIND of decision as the height ones and splitting
 * them across two mechanisms means two places to look when the layout is wrong.
 * The container query is still what the CSS uses for spacing and type size; what
 * is decided here is what EXISTS, which is not something a class can express —
 * a gutter hidden with `display: none` is still in the DOM being measured.
 *
 * ## The gutter, which is the one that surprised
 *
 * Line numbers look like an obvious thing to always have. They are not, at this
 * width: at 220 pixels the text column is about 200, a four-digit gutter plus its
 * gap is 40, and losing a fifth of every wrapped line to it costs more lines of
 * reading than the numbers save. They come back at 260, which is where a
 * container stops being a sliver and starts being a pane.
 *
 * The width of the gutter is computed from the LAST line number shown rather
 * than from the number of lines, and that is not the same thing when the window
 * has moved: a file opened at line 12,000 has three lines on screen and needs
 * five digits. Sizing it by the count would produce a gutter that shifts by two
 * characters as you scroll, which reads as the text moving.
 */

/** How much room there is, in CSS pixels. */
export interface Size {
  width: number
  height: number
}

/** What to draw, given that. */
export interface Room {
  /** Whether the line-number gutter exists at all. */
  numbers: boolean
  /** How many characters wide it should be. Zero when there is none. */
  gutter: number
  /** What the header says about which file this is. */
  name: 'none' | 'file' | 'path'
  /** Whether the header exists at all. */
  header: boolean
  /**
   * Tighter leading and a smaller header.
   *
   * A height decision, and the reason this function takes a height at all. A
   * container 200 pixels tall shows twelve lines at comfortable leading and
   * sixteen at tight, and four more lines is the difference between seeing a
   * function and scrolling to find out what is in it. Above that the tightness
   * costs legibility for nothing.
   */
  dense: boolean
}

/**
 * The gutter is hidden below this, in pixels.
 *
 * 260 rather than a round 250 or 300 because the containers this workspace
 * actually uses cluster at 220 and 320 — the number only has to fall between
 * them, and putting it near the middle means neither is decided by a pixel of
 * scrollbar.
 */
export const NUMBERS_FROM = 260

/**
 * The full relative path replaces the bare filename at this width.
 *
 * `chapters/agents.tex` is forty per cent more useful than `agents.tex` and
 * costs about eighteen characters. Below 380 those eighteen characters get
 * truncated to an ellipsis in the middle, at which point the path is neither
 * readable nor short, and the filename alone is strictly better.
 */
export const PATH_FROM = 380

/** Below this height, the header's strip is more than the view can spare. */
export const HEADER_FROM = 120

/** Below this height, the leading tightens. */
export const DENSE_BELOW = 240

export function room(size: Size, lastLine: number): Room {
  const numbers = size.width >= NUMBERS_FROM
  return {
    numbers,
    gutter: numbers ? Math.max(2, String(Math.max(1, lastLine)).length) : 0,
    header: size.height >= HEADER_FROM,
    name: size.height < HEADER_FROM ? 'none' : size.width >= PATH_FROM ? 'path' : 'file',
    dense: size.height < DENSE_BELOW,
  }
}

/**
 * What to call the file, given how much room the header has.
 *
 * Relative to the project, because the project's own directory is printed by the
 * host in the container header and repeating it here would spend a third of a
 * narrow strip saying where the canvas already is. A path that is not under the
 * project falls back to its own last segment rather than being drawn absolute:
 * that only happens when a passage names something outside the root, which this
 * app refuses to open anyway, so the header is never the place that finds out.
 */
export function label(path: string, projectPath: string | null, name: Room['name']): string {
  const last = path.slice(path.lastIndexOf('/') + 1)
  if (name === 'none') return ''
  if (name === 'file') return last
  if (!projectPath) return last
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  return path.startsWith(root) ? path.slice(root.length) : last
}
