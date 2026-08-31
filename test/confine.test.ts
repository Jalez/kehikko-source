import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contains, inside, rootOf } from '../file/confine.ts'

/**
 * Trying to get past the fence.
 *
 * This file is adversarial on purpose and it is the most important one in the
 * repository. Everything else here decides how to DRAW a file; this decides
 * WHICH file, and the caller is a passage — a path chosen by some other program
 * on the canvas, which the protocol itself describes as a rumour.
 *
 * The stakes are higher than at the module this fence was copied from. A hole in
 * the explorer's version leaks the NAMES of somebody's files. A hole in this one
 * leaks their contents: `.env`, an unpushed draft, a key in a working tree.
 *
 * `mkdtemp` under the system temp directory, and every expectation is written
 * against a `realpath` of the root rather than the string handed to `mkdtemp` —
 * on macOS `/tmp` is a symlink to `/private/tmp`, so a test that compared raw
 * strings would pass for the wrong reason on one platform and fail on another.
 */

const scratch = mkdtempSync(join(tmpdir(), 'source-confine-'))
const project = join(scratch, 'project')
const outside = join(scratch, 'outside')

mkdirSync(project, { recursive: true })
mkdirSync(join(project, 'src'), { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(project, 'ok.txt'), 'inside\n')
writeFileSync(join(project, 'src', 'deep.ts'), 'const a = 1\n')
writeFileSync(join(outside, 'secret.txt'), 'not yours\n')
/* A sibling whose name merely BEGINS with the root's. The oldest bug in this
   family lives here. */
mkdirSync(`${project}-evil`, { recursive: true })
writeFileSync(join(`${project}-evil`, 'secret.txt'), 'not yours either\n')

symlinkSync(join(outside, 'secret.txt'), join(project, 'escape.txt'))
symlinkSync(outside, join(project, 'escape-dir'))
symlinkSync(join(project, 'ok.txt'), join(project, 'friendly.txt'))

/* `realpath` rather than `resolve`, and this line is the test file's own version
   of the bug it is testing for: on macOS `/tmp` is a symlink to `/private/tmp`,
   so a string built from `mkdtemp`'s answer is not what the fence returns. */
const root = realpathSync(project)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('inside', () => {
  test('a plain file under the root resolves', () => {
    expect(inside(root, 'ok.txt')).toBe(join(root, 'ok.txt'))
  })

  test('a nested file resolves', () => {
    expect(inside(root, 'src/deep.ts')).toBe(join(root, 'src', 'deep.ts'))
  })

  test('the absolute spelling of the same file resolves — a passage carries absolute paths', () => {
    expect(inside(root, join(root, 'ok.txt'))).toBe(join(root, 'ok.txt'))
  })

  test('an absolute path spelled under the SYMLINKED root still resolves', () => {
    /*
     * The bug that only appears when the module is pointed at a real project.
     *
     * A passage carries an absolute path built from the host's `projectPath`. If
     * that path runs through a symlink — which on macOS every temporary
     * directory does — the spelling in the passage is not the spelling this
     * fence realpath'd, and a lexical check between the two fails. The module
     * then refuses every file in the project it was pointed at, with the same
     * sentence it uses for `/etc/shadow`.
     */
    expect(inside(root, join(project, 'ok.txt'))).toBe(join(root, 'ok.txt'))
    expect(inside(project, join(project, 'src', 'deep.ts'))).toBe(join(root, 'src', 'deep.ts'))
  })

  test('a dot-dot escape through the symlinked spelling is still refused', () => {
    /* The other half of the line above: re-expressing a path relative to the
       root must not become a way to smuggle one past the check that matters. */
    expect(inside(root, join(project, '..', 'outside', 'secret.txt'))).toBeNull()
    expect(inside(root, `${project}/../../etc/passwd`)).toBeNull()
  })

  test('a dot-dot escape is refused', () => {
    expect(inside(root, '../outside/secret.txt')).toBeNull()
  })

  test('a dot-dot escape wearing a legitimate prefix is refused', () => {
    expect(inside(root, 'src/../../outside/secret.txt')).toBeNull()
  })

  test('an absolute path elsewhere on the disk is refused', () => {
    expect(inside(root, '/etc/passwd')).toBeNull()
  })

  test('a symlink pointing at a file outside the root is refused', () => {
    /* This is the one a lexical check passes: the path is `<root>/escape.txt`,
       which starts with the root, and it opens a file that does not. */
    expect(inside(root, 'escape.txt')).toBeNull()
  })

  test('a file reached through a symlinked directory outside the root is refused', () => {
    expect(inside(root, 'escape-dir/secret.txt')).toBeNull()
  })

  test('a symlink pointing back inside the root is allowed, at its real path', () => {
    /* Refusing every symlink would be a simpler fence and a wrong one: a project
       with a linked file in it is ordinary, and what matters is where the link
       LANDS. */
    expect(inside(root, 'friendly.txt')).toBe(join(root, 'ok.txt'))
  })

  test('/project-evil does not pass a /project check', () => {
    expect(inside(root, join(`${root}-evil`, 'secret.txt'))).toBeNull()
  })

  test('a path that does not exist is refused rather than accepted lexically', () => {
    /* The sibling module's bug, written down as a test. A path this process
       cannot resolve is a path it knows nothing about, and "it is under the root
       as a string" is not a sentence a fence gets to say. */
    expect(inside(root, 'not-there.txt')).toBeNull()
    expect(inside(root, 'src/also/not/there.ts')).toBeNull()
  })

  test('the root itself resolves, and an empty path means the root', () => {
    expect(inside(root, '')).toBe(root)
    expect(inside(root, '.')).toBe(root)
  })

  test('a relative or empty root is refused outright', () => {
    expect(inside('', 'ok.txt')).toBeNull()
    expect(inside('project', 'ok.txt')).toBeNull()
  })

  test('a root that cannot be resolved is refused', () => {
    expect(inside(join(scratch, 'no-such-project'), 'ok.txt')).toBeNull()
  })

  test('every refusal is the same refusal', () => {
    /* Three distinguishable answers would let a caller ask whether a file it may
       not see exists, one question at a time. They are all null. */
    const answers = [
      inside(root, '../outside/secret.txt'),
      inside(root, 'not-there.txt'),
      inside(root, 'escape.txt'),
      inside(root, '/etc/shadow'),
    ]
    expect(new Set(answers)).toEqual(new Set([null]))
  })
})

describe('contains', () => {
  test('a directory contains itself', () => {
    expect(contains('/a/b', '/a/b')).toBe(true)
  })

  test('a directory contains what is under it', () => {
    expect(contains('/a/b', '/a/b/c')).toBe(true)
  })

  test('a sibling whose name begins with it is not under it', () => {
    expect(contains('/project', '/project-evil')).toBe(false)
    expect(contains('/project', '/project-evil/secret.txt')).toBe(false)
  })

  test('a trailing separator on the root changes nothing', () => {
    expect(contains('/a/b/', '/a/b/c')).toBe(true)
    expect(contains('/a/b/', '/a/bc')).toBe(false)
  })
})

describe('rootOf', () => {
  test('an absolute directory that exists is a root', () => {
    expect(rootOf(project)).toBe(root)
  })

  test('a relative root is refused, so this app never explores its own source', () => {
    expect(rootOf('.')).toBeNull()
    expect(rootOf('src')).toBeNull()
  })

  test('an empty or missing root is refused', () => {
    expect(rootOf('')).toBeNull()
    expect(rootOf(null)).toBeNull()
    expect(rootOf(undefined)).toBeNull()
  })

  test('a root that does not exist is refused', () => {
    expect(rootOf(join(scratch, 'nope'))).toBeNull()
  })

  describe('with SOURCE_ROOTS configured', () => {
    test('a root inside a configured directory is allowed and one outside is not', () => {
      const was = process.env.SOURCE_ROOTS
      process.env.SOURCE_ROOTS = project
      try {
        expect(rootOf(project)).toBe(root)
        expect(rootOf(join(project, 'src'))).toBe(join(root, 'src'))
        expect(rootOf(outside)).toBeNull()
        /* And the prefix trap again, at the other fence. */
        expect(rootOf(`${project}-evil`)).toBeNull()
      } finally {
        if (was === undefined) delete process.env.SOURCE_ROOTS
        else process.env.SOURCE_ROOTS = was
      }
    })
  })
})
