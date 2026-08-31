import { bytes } from '../../file/shape.ts'

/**
 * The screens that are not a file, and each one names why it is there.
 *
 * Every one of these is a place where a lesser version of this app would draw an
 * empty box and let the reader conclude something wrong. An empty box says "this
 * file is empty". These say which of the six quite different reasons that is —
 * and this module has more of them than its siblings, because it is the one
 * whose whole input arrives from somewhere else and can be absent, wrong,
 * unreadable, or not a document at all.
 *
 * ## The words are short on purpose
 *
 * The standing complaint about these modules is that they say too much on
 * screen. Every sentence below was longer once. What is left is the one fact a
 * person needs, in their words rather than in this codebase's private ones. The
 * reasoning that used to be on screen is in these comments, which is where it
 * belongs: it is for whoever changes this file, not for somebody trying to read
 * a file.
 *
 * There is no button on any of them, and that is a decision rather than an
 * omission. Every one of these states is fixed by pointing the canvas somewhere,
 * which is something the containers next door do and this one has given up the
 * right to — see `manifest.ts`. A press here that appeared to help and did
 * nothing would be worse than a sentence that is honest about who can act.
 */

/** Waiting for a greeting, for under a second, saying what it is waiting for. */
export function Listening() {
  return (
    <div className="p-3">
      <p className="text-xs text-muted-foreground">Waiting to be told what to show…</p>
    </div>
  )
}

/**
 * Nobody said where the project is, so there is no root and nothing may be
 * opened.
 *
 * `projectPath` is nullable on the wire for perfectly ordinary reasons — nobody
 * has opened a project, this page was opened directly on its own port, or the
 * host has no filesystem of its own to point at — and not one of them is this
 * app being broken. So there is no error colour.
 *
 * The heading appears only when nothing is framing this page. A host prints the
 * module's name in the container header; a page that also printed "Source" at
 * the top of itself would be saying the name twice and spending a fixed strip of
 * a short container on the repetition.
 */
export function NoProject({ unhosted }: { unhosted: boolean }) {
  return (
    <div className="space-y-2 p-3">
      {unhosted ? <h1 className="text-sm font-semibold">Source</h1> : null}
      <p data-testid="no-project" className="text-xs text-muted-foreground">
        {unhosted
          ? 'Nothing is framing this page, so nothing has said what to show.'
          : 'This canvas has not said which project is open.'}
      </p>
    </div>
  )
}

/**
 * There is a project and nothing is pointed at a file.
 *
 * A different fact from the one above and it gets a different sentence, which is
 * the whole reason both exist. "No project" is answered by opening one; "no
 * passage" is answered by pressing a file in the container next door. Collapsing
 * them into one apologetic line would leave the reader with no idea which of the
 * two they are in.
 *
 * It names the explorer, because on this canvas that is the thing that produces
 * a passage from nothing — every other producer needs a document to already be
 * open. Naming it is the difference between a dead end and an instruction.
 */
export function NoPassage() {
  return (
    <div className="p-3">
      <p data-testid="no-passage" className="text-xs text-muted-foreground">
        Nothing is pointing at a file yet. Press one in Explorer.
      </p>
    </div>
  )
}

/**
 * The passage named a directory.
 *
 * Reachable, and not by a bug: the explorer points only at files, but any module
 * may publish a passage, and a person can type a path at `/mcp`. The server
 * answers this as its own case rather than as a refusal — see `file/read.ts` —
 * because a directory is a real thing at a real path and saying "that is not
 * somewhere this app can look" about it would be false.
 */
export function Folder() {
  return (
    <div className="p-3">
      <p data-testid="folder" className="text-xs text-muted-foreground">
        That is a folder, not a file.
      </p>
    </div>
  )
}

/**
 * A file this app can see and will not decode.
 *
 * The size is here because it is the one thing worth knowing about a file you
 * cannot read, and because it is the honest evidence that this app did look. The
 * guess from the extension is hedged — `looks like an image` — for the reason
 * `looksLike` gives: this app decided not to decode the file, so it has not seen
 * inside it, and a confident "PNG image" would be repeating the filename back as
 * though it were a finding.
 */
export function Binary({ size, looks }: { size: number; looks: string | null }) {
  return (
    <div className="p-3">
      <p data-testid="binary" className="text-xs text-muted-foreground">
        Not text — {bytes(size)}
        {looks ? `, looks like ${looks}` : ''}.
      </p>
    </div>
  )
}

/** A real file with nothing in it. Worth its own sentence, because zero bytes and a failed read look identical. */
export function EmptyFile() {
  return (
    <div className="p-3">
      <p data-testid="empty" className="text-xs text-muted-foreground">
        This file is empty.
      </p>
    </div>
  )
}

/**
 * The file could not be read.
 *
 * The one screen drawn in a colour, because it is the one state where something
 * is actually wrong. The sentence comes from the server rather than being
 * composed here — `file/confine.ts` gives one refusal for "outside the project",
 * "does not exist" and "cannot be read", deliberately, and rewording it on the
 * way to the screen would be this page inventing a distinction the server
 * refused to draw.
 */
export function Trouble({ said }: { said: string }) {
  return (
    <div className="p-3">
      <p data-testid="trouble" className="text-xs text-red-600 dark:text-red-400">
        {said}
      </p>
    </div>
  )
}
