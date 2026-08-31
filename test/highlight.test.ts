import { describe, expect, test } from 'bun:test'

import { lines } from '../src/lib/highlight.ts'

/**
 * The one piece of arithmetic in this module that nobody can see going wrong.
 *
 * A highlight that is one character out looks like a highlight. It looks exactly
 * like a highlight when the file is code and the range starts at a token
 * boundary, which is most of the time. The only way to know is to write the
 * offsets down, so this file does.
 *
 * `plain(rows)` is the invariant every test here leans on: whatever the spans are
 * cut into, joining them back has to reproduce the file. If that ever fails, the
 * program is not merely mis-colouring — it is displaying something the file does
 * not say.
 */

const plain = (rows: ReturnType<typeof lines>) => rows.map((row) => row.spans.map((s) => s.text).join('')).join('\n')
const marked = (rows: ReturnType<typeof lines>) =>
  rows.flatMap((row) => row.spans.filter((s) => s.marked).map((s) => s.text)).join('')

describe('splitting into lines', () => {
  test('the text survives the round trip, uncoloured', () => {
    const text = 'one\ntwo\nthree'
    expect(plain(lines(text, null, 1, null))).toBe(text)
  })

  test('the text survives the round trip, coloured', () => {
    const text = 'const a = 1\n// a comment\nfunction b() { return "x" }\n'
    expect(plain(lines(text, 'typescript', 1, null))).toBe(text)
  })

  test('line numbers start where the window starts, not at one', () => {
    /* A file opened at byte 12,000,000 numbers its first line as what it really
       is. A viewer that numbered it 1 would invite somebody to quote a line
       number to a colleague, and the number would be wrong. */
    const rows = lines('a\nb\nc', null, 4_012, null)
    expect(rows.map((row) => row.number)).toEqual([4012, 4013, 4014])
  })

  test('an empty line is a line', () => {
    const rows = lines('a\n\nb', null, 1, null)
    expect(rows).toHaveLength(3)
    expect(rows[1]!.spans).toHaveLength(0)
  })

  test('a trailing newline produces the empty line it implies', () => {
    /* The server drops the trailing newline of a complete file before it gets
       here — see `file/read.ts` — so this case only arises for a window that was
       cut. Either way the arithmetic has to be right rather than special. */
    expect(lines('a\n', null, 1, null)).toHaveLength(2)
  })

  test('a comment that spans several lines is coloured on all of them', () => {
    /* The reason the whole file is tokenised at once rather than line by line.
       Per-line highlighting is simpler, is what a virtualized viewer is forced
       into, and gets block comments and template literals wrong — which in this
       workspace is most of every file. */
    const rows = lines('/*\n * one\n */\nconst a = 1', 'typescript', 1, null)
    for (const row of rows.slice(0, 3)) {
      expect(row.spans.some((span) => span.cls?.includes('hljs-comment'))).toBe(true)
    }
  })

  test('nested classes accumulate rather than the innermost winning', () => {
    const rows = lines('#include <stdio.h>\n', 'c', 1, null)
    const all = rows.flatMap((row) => row.spans.map((span) => span.cls ?? ''))
    expect(all.some((cls) => cls.split(' ').length > 1)).toBe(true)
  })

  test('an unknown language draws plain rather than guessing', () => {
    const rows = lines('const a = 1', 'not-a-language', 1, null)
    expect(rows[0]!.spans).toEqual([{ text: 'const a = 1', cls: null, marked: false }])
  })

  test('latex is registered, because the thesis this workspace was built around is .tex', () => {
    const rows = lines('\\section{Agents}\n', 'latex', 1, null)
    expect(rows[0]!.spans.some((span) => span.cls !== null)).toBe(true)
  })
})

describe('the mark', () => {
  const text = 'const alpha = 1\nconst beta = 2\nconst gamma = 3'

  test('a range inside one line marks exactly that range', () => {
    const from = text.indexOf('alpha')
    const rows = lines(text, null, 1, { from, to: from + 5 })
    expect(marked(rows)).toBe('alpha')
    expect(rows.map((row) => row.marked)).toEqual([true, false, false])
  })

  test('a range across a line break marks both halves and neither newline twice', () => {
    const from = text.indexOf('= 1')
    const to = text.indexOf('beta') + 4
    const rows = lines(text, null, 1, { from, to })
    expect(marked(rows)).toBe(text.slice(from, to).replace('\n', ''))
    expect(rows.map((row) => row.marked)).toEqual([true, true, false])
  })

  test('the mark cuts through a coloured token without losing the colour', () => {
    /* The case an HTML-string highlighter cannot do at all, and the reason this
       module walks a tree. Half of a string literal is highlighted and both
       halves are still a string. */
    const source = 'const s = "abcdef"'
    const from = source.indexOf('cde')
    const rows = lines(source, 'typescript', 1, { from, to: from + 3 })
    expect(marked(rows)).toBe('cde')
    expect(plain(rows)).toBe(source)
    const cut = rows[0]!.spans.filter((span) => span.marked)
    expect(cut.every((span) => span.cls?.includes('hljs-string'))).toBe(true)
  })

  test('a range covering the whole file marks all of it and drops no character', () => {
    const rows = lines(text, 'typescript', 1, { from: 0, to: text.length })
    expect(marked(rows)).toBe(text.replaceAll('\n', ''))
    expect(plain(rows)).toBe(text)
  })

  test('a zero-width or backwards range marks nothing rather than everything', () => {
    /* The server refuses these, so this is a second fence. The failure it
       prevents is the whole file drawn as a selection, which looks deliberate. */
    expect(marked(lines(text, null, 1, { from: 5, to: 5 }))).toBe('')
    expect(marked(lines(text, null, 1, { from: 9, to: 4 }))).toBe('')
  })

  test('a range past the end of the text marks nothing', () => {
    expect(marked(lines(text, null, 1, { from: 9_000, to: 9_010 }))).toBe('')
  })

  test('no span is ever empty', () => {
    /* An empty span renders as nothing and counts as something, which is how a
       key collision appears in a list that looks fine. */
    const from = text.indexOf('const')
    const rows = lines(text, 'typescript', 1, { from, to: from + 5 })
    for (const row of rows) for (const span of row.spans) expect(span.text.length).toBeGreaterThan(0)
  })

  test('multi-byte characters before the mark do not shift it — the offsets are characters', () => {
    /* The server converts bytes to characters; this file must not undo that by
       counting anything else. */
    const source = 'ääää MARK'
    const from = source.indexOf('MARK')
    expect(marked(lines(source, null, 1, { from, to: from + 4 }))).toBe('MARK')
  })
})
