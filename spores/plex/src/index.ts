import { defineConfig } from '@mycelo/septum'
import type { HealthStatus, RhizaContext, RhizaModule, TranslatableRef } from '@mycelo/septum'
import { z } from 'zod'
import type { PlexApi, PlexSession } from './api.js'
import { getJson, refFor, stateFor } from './http.js'
import type { Fetched } from './http.js'
import { parseSessions, versionOf } from './parse.js'

const schema = z.object({
  url: z.url(),
  token: z.string().min(1),
})

type Config = z.infer<typeof schema>

// See radarr's: a judgement above the ~1s connect ceiling findings §6 measured, not a measured hang.
const TIMEOUT_MS = 5000

// findings §5: without it Plex answers XML, which this spore cannot read.
const JSON_HEADERS = { Accept: 'application/json' }

export default {
  configSchema: defineConfig(schema, { secrets: ['token'] }),
  create: () => {
    let ctx: RhizaContext<Config> | null = null

    const get = async (path: string, extra: Record<string, string>): Promise<Fetched> => {
      if (ctx === null) return { ok: false, failure: 'unreachable', detail: 'not started' }
      const base = ctx.config.url.replace(/\/+$/, '')
      return getJson(`${base}${path}`, { ...JSON_HEADERS, ...extra }, TIMEOUT_MS)
    }

    // The token is a header, never a query parameter, which would put it in Plex's access log.
    const withToken = (): Record<string, string> =>
      (ctx === null ? {} : { 'X-Plex-Token': ctx.config.token })

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
        if (ctx === null) return { state: 'unreachable', detail: 'not started', checkedAt: new Date() }
        // design §4.3 claims a bad token is distinguishable from a dead host; one request cannot do
        // it. /identity needs no token, so it answers "is the box on", and /status/sessions then
        // answers "is the credential good". Both go through stateFor: a host answering 500 on
        // /identity is up and unwell, not unreachable.
        const identity = await get('/identity', {})
        if (!identity.ok) {
          return { state: stateFor(identity.failure), detail: identity.detail, checkedAt: new Date() }
        }
        const sessions = await get('/status/sessions', withToken())
        if (sessions.ok) {
          const version = versionOf(identity.body)
          // findings §4: /identity always carries a version, so a 200 without one is not the box the
          // operator thinks answered. Same rule as radarr's system/status.
          return version === null
            ? { state: 'degraded', detail: 'identity carried no version', checkedAt: new Date() }
            : { state: 'healthy', detail: `Plex ${version}`, checkedAt: new Date() }
        }
        return {
          state: stateFor(sessions.failure),
          detail: sessions.failure === 'unauthorized' ? `token rejected (${sessions.detail})` : sessions.detail,
          checkedAt: new Date(),
        }
      },

      api: {
        sessions: async (): Promise<readonly PlexSession[] | TranslatableRef> => {
          const result = await get('/status/sessions', withToken())
          if (!result.ok) {
            ctx?.logger.warn('plex sessions failed', { failure: result.failure, detail: result.detail })
            return refFor(result.failure, result.detail)
          }
          const parsed = parseSessions(result.body)
          if (parsed === null) {
            ctx?.logger.error('plex sessions carried no readable MediaContainer')
            return refFor('unexpected', 'no readable MediaContainer')
          }
          return parsed
        },
      },
    }
  },
} satisfies RhizaModule<Config, PlexApi>
