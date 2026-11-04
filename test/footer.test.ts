import { describe, expect, test } from 'bun:test'

import { FOOT, footerItems } from '../src/view/footer.ts'

const base = { name: 'src/app.tsx', whole: '/p/src/app.tsx', hidden: false, notice: null, noticeIsTrouble: false, lines: null, marked: false }

describe('the footer', () => {
  test('says which file, whole in its tooltip; nothing pressable without lines or a mark', () => {
    const items = footerItems(base)
    expect(items).toEqual([expect.objectContaining({ kind: 'text', id: FOOT.FILE, text: 'src/app.tsx', tooltip: '/p/src/app.tsx' })])
  })

  test('private, the notice, Comment and Selection when there is something for them', () => {
    const items = footerItems({ ...base, hidden: true, notice: '2 MB of 40 MB, from line 1.', lines: { from: 3, to: 7 }, marked: true })
    expect(items.map((i) => i.id)).toEqual([FOOT.FILE, FOOT.PRIVATE, FOOT.NOTICE, FOOT.COMMENT, FOOT.TO_MARK])
    expect(items.find((i) => i.id === FOOT.COMMENT)).toMatchObject({ kind: 'run', label: 'Comment on lines 3–7', align: 'end' })
    expect(items.find((i) => i.id === FOOT.NOTICE)).toMatchObject({ level: 'normal', optional: true })
    expect(items.find((i) => i.id === FOOT.FILE)?.tooltip).toContain('Agents cannot read this file.')
  })

  test('what the host said to a comment is a warning that stays in a narrow row', () => {
    const items = footerItems({ ...base, notice: 'The host did not take it.', noticeIsTrouble: true, lines: { from: 4, to: 4 } })
    expect(items.find((i) => i.id === FOOT.NOTICE)).toMatchObject({ level: 'warn', optional: false })
    expect(items.find((i) => i.id === FOOT.COMMENT)).toMatchObject({ label: 'Comment on this line' })
  })

  test('a long path is cut to fit, the whole in the tooltip', () => {
    const long = `src/${'a/'.repeat(80)}x.ts`
    const items = footerItems({ ...base, name: long, whole: long })
    expect((items[0] as { text: string }).text.length).toBeLessThanOrEqual(120)
  })
})
