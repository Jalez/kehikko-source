import { describe, expect, test } from 'bun:test'
import { emptySaid, narrowToFocus, type EpicPart } from 'kehikot-module-protocol'

import { MANIFEST } from '../manifest.ts'
import { NOUN, anchorOf, inHand } from '../src/view/focus.ts'

/**
 * The one file this page shows, under a pick of the epic's parts.
 *
 * The rule is the protocol's. What is this module's is what the file is tied
 * to, and that it is in hand while the canvas points — which is why a pick
 * takes nothing from this page and nothing is said about one.
 */

const EPIC = 'thesis'
const PROJECT = '/tmp/p'
const DIR = `${PROJECT}/.kehikot/paper/${EPIC}`
const METHODS = { path: `${DIR}/chapters/3_methods.tex` }
const RESULTS = { path: `${DIR}/chapters/4_results.tex` }
const CODE = { path: `${PROJECT}/src/sim/run.ts` }

/** Parts as a host with documents sends them, and as one from before documents does. */
const withDocuments = (picked: boolean): EpicPart[] => [
  { id: 'methods', heading: 'Methods', refs: [], picked, documents: ['.kehikot/paper/thesis/chapters/3_methods.tex', 'src/sim/run.ts'], files: ['chapters/3_methods.tex'] },
]
const withFiles = (picked: boolean): EpicPart[] => [{ id: 'methods', heading: 'Methods', refs: [], picked, files: ['chapters/3_methods.tex'] }]

const drawn = (parts: EpicPart[], file: { path: string }, passage: { path: string } | null) =>
  narrowToFocus(parts, [file], anchorOf, { epic: EPIC, projectPath: PROJECT, keep: () => inHand(passage) }).shown.length === 1

describe('anchorOf', () => {
  test('the file on screen is about itself, by its path', () => {
    expect(anchorOf(METHODS)).toEqual({ file: METHODS.path })
  })
})

describe('what the rule says of the file, before anything is kept', () => {
  test('a context that carries documents: a file a picked part lists is in it, wherever in the project it is', () => {
    expect(drawn(withDocuments(true), METHODS, null)).toBe(true)
    expect(drawn(withDocuments(true), CODE, null)).toBe(true)
    expect(drawn(withDocuments(true), RESULTS, null)).toBe(false)
  })

  test('a context that carries only files: the same answer for the files it can name', () => {
    expect(drawn(withFiles(true), METHODS, null)).toBe(true)
    expect(drawn(withFiles(true), RESULTS, null)).toBe(false)
    expect(drawn(withFiles(true), CODE, null)).toBe(false)
  })

  test('nothing picked is every file', () => {
    for (const parts of [withDocuments(false), withFiles(false), []]) expect(drawn(parts, RESULTS, null)).toBe(true)
  })
})

describe('keep: the file the canvas points at is in hand', () => {
  test('it is drawn though no picked part lists it, under either shape of context', () => {
    expect(drawn(withDocuments(true), RESULTS, RESULTS)).toBe(true)
    expect(drawn(withFiles(true), CODE, CODE)).toBe(true)
  })

  test('the file still on screen while the next is being read is in hand too', () => {
    /* The passage has moved to METHODS; RESULTS is what is drawn until it has been read. */
    expect(drawn(withFiles(true), RESULTS, METHODS)).toBe(true)
  })

  test('in hand is the canvas pointing, and nothing else', () => {
    expect(inHand(METHODS)).toBe(true)
    expect(inHand(null)).toBe(false)
    expect(inHand(undefined)).toBe(false)
  })
})

describe('the one sentence', () => {
  test('is the protocol’s, with this module’s noun', () => {
    expect(emptySaid(withFiles(true), NOUN)).toBe('No file is in the picked part.')
  })
})

describe('what the manifest says about parts', () => {
  test('it reacts to them, and no longer says it has nothing to do with them', () => {
    expect(MANIFEST.reacts).toEqual(['passage', 'parts'])
    expect(MANIFEST.partless).toBeUndefined()
    /* Still the purest consumer: following the pick asks the host for nothing. */
    expect(MANIFEST.declares.uses).toEqual([])
  })
})
