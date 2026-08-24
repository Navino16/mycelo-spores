import type {
  ConversationsRead, EnzymeModule, LocaleManage, MessagesBroadcast, PluginsConfigure, PluginsRead,
  PluginsToggle, PrincipalsRead, RestrictionsManage, RolesAssign, RolesManage, RolesRead,
} from '@mycelo/septum'

// JSON first, raw string as the fallback: a chat channel has no types, and Zod must receive
// 8080 as a number while http://x is not valid JSON and has to stay a string.
function coerce(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return raw }
}

export default {
  create: () => ({
    handlers: {
      handlePlugins: async (_invocation, ctx) => {
        const names = ctx.rhiza<PluginsRead>('mycelium').listPlugins().map((p) => p.name)
        await ctx.reply({
          text: names.length === 0
            ? ctx.t('reply.plugins.none')
            : ctx.t('reply.plugins.list', { names: names.join(', ') }),
        })
      },
      handleWhoami: async (invocation, ctx) => {
        const { channel, externalId } = invocation.message.sender
        const roles = ctx.principal.roles.join(', ') || ctx.t('reply.whoami.no-roles')
        await ctx.reply({ text: ctx.t('reply.whoami.text', { channel, externalId, roles }) })
      },
      handleRoles: async (_invocation, ctx) => {
        const roles = await ctx.rhiza<RolesRead>('mycelium').listRoles()
        if (roles.length === 0) {
          await ctx.reply({ text: ctx.t('reply.roles.none') })
          return
        }
        const lines = roles
          .map((r) => `${r.name}: ${r.patterns.join(', ') || ctx.t('reply.roles.no-patterns')}`)
          .join('; ')
        await ctx.reply({ text: ctx.t('reply.roles.list', { roles: lines }) })
      },
      handleGrant: async (invocation, ctx) => {
        const { role, who } = invocation.args
        // noUncheckedIndexedAccess widens Invocation.args per key, and `required` is a /help
        // hint rather than a gate (design §5), so the handler owns the absent case.
        if (role === undefined || who === undefined) {
          await ctx.reply({ text: ctx.t('reply.grant.usage') })
          return
        }
        const channel = invocation.message.channel
        const identity = await ctx.rhiza<PrincipalsRead>('mycelium').findByIdentity(channel, who)
        if (identity === null) {
          await ctx.reply({ text: ctx.t('reply.grant.unknown', { who, channel }) })
          return
        }
        // The mycelium curates its own diagnostics ("role 'x' does not exist") and they are
        // not this spore's catalogue to translate; letting the throw reach the bus would
        // replace them all with "command 'grant' failed".
        try {
          await ctx.rhiza<RolesAssign>('mycelium').assignRole(identity.id, role)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: ctx.t('reply.grant.done', { role, who }) })
      },
      handleRevoke: async (invocation, ctx) => {
        const { role, who } = invocation.args
        if (role === undefined || who === undefined) {
          await ctx.reply({ text: ctx.t('reply.revoke.usage') })
          return
        }
        const channel = invocation.message.channel
        const identity = await ctx.rhiza<PrincipalsRead>('mycelium').findByIdentity(channel, who)
        if (identity === null) {
          await ctx.reply({ text: ctx.t('reply.revoke.unknown', { who, channel }) })
          return
        }
        try {
          await ctx.rhiza<RolesAssign>('mycelium').revokeRole(identity.id, role)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: ctx.t('reply.revoke.done', { role, who }) })
      },
      // Only `name` is a declared arg spec, so bindArgs binds the whole remainder to it;
      // the patterns after the name are parsed from invocation.rest instead.
      handleRoleNew: async (invocation, ctx) => {
        const rest = invocation.rest.trim()
        const space = rest.indexOf(' ')
        const name = space === -1 ? rest : rest.slice(0, space)
        const patterns = space === -1 ? [] : rest.slice(space + 1).trim().split(/\s+/).filter((p) => p !== '')
        if (name === '') {
          await ctx.reply({ text: ctx.t('reply.role-new.usage') })
          return
        }
        try {
          await ctx.rhiza<RolesManage>('mycelium').createRole(name, patterns)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        const rendered = patterns.join(', ') || ctx.t('reply.role-new.no-patterns')
        await ctx.reply({ text: ctx.t('reply.role-new.done', { name, patterns: rendered }) })
      },
      handlePluginList: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsRead>('mycelium')
        const lines = mycelium.listPlugins()
          .map((p) => `${p.name} (${p.kind ?? ctx.t('reply.plugin-list.unknown-kind')}) — ${p.state}`)
          .join('\n')
        await ctx.reply({
          text: lines === '' ? ctx.t('reply.plugin-list.none') : ctx.t('reply.plugin-list.list', { lines }),
        })
      },
      handlePluginEnable: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsToggle>('mycelium')
        const name = invocation.args['name'] ?? ''
        // The refusal reason is what tells the operator what to fix; swallowing it
        // would leave nothing but "failed".
        try {
          await mycelium.enable(name)
          await ctx.reply({ text: ctx.t('reply.plugin-enable.done', { name }) })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginDisable: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsToggle>('mycelium')
        const name = invocation.args['name'] ?? ''
        try {
          await mycelium.disable(name)
          await ctx.reply({ text: ctx.t('reply.plugin-disable.done', { name }) })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginSet: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsConfigure>('mycelium')
        const { name, key, value } = invocation.args
        try {
          await mycelium.setSetting(name ?? '', key ?? '', coerce(value ?? ''))
          await ctx.reply({ text: ctx.t('reply.plugin-set.done', { key: key ?? '', name: name ?? '' }) })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginConfig: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsConfigure>('mycelium')
        let settings: Record<string, unknown>
        try {
          settings = await mycelium.settings(invocation.args['name'] ?? '')
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        const lines = Object.entries(settings).map(([k, v]) => `${k} = ${String(v)}`).join('\n')
        await ctx.reply({
          text: lines === '' ? ctx.t('reply.plugin-config.none') : ctx.t('reply.plugin-config.list', { lines }),
        })
      },
      handleConversations: async (_invocation, ctx) => {
        const rows = await ctx.rhiza<ConversationsRead>('mycelium').listConversations()
        if (rows.length === 0) {
          await ctx.reply({ text: ctx.t('reply.conversations.none') })
          return
        }
        const lines = rows.map((c) => `${c.label ?? c.conversationId} (${c.kind})`).join('\n')
        await ctx.reply({ text: ctx.t('reply.conversations.list', { lines }) })
      },
      handleWhereRule: async (invocation, ctx) => {
        const { pattern, where } = invocation.args
        if (pattern === undefined || (where !== 'dm' && where !== 'group')) {
          await ctx.reply({ text: ctx.t('reply.where-rule.usage') })
          return
        }
        try {
          await ctx.rhiza<RestrictionsManage>('mycelium').setContextRule(pattern, where)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: ctx.t('reply.where-rule.done', { pattern, where }) })
      },
      handleBroadcastAdd: async (invocation, ctx) => {
        const { channel, conversation } = invocation.args
        if (channel === undefined || conversation === undefined) {
          await ctx.reply({ text: ctx.t('reply.broadcast-add.usage') })
          return
        }
        await ctx.rhiza<RestrictionsManage>('mycelium')
          .addBroadcastTarget({ channel, conversationId: conversation })
        await ctx.reply({ text: ctx.t('reply.broadcast-add.done', { channel, conversation }) })
      },
      handleBroadcast: async (invocation, ctx) => {
        const text = invocation.rest.trim()
        if (text === '') {
          await ctx.reply({ text: ctx.t('reply.broadcast.usage') })
          return
        }
        const results = await ctx.rhiza<MessagesBroadcast>('mycelium').broadcast({ text })
        const ok = results.filter((r) => r.ok).length
        await ctx.reply({
          text: ctx.t('reply.broadcast.done', { ok: String(ok), failed: String(results.length - ok) }),
        })
      },
      // Only `name` is a declared arg spec, so bindArgs binds the whole remainder to it;
      // the channels after the name are parsed from invocation.rest instead.
      handleInhibitorChannels: async (invocation, ctx) => {
        const rest = invocation.rest.trim()
        const space = rest.indexOf(' ')
        const name = space === -1 ? rest : rest.slice(0, space)
        const channels = space === -1 ? [] : rest.slice(space + 1).trim().split(/\s+/).filter((c) => c !== '')
        if (name === '') {
          await ctx.reply({ text: ctx.t('reply.inhibitor-channels.usage') })
          return
        }
        try {
          await ctx.rhiza<RestrictionsManage>('mycelium').setInhibitorChannels(name, channels)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({
          text: channels.length === 0
            ? ctx.t('reply.inhibitor-channels.all', { name })
            : ctx.t('reply.inhibitor-channels.list', { name, channels: channels.join(', ') }),
        })
      },
      handleLang: async (invocation, ctx) => {
        const locale = invocation.args['locale']
        if (locale === undefined) {
          await ctx.reply({ text: ctx.t('reply.lang.usage') })
          return
        }
        try {
          await ctx.rhiza<LocaleManage>('mycelium').setPrincipalLocale(ctx.principal.id, locale)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        // Explicit locale: the one resolved for this message is the old one, so a
        // confirmation without it would answer in the language just abandoned.
        await ctx.reply({ text: ctx.t('reply.lang.set', { locale }, locale) })
      },
      handleLangGroup: async (invocation, ctx) => {
        const locale = invocation.args['locale']
        const { group, channel, conversationId } = invocation.message
        if (locale === undefined) {
          await ctx.reply({ text: ctx.t('reply.lang-group.usage') })
          return
        }
        if (group === undefined) {
          await ctx.reply({ text: ctx.t('reply.lang-group.group-only') })
          return
        }
        try {
          await ctx.rhiza<LocaleManage>('mycelium').setConversationLocale(channel, conversationId, locale)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: ctx.t('reply.lang-group.set', { locale }, locale) })
      },
    },
  }),
} satisfies EnzymeModule
