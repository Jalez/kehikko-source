import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resetServerStanding, serverStanding } from 'kehikot-module-protocol/client'

import { TICKET, answer } from '../doors.ts'
import { useSource } from '../src/use-source.ts'

/* The page's one read against the real door, with `fetch` as the only thing faked. */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'source-wire-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))
writeFileSync(join(root, 'a.ts'), 'const a = 1\n')

const passage = { path: join(root, 'a.ts'), from: null, to: null, page: null, quoted: '', section: null }

const realFetch = globalThis.fetch
let carried = ''

beforeEach(() => {
  resetServerStanding()
  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify(TICKET)
  document.body.appendChild(island)
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    carried = (init.headers as Record<string, string>)['x-module-ticket'] ?? ''
    const at = new URL(url, 'http://localhost')
    const said = answer(String(init.method ?? 'GET'), at.pathname, at.searchParams, null, carried)
    return new Response(JSON.stringify(said?.body), { status: said?.status ?? 500 })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
})

describe('the page’s read', () => {
  test('carries the ticket printed into the page, which the door accepts', async () => {
    const { result } = renderHook(() => useSource(root, passage))
    await waitFor(() => expect(result.current.seen).not.toBeNull())
    expect(carried).toBe(TICKET)
    expect(result.current.seen?.kind === 'text' && result.current.seen.text).toBe('const a = 1')
    expect(serverStanding()).toBe('up')
  })

  test('a page older than its server is told so', async () => {
    document.getElementById('ticket')!.textContent = JSON.stringify('a-ticket-from-before-the-restart')
    const { result } = renderHook(() => useSource(root, passage))
    await waitFor(() => expect(serverStanding()).toBe('stale'))
    expect(result.current.seen).toBeNull()
  })
})
