/**
 * The width rule, measured rather than looked at.
 *
 *   node dev/measure.mjs             # needs ./run.sh already on 7980
 *
 * The standing rule in this workspace is that nothing overflows sideways, and
 * this is the module where it is hardest to keep: the thing on screen is lines of
 * code whose length nobody chose, in a container that is often 220 pixels wide.
 * A tree can truncate a filename; a viewer cannot truncate a line.
 *
 * Eyeballing it does not work. A page overflowing by four pixels looks identical
 * to one that does not, in a screenshot and in a browser, until somebody drags a
 * container narrow and finds a scrollbar. So this frames the real page at the
 * four sizes this workspace actually uses, points it at files chosen to break the
 * rule if it is breakable, and compares `scrollWidth` to `clientWidth` on every
 * element that could carry the overflow.
 *
 * The files are the adversarial ones on purpose: a minified bundle (one token a
 * hundred thousand characters long, which is what `break-word` fails on and
 * `overflow-wrap: anywhere` handles), a LaTeX chapter of the thesis this
 * workspace was built around, this module's own longest source file, and a lock
 * file with very long single-line entries.
 */
import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.SOURCE_ORIGIN ?? 'http://127.0.0.1:7980'

const SIZES = [
  { width: 220, height: 300 },
  { width: 320, height: 200 },
  { width: 460, height: 360 },
  { width: 900, height: 700 },
]

const HERE = '/Users/jaakkorajala/Projects/kehikko-source'
const THESIS = '/Users/jaakkorajala/Claude/Projects/CS-DEGREE/05_drafts/thesis_latex'

const SUBJECTS = [
  { what: 'this module’s longest source', project: HERE, file: `${HERE}/file/read.ts` },
  { what: 'a lock file, very long lines', project: HERE, file: `${HERE}/bun.lock` },
  { what: 'the host, TypeScript', project: '/Users/jaakkorajala/Projects/roadmap', file: null },
  { what: 'the thesis, LaTeX', project: THESIS, file: null },
]

const host = (size) => `<!doctype html>
<html><body style="margin:0">
<iframe id="frame" src="${ORIGIN}/app" width="${size.width}" height="${size.height}" style="border:0"
  sandbox="allow-scripts allow-same-origin"></iframe>
<script>
  const frame = document.getElementById('frame')
  window.__point = (projectPath, passage) => {
    frame.contentWindow.postMessage({
      type: 'roadmap.context', protocol: 2, epic: null, project: 'measured',
      projectPath, theme: 'light', passage, prompt: null,
    }, '*')
  }
  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage({
      type: 'roadmap.hello', protocol: 2, session: 'measure', state: null,
      context: { epic: null, project: 'measured', projectPath: null, theme: 'light', passage: null, prompt: null },
    }, '*')
  })
</script>
</body></html>`

/* See the essay in `dev/following.mjs`: this disables a Chrome check that the
   real host never hits, and leaves the module's own `frame-ancestors` enforced. */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
})

const { readdirSync, statSync } = await import('node:fs')
const { join } = await import('node:path')

/** Some real file in a real project, picked by extension rather than named. */
const findIn = (dir, extensions, depth = 2) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isFile() && extensions.some((one) => entry.name.endsWith(one)) && statSync(path).size > 400) return path
    if (entry.isDirectory() && depth > 0) {
      const found = findIn(path, extensions, depth - 1)
      if (found) return found
    }
  }
  return null
}

SUBJECTS[2].file = findIn('/Users/jaakkorajala/Projects/roadmap/src', ['.ts', '.tsx']) ?? null
SUBJECTS[3].file = findIn(THESIS, ['.tex']) ?? null

const rows = []
let worst = 0

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width + 80, height: size.height + 80 } })
  const page = await context.newPage()
  await page.route('http://localhost:4181/source-measure', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: host(size) }))
  await page.goto('http://localhost:4181/source-measure', { waitUntil: 'domcontentloaded' })
  const frame = page.frameLocator('#frame')
  await frame.locator('[data-testid="no-project"]').waitFor({ timeout: 10_000 })

  for (const subject of SUBJECTS) {
    if (!subject.file) continue
    await page.evaluate(
      ([project, file]) => window.__point(project, { path: file, page: null, from: null, to: null, quoted: '' }),
      [subject.project, subject.file],
    )
    await frame.locator('[data-testid="code"]').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(150)

    /*
     * Measured on the elements that can each carry the overflow independently.
     *
     * `documentElement` and `body` catch a page that has grown past its own
     * viewport; the scroller catches content wider than the box it is in; the
     * widest `code` element catches a line that has escaped both because the
     * others were told to hide it. Checking only the body would pass a page that
     * clipped its own bug.
     */
    const measured = await frame.locator('[data-testid="scroller"]').evaluate((scroller) => {
      const document_ = scroller.ownerDocument
      const widest = [...document_.querySelectorAll('code')].reduce(
        (most, one) => Math.max(most, one.scrollWidth - one.clientWidth),
        0,
      )
      return {
        html: document_.documentElement.scrollWidth - document_.documentElement.clientWidth,
        body: document_.body.scrollWidth - document_.body.clientWidth,
        scroller: scroller.scrollWidth - scroller.clientWidth,
        code: widest,
        lines: document_.querySelectorAll('[data-testid="line"]').length,
        gutter: document_.querySelector('[data-testid="line"] span[aria-hidden]') !== null,
        header: document_.querySelector('[data-testid="name"]')?.textContent ?? '(no header)',
      }
    })

    const over = Math.max(measured.html, measured.body, measured.scroller, measured.code)
    worst = Math.max(worst, over)
    rows.push({
      size: `${size.width}x${size.height}`,
      file: subject.what,
      lines: measured.lines,
      gutter: measured.gutter,
      header: measured.header,
      'overflow px': over,
    })
  }
  await context.close()
}

await browser.close()
console.table(rows)

if (worst > 0) {
  console.error(`SIDEWAYS OVERFLOW: ${worst}px at the worst size. Nothing here may scroll horizontally.`)
  process.exit(1)
}
console.log('no horizontal overflow at any size, on any file')
