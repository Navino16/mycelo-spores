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
          .map((c) => {
            if (c.args === undefined || c.args.length === 0) {
              return ctx.t('reply.line', { name: c.name, description: c.description })
            }
            const args = c.args
              .map((a) => ctx.t('reply.arg', {
                name: a.name,
                description: a.description,
                state: a.required ? ctx.t('reply.argRequired') : ctx.t('reply.argOptional'),
              }))
              .join('\n')
            return ctx.t('reply.lineWithArgs', { name: c.name, description: c.description, args })
          })
          .join('\n')
        await ctx.reply({ text: ctx.t('reply.list', { lines }) })
      },
    },
  }),
} satisfies EnzymeModule
