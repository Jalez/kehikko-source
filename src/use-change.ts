import { ask } from 'kehikot-module-protocol/client'
import { useCallback, useEffect, useState } from 'react'

import type { CodeTarget } from '@/live/change.ts'
import type { Seen } from '@/use-source.ts'

/**
 * One file of one change, asked of this app's own door (`/api/change`), which
 * reads it out of a commit and never off the disk. The `useSource` of a change:
 * keyed on the primitives that change what is read, every late answer dropped,
 * the previous file kept on screen until the next one is ready.
 */

export type ChangeSeen = Exclude<Seen, { kind: 'folder' }> & {
  /** The commit it was read at. */
  commit: string
  change: string
  side: 'new' | 'old'
}

export interface ChangeSource {
  seen: ChangeSeen | null
  trouble: string | null
  reading: boolean
  retry: () => void
}

export function useChange(projectPath: string | null, target: CodeTarget | null): ChangeSource {
  const [seen, setSeen] = useState<ChangeSeen | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [again, setAgain] = useState(0)
  const retry = useCallback(() => setAgain((n) => n + 1), [])

  const change = target?.change ?? null
  const path = target?.path ?? null
  const side = target?.side ?? 'new'
  const line = target?.line ?? null
  const endLine = target?.endLine ?? null
  const commit = target?.commit ?? null
  const url = target?.url ?? null

  useEffect(() => {
    if (!projectPath || !change || !path) {
      setSeen(null)
      setTrouble(null)
      setReading(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setReading(true)
    const query: Record<string, string> = { projectPath, change, path, side }
    if (line !== null) query.line = String(line)
    if (endLine !== null) query.endLine = String(endLine)
    if (commit) query.commit = commit
    if (url) query.url = url
    void ask<ChangeSeen>('./api/change', { query, signal: controller.signal, ticket: true }).then((asked) => {
      if (cancelled || controller.signal.aborted) return
      setReading(false)
      if (asked.ok) {
        setTrouble(null)
        setSeen(asked.body)
        return
      }
      if (asked.kind === 'down') return
      setSeen(null)
      const said = (asked.body as { error?: unknown } | null)?.error
      setTrouble(typeof said === 'string' && said ? said : 'That file could not be read from the change.')
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [projectPath, change, path, side, line, endLine, commit, url, again])

  return { seen, trouble, reading, retry }
}
