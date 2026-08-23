import type { CalendarEntry, SearchResult } from './api.js'

// Array.isArray narrows an unknown to any[], which turns every read below into a no-unsafe-*
// error; a local predicate keeps the elements unknown until asserted.
const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)

const asRecord = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !isArray(v) ? v as Record<string, unknown> : null)

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const asDate = (v: unknown): Date | null => {
  const raw = asString(v)
  if (raw === null) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const versionOf = (body: unknown): string | null => {
  const record = asRecord(body)
  return record === null ? null : asString(record['version'])
}

/**
 * Radarr carries three release dates and a film may have any subset (findings §2). The entry is in
 * the requested window because of one of them, so the earliest that falls inside it wins; with none
 * inside, the earliest that exists. Not `releaseDate`: findings §2.1 measured it outside the window
 * for nine of ten entries, so using it prints dates in the past.
 */
export function releaseOf(entry: Record<string, unknown>, from: Date, to: Date): Date | null {
  const dates = ['digitalRelease', 'physicalRelease', 'inCinemas']
    .map((field) => asDate(entry[field]))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())
  return dates.find((d) => d >= from && d <= to) ?? dates[0] ?? null
}

export interface ParsedCalendar {
  entries: readonly CalendarEntry[]
  /** Elements the parser could not read. Non-zero means the wire shape moved. */
  skipped: number
}

export function parseCalendar(body: unknown, from: Date, to: Date): ParsedCalendar | null {
  if (!isArray(body)) return null
  const entries: CalendarEntry[] = []
  let skipped = 0
  for (const raw of body) {
    const record = asRecord(raw)
    const title = record === null ? null : asString(record['title'])
    const releaseAt = record === null ? null : releaseOf(record, from, to)
    if (title === null || releaseAt === null || record === null) {
      skipped += 1
      continue
    }
    entries.push({ title, releaseAt, hasFile: record['hasFile'] === true })
  }
  entries.sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime())
  return { entries, skipped }
}

export function parseSearch(body: unknown): readonly SearchResult[] | null {
  if (!isArray(body)) return null
  const results: SearchResult[] = []
  for (const raw of body) {
    const record = asRecord(raw)
    if (record === null) continue
    const title = asString(record['title'])
    const year = record['year']
    if (title === null || typeof year !== 'number') continue
    // findings §3: a film already in the library carries an id; a miss carries no id key at all,
    // never a zero.
    const id = record['id']
    results.push({ title, year, inLibrary: typeof id === 'number' && id > 0 })
  }
  return results
}
