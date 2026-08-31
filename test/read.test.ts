import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REFUSED, binary, open } from '../file/read.ts'
import { MAX_BYTES, MAX_LINES } from '../file/shape.ts'

/**
 * Opening files, including the four kinds this module exists to be honest about:
 * the enormous one, the binary one, the one whose interesting part is a long way
 * in, and the one with a character in it that is not one byte wide.
 *
 * Real files in a real temporary directory rather than a mocked filesystem. Every
 * bug this module can have is a bug about bytes and offsets, and a mock is a
 * second opinion about how many of those there are.
 */

const scratch = mkdtempSync(join(tmpdir(), 'source-read-'))
mkdirSync(join(scratch, 'folder'), { recursive: true })

const put = (name: string, content: string | Buffer) => {
  writeFileSync(join(scratch, name), content)
  return name
}

put('small.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
put('empty.txt', '')
put('no-newline.txt', 'one line and no newline at the end')
put('accented.txt', 'ä'.repeat(10) + '\nMARK HERE\n')
put('png.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]))
put('utf16.txt', Buffer.from('hello there', 'utf16le'))
put('ansi.log', `[32mgreen[0m line one\n[31mred[0m line two\n`)

/* Bigger than the ceiling, with line numbers written into the lines so a test
   can say which line it is looking at without counting. */
const wide = Array.from({ length: 20_000 }, (_, i) => `line ${i + 1} ${'x'.repeat(40)}`).join('\n')
put('big.txt', wide)

/* One line, no newline anywhere: a minified bundle. */
put('minified.js', `var a=1;${'/*pad*/'.repeat(60_000)}`)

/* More lines than the line cap allows, but small in bytes. */
const many = Array.from({ length: MAX_LINES + 500 }, (_, i) => `${i + 1}`).join('\n')
put('many.txt', many)

const root = realpathSync(scratch)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const text = (name: string, want: { from: number; to: number } | null = null) => {
  const seen = open(root, name, want)
  if (seen.kind !== 'text') throw new Error(`expected text, got ${seen.kind}`)
  return seen
}

describe('the ordinary case', () => {
  test('a small file comes back whole, numbered from one', () => {
    const seen = text('small.ts')
    expect(seen.text).toBe('const a = 1\nconst b = 2\nconst c = 3')
    expect(seen.firstLine).toBe(1)
    expect(seen.whole).toBe(true)
    expect(seen.size).toBe(36)
    expect(seen.language).toBe('typescript')
  })

  test('the trailing newline of a complete file is not a phantom last line', () => {
    /* A file ending in `\n` has three lines, not four. Every editor agrees, and
       a fourth empty row at the bottom of every well-formed file in the project
       is the kind of wrong that nobody reports and everybody notices. */
    expect(text('small.ts').text.split('\n')).toHaveLength(3)
    expect(text('small.ts').whole).toBe(true)
  })

  test('a file with no trailing newline is still whole', () => {
    const seen = text('no-newline.txt')
    expect(seen.text).toBe('one line and no newline at the end')
    expect(seen.whole).toBe(true)
  })

  test('an empty file is text, and says so by being empty rather than by failing', () => {
    const seen = text('empty.txt')
    expect(seen.text).toBe('')
    expect(seen.size).toBe(0)
    expect(seen.whole).toBe(true)
  })

  test('a directory is its own answer and not a refusal', () => {
    expect(open(root, 'folder', null).kind).toBe('folder')
  })

  test('a path outside the root is refused, with the one sentence', () => {
    const seen = open(root, '../../../etc/passwd', null)
    expect(seen.kind).toBe('refused')
    expect(seen.kind === 'refused' && seen.error).toBe(REFUSED)
  })

  test('a file that is not there is refused the same way', () => {
    const seen = open(root, 'nope.ts', null)
    expect(seen.kind === 'refused' && seen.error).toBe(REFUSED)
  })
})

describe('binary', () => {
  test('a NUL byte in the sniff makes it binary', () => {
    expect(binary(Buffer.from([0x41, 0x42, 0x00, 0x43]))).toBe(true)
  })

  test('ordinary text is not binary', () => {
    expect(binary(Buffer.from('const a = 1\n\tconst b = 2\r\n'))).toBe(false)
  })

  test('an empty chunk is not binary — an empty file is a text file with nothing in it', () => {
    expect(binary(Buffer.alloc(0))).toBe(false)
  })

  test('a run of control characters with no NUL is still binary', () => {
    expect(binary(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x41, 0x42, 0x05, 0x06]))).toBe(true)
  })

  test('ANSI escapes are text, because a captured terminal log is text', () => {
    const seen = open(root, 'ansi.log', null)
    expect(seen.kind).toBe('text')
  })

  test('a PNG is reported as binary with its size and a hedged guess', () => {
    const seen = open(root, 'png.png', null)
    expect(seen.kind).toBe('binary')
    if (seen.kind !== 'binary') return
    expect(seen.size).toBe(12)
    expect(seen.looks).toBe('an image')
  })

  test('UTF-16 is caught by the NUL rule rather than decoded into mojibake', () => {
    expect(open(root, 'utf16.txt', null).kind).toBe('binary')
  })
})

describe('the byte ceiling', () => {
  test('a file over the ceiling is cut, and says how much of how much', () => {
    const seen = text('big.txt')
    expect(seen.whole).toBe(false)
    expect(seen.read).toBeLessThanOrEqual(MAX_BYTES)
    expect(seen.size).toBeGreaterThan(MAX_BYTES)
    expect(seen.at).toBe(0)
    expect(seen.firstLine).toBe(1)
  })

  test('the cut lands on a line boundary, so the last line shown is a whole line', () => {
    const seen = text('big.txt')
    const last = seen.text.slice(seen.text.lastIndexOf('\n') + 1)
    expect(last).toMatch(/^line \d+ x+$/)
  })

  test('a file that is one enormous line is shown anyway rather than shown as nothing', () => {
    /* Trimming to the last newline would leave zero bytes here, and answering
       "empty" for a file that is plainly full is worse than showing a quarter of
       a very long line. */
    const seen = text('minified.js')
    expect(seen.text.length).toBeGreaterThan(1000)
    expect(seen.whole).toBe(false)
  })

  test('the line cap bites on a file that is small in bytes and long in lines', () => {
    const seen = text('many.txt')
    expect(seen.text.split('\n')).toHaveLength(MAX_LINES)
    expect(seen.whole).toBe(false)
    expect(seen.firstLine).toBe(1)
  })
})

describe('the range a passage carries', () => {
  test('a range in a small file comes back as character offsets into the text', () => {
    const seen = text('small.ts', { from: 12, to: 23 })
    expect(seen.mark).not.toBeNull()
    expect(seen.text.slice(seen.mark!.from, seen.mark!.to)).toBe('const b = 2')
    expect(seen.markLost).toBe(false)
  })

  test('bytes are converted to characters, so an accented prefix does not shift the highlight', () => {
    /* Ten `ä` is twenty bytes and ten characters. A consumer that treated the
       passage's bytes as string indices would highlight ten characters early —
       which is invisible in ASCII source and wrong in every file of prose this
       workspace was built to read. */
    const seen = text('accented.txt', { from: 21, to: 30 })
    expect(seen.text.slice(seen.mark!.from, seen.mark!.to)).toBe('MARK HERE')
  })

  test('a range past the end of the file is lost rather than clamped to something', () => {
    const seen = text('small.ts', { from: 10_000, to: 10_010 })
    expect(seen.mark).toBeNull()
    expect(seen.markLost).toBe(true)
  })

  test('no range asked for is not the same as a range that was lost', () => {
    const seen = text('small.ts')
    expect(seen.mark).toBeNull()
    expect(seen.markLost).toBe(false)
  })

  test('a range deep inside a large file moves the window onto it', () => {
    /* The whole reason the window is not simply the first N bytes. A passage
       from a diff or a note can name a range a long way in, and answering with
       the top of the file would be answering a different question. */
    const at = Math.floor(wide.length * 0.8)
    const from = wide.indexOf('line 16000 ')
    const seen = text('big.txt', { from, to: from + 10 })
    expect(from).toBeGreaterThan(MAX_BYTES)
    expect(at).toBeGreaterThan(0)
    expect(seen.at).toBeGreaterThan(0)
    expect(seen.mark).not.toBeNull()
    expect(seen.text.slice(seen.mark!.from, seen.mark!.to)).toBe('line 16000')
  })

  test('a moved window reports the real line number of its first line', () => {
    const from = wide.indexOf('line 16000 ')
    const seen = text('big.txt', { from, to: from + 10 })
    /* The line the mark is on, counted from what the reader is told the first
       line is. If `firstLine` were a lie this arithmetic would land somewhere
       else, which is the whole failure a viewer of a large file can have. */
    const before = seen.text.slice(0, seen.mark!.from).split('\n').length - 1
    expect(seen.firstLine + before).toBe(16_000)
  })

  test('a moved window starts at a line boundary', () => {
    const from = wide.indexOf('line 16000 ')
    const seen = text('big.txt', { from, to: from + 10 })
    expect(seen.text.slice(0, 5)).toBe('line ')
  })

  test('the line cap keeps the marked line rather than the top of the file', () => {
    const from = many.indexOf(`\n${MAX_LINES + 200}\n`) + 1
    const seen = text('many.txt', { from, to: from + String(MAX_LINES + 200).length })
    expect(seen.mark).not.toBeNull()
    expect(seen.text.slice(seen.mark!.from, seen.mark!.to)).toBe(String(MAX_LINES + 200))
    expect(seen.firstLine).toBeGreaterThan(1)
  })
})
