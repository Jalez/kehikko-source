import { describe, expect, test } from 'bun:test'

import { label, room } from '../src/view/room.ts'

/**
 * The layout decisions, at the sizes this workspace actually uses.
 *
 * 220x300 is the narrow container that is this module's normal case; 320x200 is
 * short and slightly wider; 460x360 is a comfortable pane; 900x700 is somebody
 * who has given the file most of a canvas. Every one of these is a size the
 * module was measured at in a browser, and this file is the cheap version of
 * that measurement — the part that can be checked without one.
 */

const NARROW = { width: 220, height: 300 }
const SHORT = { width: 320, height: 200 }
const PANE = { width: 460, height: 360 }
const WIDE = { width: 900, height: 700 }

describe('the gutter', () => {
  test('no line numbers at 220 wide — a fifth of the reading width is too much to spend', () => {
    expect(room(NARROW, 300).numbers).toBe(false)
    expect(room(NARROW, 300).gutter).toBe(0)
  })

  test('line numbers from 320 up', () => {
    expect(room(SHORT, 300).numbers).toBe(true)
    expect(room(PANE, 300).numbers).toBe(true)
    expect(room(WIDE, 300).numbers).toBe(true)
  })

  test('the gutter is sized by the last line number, not by how many lines there are', () => {
    /* A window that opened at line 12,000 shows three lines and needs five
       digits. Sizing by the count would shift the text by two characters as the
       reader scrolled, which reads as the file moving. */
    expect(room(PANE, 12_450).gutter).toBe(5)
    expect(room(PANE, 9).gutter).toBe(2)
  })

  test('it never collapses below two characters', () => {
    expect(room(PANE, 1).gutter).toBe(2)
    expect(room(PANE, 0).gutter).toBe(2)
  })
})

describe('the header', () => {
  test('the bare filename in a narrow container', () => {
    expect(room(NARROW, 40).name).toBe('file')
    expect(room(SHORT, 40).name).toBe('file')
  })

  test('the path relative to the project once there is room for it', () => {
    expect(room(PANE, 40).name).toBe('path')
    expect(room(WIDE, 40).name).toBe('path')
  })

  test('no header at all in a container too short to spare the strip', () => {
    expect(room({ width: 460, height: 90 }, 40).header).toBe(false)
    expect(room({ width: 460, height: 90 }, 40).name).toBe('none')
  })

  test('the header survives at 220x300 and at 320x200, which are the real cases', () => {
    expect(room(NARROW, 40).header).toBe(true)
    expect(room(SHORT, 40).header).toBe(true)
  })
})

describe('density', () => {
  test('a short container tightens its leading', () => {
    expect(room(SHORT, 40).dense).toBe(true)
  })

  test('a tall one does not', () => {
    expect(room(NARROW, 40).dense).toBe(false)
    expect(room(PANE, 40).dense).toBe(false)
    expect(room(WIDE, 40).dense).toBe(false)
  })

  test('a container of zero size decides something rather than throwing', () => {
    /* The first frame, before the observer has fired. Every field has to have an
       answer, because the alternative is a render that crashes on mount and a
       container that never measures itself at all. */
    const first = room({ width: 0, height: 0 }, 1)
    expect(first.numbers).toBe(false)
    expect(first.header).toBe(false)
    expect(first.dense).toBe(true)
  })
})

describe('label', () => {
  const project = '/Users/someone/Projects/thesis'
  const file = `${project}/chapters/agents.tex`

  test('the filename alone when that is all there is room for', () => {
    expect(label(file, project, 'file')).toBe('agents.tex')
  })

  test('the path relative to the project when there is', () => {
    expect(label(file, project, 'path')).toBe('chapters/agents.tex')
  })

  test('nothing when there is no header', () => {
    expect(label(file, project, 'none')).toBe('')
  })

  test('a project path with a trailing slash does not leave a leading one behind', () => {
    expect(label(file, `${project}/`, 'path')).toBe('chapters/agents.tex')
  })

  test('a file that is not under the project falls back to its own name', () => {
    /* Only reachable if a passage names something outside the root, which this
       app refuses to open — so the header is never the thing that finds out, and
       it must not print somebody's home directory in a 220-pixel strip. */
    expect(label('/etc/hosts', project, 'path')).toBe('hosts')
    expect(label(file, null, 'path')).toBe('agents.tex')
  })

  test('a sibling directory whose name begins with the project is not stripped', () => {
    expect(label(`${project}-old/notes.md`, project, 'path')).toBe('notes.md')
  })
})
