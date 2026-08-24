import type { TranslatableRef } from '@mycelo/septum'

export interface PlexSession {
  /** The episode's or the film's own title. */
  title: string
  /** The series an episode belongs to; absent for a film (findings §5). */
  series?: string
  user: string
  player: string
  /** Whole per cent watched, or null when Plex reported no usable duration. */
  progress: number | null
  /** Plex reports a paused session as a session; a consumer that does not say so misreports it. */
  paused: boolean
}

/** What `ctx.rhiza<PlexApi>('plex')` resolves to. Answers data or a ref, never a throw. */
export interface PlexApi {
  sessions(): Promise<readonly PlexSession[] | TranslatableRef>
}
