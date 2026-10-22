import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { changeHeader, commentAt, rowsIn, targetFrom } from '../src/live/change.ts'

/**
 * Following a code location (protocol 2.13.0): the file as the change has it,
 * scrolled to the lines with them tinted, a header that says which change and
 * which commit — and "Comment on this line", the one press that points.
 */

const here = { change: 'gl!123', path: 'src/app.ts', line: 3, side: 'new' as const, commit: 'abc1234' }
const shared = { ...here, intent: 'show' as const, by: 'kehikot.review', at: '2026-10-22T10:00:00.000Z' }
const passage = { path: '/tmp/p/src/app.ts', page: null, from: null, to: null, quoted: '', section: null }

describe('which file of which change', () => {
  const rows = new Map([
    ['gh#41', { kind: 'change' as const, url: 'https://github.com/o/r/pull/41' }],
    ['gh#9', { kind: 'issue' as const, url: 'https://github.com/o/r/issues/9' }],
  ])
  test('a location is exactly what is shown, with its URL when the reading has it', () => {
    const target = targetFrom({ location: { ...shared, change: 'gh#41' }, passage: null, projectPath: '/tmp/p', selection: ['gh#41'], rows })
    expect(target).toMatchObject({ change: 'gh#41', path: 'src/app.ts', line: 3, endLine: null, side: 'new', commit: 'abc1234', url: 'https://github.com/o/r/pull/41' })
  })
  test('one change picked and a file chosen: that file at its head, no line', () => {
    const target = targetFrom({ location: null, passage, projectPath: '/tmp/p', selection: ['gh#41', 'gh#9'], rows })
    expect(target).toMatchObject({ change: 'gh#41', path: 'src/app.ts', line: null, commit: null, side: 'new' })
  })
  test('a spelling that can only be a change counts without a reading', () => {
    expect(targetFrom({ location: null, passage, projectPath: '/tmp/p', selection: ['!7'], rows: new Map() })?.change).toBe('!7')
  })
  test('otherwise the disk, as before: no change, two changes, or a file outside the project', () => {
    expect(targetFrom({ location: null, passage, projectPath: '/tmp/p', selection: ['gh#9'], rows })).toBeNull()
    expect(targetFrom({ location: null, passage, projectPath: '/tmp/p', selection: ['gh#41', '!7'], rows })).toBeNull()
    expect(targetFrom({ location: null, passage: { ...passage, path: '/elsewhere/a.ts' }, projectPath: '/tmp/p', selection: ['!7'], rows })).toBeNull()
    expect(targetFrom({ location: null, passage: null, projectPath: '/tmp/p', selection: ['!7'], rows })).toBeNull()
  })
  test('the header, and the location a comment sends', () => {
    expect(changeHeader({ change: '!123', path: 'src/app.ts', line: 42, endLine: null }, 'abc1234def')).toBe('!123 · src/app.ts:42 at abc1234')
    expect(changeHeader({ change: '!123', path: 'src/app.ts', line: 42, endLine: 48 }, null)).toBe('!123 · src/app.ts:42-48')
    expect(commentAt({ change: '!1', path: 'a.ts', side: 'old' }, 'abc1234', 9, 4)).toEqual({ change: '!1', path: 'a.ts', line: 4, endLine: 9, side: 'old', commit: 'abc1234' })
    expect(commentAt({ change: '!1', path: 'a.ts', side: 'new' }, 'abc1234', 4, 4)).toEqual({ change: '!1', path: 'a.ts', line: 4, side: 'new', commit: 'abc1234' })
  })
  test('rows are read off a tracker reading, and nothing off anything else', () => {
    expect(rowsIn({ nonsense: true }).size).toBe(0)
  })
})

describe('the page, framed', () => {
  const realFetch = globalThis.fetch
  let asked: string[] = []
  let requests: { id: string; method: string; params: Record<string, unknown> }[] = []
  let answerLocate: Record<string, unknown> = { outcome: 'taken', why: '' }
  const TEXT = 'one\ntwo\nthree\nfour\nfive'
  const file = {
    ok: true,
    kind: 'text',
    path: 'src/app.ts',
    size: TEXT.length,
    read: TEXT.length,
    at: 0,
    text: TEXT,
    firstLine: 1,
    whole: true,
    mark: { from: 8, to: 13 },
    markLost: false,
    language: null,
    commit: 'abc1234def5678',
    change: 'gl!123',
    side: 'new',
  }
  const context = (over: Record<string, unknown>) => ({ epic: null, theme: 'light', project: 'p', projectPath: '/tmp/p', ...over })
  const settle = (ms = 30) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))
  const post = async (message: Record<string, unknown>) => {
    await act(async () => {
      window.postMessage({ protocol: 2, ...message }, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const greet = (over: Record<string, unknown>) => post({ type: 'kehikot.hello', session: 's', state: null, context: context(over) })
  const heard = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: string; method?: string; params?: Record<string, unknown> }
    if (data?.type !== 'kehikot.request' || !data.id || !data.method) return
    requests.push({ id: data.id, method: data.method, params: data.params ?? {} })
    const reply = data.method === 'location.set' ? answerLocate : data.method === 'tracker.get' ? { rows: [], missing: [], at: null, refreshing: false } : {}
    window.postMessage({ protocol: 2, type: 'kehikot.response', id: data.id, ok: true, data: reply }, '*')
  }

  const sized = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  }
  beforeEach(() => {
    /* Room for the header: the page draws it from 120 pixels tall. */
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 460 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 360 })
    asked = []
    requests = []
    answerLocate = { outcome: 'taken', why: '' }
    resetServerStanding()
    window.addEventListener('message', heard)
    globalThis.fetch = (async (url: unknown) => {
      asked.push(String(url))
      return new Response(JSON.stringify(file), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    cleanup()
    for (const [key, was] of [['clientWidth', sized.width], ['clientHeight', sized.height]] as const) {
      if (was) Object.defineProperty(HTMLElement.prototype, key, was)
    }
    window.removeEventListener('message', heard)
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('a location opens the change’s file at its commit, tints the lines and says where', async () => {
    render(<App />)
    await greet({ selection: ['gl!123'], location: { ...shared, endLine: 4 } })
    await settle()
    expect(asked.at(-1)).toBe('./api/change?projectPath=%2Ftmp%2Fp&change=gl%21123&path=src%2Fapp.ts&side=new&line=3&endLine=4&commit=abc1234')
    expect(screen.getByTestId('name').textContent).toBe('gl!123 · src/app.ts:3-4 at abc1234')
    const tinted = screen.getAllByTestId('line').filter((line) => line.dataset.tinted === 'yes')
    expect(tinted.map((line) => line.dataset.line)).toEqual(['3', '4'])
    /* Whole lines, not the bytes: no span mark drawn over them as well. */
    expect(document.querySelector('[data-marked]')).toBeNull()
    /* The tracker reading was asked which refs are changes. */
    expect(requests.find((one) => one.method === 'tracker.get')?.params).toEqual({ refs: ['gl!123'] })
  })

  test('the same place pointed at again scrolls again, and a new place is read', async () => {
    const scrolled: string[] = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.line ?? '')
    }
    try {
      render(<App />)
      await greet({ selection: ['gl!123'], location: shared })
      await settle()
      const before = scrolled.length
      const read = asked.length
      expect(scrolled.at(-1)).toBe('3')
      await post({ type: 'kehikot.context', ...context({ selection: ['gl!123'], location: { ...shared, at: '2026-10-22T10:01:00.000Z' } }) })
      expect(scrolled.length).toBeGreaterThan(before)
      expect(asked).toHaveLength(read)
      await post({ type: 'kehikot.context', ...context({ selection: ['gl!123'], location: { ...shared, line: 5 } }) })
      expect(asked).toHaveLength(read + 1)
    } finally {
      Element.prototype.scrollIntoView = was
    }
  })

  test('right-click on a line offers "Comment on this line", which sends a comment location at the commit read', async () => {
    render(<App />)
    await greet({ selection: ['gl!123'], location: shared })
    await settle()
    const line = screen.getAllByTestId('line').find((one) => one.dataset.line === '2')!
    await act(async () => void fireEvent.contextMenu(line, { clientX: 10, clientY: 20 }))
    const item = screen.getByRole('menuitem', { name: 'Comment on this line' })
    await act(async () => {
      fireEvent.click(item)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const sent = requests.find((one) => one.method === 'location.set')
    expect(sent?.params).toEqual({
      location: { change: 'gl!123', path: 'src/app.ts', line: 2, side: 'new', commit: 'abc1234def5678' },
      intent: 'comment',
    })
    expect(screen.queryByTestId('line-menu')).toBeNull()
  })

  test('a comment the host does not take says why', async () => {
    answerLocate = { outcome: 'not-selected', why: 'gl!123 is not picked out.' }
    render(<App />)
    await greet({ selection: ['gl!123'], location: shared })
    await settle()
    const line = screen.getAllByTestId('line')[0]!
    await act(async () => void fireEvent.contextMenu(line))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem'))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(screen.getByTestId('notice').textContent).toBe('gl!123 is not picked out.')
  })

  test('without a location or a picked change it is the disk, as before, and there is no comment to offer', async () => {
    globalThis.fetch = (async (url: unknown) => {
      asked.push(String(url))
      return new Response(JSON.stringify({ ...file, path: '/tmp/p/src/app.ts', mark: null }), { status: 200 })
    }) as unknown as typeof fetch
    render(<App />)
    await greet({ passage })
    await settle()
    expect(asked.at(-1)).toBe('./api/source?projectPath=%2Ftmp%2Fp&path=%2Ftmp%2Fp%2Fsrc%2Fapp.ts')
    const line = screen.getAllByTestId('line')[0]!
    await act(async () => void fireEvent.contextMenu(line))
    expect(screen.queryByTestId('line-menu')).toBeNull()
    expect(requests.some((one) => one.method === 'location.set')).toBe(false)
  })

  test('a picked change and a chosen file: the file at the change’s head', async () => {
    render(<App />)
    await greet({ selection: ['!7'], passage })
    await settle()
    expect(asked.at(-1)).toBe('./api/change?projectPath=%2Ftmp%2Fp&change=%217&path=src%2Fapp.ts&side=new')
    expect(screen.getByTestId('name').textContent).toBe('!7 · src/app.ts at abc1234')
  })
})
