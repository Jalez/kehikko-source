import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { FIND_MARK_ATTRIBUTE, pageFind } from 'kehikot-module-protocol/client'

import { Code } from '../src/view/code.tsx'
import { room } from '../src/view/room.ts'

/**
 * Find (protocol 2.69.0). Every line of the file is in the document (`code.tsx` says why it is not
 * virtualized), so the host's find bar is answered by the protocol client's own search of the page.
 * The line numbers are skipped: they are not the file's text. This holds that the search marks,
 * counts, moves and clears on the file this page renders. Marked with `<mark>` here (the test
 * document has no `CSS.highlights`), which also proves the marks come back out of React's DOM
 * without a trace.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const PANE = room({ width: 460, height: 360 }, 3)
const TEXT = 'const a = 1\nconst b = 2\nlet c = a + b\nconst d = 12'

const file = () => render(<Code text={TEXT} language="typescript" firstLine={1} mark={null} room={PANE} />).container
const marks = (root: Element) => [...root.querySelectorAll(`mark[${FIND_MARK_ATTRIBUTE}]`)]
const words = { caseSensitive: false, wholeWord: true }

describe('find in the file', () => {
  test('marks and counts the matches in the code, and moves between them', () => {
    const root = file()
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    expect(search.run('const', words, 'first')).toEqual({ total: 3, current: 1 })
    expect(marks(root)).toHaveLength(3)
    expect(search.run('const', words, 'next')).toEqual({ total: 3, current: 2 })
    expect(search.run('const', words, 'prev')).toEqual({ total: 3, current: 1 })
    expect(search.run('const', words, 'prev')).toEqual({ total: 3, current: 3 })
    expect(root.querySelectorAll('[data-current]')).toHaveLength(1)
    search.close()
  })

  test('the line numbers are not searched', () => {
    const root = file()
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    /* `2` is printed in the file once, as a value; line 2's number is not the file's. */
    expect(search.run('2', words, 'first')).toEqual({ total: 1, current: 1 })
    search.close()
  })

  test('close clears every mark and leaves the file as React drew it', () => {
    const root = file()
    const before = root.innerHTML
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    search.run('const', words, 'first')
    search.close()
    expect(marks(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(before)
  })
})
