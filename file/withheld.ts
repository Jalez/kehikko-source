/**
 * Which files this app does not show, by where they are and what they are called.
 *
 * This container shows a file's CONTENTS, and a project folder holds a few files
 * whose contents are not for a screen: what a program signs in with. They are
 * recognised by name, the way everybody recognises them, and the rule is this
 * whole file:
 *
 *   - anything inside `.git`, `.ssh`, `.aws` or `.gnupg`;
 *   - a file called `.env`, or `.env.<anything>`, or `<anything>.env`;
 *   - `.netrc`, `.npmrc`, `.pgpass`;
 *   - a private key by its usual name: `id_rsa`, `id_dsa`, `id_ecdsa`,
 *     `id_ed25519`, and anything ending `.pem` or `.key`.
 *
 * Every other dot-file is shown — `.gitignore`, `.github/…`, and the project's
 * own `.kehikot/…`, where a paper's source lives. The path is judged twice by
 * its caller: as it was written and as it resolved, so a link with a plain name
 * is judged by what it leads to.
 *
 * `relative` is a path inside the project, with either kind of slash.
 */
const FOLDERS = new Set(['.git', '.ssh', '.aws', '.gnupg'])
const FILES = new Set(['.netrc', '.npmrc', '.pgpass', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])

export function withheld(relative: string): boolean {
  const segments = relative.replace(/\\/g, '/').split('/').filter(Boolean).map((one) => one.toLowerCase())
  if (segments.some((one) => FOLDERS.has(one))) return true
  const name = segments.at(-1) ?? ''
  return FILES.has(name) || name === '.env' || name.startsWith('.env.') || name.endsWith('.env') || name.endsWith('.pem') || name.endsWith('.key')
}

/** What a person is told. It names the rule, so the remedy — their own editor — is plain. */
export const WITHHELD =
  'This app does not show that file: by its name it is one that holds what a program signs in with (an .env file, a '
  + 'private key, something inside .git). Open it in your own editor.'
