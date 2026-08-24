import { defineConfig } from '@mycelo/septum'
import type { EnzymeModule, TranslatableRef } from '@mycelo/septum'
import type { CalendarEntry, RadarrApi } from '@mycelo/spore-radarr'
import { z } from 'zod'

const schema = z.object({
  // The answer's length is the operator's choice, not the author's (design §8).
  defaultDays: z.number().int().min(1).max(365).default(30),
})

type Config = z.infer<typeof schema>

const isRef = (r: readonly CalendarEntry[] | TranslatableRef): r is TranslatableRef => 'domain' in r

export default {
  configSchema: defineConfig(schema),
  create: () => ({
    handlers: {
      handleUpcoming: async (invocation, ctx) => {
        const given = invocation.args['days']
        const days = given === undefined || given === ''
          ? ctx.config.defaultDays
          : Number.parseInt(given, 10)
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          await ctx.reply({ text: ctx.t('reply.usage') })
          return
        }
        const result = await ctx.rhiza<RadarrApi>('radarr').calendar(days)
        if (isRef(result)) {
          // radarr's domain is permitted because the manifest requires it (design §4.1).
          await ctx.reply({ text: ctx.t(result) })
          return
        }
        if (result.length === 0) {
          await ctx.reply({ text: ctx.t('reply.empty', { days }) })
          return
        }
        // Formatted here rather than as an ICU {date} placeholder: the repository's shared
        // render-every-key test formats with a bag of plain strings, and Intl throws on those.
        const when = new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium' })
        const lines = result.map((entry) => ctx.t(entry.hasFile ? 'reply.held' : 'reply.awaited', {
          title: entry.title,
          date: when.format(entry.releaseAt),
        }))
        await ctx.reply({ text: ctx.t('reply.list', { days, lines: lines.join('\n') }) })
      },
    },
  }),
} satisfies EnzymeModule<Config>
