import { FOCUS_WHERE, fileInFocus, paperFileOf, pickedFiles, pickedParts, type EpicPart } from 'kehikot-module-protocol'

/**
 * What this container says about the picked parts of the epic — or nothing,
 * which is the usual answer. It is never a row: the sentence is the tooltip of
 * the file's name, and a file outside the pick has its name set back.
 *
 * ## Why a one-file viewer says anything about parts at all
 *
 * This module shows the file the canvas is pointed at and has no list, which
 * is why it used to declare itself `partless`. That was true of what it HOLDS
 * and false about what a person sees. Parts are picked in the host's bar and
 * every container beside this one narrows to them; this one went on showing
 * one file with nothing saying how that file stood to the pick. Two parts
 * ticked, two files in front of the person everywhere else, and one of them
 * here, looking exactly as it does when it is the whole answer. A passage
 * pointed into a file no picked part owns looked the same again.
 *
 * So it says which of those it is, where it costs no room, and does nothing else. It still shows the
 * pointed file — the passage is the only thing that chooses it — and there is
 * still no press: a row of the other files to open would be the file picker
 * `app.tsx` refuses, a second answer to "which file are we looking at". The
 * files are named so a person knows what to press next door.
 *
 * ## The three cases
 *
 *  - **nothing picked**, or the pointed file is the one file the picked parts
 *    own: nothing is said. That is the resting state and it stays quiet.
 *  - **the pointed file is outside the picked parts** (or is no file of the
 *    paper): said, with the parts named. The rule is the protocol's
 *    `fileInFocus`, the same one every neighbour narrows by.
 *  - **the picked parts own several files** and this is one of them: said,
 *    with the others named, a few of them and then a count.
 */
export interface FocusLine {
  /** `outside` when no picked part owns the file shown; `one-of` when they own it and others too. */
  kind: 'outside' | 'one-of'
  /** The sentence, short. */
  said: string
  /** The same with every file named, and where parts are picked: what the tooltip says. */
  title: string
}

/** How many of the other files are named in the line itself before it counts the rest. */
export const OTHERS_NAMED = 2

export function focusLine(parts: readonly EpicPart[], path: string | null, epic: string | null): FocusLine | null {
  const picked = pickedParts(parts)
  if (picked.length === 0 || !path) return null
  const where = `the picked part${picked.length === 1 ? '' : 's'} (${picked.map((part) => part.heading || part.id).join(', ')})`
  const owned = pickedFiles(parts)

  if (!fileInFocus(parts, path, epic)) {
    const said = `This file is outside ${where}.`
    const theirs = owned.length ? ` ${owned.length === 1 ? 'Its file is' : 'Their files are'} ${owned.join(', ')}.` : ''
    return { kind: 'outside', said, title: `${said}${theirs} It is shown because the canvas points at it. ${FOCUS_WHERE}` }
  }

  const open = paperFileOf(path, epic)
  const others = owned.filter((file) => file !== open)
  if (others.length === 0) return null
  const head = `One of ${owned.length} files in ${where}.`
  const named = others.slice(0, OTHERS_NAMED).join(', ')
  const more = others.length - OTHERS_NAMED
  const rest =
    others.length === 1 ? `The other is ${named}.` : more > 0 ? `The others: ${named} and ${more} more.` : `The others: ${named}.`
  return {
    kind: 'one-of',
    said: `${head} ${rest}`,
    title: `${head} The other${others.length === 1 ? ' is' : 's:'} ${others.join(', ')}. This container shows the one the canvas points at. ${FOCUS_WHERE}`,
  }
}
