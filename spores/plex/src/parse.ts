import type { PlexSession } from './api.js'

const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)

const asRecord = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !isArray(v) ? v as Record<string, unknown> : null)

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const versionOf = (body: unknown): string | null => {
  const container = asRecord(asRecord(body)?.['MediaContainer'])
  return container === null ? null : asString(container['version'])
}

function percentOf(offset: unknown, duration: unknown): number | null {
  const played = asNumber(offset)
  const total = asNumber(duration)
  if (played === null || total === null || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((played / total) * 100)))
}

export function parseSessions(body: unknown): readonly PlexSession[] | null {
  const container = asRecord(asRecord(body)?.['MediaContainer'])
  if (container === null) return null
  const metadata = container['Metadata']
  // Measured 2026-08-24: nothing playing returns a container with size:0 and no Metadata key.
  // See phase-7.6-admin ledger frames/plex-sessions-empty-MEASURED.json.
  if (metadata === undefined) return []
  if (!isArray(metadata)) return null
  const sessions: PlexSession[] = []
  for (const raw of metadata) {
    const record = asRecord(raw)
    if (record === null) continue
    const title = asString(record['title'])
    if (title === null) continue
    const series = asString(record['grandparentTitle'])
    sessions.push({
      title,
      ...(series === null ? {} : { series }),
      user: asString(asRecord(record['User'])?.['title']) ?? '?',
      player: asString(asRecord(record['Player'])?.['title']) ?? '?',
      progress: percentOf(record['viewOffset'], record['duration']),
      paused: asString(asRecord(record['Player'])?.['state']) === 'paused',
    })
  }
  return sessions
}
