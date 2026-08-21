import { defineConfig } from '@mycelo/septum'
import type { EnzymeModule } from '@mycelo/septum'
import { z } from 'zod'

// No `.min(1)`: a required array with no default leaves a fresh install dormant before an
// operator can configure it (design §9.1) — `.default([])` keeps it germinated and makes
// the empty-case branch below reachable.
const schema = z.object({
  services: z.array(z.object({
    label: z.string().min(1),
    url: z.url(),
    note: z.string().optional(),
  })).default([]),
})

type Config = z.infer<typeof schema>

export default {
  configSchema: defineConfig(schema),
  create: () => ({
    handlers: {
      handleLinks: async (_invocation, ctx) => {
        const { services } = ctx.config
        if (services.length === 0) {
          await ctx.reply({ text: ctx.t('reply.empty') })
          return
        }
        const lines = services.map((s) => (s.note === undefined
          ? ctx.t('reply.line', { label: s.label, url: s.url })
          : ctx.t('reply.noted', { label: s.label, url: s.url, note: s.note })))
        // The whole layout lives in one key, as in the help spore: joining a header in code
        // leaves a translator unable to reorder it.
        await ctx.reply({ text: ctx.t('reply.list', { lines: lines.join('\n') }) })
      },
      handleLink: async (invocation, ctx) => {
        const label = invocation.args.label
        if (typeof label !== 'string' || label.length === 0) {
          await ctx.reply({ text: ctx.t('reply.usage') })
          return
        }
        const found = ctx.config.services.find((s) => s.label === label)
        if (found === undefined) {
          const known = ctx.config.services.map((s) => s.label).join(', ')
          await ctx.reply({ text: ctx.t('reply.unknown', { label, known }) })
          return
        }
        await ctx.reply({
          text: found.note === undefined
            ? ctx.t('reply.line', { label: found.label, url: found.url })
            : ctx.t('reply.noted', { label: found.label, url: found.url, note: found.note }),
        })
      },
    },
  }),
} satisfies EnzymeModule<Config>
