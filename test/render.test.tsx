import { describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'

import { Code } from '../src/view/code.tsx'
import { room } from '../src/view/room.ts'
import { Binary, EmptyFile, Folder, Listening, NoPassage, NoProject, Trouble } from '../src/view/screens.tsx'

/**
 * What is actually on screen, in the real components.
 *
 * The words are the thing being asserted. Every screen in this module is one
 * short sentence that has to distinguish itself from five other short sentences,
 * and the failure they exist to prevent is a reader concluding the wrong one of
 * six quite different things from an empty box. A test that checked for a
 * `data-testid` and not for what it says would pass while the sentence said
 * something else.
 */

const NARROW = room({ width: 220, height: 300 }, 3)
const PANE = room({ width: 460, height: 360 }, 3)

describe('the screens are six different sentences', () => {
  test('waiting says what it is waiting for, rather than spinning', () => {
    render(<Listening />)
    expect(screen.getByText(/Waiting to be told what to show/)).toBeDefined()
    cleanup()
  })

  test('unhosted and hosted say different things about there being no project', () => {
    render(<NoProject unhosted />)
    const alone = screen.getByTestId('no-project').textContent ?? ''
    expect(alone).toContain('Nothing is framing this page')
    /* The name appears only when nothing else is printing it. A host puts the
       module's name in the container header. */
    expect(screen.getByText('Source')).toBeDefined()
    cleanup()

    render(<NoProject unhosted={false} />)
    const framed = screen.getByTestId('no-project').textContent ?? ''
    expect(framed).toContain('has not said which project')
    expect(framed).not.toBe(alone)
    expect(screen.queryByText('Source')).toBeNull()
    cleanup()
  })

  test('no passage is a different fact from no project, and names who can fix it', () => {
    render(<NoPassage />)
    const text = screen.getByTestId('no-passage').textContent ?? ''
    expect(text).toContain('Explorer')
    expect(text.length).toBeLessThan(70)
    cleanup()
  })

  test('a folder says it is a folder rather than failing', () => {
    render(<Folder />)
    expect(screen.getByTestId('folder').textContent).toContain('folder, not a file')
    cleanup()
  })

  test('a binary file says how big it is and hedges the guess', () => {
    render(<Binary size={2_400_000} looks="an image" />)
    const text = screen.getByTestId('binary').textContent ?? ''
    expect(text).toContain('Not text')
    expect(text).toContain('2.3 MB')
    expect(text).toContain('looks like an image')
    cleanup()
  })

  test('a binary file with no recognisable extension claims nothing about what it is', () => {
    render(<Binary size={99} looks={null} />)
    expect(screen.getByTestId('binary').textContent).toBe('Not text — 99 B.')
    cleanup()
  })

  test('an empty file is its own sentence, because zero bytes and a failed read look identical', () => {
    render(<EmptyFile />)
    expect(screen.getByTestId('empty').textContent).toContain('empty')
    cleanup()
  })

  test('trouble prints the server’s own sentence without rewording it', () => {
    render(<Trouble said="That file is not somewhere this app can look." />)
    expect(screen.getByTestId('trouble').textContent).toBe('That file is not somewhere this app can look.')
    cleanup()
  })

  test('every screen fits in a short sentence', () => {
    /* The standing complaint about these modules is that they say too much in a
       narrow column. This is that complaint as a test. */
    for (const element of [<Listening key="a" />, <NoPassage key="b" />, <Folder key="c" />, <EmptyFile key="d" />]) {
      render(element)
      expect((document.body.textContent ?? '').length).toBeLessThan(80)
      cleanup()
    }
  })
})

describe('the code', () => {
  const text = 'const a = 1\nconst b = 2\nconst c = 3'

  test('every line of the file is drawn', () => {
    render(<Code text={text} language="typescript" firstLine={1} mark={null} room={PANE} />)
    expect(screen.getAllByTestId('line')).toHaveLength(3)
    cleanup()
  })

  test('the lines say what the file says', () => {
    render(<Code text={text} language="typescript" firstLine={1} mark={null} room={PANE} />)
    const rows = screen.getAllByTestId('line')
    /*
     * The code is read out of the `<code>` element rather than off the row,
     * because the row also holds the gutter — and the gap between the number and
     * the code is PADDING rather than a character.
     *
     * That is not an accident of this test. A space in the markup would land in
     * a copied selection, and somebody copying four lines out of this container
     * to paste into a shell would get four lines with a number and a space in
     * front of each. The gutter is `select-none` for the same reason.
     */
    const code = rows.map((row) => row.querySelector('code')?.textContent ?? '')
    expect(code[0]).toBe('const a = 1')
    expect(code[2]).toBe('const c = 3')
    expect(rows[0]!.textContent).toContain('1')
    cleanup()
  })

  test('there is no gutter at 220 wide, and the code is unchanged without it', () => {
    render(<Code text={text} language="typescript" firstLine={1} mark={null} room={NARROW} />)
    expect(screen.getAllByTestId('line')[0]!.textContent).toBe('const a = 1')
    cleanup()
  })

  test('line numbers are the file’s, not the screen’s', () => {
    render(<Code text={text} language={null} firstLine={4_012} mark={null} room={PANE} />)
    expect(screen.getAllByTestId('line').map((line) => line.dataset.line)).toEqual(['4012', '4013', '4014'])
    cleanup()
  })

  test('a marked range marks its line and only its line', () => {
    const from = text.indexOf('const b')
    render(<Code text={text} language="typescript" firstLine={1} mark={{ from, to: from + 11 }} room={PANE} />)
    const marked = screen.getAllByTestId('line').filter((line) => line.dataset.marked === 'yes')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.dataset.line).toBe('2')
    cleanup()
  })

  test('the marked text carries the highlight class and the syntax class at once', () => {
    const from = text.indexOf('a = 1')
    render(<Code text={text} language="typescript" firstLine={1} mark={{ from, to: from + 1 }} room={PANE} />)
    const highlighted = [...document.querySelectorAll('.bg-mark')]
    expect(highlighted.length).toBeGreaterThan(0)
    expect(highlighted.map((one) => one.textContent).join('')).toBe('a')
    cleanup()
  })

  test('the whole file is still readable when a range is highlighted', () => {
    /* The invariant that matters most: cutting spans for a highlight must not
       lose or duplicate a character of somebody's file. */
    render(<Code text={text} language="typescript" firstLine={1} mark={{ from: 3, to: 20 }} room={PANE} />)
    const rebuilt = screen
      .getAllByTestId('line')
      .map((line) => line.querySelector('code')?.textContent)
      .join('\n')
    expect(rebuilt).toBe(text)
    cleanup()
  })

  test('syntax colouring happens, and unknown languages simply do not get any', () => {
    render(<Code text={text} language="typescript" firstLine={1} mark={null} room={NARROW} />)
    expect(document.querySelectorAll('[class*="hljs-"]').length).toBeGreaterThan(0)
    cleanup()

    render(<Code text={text} language={null} firstLine={1} mark={null} room={NARROW} />)
    expect(document.querySelectorAll('[class*="hljs-"]').length).toBe(0)
    cleanup()
  })

  test('an empty line still occupies one', () => {
    render(<Code text={'a\n\nb'} language={null} firstLine={1} mark={null} room={NARROW} />)
    expect(screen.getAllByTestId('line')).toHaveLength(3)
    cleanup()
  })

  test('a very long line wraps rather than being given anywhere to scroll to', () => {
    /* The rule the whole layout is arranged around. `overflow-wrap: anywhere`
       rather than a named utility, because a class that silently does not exist
       produces exactly the overflow it was added to prevent. */
    render(<Code text={'x'.repeat(5_000)} language={null} firstLine={1} mark={null} room={NARROW} />)
    const code = document.querySelector('code')!
    expect(code.className).toContain('whitespace-pre-wrap')
    expect(code.className).toContain('[overflow-wrap:anywhere]')
    cleanup()
  })
})
