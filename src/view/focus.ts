import type { Anchor } from 'kehikot-module-protocol'

/**
 * This container under a pick of the epic's parts.
 *
 * ## One rule, and it is not this file's
 *
 * This module shows one file: the one the canvas is pointed at. That file is
 * its one item, about itself (`anchorOf`), and the page narrows it through the
 * protocol's `useFocus(context).narrow` like every list anywhere.
 *
 * ## The file is in hand, so a pick takes nothing from this page
 *
 * A passage is somebody pointing: they pressed a file, selected a sentence,
 * opened a note. What they pointed at is in their hands, and the rule keeps
 * what is in hand (`inHand`) whatever is picked. So the file is drawn as it
 * always is, in the picked parts or not.
 *
 * ## And nothing is said about it
 *
 * This page used to set the file's name back when no picked part had the file,
 * and to say in the name's tooltip how the file stood to the pick, with the
 * other files named. Both are gone. While anything is drawn nothing about the
 * pick is drawn — the host's bar says what is picked — and this page always
 * draws something. The one sentence the rule has, for a view a pick left
 * empty, is the protocol's and is drawn only if the rule ever hands it back.
 */

/** What the one item is called in the protocol's sentence for an empty view. */
export const NOUN = 'file'

/** What ties the file on screen to a part: itself, by its path. THE anchor function of this module. */
export const anchorOf = (file: { path: string }): Anchor => ({ file: file.path })

/**
 * Whether the file on screen is in a person's hands: the canvas is pointing.
 *
 * Asked of the passage and not of the path, because while the next file is
 * being read the previous one is still drawn, and it is still what the person
 * is looking at. With no passage nothing is drawn at all.
 */
export const inHand = (passage: { path: string } | null | undefined): boolean => Boolean(passage)
