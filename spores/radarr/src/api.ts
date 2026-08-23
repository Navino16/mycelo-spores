import type { TranslatableRef } from '@mycelo/septum'

/** One film in Radarr's release calendar. */
export interface CalendarEntry {
  title: string
  /** The release the entry is in the requested window for (findings §2). */
  releaseAt: Date
  /** Radarr already holds a file for this film. */
  hasFile: boolean
}

export interface SearchResult {
  title: string
  year: number
  inLibrary: boolean
}

/**
 * What `ctx.rhiza<RadarrApi>('radarr')` resolves to. Every method answers data or a
 * TranslatableRef for the caller to render — never a throw and never null (design §6).
 */
export interface RadarrApi {
  calendar(days: number): Promise<readonly CalendarEntry[] | TranslatableRef>
  search(term: string): Promise<readonly SearchResult[] | TranslatableRef>
}
