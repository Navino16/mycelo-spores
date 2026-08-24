import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { enzymeChecks } from '@mycelo/septum/conformance'
import module from '../src/index.js'
import type { EnzymeContext, IncomingMessage, Invocation } from '@mycelo/septum'

const here = join(import.meta.dirname, '..')

/** Flattens the shipped catalogue to the dotted keys the core resolves. */
function catalogueKeys(file: string): Set<string> {
  const keys = new Set<string>()
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') { keys.add(prefix); return }
    if (typeof node !== 'object' || node === null) return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, prefix === '' ? k : `${prefix}.${k}`)
    }
  }
  walk(parseYaml(readFileSync(join(here, 'translations', file), 'utf8')), '')
  return keys
}

const KEYS = catalogueKeys('en.yaml')

/**
 * Throws on a key the shipped catalogue does not carry. Without it, renaming a key in every
 * catalogue leaves the suite green while the bot answers the literal key to a real user.
 */
function known(key: string): string {
  if (!KEYS.has(key)) throw new Error(`no such key in translations/en.yaml: ${key}`)
  return key
}

function msg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channel: 'console',
    conversationId: 'c:1',
    messageId: 'm:1',
    sender: { channel: 'console', externalId: 'alice' },
    text: '',
    attachments: [],
    raw: null,
    receivedAt: new Date(),
    ...overrides,
  }
}

const call = (command: string, args: Record<string, string> = {}, rest = '', message = msg()): Invocation =>
  ({ command, args, rest, message })

interface PluginRow { name: string, kind?: string, state: string }
interface RoleRow { name: string, patterns: string[] }
interface ConversationRow { label?: string, conversationId: string, kind: string }

// One mock covers every scope this spore requires; a test overrides only what it exercises.
interface Mycelium {
  listPlugins: () => PluginRow[]
  listRoles: () => Promise<RoleRow[]>
  findByIdentity: (channel: string, who: string) => Promise<{ id: string } | null>
  assignRole: (id: string, role: string) => Promise<void>
  revokeRole: (id: string, role: string) => Promise<void>
  createRole: (name: string, patterns: string[]) => Promise<void>
  enable: (name: string) => Promise<void>
  disable: (name: string) => Promise<void>
  setSetting: (name: string, key: string, value: unknown) => Promise<void>
  settings: (name: string) => Promise<Record<string, unknown>>
  listConversations: () => Promise<ConversationRow[]>
  setContextRule: (pattern: string, where: string) => Promise<void>
  addBroadcastTarget: (t: { channel: string, conversationId: string }) => Promise<void>
  broadcast: (c: { text: string }) => Promise<{ ok: boolean }[]>
  setInhibitorChannels: (name: string, channels: string[]) => Promise<void>
  setPrincipalLocale: (id: string, locale: string) => Promise<void>
  setConversationLocale: (channel: string, conversationId: string, locale: string) => Promise<void>
}

function defaultMycelium(): Mycelium {
  return {
    listPlugins: () => [],
    listRoles: () => Promise.resolve([]),
    findByIdentity: () => Promise.resolve(null),
    assignRole: () => Promise.resolve(),
    revokeRole: () => Promise.resolve(),
    createRole: () => Promise.resolve(),
    enable: () => Promise.resolve(),
    disable: () => Promise.resolve(),
    setSetting: () => Promise.resolve(),
    settings: () => Promise.resolve({}),
    listConversations: () => Promise.resolve([]),
    setContextRule: () => Promise.resolve(),
    addBroadcastTarget: () => Promise.resolve(),
    broadcast: () => Promise.resolve([]),
    setInhibitorChannels: () => Promise.resolve(),
    setPrincipalLocale: () => Promise.resolve(),
    setConversationLocale: () => Promise.resolve(),
  }
}

function stub(overrides: Partial<Mycelium> = {}, roles: readonly string[] = ['owner']) {
  const mycelium: Mycelium = { ...defaultMycelium(), ...overrides }
  const sent: { text?: string }[] = []
  const calls: [string, Record<string, unknown> | undefined, string | undefined][] = []
  const asked: string[] = []
  const ctx = {
    principal: { id: 'p1', roles, identities: [] },
    locale: 'en',
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => ctx.logger },
    rhiza: (name: string) => { asked.push(name); return mycelium },
    has: () => true,
    t: (key: string, params: Record<string, unknown> = {}, locale?: string) => {
      calls.push([key, params, locale])
      return `${known(key)}(${JSON.stringify(params)})`
    },
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<unknown>, sent, calls, asked, mycelium }
}

const { handlers } = module.create()

describe('the admin spore', () => {
  it('requires the mycelium rhiza, with the eleven scopes its handlers actually use', async () => {
    const manifest = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8')) as {
      requires?: readonly { rhiza?: string, scopes?: readonly string[] }[]
    }
    // Without this declaration the spore germinates clean and every command throws in the
    // core's bus while /api/health still reports germinated (phase 7.5B's whole-branch review).
    expect(manifest.requires).toEqual([{
      rhiza: 'mycelium',
      scopes: [
        'plugins.read', 'plugins.toggle', 'plugins.configure', 'principals.read', 'roles.read',
        'roles.assign', 'roles.manage', 'conversations.read', 'messages.broadcast',
        'restrictions.manage', 'locale.manage',
      ],
    }])
    const { ctx, asked } = stub()
    await handlers.handlePlugins(call('plugins'), ctx)
    expect(asked).toEqual(['mycelium'])
  })

  describe('plugins', () => {
    it('answers the empty case', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePlugins(call('plugins'), ctx)
      expect(sent[0]?.text).toBe('reply.plugins.none({})')
    })

    it('lists every installed plugin, not just the last', async () => {
      const { ctx, sent } = stub({ listPlugins: () => [{ name: 'radarr', state: 'germinated' }, { name: 'plex', state: 'germinated' }] })
      await handlers.handlePlugins(call('plugins'), ctx)
      expect(sent[0]?.text).toContain('radarr')
      expect(sent[0]?.text).toContain('plex')
    })
  })

  describe('whoami', () => {
    it('reports the sender and their roles', async () => {
      const { ctx, sent } = stub({}, ['owner', 'guest'])
      await handlers.handleWhoami(call('whoami', {}, '', msg({ sender: { channel: 'console', externalId: 'alice' } })), ctx)
      expect(sent[0]?.text).toContain('owner, guest')
    })

    it('falls back to a translated fallback when the principal holds no role', async () => {
      const { ctx, sent } = stub({}, [])
      await handlers.handleWhoami(call('whoami'), ctx)
      expect(sent[0]?.text).toContain(known('reply.whoami.no-roles'))
    })
  })

  describe('roles', () => {
    it('answers the empty case', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRoles(call('roles'), ctx)
      expect(sent[0]?.text).toBe('reply.roles.none({})')
    })

    it('lists every role and falls back for one with no patterns', async () => {
      const { ctx, sent } = stub({ listRoles: () => Promise.resolve([{ name: 'owner', patterns: ['*'] }, { name: 'empty', patterns: [] }]) })
      await handlers.handleRoles(call('roles'), ctx)
      expect(sent[0]?.text).toContain('owner')
      expect(sent[0]?.text).toContain(known('reply.roles.no-patterns'))
    })
  })

  describe('grant', () => {
    it('answers its own usage when a required argument is absent, rather than throwing', async () => {
      const { ctx, sent } = stub()
      await handlers.handleGrant(call('grant', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.grant.usage'))
    })

    it('names the channel and who when no identity matches', async () => {
      const { ctx, sent } = stub()
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toContain('bob')
      expect(sent[0]?.text).toContain('console')
    })

    it('confirms once the mycelium accepts the assignment', async () => {
      const { ctx, sent } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.grant.done'))
    })

    it('surfaces the mycelium’s own diagnostic untranslated rather than a generic failure', async () => {
      const { ctx, sent } = stub({
        findByIdentity: () => Promise.resolve({ id: 'p2' }),
        assignRole: () => Promise.reject(new Error("role 'guest' does not exist")),
      })
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toBe("role 'guest' does not exist")
    })
  })

  describe('revoke', () => {
    it('confirms once the mycelium accepts the revocation', async () => {
      const { ctx, sent } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
      await handlers.handleRevoke(call('revoke', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.revoke.done'))
    })
  })

  describe('role-new', () => {
    it('answers usage when the name is empty', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRoleNew(call('role-new', {}, ''), ctx)
      expect(sent[0]?.text).toContain(known('reply.role-new.usage'))
    })

    it('creates a role with the patterns parsed from rest', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRoleNew(call('role-new', {}, 'guest media.* help.*'), ctx)
      expect(sent[0]?.text).toContain('media.*')
      expect(sent[0]?.text).toContain('help.*')
    })

    it('falls back to a translated placeholder with no patterns at all', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRoleNew(call('role-new', {}, 'guest'), ctx)
      expect(sent[0]?.text).toContain(known('reply.role-new.no-patterns'))
    })
  })

  describe('plugin-list', () => {
    it('answers the empty case', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePluginList(call('plugin-list'), ctx)
      expect(sent[0]?.text).toBe('reply.plugin-list.none({})')
    })

    it('falls back to a translated placeholder for an unknown kind', async () => {
      const { ctx, sent } = stub({ listPlugins: () => [{ name: 'radarr', state: 'germinated' }] })
      await handlers.handlePluginList(call('plugin-list'), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-list.unknown-kind'))
    })
  })

  describe('plugin-enable / plugin-disable', () => {
    it('confirms once enabled', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePluginEnable(call('plugin-enable', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-enable.done'))
    })

    it('surfaces the refusal reason untranslated rather than a generic failure', async () => {
      const { ctx, sent } = stub({ enable: () => Promise.reject(new Error('apiKey: Invalid input')) })
      await handlers.handlePluginEnable(call('plugin-enable', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toBe('apiKey: Invalid input')
    })

    it('confirms once disabled', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePluginDisable(call('plugin-disable', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-disable.done'))
    })
  })

  describe('plugin-set', () => {
    it('coerces a JSON-shaped value before writing it', async () => {
      const written: unknown[] = []
      const { ctx, sent } = stub({ setSetting: (_n, _k, v) => { written.push(v); return Promise.resolve() } })
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'port', value: '8080' }), ctx)
      expect(written).toEqual([8080])
      expect(sent[0]?.text).toContain(known('reply.plugin-set.done'))
    })

    it('keeps a non-JSON value as a raw string', async () => {
      const written: unknown[] = []
      const { ctx } = stub({ setSetting: (_n, _k, v) => { written.push(v); return Promise.resolve() } })
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'url', value: 'http://x' }), ctx)
      expect(written).toEqual(['http://x'])
    })
  })

  describe('plugin-config', () => {
    it('answers the empty case', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePluginConfig(call('plugin-config', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toBe('reply.plugin-config.none({})')
    })

    it('lists every setting, not just the last', async () => {
      const { ctx, sent } = stub({ settings: () => Promise.resolve({ url: 'http://x', apiKey: '••••' }) })
      await handlers.handlePluginConfig(call('plugin-config', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toContain('url')
      expect(sent[0]?.text).toContain('apiKey')
    })
  })

  describe('conversations', () => {
    it('answers the empty case', async () => {
      const { ctx, sent } = stub()
      await handlers.handleConversations(call('conversations'), ctx)
      expect(sent[0]?.text).toBe('reply.conversations.none({})')
    })

    it('lists every conversation, not just the last', async () => {
      const { ctx, sent } = stub({
        listConversations: () => Promise.resolve([
          { conversationId: 'c:1', kind: 'dm', label: 'Alice' },
          { conversationId: 'c:2', kind: 'group', label: 'weekend' },
        ]),
      })
      await handlers.handleConversations(call('conversations'), ctx)
      expect(sent[0]?.text).toContain('Alice')
      expect(sent[0]?.text).toContain('weekend')
    })
  })

  describe('where-rule', () => {
    it('answers usage for an invalid `where`', async () => {
      const { ctx, sent } = stub()
      await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'nowhere' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.where-rule.usage'))
    })

    it('confirms the confinement', async () => {
      const { ctx, sent } = stub()
      await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'dm' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.where-rule.done'))
    })
  })

  describe('broadcast-add', () => {
    it('answers usage when an argument is absent', async () => {
      const { ctx, sent } = stub()
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.broadcast-add.usage'))
    })

    it('confirms the added target', async () => {
      const { ctx, sent } = stub()
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal', conversation: 'c:1' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.broadcast-add.done'))
    })
  })

  describe('broadcast', () => {
    it('answers usage for empty text', async () => {
      const { ctx, sent } = stub()
      await handlers.handleBroadcast(call('broadcast', {}, ''), ctx)
      expect(sent[0]?.text).toContain(known('reply.broadcast.usage'))
    })

    it('reports the ok and failed counts, not just one of them', async () => {
      const { ctx, sent } = stub({ broadcast: () => Promise.resolve([{ ok: true }, { ok: true }, { ok: false }]) })
      await handlers.handleBroadcast(call('broadcast', {}, 'hello everyone'), ctx)
      expect(sent[0]?.text).toContain('"ok":"2"')
      expect(sent[0]?.text).toContain('"failed":"1"')
    })
  })

  describe('inhibitor-channels', () => {
    it('answers usage when the name is empty', async () => {
      const { ctx, sent } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, ''), ctx)
      expect(sent[0]?.text).toContain(known('reply.inhibitor-channels.usage'))
    })

    it('reports every channel when none are named', async () => {
      const { ctx, sent } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate'), ctx)
      expect(sent[0]?.text).toContain(known('reply.inhibitor-channels.all'))
    })

    it('lists every confined channel, not just the last', async () => {
      const { ctx, sent } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate signal console'), ctx)
      expect(sent[0]?.text).toContain('signal')
      expect(sent[0]?.text).toContain('console')
    })
  })

  describe('lang', () => {
    it('answers its own usage when the argument is absent, rather than throwing', async () => {
      const { ctx, sent } = stub()
      await handlers.handleLang(call('lang', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.lang.usage'))
    })

    it('confirms a new language in the new language, not the one being left', async () => {
      const { ctx, calls } = stub()
      await handlers.handleLang(call('lang', { locale: 'fr' }), ctx)
      // The third argument to ctx.t is the whole point: without it the confirmation
      // renders in the locale resolved for this message, which is the old one.
      expect(calls.at(-1)).toEqual(['reply.lang.set', { locale: 'fr' }, 'fr'])
    })
  })

  describe('lang-group', () => {
    it('refuses outside a group', async () => {
      const { ctx, sent } = stub()
      await handlers.handleLangGroup(call('lang-group', { locale: 'fr' }, '', msg({ group: undefined })), ctx)
      expect(sent[0]?.text).toContain(known('reply.lang-group.group-only'))
    })

    it('confirms a new conversation language in that new language', async () => {
      const { ctx, calls } = stub()
      await handlers.handleLangGroup(call('lang-group', { locale: 'ru' }, '', msg({ group: { id: 'g:1', name: 'weekend' } })), ctx)
      expect(calls.at(-1)).toEqual(['reply.lang-group.set', { locale: 'ru' }, 'ru'])
    })
  })

  it('conforms', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await enzymeChecks({
      name: 'admin',
      manifest,
      module,
      catalogs: {
        en: parseYaml(readFileSync(join(here, 'translations', 'en.yaml'), 'utf8')),
        fr: parseYaml(readFileSync(join(here, 'translations', 'fr.yaml'), 'utf8')),
      },
      context: () => stub().ctx,
    })
    expect(failures).toEqual([])
  })
})
