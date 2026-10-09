import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'

import { Code } from '../src/view/code.tsx'
import { room } from '../src/view/room.ts'
import { Binary, EmptyFile, Folder, NoPassage, Trouble } from '../src/view/screens.tsx'

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

describe('the screens are different sentences', () => {
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
    for (const element of [<NoPassage key="b" />, <Folder key="c" />, <EmptyFile key="d" />]) {
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

/*
 * The moments this page has no file to draw, each as the protocol's one shared cover. Driven
 * through `App` itself — a greeting posted to the window, `fetch` stood in for — because which
 * cover is in front is a decision `App` makes, and a server that did not answer used to be a red
 * sentence in place of the file.
 */
describe('the not-ready moments, each as the one shared cover', () => {
  const realFetch = globalThis.fetch
  let down = false
  let refuse: string | null = null
  let asked: string[] = []
  const file = { ok: true, kind: 'text', path: '/tmp/p/a.ts', size: 11, read: 11, at: 0, text: 'const a = 1', firstLine: 1, whole: true, mark: null, markLost: false, language: null }
  const passage = { path: '/tmp/p/a.ts', page: null, from: null, to: null, quoted: '', section: null }
  const context = (over: Record<string, unknown>) => ({ epic: null, theme: 'dark', ...over })
  const post = async (message: Record<string, unknown>) => {
    await act(async () => {
      window.postMessage({ protocol: 2, ...message }, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const greet = (over: Record<string, unknown>) => post({ type: 'kehikot.hello', session: 's', state: null, context: context(over) })
  const cover = () => document.querySelector('[data-cover]')
  const settle = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))

  beforeEach(() => {
    down = false
    refuse = null
    asked = []
    resetServerStanding()
    globalThis.fetch = (async (url: unknown) => {
      asked.push(String(url))
      if (down) throw new TypeError('Load failed')
      if (refuse) return new Response(JSON.stringify({ ok: false, error: refuse }), { status: 404 })
      return new Response(JSON.stringify(file), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    cleanup()
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('before anything has greeted the page it is waiting — never "no project" — and then unhosted', async () => {
    render(<App />)
    await settle(30)
    expect(cover()?.getAttribute('data-cover')).toBe('waiting')
    expect(document.body.textContent).toContain('Waiting for Kehikot…')
    expect(document.body.textContent).not.toContain('No project')
    await settle(800)
    expect(cover()?.getAttribute('data-cover')).toBe('unhosted')
    expect(document.body.textContent).toContain('Nothing is framing this page — open Source in Kehikot.')
    /* No path box and nothing to press: this viewer shows what the canvas points at and nothing else. */
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(within(cover() as HTMLElement).queryAllByRole('button')).toHaveLength(0)
    expect(asked).toHaveLength(0)
  })

  test('hosted with no project: no project, in the host’s theme', async () => {
    render(<App />)
    await greet({ project: null, projectPath: null })
    expect(cover()?.getAttribute('data-cover')).toBe('no-project')
    expect(document.body.textContent).toContain('No project is open — open one in Kehikot.')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(asked).toHaveLength(0)
  })

  test('a project and no passage is this module’s own sentence, not a cover, and nothing is read', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', theme: 'light' })
    expect(cover()).toBeNull()
    expect(screen.getByTestId('no-passage').textContent).toContain('Nothing is pointing at a file yet')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(asked).toHaveLength(0)
  })

  test('a passage is read once, by a relative path, however often the host repeats it', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', passage })
    expect(cover()).toBeNull()
    expect(asked).toEqual(['./api/source?projectPath=%2Ftmp%2Fp&path=%2Ftmp%2Fp%2Fa.ts'])
    /* The host rebroadcasts a fresh, identical passage object every couple of seconds. */
    await post({ type: 'kehikot.context', ...context({ project: 'p', projectPath: '/tmp/p', passage: { ...passage } }) })
    await post({ type: 'kehikot.context', ...context({ project: 'p', projectPath: '/tmp/p', passage: { ...passage } }) })
    expect(asked).toHaveLength(1)
  })

  test('its own server not answering says so, and Try again asks for the same file again', async () => {
    down = true
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', passage })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    expect(document.body.textContent).toContain('Source’s own server is not answering.')
    /* Not the red sentence: nothing is wrong with the file, and nothing has been said about it. */
    expect(screen.queryByTestId('trouble')).toBeNull()
    down = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(asked).toHaveLength(2)
    expect(asked[1]).toBe(asked[0])
    expect(cover()).toBeNull()
  })

  test('a server that stops under an open file covers it without unmounting it', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', passage })
    const scroller = screen.getByTestId('scroller')
    down = true
    await post({ type: 'kehikot.context', ...context({ project: 'p', projectPath: '/tmp/p', passage: { ...passage, path: '/tmp/p/b.ts' } }) })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    /* The same element, hidden: the file that was open is still there under the cover. */
    expect(screen.getByTestId('scroller')).toBe(scroller)
    expect(scroller.closest('[hidden]')).not.toBeNull()
  })

  test('a file the server refuses is the server’s own sentence, not a cover', async () => {
    refuse = 'There is nothing there to show inside this project.'
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', passage })
    expect(cover()).toBeNull()
    expect(screen.getByTestId('trouble').textContent).toBe('There is nothing there to show inside this project.')
  })
})
