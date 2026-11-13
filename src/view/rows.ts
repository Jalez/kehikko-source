import { footerItems, type FooterState } from './footer.ts'

/**
 * The rows File Viewer declares, one state per moment worth checking, for `kehikot-check-rows`
 * (protocol 2.70.0). Built from the real footer function, so `kehikot.rows.json` (written by
 * `bun run rows`, held equal to this by `test/rows.test.ts`) cannot drift from what the page sends.
 *
 * No header in any of them: File Viewer declares none. Nothing in it is a choice about how the module is
 * set up — it shows the file the canvas points at, and there is no second answer to pick. Everything
 * it has is where you are and what is going on now, which is the footer's.
 */

const file: FooterState = { name: 'src/app.tsx', whole: '/project/src/app.tsx', hidden: false, notice: null, noticeIsTrouble: false, lines: null, marked: false }

export function rowsStates() {
  return [
    { name: 'a file', footer: footerItems(file), state: true },
    { name: 'a passage marked in a file cut short', footer: footerItems({ ...file, notice: '2 MB of 40 MB, from line 1.', marked: true }), state: true },
    {
      name: 'a change’s file agents are refused, lines picked',
      footer: footerItems({ ...file, name: '!12 · src/app.tsx', whole: '!12 · src/app.tsx\nAs the change has it (its head), commit abc1234', hidden: true, lines: { from: 3, to: 7 }, marked: true }),
      state: true,
    },
    { name: 'a comment the host did not take', footer: footerItems({ ...file, notice: 'The host did not take it.', noticeIsTrouble: true, lines: { from: 4, to: 4 } }), state: true },
    { name: 'nothing shown', footer: [] },
  ]
}
