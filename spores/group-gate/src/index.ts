import { defineConfig } from '@mycelo/septum'
import type { InhibitorModule } from '@mycelo/septum'
import { z } from 'zod'

const schema = z.object({
  channel: z.string().min(1),
  groupId: z.string().min(1),
})

type Config = z.infer<typeof schema>

export default {
  configSchema: defineConfig(schema),
  create: () => {
    let config: Config | null = null
    return {
      start: (ctx) => {
        config = ctx.config
        // Throws when the configured channel cannot report members, so the spore goes
        // dormant instead of admitting everyone (design §8, core design §5.1).
        ctx.requireCapability(config.channel, 'group_membership')
        return Promise.resolve()
      },
      stop: () => Promise.resolve(),
      inspect: async (message, ctx) => {
        if (config === null) return { allow: false, reason: ctx.t('reason.unstarted') }
        if (message.channel !== config.channel) return { allow: true }
        const members = await ctx.groupMembers(config.channel, config.groupId)
        if (members === null) return { allow: false, reason: ctx.t('reason.unavailable') }
        const member = members.some(
          (m) => m.channel === message.sender.channel && m.externalId === message.sender.externalId,
        )
        return member ? { allow: true } : { allow: false, reason: ctx.t('reason.not-member') }
      },
    }
  },
} satisfies InhibitorModule<Config>
