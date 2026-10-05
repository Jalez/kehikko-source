#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7980 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision on
 * their behalf every time they pressed start.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `kehikot.source.json` is what makes this
 * `kehikot.source`. Two files naming the same port under different names are two
 * modules as far as a host is concerned.
 *
 * ## `dir` as well as `url`
 *
 * The url is where to talk to this app; the directory is where to start it. A
 * host that has only the first can frame a running module and can do nothing at
 * all about a stopped one, which in practice means a container saying "nothing is
 * answering" beside a Start button that is not there. With both, the host runs
 * `run.sh` inside this directory — one script, no arguments, for the reason that
 * file gives.
 *
 * It is this file's own location rather than a string, so a checkout moved or
 * cloned somewhere else registers itself correctly by being run.
 *
 * ## Where a host looks is not copied into this file
 *
 * The registry directory, the filename-carries-the-id rule and the shape of the
 * document are all in `kehikot-module-protocol/serve` (`registerAt`), so this
 * file cannot disagree with a host about them by a character. Writing to the
 * wrong directory is the worst failure a module can have: the host finds
 * nothing, and finds it silently. `KEHIKOT_MODULES_DIR` points it somewhere
 * disposable.
 *
 * 7980, and the number is not arbitrary.
 *
 * 7820 through 7970 are the other modules on this machine, and the explorer this
 * one pairs with holds the top of that range. A module that defaulted to a port
 * somebody else had would answer nothing, or worse, would fail to start while its
 * neighbour went on serving a page the host attributed to this one. `run.sh`
 * defaults to the same number for the same reason, and the two must not drift.
 */
const port = Number(process.env.PORT ?? 7980)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
