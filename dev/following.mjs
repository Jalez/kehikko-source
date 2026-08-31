/**
 * The module's whole behaviour, watched from the host's side.
 *
 *   node dev/following.mjs            # needs ./run.sh already on 7980
 *
 * This module is a consumer. Its claim about itself has two halves and neither
 * one can be checked from inside the program: that it FOLLOWS the canvas passage
 * — every context, including the ones that change what is pointed at and the
 * ones that clear it — and that it never POINTS, so nothing on this canvas ever
 * has to argue with it about where the reader is.
 *
 * The only honest way to check a claim about runtime behaviour is to sit where
 * the host sits. So this page IS a host: it frames `/app`, greets it, records
 * every `roadmap.request` the frame sends, and then walks the module through the
 * states it exists to be right about.
 *
 * ## What it establishes
 *
 *   1. A greeting with no passage produces the "nothing is pointing" sentence.
 *   2. A context naming a file shows that file, with its real first line.
 *   3. A context naming a DIFFERENT file replaces it — the previous file does
 *      not linger, which is the failure a viewer that cached would have.
 *   4. A context carrying a byte range highlights exactly that range.
 *   5. A context with a null passage goes back to saying nothing is pointed at.
 *      The protocol makes the field nullable precisely so this is a state a
 *      module can move INTO, and a viewer that kept the last file would be
 *      showing a document the reader closed.
 *   6. Through all of it: ZERO `passage.set`, and zero requests of any kind.
 *
 * The last one is the load-bearing assertion. It is easy to write a viewer that
 * "helpfully" re-points the canvas at what it just opened, and the symptom is not
 * visible in one container — it needs two, and by then it is somebody's bug
 * report about containers fighting.
 */
import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.SOURCE_ORIGIN ?? 'http://127.0.0.1:7980'
const PROJECT = process.argv[2] ?? '/Users/jaakkorajala/Projects/kehikko-source'

/**
 * A host, in one document.
 *
 * ## It greets on `load`, and that order is not interchangeable
 *
 * The obvious version greets when `roadmap.ready` arrives, and it waits forever:
 * the client sends `ready` in ANSWER to a greeting, naming the protocol it was
 * greeted with, so a host waiting for one is two programs each waiting for the
 * other. A real host greets on the frame's `load` event, which is exactly why the
 * client installs its listener at module scope — see the essay in
 * `src/main.tsx`.
 *
 * ## The greeting wraps its context and `roadmap.context` does not
 *
 * The greeting carries `context: {...}`; a later context IS the context with two
 * envelope fields added. Assuming symmetry there costs an afternoon, so the two
 * shapes are written out separately below rather than built by one function.
 */
const HOST = `<!doctype html>
<html><body style="margin:0">
<iframe id="frame" src="${ORIGIN}/app" width="460" height="360" style="border:0"
  sandbox="allow-scripts allow-same-origin"></iframe>
<script>
  window.__sent = []
  const frame = document.getElementById('frame')
  addEventListener('message', (event) => {
    const message = event.data
    if (!message || typeof message.type !== 'string') return
    window.__sent.push(message)
  })
  window.__point = (passage) => {
    frame.contentWindow.postMessage({
      type: 'roadmap.context',
      protocol: 2,
      epic: null,
      project: 'measured',
      projectPath: ${JSON.stringify(PROJECT)},
      theme: 'light',
      passage,
      prompt: null,
    }, '*')
  }
  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage({
      type: 'roadmap.hello',
      protocol: 2,
      session: 'following',
      state: null,
      context: {
        epic: null,
        project: 'measured',
        projectPath: ${JSON.stringify(PROJECT)},
        theme: 'light',
        passage: null,
        prompt: null,
      },
    }, '*')
  })
</script>
</body></html>`

/*
 * Local Network Access is turned off for this run, and only for this run.
 *
 * Chrome refuses a page on one origin framing `127.0.0.1` unless the loopback
 * server opts in, and answers `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`
 * before the module's own headers are ever consulted. The real host is itself on
 * loopback, so it does not hit this; a probe whose host page is synthesised by
 * the test runner does. Disabling the check is therefore removing an artefact of
 * the harness, not relaxing anything the module relies on — its own
 * `frame-ancestors` is still enforced, which is why the host page below is served
 * from an origin that header names.
 */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
})
const context = await browser.newContext({ viewport: { width: 520, height: 480 } })
const page = await context.newPage()

await page.route('http://localhost:4181/source-probe', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: HOST }))
await page.goto('http://localhost:4181/source-probe', { waitUntil: 'domcontentloaded' })

const frame = page.frameLocator('#frame')
const point = (passage) => page.evaluate((one) => window.__point(one), passage)
const requests = () => page.evaluate(() => window.__sent.filter((m) => m.type === 'roadmap.request'))

/**
 * Waiting for the header to name a particular file.
 *
 * Polled through the frame locator rather than by reaching for
 * `frame.contentDocument`, which is null here and would be null in the real host
 * too: this probe's page is `localhost:4181` and the module is `127.0.0.1:7980`,
 * and those are different origins however much they look like the same machine.
 * A probe that read the frame's document directly would only ever work by
 * accident.
 */
const named = async (needle) => {
  for (let waited = 0; waited < 10_000; waited += 100) {
    const seen = await frame.locator('[data-testid="name"]').textContent().catch(() => null)
    if (seen?.includes(needle)) return seen
    await page.waitForTimeout(100)
  }
  throw new Error(`the header never named ${needle}`)
}

/* 1. Greeted with no passage. */
await frame.locator('[data-testid="no-passage"]').waitFor({ timeout: 10_000 })
const empty = await frame.locator('[data-testid="no-passage"]').textContent()

/* 2. A file. */
await point({ path: `${PROJECT}/package.json`, page: null, from: null, to: null, quoted: '' })
await frame.locator('[data-testid="code"]').waitFor({ timeout: 10_000 })
const first = await frame.locator('[data-testid="name"]').textContent()
const firstLine = await frame.locator('[data-testid="line"]').first().textContent()

/* 3. A different file replaces it rather than being merged with it. */
await point({ path: `${PROJECT}/file/shape.ts`, page: null, from: null, to: null, quoted: '' })
const second = await named('shape.ts')
const stale = (await frame.locator('[data-testid="code"]').textContent()).includes('"kehikko-source"')

/*
 * 4. A byte range, computed here against the real bytes of the real file.
 *
 * Computed rather than hard-coded, because the point of the assertion is that
 * BYTES arrive and CHARACTERS come back — a range read as string indices would
 * still highlight something, and something is what a hard-coded number would be
 * checked against.
 */
const { readFileSync } = await import('node:fs')
const target = `${PROJECT}/file/shape.ts`
const bytes = readFileSync(target)
const needle = 'export const MAX_BYTES'
const from = bytes.indexOf(Buffer.from(needle))
await point({ path: target, page: null, from, to: from + needle.length, quoted: needle })
await frame.locator('[data-marked="yes"]').first().waitFor({ timeout: 10_000 })
const highlighted = await frame
  .locator('.bg-mark')
  .evaluateAll((nodes) => nodes.map((one) => one.textContent).join(''))
const markedLine = await frame.locator('[data-marked="yes"]').first().getAttribute('data-line')
/* What line it REALLY is, counted here from the file itself. */
const trueLine = bytes.subarray(0, from).toString('utf8').split('\n').length

/* 5. And back to nothing, which is a state and not a fault. */
await point(null)
await frame.locator('[data-testid="no-passage"]').waitFor({ timeout: 10_000 })

/* 6. Nothing was ever asked of the host. */
const asked = await requests()

await browser.close()

const report = {
  'says nothing is pointing, before any passage': empty?.trim(),
  'the file named by a passage is shown': first?.trim(),
  'a second passage replaces the first': second?.trim(),
  'the first file is still on screen': stale,
  'the range highlighted': highlighted,
  'the line it was highlighted on': markedLine,
  'the line it is really on': String(trueLine),
  'requests sent to the host, ever': asked.length,
}
console.table(report)

const wrong = []
if (!empty?.includes('Explorer')) wrong.push('the empty state did not name where a passage comes from')
if (!first?.includes('package.json')) wrong.push('a passage did not open the file it named')
if (!second?.includes('shape.ts')) wrong.push('a second passage did not replace the first')
if (stale) wrong.push('the previous file was still on screen')
if (highlighted !== needle) wrong.push(`highlighted ${JSON.stringify(highlighted)} rather than ${JSON.stringify(needle)}`)
if (markedLine !== String(trueLine)) wrong.push(`highlighted line ${markedLine}, which is really line ${trueLine}`)
if (asked.length !== 0) wrong.push(`asked the host for ${asked.length} things; a consumer asks for none`)
if (wrong.length) {
  console.error(`WRONG: ${wrong.join('; ')}`)
  process.exit(1)
}
console.log('follows every passage, highlights the real bytes on the real line, and asks the host for nothing')
console.log(`first line drawn: ${JSON.stringify(firstLine)}`)
