import type { CommandsRead, EnzymeModule } from '@mycelo/septum'

// design §10: filtered on authorization by the core, rendered in the reader's own locale.
export default {
  create: () => ({
    handlers: {
      handleHelp: async (_invocation, ctx) => {
        const commands = await ctx.rhiza<CommandsRead>('mycelium').available(ctx.principal, ctx.locale)
        if (commands.length === 0) {
          await ctx.reply({ text: ctx.t('reply.none') })
          return
        }
        const lines = commands
          .map((c) => ctx.t('reply.line', { name: c.name, description: c.description }))
          .join('\n')
        await ctx.reply({ text: ctx.t('reply.list', { lines }) })
      },
    },
  }),
} satisfies EnzymeModule
