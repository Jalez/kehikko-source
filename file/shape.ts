/**
 * What this app is willing to say about a file, and every bound it puts on
 * saying it.
 *
 * Shapes and numbers only — no filesystem, no React — because the server and
 * the page both work in these, and a second definition of "what a file looks
 * like from here" is two programs that agree until the day they do not.
 */

/**
 * A path in a request. The protocol's own `LIMITS.PATH` is 4096; this matches
 * it, because the paths that arrive here are passage paths and a passage is
 * bounded by that number on the wire.
 */
export const MAX_PATH = 4096

/**
 * The byte ceiling: how much of a file this app will ever hold, decode, ship
 * and draw.
 *
 * 256 KiB, and the number was chosen against the failure rather than against a
 * feeling. The failure is a container on somebody's canvas going unresponsive
 * because a passage named a 40 MB build log or a 6 MB minified bundle, and it
 * has three distinct costs that all have to be under control at once:
 *
 *   - reading and decoding, which is the cheapest of the three;
 *   - shipping it through `fetch` as JSON, where the string is escaped and can
 *     double;
 *   - and highlighting it, which walks every character and builds a tree.
 *
 * The third is what sets the number. Syntax highlighting 256 KiB of TypeScript
 * takes tens of milliseconds; a megabyte takes long enough to drop frames, and
 * ten megabytes takes long enough that the person concludes the app has hung.
 * There is no partial credit available there — the highlighter is synchronous —
 * so the honest place to stop is before it starts.
 *
 * A quarter of a megabyte is also a comfortable amount of source. Every file in
 * this repository, every file in the roadmap host, and every chapter of the
 * thesis this workspace was built around fits under it with room to spare. What
 * does not fit is exactly the class of file nobody reads top to bottom anyway.
 *
 * **It is never a silent truncation.** `read.ts` reports the file's real size
 * alongside what it returned, and the page says so in a line of its own — the
 * explorer's `15,000 more here than this shows` is the register to match. A
 * container that drew a quarter of a file with nothing saying so would be lying
 * about the disk in the one place somebody is looking to find out what is on it.
 */
export const MAX_BYTES = 262_144

/**
 * How many lines of the window may be drawn.
 *
 * A second bound, on a different axis, because the byte ceiling does not
 * constrain this one usefully: 256 KiB of a log with sixteen-byte lines is
 * sixteen thousand of them. Every line is a DOM element with highlighted spans
 * inside it and this page does not virtualize — see the essay in
 * `src/view/code.tsx` for why wrapping and virtualization cannot both be had —
 * so the number of elements has to be bounded somewhere, and four thousand is
 * where a render stays under a frame on the machines this runs on.
 *
 * Four thousand lines is also more than anybody scrolls through in a 300-pixel
 * container. The bound that people will actually meet is the byte one.
 */
export const MAX_LINES = 4_000

/**
 * How many bytes to sniff when deciding whether a file is text.
 *
 * 8192, which is git's number for the same decision, and it is copied
 * deliberately rather than picked: a person's intuition about which of their
 * files are binary is largely trained by git, and a module that disagreed with
 * `git diff` about a file would be the one that is wrong in their eyes even
 * where it is right in principle.
 */
export const SNIFF_BYTES = 8192

/**
 * How many lines of lead to keep above a marked range when the range is too
 * far into a file to show from the top.
 *
 * Enough that the highlighted range does not sit against the top edge with no
 * context above it — a selection with nothing before it reads as the start of
 * the file, which is precisely the wrong impression. Not so many that the
 * reader has to scroll to find what they were pointed at.
 */
export const LINE_LEAD = 40

/** Bytes of lead when the window has to be anchored on a range in a large file. */
export const BYTE_LEAD = 8_192

/** One file, as this app is willing to describe it. */
export interface Text {
  kind: 'text'
  /** Where it is, absolute, as this app resolved it. */
  path: string
  /** How big the whole file is, in bytes. */
  size: number
  /** The bytes of it that `text` was decoded from. */
  read: number
  /** The byte offset in the file where `text` begins. Always a line boundary, or 0. */
  at: number
  /** The lines being shown, joined. Never a partial line at either end unless the file has no newline at all. */
  text: string
  /** The 1-based line number in the file of the first line of `text`. */
  firstLine: number
  /** Whether `text` reaches both ends of the file. False means something was left out. */
  whole: boolean
  /**
   * Where to highlight, as indices into `text` — CHARACTERS, not bytes.
   *
   * The passage carries bytes, because that is what the protocol says and it is
   * the only unit two modules can agree on without agreeing on an encoding.
   * A browser holds UTF-16 code units. Converting between them needs the actual
   * bytes, which only the server has, so the conversion happens there and the
   * page receives something it can hand straight to a `slice`. A page doing this
   * arithmetic itself would be guessing, and would be wrong by exactly the
   * number of non-ASCII characters before the selection.
   */
  mark: { from: number; to: number } | null
  /**
   * A range was asked for and none of it is in `text`.
   *
   * Distinguished from `mark: null` because they are different facts and the
   * page says different things about them: nothing was selected, versus what
   * was selected is past the end of what this container can show.
   */
  markLost: boolean
  /**
   * What to highlight it as, by highlight.js's name for the language, or null
   * for "no idea, draw it plain". Guessed from the extension — see `tongue`.
   */
  language: string | null
}

/** A file this app can see and will not decode. */
export interface Binary {
  kind: 'binary'
  path: string
  size: number
  /** A word for what it probably is, from the extension, or null. Never a claim about the contents. */
  looks: string | null
}

/** A directory. Not a refusal: it is a perfectly real thing, and it is not a document. */
export interface Folder {
  kind: 'folder'
  path: string
}

export type Seen = Text | Binary | Folder

/** A string argument, bounded, or `''`. Nothing here defaults a missing value into a real one. */
export function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > max ? '' : trimmed
}

/**
 * A byte offset, or null.
 *
 * Null rather than a default, so that a malformed `from` is never silently read
 * as zero — which would be this app highlighting the top of a file because
 * somebody's arithmetic produced `NaN`, and looking entirely deliberate while it
 * did. `"120"` is accepted because a query string has no numbers in it.
 */
export function offset(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null
  return n
}

/**
 * A size in bytes, for a person, in the shortest form that is still true.
 *
 * Shared between the server's MCP answers and the page's own line, so that the
 * number an agent is told and the number a person reads are the same number
 * spelled the same way. Both audiences are looking at the same file.
 */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * What language to highlight a file as, from its name alone.
 *
 * ## Why not highlight.js's own automatic detection
 *
 * `highlightAuto` exists, it is one call, and it is refused for two reasons.
 *
 * It is slow in the way that matters: it runs every registered grammar over the
 * text and scores them, so the cost is the cost of highlighting multiplied by
 * the number of languages, on the interaction path, synchronously, in a frame
 * the person is watching.
 *
 * And it is wrong often enough to be worse than plain. Auto-detection on a
 * short file — a config, a `.env`, twelve lines of shell — routinely lands on
 * something confident and unrelated, and the failure is invisible: the file just
 * appears to be coloured strangely, and nothing on screen says the language was
 * a guess. An extension is a much weaker signal in principle and a much stronger
 * one in practice, because a person named the file.
 *
 * ## What is not in the table
 *
 * Anything this workspace does not open. The table is a list of the languages
 * somebody here will actually point the canvas at, and it is meant to be
 * extended by adding a line when a file comes up plain that should not have. A
 * name highlight.js has not registered would silently fall through to plain
 * text, which is the correct failure and is why the return is nullable.
 */
export function tongue(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const lower = name.toLowerCase()
  const whole = BY_NAME[lower]
  if (whole) return whole
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return null
  return BY_EXTENSION[lower.slice(dot + 1)] ?? null
}

/** Files whose whole name is the signal, because they have no extension to read. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'ini',
  'cargo.lock': 'ini',
}

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  tex: 'latex',
  sty: 'latex',
  cls: 'latex',
  bib: 'latex',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  diff: 'diff',
  patch: 'diff',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  vim: 'vim',
  dart: 'dart',
  scala: 'scala',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  txt: 'plaintext',
  log: 'plaintext',
}

/**
 * A word for what a binary file probably is, from its extension.
 *
 * Deliberately vague, and deliberately not a claim about the CONTENTS. This app
 * has decided not to decode the file; it has therefore not looked at it, and a
 * sentence saying "PNG image" about a file it refused to read would be
 * repeating the filename back as though it were a finding. What the page says
 * is built from this and reads as what it is — a guess from the name.
 */
export function looksLike(path: string): string | null {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot <= slash + 1) return null
  return BINARY_WORDS[path.slice(dot + 1).toLowerCase()] ?? null
}

const BINARY_WORDS: Record<string, string> = {
  png: 'an image',
  jpg: 'an image',
  jpeg: 'an image',
  gif: 'an image',
  webp: 'an image',
  avif: 'an image',
  ico: 'an image',
  bmp: 'an image',
  tiff: 'an image',
  heic: 'an image',
  pdf: 'a PDF',
  zip: 'an archive',
  gz: 'an archive',
  tar: 'an archive',
  bz2: 'an archive',
  xz: 'an archive',
  '7z': 'an archive',
  rar: 'an archive',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  woff: 'a font',
  woff2: 'a font',
  ttf: 'a font',
  otf: 'a font',
  eot: 'a font',
  so: 'a binary',
  dylib: 'a binary',
  dll: 'a binary',
  exe: 'a binary',
  o: 'a binary',
  a: 'a binary',
  wasm: 'a binary',
  class: 'a binary',
  pyc: 'a binary',
  db: 'a database',
  sqlite: 'a database',
  sqlite3: 'a database',
}
