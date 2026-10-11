import { describe, expect, test } from 'bun:test'
import { FOCUS_WHERE, partsSchema, type EpicPart } from 'kehikot-module-protocol'

import { MANIFEST } from '../manifest.ts'
import { focusLine } from '../src/view/focus.ts'

/**
 * What this container says about the picked parts, as the words on screen.
 *
 * The fault these are here for was a silence: two parts ticked, two files in
 * front of the person in every other container, and one of them here with
 * nothing to say it was one of two.
 */

const EPIC = 'thesis'
const DIR = `/tmp/p/.kehikot/paper/${EPIC}`
const part = (id: string, heading: string, picked: boolean, files: string[]): EpicPart => ({ id, heading, refs: [], picked, files })
const parts = (...picked: string[]) =>
  partsSchema.parse([
    part('methods', 'Methods', picked.includes('methods'), ['chapters/3_methods.tex']),
    part('results', 'Results', picked.includes('results'), ['chapters/4_results.tex', 'generated/tab.tex', 'generated/quotes.tex', 'generated/more.tex']),
    part('steps', 'Steps', picked.includes('steps'), []),
  ])

describe('the line about the picked parts', () => {
  test('nothing picked says nothing, whatever is shown', () => {
    expect(focusLine(parts(), `${DIR}/chapters/3_methods.tex`, EPIC)).toBeNull()
    expect(focusLine(parts(), '/tmp/p/README.md', EPIC)).toBeNull()
    expect(focusLine([], `${DIR}/main.tex`, EPIC)).toBeNull()
  })

  test('the one file of the one picked part says nothing: it is the whole answer', () => {
    expect(focusLine(parts('methods'), `${DIR}/chapters/3_methods.tex`, EPIC)).toBeNull()
  })

  test('two parts picked and one of their files shown: it says it is one of them, and names the rest', () => {
    const two = part('results', 'Results', true, ['chapters/4_results.tex'])
    const line = focusLine([part('methods', 'Methods', true, ['chapters/3_methods.tex']), two], `${DIR}/chapters/3_methods.tex`, EPIC)!
    expect(line.kind).toBe('one-of')
    expect(line.said).toBe('One of 2 files in the picked parts (Methods, Results). The other is chapters/4_results.tex.')
    expect(line.title).toContain(FOCUS_WHERE)
  })

  test('many others: two are named and the rest counted, and the tooltip names them all', () => {
    const line = focusLine(parts('methods', 'results'), `${DIR}/chapters/4_results.tex`, EPIC)!
    expect(line.said).toBe(
      'One of 5 files in the picked parts (Methods, Results). The others: chapters/3_methods.tex, generated/tab.tex and 2 more.',
    )
    for (const file of ['chapters/3_methods.tex', 'generated/tab.tex', 'generated/quotes.tex', 'generated/more.tex']) expect(line.title).toContain(file)
    expect(line.title).not.toContain('chapters/4_results.tex,')
  })

  test('a file no picked part owns says it is outside them', () => {
    const line = focusLine(parts('methods'), `${DIR}/chapters/4_results.tex`, EPIC)!
    expect(line.kind).toBe('outside')
    expect(line.said).toBe('This file is outside the picked part (Methods).')
    expect(line.title).toContain('Its file is chapters/3_methods.tex.')
    expect(line.title).toContain('shown because the canvas points at it')
  })

  test('a file that is not of the paper at all is outside too, and so is another epic’s paper', () => {
    expect(focusLine(parts('methods'), '/tmp/p/src/app.ts', EPIC)!.said).toBe('This file is outside the picked part (Methods).')
    expect(focusLine(parts('methods'), '/tmp/p/.kehikot/paper/other/chapters/3_methods.tex', EPIC)!.kind).toBe('outside')
  })

  test('picked parts that own no file: whatever is shown is outside them', () => {
    const line = focusLine(parts('steps'), `${DIR}/main.tex`, EPIC)!
    expect(line.said).toBe('This file is outside the picked part (Steps).')
    expect(line.title).not.toContain('Its file is')
  })

  test('a part with no heading is named by its id', () => {
    expect(focusLine([part('methods', '', true, [])], `${DIR}/main.tex`, EPIC)!.said).toBe('This file is outside the picked part (methods).')
  })

  test('the line stays short enough for a narrow container', () => {
    expect(focusLine(parts('methods', 'results'), `${DIR}/chapters/4_results.tex`, EPIC)!.said.length).toBeLessThan(130)
  })
})

describe('what the manifest says about parts', () => {
  test('it reacts to them, and no longer says it has nothing to do with them', () => {
    expect(MANIFEST.reacts).toEqual(['passage', 'parts'])
    expect(MANIFEST.partless).toBeUndefined()
    /* Still the purest consumer: saying a line about the pick asks the host for nothing. */
    expect(MANIFEST.declares.uses).toEqual([])
  })
})
