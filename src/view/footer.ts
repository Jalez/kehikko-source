import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

/**
 * Source's footer, in a host that draws one (`kehikot.footer`, protocol 2.38.0): where you are in
 * what the canvas points at, and the two presses that act on it. It is the strip the page drew
 * along the top of the code (the file's name, "private", Comment, selection) and the notice along
 * its bottom (what was left out, or what the host said to a comment), in one row the host draws.
 * Source has no header: nothing in it is a choice about how the module is set up.
 *
 * - the file: its path in the project, or the change and side it was read from; the whole of it in
 *   the tooltip;
 * - `private` beside it, for a file agents are refused;
 * - the notice, when there is one;
 * - Comment on the picked lines (a change's file only, lines picked), and Selection, which scrolls
 *   back to the marked range: both act on what the row says.
 *
 * Pure: the page declares it only when the greeting said the host draws it.
 */
export const FOOT = { FILE: 'file', PRIVATE: 'private', NOTICE: 'notice', COMMENT: 'comment', TO_MARK: 'to-mark' } as const

export interface FooterState {
  /** What the row calls the file: its project-relative path, or the change's header. */
  name: string
  /** The whole of it, for the tooltip. */
  whole: string
  hidden: boolean
  /** What was left out, or what the host said, or null. */
  notice: string | null
  /** The notice is the host refusing a comment, not a fact about the file. */
  noticeIsTrouble: boolean
  /** Lines picked in a change's file, so Comment can be offered; else null. */
  lines: { from: number; to: number } | null
  /** There is a marked range to scroll back to. */
  marked: boolean
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems(state: FooterState): FooterItem[] {
  const items: unknown[] = []
  if (state.name) {
    const tip = state.hidden ? `${state.whole}\nAgents cannot read this file.` : state.whole
    items.push({ kind: 'text', id: FOOT.FILE, text: cut(state.name, LIMITS.FOOTER_TEXT), ...(tip ? { tooltip: cut(tip, LIMITS.FOOTER_TOOLTIP) } : {}) })
  }
  if (state.hidden) items.push({ kind: 'text', id: FOOT.PRIVATE, text: 'private', tooltip: 'Agents cannot read this file.', optional: true })
  if (state.notice) {
    items.push({
      kind: 'text',
      id: FOOT.NOTICE,
      text: cut(state.notice, LIMITS.FOOTER_TEXT),
      level: state.noticeIsTrouble ? 'warn' : 'normal',
      align: 'center',
      optional: !state.noticeIsTrouble,
      tooltip: cut(state.notice, LIMITS.FOOTER_TOOLTIP),
    })
  }
  if (state.lines) {
    items.push({
      kind: 'run',
      id: FOOT.COMMENT,
      label: state.lines.from === state.lines.to ? 'Comment on this line' : `Comment on lines ${state.lines.from}–${state.lines.to}`,
      icon: 'pencil',
      align: 'end',
      tooltip: 'Ask for a review comment on the picked lines',
    })
  }
  if (state.marked) items.push({ kind: 'run', id: FOOT.TO_MARK, label: 'Selection', align: 'end', optional: true, tooltip: 'Scroll back to the selection' })
  return footerItemsSchema.parse(items)
}
