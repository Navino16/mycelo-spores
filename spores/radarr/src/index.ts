import { defineConfig } from '@mycelo/septum'
import type { HealthStatus, RhizaContext, RhizaModule, TranslatableRef } from '@mycelo/septum'
import { z } from 'zod'
import type { CalendarEntry, RadarrApi, SearchResult } from './api.js'
import { getJson, refFor, stateFor } from './http.js'
import type { Fetched } from './http.js'
import { parseCalendar, parseSearch, versionOf } from './parse.js'

const schema = z.object({
  url: z.url(),
  apiKey: z.string().min(1),
})

type Config = z.infer<typeof schema>

// A judgement, not a measurement: findings §6 could produce no hang longer than ~1s on this network,
// so 5s only has to leave room for a slow answer without making /api/health wait.
const TIMEOUT_MS = 5000

const DAY_MS = 86_400_000

export default {
  configSchema: defineConfig(schema, { secrets: ['apiKey'] }),
  create: () => {
    let ctx: RhizaContext<Config> | null = null

    const request = async (path: string): Promise<Fetched> => {
      if (ctx === null) return { ok: false, failure: 'unreachable', detail: 'not started' }
      // Trailing slashes trimmed rather than new URL(): an absolute pathname would drop the
      // subpath of a reverse-proxied install at /radarr.
      const base = ctx.config.url.replace(/\/+$/, '')
      return getJson(`${base}${path}`, { 'X-Api-Key': ctx.config.apiKey }, TIMEOUT_MS)
    }

    return {
      start: (given: RhizaContext<Config>) => {
        ctx = given
        return Promise.resolve()
      },
      stop: () => {
        ctx = null
        return Promise.resolve()
      },

      health: async (): Promise<HealthStatus> => {
        // The conformance kit calls health() and never start(), so that it does not dial the real
        // service. A rhiza reading its config here fails conformance with a TypeError.
        if (ctx === null) return { state: 'unreachable', detail: 'not started', checkedAt: new Date() }
        const result = await request('/api/v3/system/status')
        if (!result.ok) {
          return {
            state: stateFor(result.failure),
            detail: result.detail,
            checkedAt: new Date(),
          }
        }
        const version = versionOf(result.body)
        return version === null
          ? { state: 'degraded', detail: 'system/status carried no version', checkedAt: new Date() }
          : { state: 'healthy', detail: `Radarr ${version}`, checkedAt: new Date() }
      },

      api: {
        calendar: async (days: number): Promise<readonly CalendarEntry[] | TranslatableRef> => {
          const from = new Date()
          const to = new Date(from.getTime() + days * DAY_MS)
          const query = `start=${from.toISOString()}&end=${to.toISOString()}&unmonitored=false`
          const result = await request(`/api/v3/calendar?${query}`)
          if (!result.ok) {
            ctx?.logger.warn('radarr calendar failed', { failure: result.failure, detail: result.detail })
            return refFor(result.failure, result.detail)
          }
          const parsed = parseCalendar(result.body, from, to)
          if (parsed === null) {
            ctx?.logger.error('radarr calendar was not an array')
            return refFor('unexpected', 'calendar was not an array')
          }
          if (parsed.skipped > 0) {
            ctx?.logger.warn('radarr calendar carried unreadable entries', { skipped: parsed.skipped })
          }
          return parsed.entries
        },

        search: async (term: string): Promise<readonly SearchResult[] | TranslatableRef> => {
          const result = await request(`/api/v3/movie/lookup?term=${encodeURIComponent(term)}`)
          if (!result.ok) {
            ctx?.logger.warn('radarr lookup failed', { failure: result.failure, detail: result.detail })
            return refFor(result.failure, result.detail)
          }
          const parsed = parseSearch(result.body)
          if (parsed === null) {
            ctx?.logger.error('radarr lookup was not an array')
            return refFor('unexpected', 'lookup was not an array')
          }
          return parsed
        },
      },
    }
  },
} satisfies RhizaModule<Config, RadarrApi>
