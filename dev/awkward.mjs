/**
 * The files a viewer is allowed to be beaten by, in a real browser.
 *
 *   node dev/awkward.mjs             # needs ./run.sh already on 7980
 *
 * The unit tests establish that the server reports the right things about a
 * 50 MB log, a PNG and a missing file. They cannot establish the thing this
 * module is actually judged on, which is whether the CONTAINER stays usable —
 * that is a browser laying out four thousand wrapped lines with syntax spans
 * inside them, at 220 pixels, and it either happens inside a frame or it does
 * not.
 *
 * So this frames the real page, points it at each awkward file, and times how
 * long it takes for the first line to be on screen. It also reads back the exact
 * sentence shown, because every one of these states is a place where the honest
 * answer is a sentence rather than a document, and a sentence that says the wrong
 * thing is this module's most likely bug.
 *
 * The fixtures are built here rather than committed. A 50 MB file in a git
 * repository is a 50 MB file in every clone of it, forever, to test something
 * that takes two seconds to generate.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.SOURCE_ORIGIN ?? 'http://127.0.0.1:7980'

const project = join(tmpdir(), 'source-awkward')
rmSync(project, { recursive: true, force: true })
mkdirSync(join(project, 'a-folder'), { recursive: true })

/* Fifty megabytes of log, written in chunks so this script does not do the thing
   it is testing the server for not doing. */
{
  const chunk = []
  for (let i = 1; i <= 200_000; i += 1) chunk.push(`${i} a line of log with some words in it`)
  const one = `${chunk.join('\n')}\n`
  writeFileSync(join(project, 'huge.log'), one.repeat(7))
}
writeFileSync(join(project, 'minified.js'), `var a=1;${'/*pad*/'.repeat(200_000)}`)
writeFileSync(join(project, 'picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))
writeFileSync(join(project, 'nothing.txt'), '')
writeFileSync(join(project, 'ordinary.ts'), 'export const a = 1\n')

const HOST = `<!doctype html>
<html><body style="margin:0">
<iframe id="frame" src="${ORIGIN}/app" width="220" height="300" style="border:0"
  sandbox="allow-scripts allow-same-origin"></iframe>
<script>
  const frame = document.getElementById('frame')
  window.__point = (passage) => frame.contentWindow.postMessage({
    type: 'roadmap.context', protocol: 2, epic: null, project: 'awkward',
    projectPath: ${JSON.stringify(project)}, theme: 'light', passage, prompt: null,
  }, '*')
  frame.addEventListener('load', () => frame.contentWindow.postMessage({
    type: 'roadmap.hello', protocol: 2, session: 'awkward', state: null,
    context: { epic: null, project: 'awkward', projectPath: ${JSON.stringify(project)},
      theme: 'light', passage: null, prompt: null },
  }, '*'))
</script>
</body></html>`

/* See the essay in `dev/following.mjs`. */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
})
const context = await browser.newContext({ viewport: { width: 320, height: 420 } })
const page = await context.newPage()
await page.route('http://localhost:4181/source-awkward', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: HOST }))
await page.goto('http://localhost:4181/source-awkward', { waitUntil: 'domcontentloaded' })

const frame = page.frameLocator('#frame')
await frame.locator('[data-testid="no-passage"]').waitFor({ timeout: 10_000 })

/**
 * Point at one file and wait for whichever of the answers appears.
 *
 * All of them are waited for at once rather than the expected one being waited
 * for by name — a probe that waited only for what it hoped would happen turns a
 * wrong answer into a timeout, and a timeout says nothing about what the module
 * did instead.
 */
const snapshot = () =>
  frame.locator('#root').evaluate((root) => {
    for (const which of ['no-passage', 'code', 'binary', 'folder', 'empty', 'trouble']) {
      const found = root.querySelector(`[data-testid="${which}"]`)
      if (!found) continue
      return {
        which,
        said: which === 'code' ? null : found.textContent,
        line: root.querySelector('[data-testid="line"]')?.textContent ?? null,
        notice: root.querySelector('[data-testid="notice"]')?.textContent ?? null,
        count: root.querySelectorAll('[data-testid="line"]').length,
      }
    }
    return null
  })

const show = async (file, mark = null) => {
  /*
   * Cleared to nothing first, and then pointed, and the clock starts after the
   * clearing.
   *
   * Without this the probe measures the wrong thing and does not notice: it
   * takes its snapshot four milliseconds after posting the context, sees the
   * PREVIOUS file still on screen, and reports it as this one — which made a
   * fifty-megabyte log look like it drew in four milliseconds and one line. A
   * transition through a state that cannot be confused with either file is what
   * makes the measurement mean what it says.
   *
   * It also exercises the null passage on every subject, which is the state the
   * protocol makes nullable on purpose and the one a viewer that cached would
   * fail.
   */
  await page.evaluate(() => window.__point(null))
  for (let waited = 0; waited < 10_000; waited += 25) {
    if ((await snapshot())?.which === 'no-passage') break
    await page.waitForTimeout(25)
  }

  const began = Date.now()
  await page.evaluate(
    ([path, range]) => window.__point({ path, page: null, from: range?.[0] ?? null, to: range?.[1] ?? null, quoted: '' }),
    [join(project, file), mark],
  )
  for (let waited = 0; waited < 30_000; waited += 25) {
    const seen = await snapshot()
    if (seen && seen.which !== 'no-passage') return { ...seen, took: Date.now() - began }
    await page.waitForTimeout(25)
  }
  throw new Error(`nothing appeared for ${file}`)
}

const rows = []
const add = (what, result) =>
  rows.push({
    file: what,
    shows: result.which,
    'ms to first line': result.took,
    lines: result.count,
    'says on screen': result.said ?? result.notice ?? result.line?.slice(0, 40) ?? '',
  })

/* Warmed first, so the fifty-megabyte number is a measurement of the file rather
   than of Vite compiling the page. */
add('ordinary.ts', await show('ordinary.ts'))
const huge = await show('huge.log')
add('huge.log — 50 MB', huge)
const deep = await show('huge.log', [49_000_000, 49_000_020])
add('huge.log — a range 49 MB in', deep)
add('minified.js — one line, 1.4 MB', await show('minified.js'))
add('picture.png', await show('picture.png'))
add('nothing.txt', await show('nothing.txt'))
add('a-folder', await show('a-folder'))
add('not-there.ts', await show('not-there.ts'))

await browser.close()
rmSync(project, { recursive: true, force: true })
console.table(rows)

const wrong = []
if (huge.took > 3_000) wrong.push(`a 50 MB log took ${huge.took}ms to draw`)
if (!huge.notice?.includes('of')) wrong.push('a truncated file did not say how much of it is shown')
if (deep.took > 3_000) wrong.push(`a range 49 MB in took ${deep.took}ms`)
if (rows.find((r) => r.file === 'picture.png')?.shows !== 'binary') wrong.push('a PNG was not called binary')
if (rows.find((r) => r.file === 'nothing.txt')?.shows !== 'empty') wrong.push('an empty file was not called empty')
if (rows.find((r) => r.file === 'a-folder')?.shows !== 'folder') wrong.push('a directory was not called a folder')
if (rows.find((r) => r.file === 'not-there.ts')?.shows !== 'trouble') wrong.push('a missing file did not say so')
if (wrong.length) {
  console.error(`WRONG: ${wrong.join('; ')}`)
  process.exit(1)
}
console.log('every awkward file draws quickly and says the true short thing about itself')
