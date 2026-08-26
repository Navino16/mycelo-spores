import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { IntlMessageFormat } from 'intl-messageformat'
import { enzymeChecks } from '@mycelo/septum/conformance'
import module from '../src/index.js'
import type { EnzymeContext, IncomingMessage, Invocation } from '@mycelo/septum'

const here = join(import.meta.dirname, '..')

/** Flattens the shipped catalogue to the dotted keys the core resolves. */
function catalogueMessages(file: string): Map<string, string> {
  const messages = new Map<string, string>()
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') { messages.set(prefix, node); return }
    if (typeof node !== 'object' || node === null) return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, prefix === '' ? k : `${prefix}.${k}`)
    }
  }
  walk(parseYaml(readFileSync(join(here, 'translations', file), 'utf8')), '')
  return messages
}

const LOCALES = ['en', 'fr'] as const
const CATALOGUES = new Map(LOCALES.map((locale) => [locale, catalogueMessages(`${locale}.yaml`)]))
const KEYS = new Set(CATALOGUES.get('en')?.keys() ?? [])

/**
 * Throws on a key the shipped catalogue does not carry. Without it, renaming a key in every
 * catalogue leaves the suite green while the bot answers the literal key to a real user.
 */
function known(key: string): string {
  if (!KEYS.has(key)) throw new Error(`no such key in translations/en.yaml: ${key}`)
  return key
}

interface ElementLike { type: number, value?: unknown, options?: Record<string, { value?: unknown }> }

// type 0 is a literal run and names no parameter; select/plural nest further elements per branch.
function placeholders(text: string, locale: string): string[] {
  const names = new Set<string>()
  const walk = (elements: unknown): void => {
    if (!Array.isArray(elements)) return
    for (const raw of elements as unknown[]) {
      if (typeof raw !== 'object' || raw === null || !('type' in raw)) continue
      const el = raw as ElementLike
      if (el.type !== 0 && typeof el.value === 'string') names.add(el.value)
      if (el.options !== undefined) for (const o of Object.values(el.options)) walk(o.value)
    }
  }
  walk(new IntlMessageFormat(text, locale).getAst())
  return [...names].sort()
}

/**
 * Every shipped locale's message must read exactly the parameters the handler supplies. A
 * placeholder renamed in a catalogue throws MissingValueError in the bot and the core then
 * answers the literal key; one dropped stops naming what the reply exists to name. Neither
 * shows in a key-set comparison, which is all the repository-wide catalogue test performs.
 */
function assertReadsExactly(key: string, params: Record<string, unknown>): void {
  for (const locale of LOCALES) {
    const text = CATALOGUES.get(locale)?.get(key)
    if (text === undefined) throw new Error(`no such key in translations/${locale}.yaml: ${key}`)
    expect(placeholders(text, locale), `${locale}/${key}`).toEqual(Object.keys(params).sort())
    new IntlMessageFormat(text, locale).format(params)
  }
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

type Told = [string, unknown[]]

/** Records every mycelium call with its arguments: a transposed pair is invisible in the reply. */
function recording(mycelium: Mycelium, told: Told[]): Mycelium {
  const entries = Object.entries(mycelium) as [string, (...a: never[]) => unknown][]
  return Object.fromEntries(entries.map(([name, fn]) => [
    name,
    (...args: never[]): unknown => { told.push([name, args]); return fn(...args) },
  ])) as unknown as Mycelium
}

function stub(overrides: Partial<Mycelium> = {}, roles: readonly string[] = ['owner']) {
  const told: Told[] = []
  const mycelium: Mycelium = recording({ ...defaultMycelium(), ...overrides }, told)
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
      assertReadsExactly(known(key), params)
      return `${key}(${JSON.stringify(params)})`
    },
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<unknown>, sent, calls, asked, told, mycelium }
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

  /** Every handler, driven once with a populated argument bag. */
  async function driveEveryCommand(ctx: EnzymeContext<unknown>): Promise<void> {
    await handlers.handlePlugins(call('plugins'), ctx)
    await handlers.handleWhoami(call('whoami'), ctx)
    await handlers.handleRoles(call('roles'), ctx)
    await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
    await handlers.handleRevoke(call('revoke', { role: 'guest', who: 'bob' }), ctx)
    await handlers.handleRoleNew(call('role-new', {}, 'guest media.*'), ctx)
    await handlers.handlePluginList(call('plugin-list'), ctx)
    await handlers.handlePluginEnable(call('plugin-enable', { name: 'radarr' }), ctx)
    await handlers.handlePluginDisable(call('plugin-disable', { name: 'radarr' }), ctx)
    await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'port', value: '80' }), ctx)
    await handlers.handlePluginConfig(call('plugin-config', { name: 'radarr' }), ctx)
    await handlers.handleConversations(call('conversations'), ctx)
    await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'dm' }), ctx)
    await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal', conversation: 'c:1' }), ctx)
    await handlers.handleBroadcast(call('broadcast', {}, 'hello everyone'), ctx)
    await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate signal'), ctx)
    await handlers.handleLang(call('lang', { locale: 'fr' }), ctx)
    await handlers.handleLangGroup(call('lang-group', { locale: 'fr' }, '', msg({ group: { id: 'g:1', name: 'weekend' } })), ctx)
  }

  it('asks the mycelium rhiza by its declared name at every call site, across all eighteen commands', async () => {
    // A single call site typo'd to 'myceliun' germinates clean and throws only when that one
    // command runs (phase 7.5B's whole-branch review, one level down from a missing `requires:`).
    const { ctx, asked } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
    await driveEveryCommand(ctx)
    expect(asked.length).toBeGreaterThan(0)
    expect(new Set(asked)).toEqual(new Set(['mycelium']))
  })

  it('supplies exactly the placeholders every shipped catalogue reads, in en and in fr', async () => {
    const { ctx, calls } = stub({
      listPlugins: () => [{ name: 'radarr', state: 'germinated' }],
      listRoles: () => Promise.resolve([{ name: 'owner', patterns: ['*'] }]),
      findByIdentity: () => Promise.resolve({ id: 'p2' }),
      settings: () => Promise.resolve({ url: 'http://x' }),
      listConversations: () => Promise.resolve([{ conversationId: 'c:1', kind: 'dm', label: 'Alice' }]),
      broadcast: () => Promise.resolve([{ ok: true }]),
    })
    // The assertion is inside the ctx.t stub, so this sweep is what applies it to every
    // populated reply; a placeholder renamed or dropped in either catalogue fails here.
    await driveEveryCommand(ctx)
    expect(calls.length).toBeGreaterThanOrEqual(18)
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
    it('reports channel, externalId and roles as the triple they actually are, not just present somewhere', async () => {
      const { ctx, sent } = stub({}, ['owner', 'guest'])
      await handlers.handleWhoami(call('whoami', {}, '', msg({ sender: { channel: 'console', externalId: 'alice' } })), ctx)
      // Presence alone survives a {channel, externalId} swap; the pairing does not.
      expect(sent[0]?.text).toContain('"channel":"console"')
      expect(sent[0]?.text).toContain('"externalId":"alice"')
      expect(sent[0]?.text).toContain('"roles":"owner, guest"')
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

    it('names the channel and who as the pair they actually are, not just present somewhere', async () => {
      const { ctx, sent } = stub()
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      // Presence alone survives a {who, channel} <-> {channel, who} swap; the pairing does not.
      expect(sent[0]?.text).toContain('"who":"bob"')
      expect(sent[0]?.text).toContain('"channel":"console"')
    })

    it('confirms the assignment naming the role and who as the pair they actually are', async () => {
      const { ctx, sent } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.grant.done'))
      expect(sent[0]?.text).toContain('"role":"guest"')
      expect(sent[0]?.text).toContain('"who":"bob"')
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
    it('answers its own usage when a required argument is absent, rather than throwing', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRevoke(call('revoke', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.revoke.usage'))
    })

    it('names the channel and who as the pair they actually are when no identity matches', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRevoke(call('revoke', { role: 'guest', who: 'bob' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.revoke.unknown'))
      expect(sent[0]?.text).toContain('"who":"bob"')
      expect(sent[0]?.text).toContain('"channel":"console"')
    })

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

    it('creates a role with the name and patterns as the pair they actually are, not just present somewhere', async () => {
      const { ctx, sent } = stub()
      await handlers.handleRoleNew(call('role-new', {}, 'guest media.* help.*'), ctx)
      // Presence alone survives a {name, patterns} swap; the pairing does not.
      expect(sent[0]?.text).toContain('"name":"guest"')
      expect(sent[0]?.text).toContain('"patterns":"media.*, help.*"')
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
    it('answers its own usage when the name is absent, rather than reaching the mycelium', async () => {
      const { ctx, sent, asked } = stub()
      await handlers.handlePluginEnable(call('plugin-enable', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-enable.usage'))
      expect(asked).toEqual([])
    })

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

    it('answers its own usage for plugin-disable too, rather than reaching the mycelium', async () => {
      const { ctx, sent, asked } = stub()
      await handlers.handlePluginDisable(call('plugin-disable', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-disable.usage'))
      expect(asked).toEqual([])
    })

    it('confirms once disabled', async () => {
      const { ctx, sent } = stub()
      await handlers.handlePluginDisable(call('plugin-disable', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-disable.done'))
    })
  })

  describe('plugin-set', () => {
    it('answers its own usage when any of the three arguments is absent', async () => {
      const { ctx, sent, asked } = stub()
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'port' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-set.usage'))
      expect(asked).toEqual([])
    })

    it('coerces a JSON-shaped value before writing it, naming the key and name as the pair they are', async () => {
      const written: unknown[] = []
      const { ctx, sent } = stub({ setSetting: (_n, _k, v) => { written.push(v); return Promise.resolve() } })
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'port', value: '8080' }), ctx)
      expect(written).toEqual([8080])
      expect(sent[0]?.text).toContain(known('reply.plugin-set.done'))
      // Presence alone survives a {key, name} swap; the pairing does not.
      expect(sent[0]?.text).toContain('"key":"port"')
      expect(sent[0]?.text).toContain('"name":"radarr"')
    })

    it('keeps a non-JSON value as a raw string', async () => {
      const written: unknown[] = []
      const { ctx } = stub({ setSetting: (_n, _k, v) => { written.push(v); return Promise.resolve() } })
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'url', value: 'http://x' }), ctx)
      expect(written).toEqual(['http://x'])
    })
  })

  describe('plugin-config', () => {
    it('answers its own usage when the name is absent, rather than reaching the mycelium', async () => {
      const { ctx, sent, asked } = stub()
      await handlers.handlePluginConfig(call('plugin-config', {}), ctx)
      expect(sent[0]?.text).toContain(known('reply.plugin-config.usage'))
      expect(asked).toEqual([])
    })

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

    it('confirms the confinement naming the pattern and where as the pair they actually are', async () => {
      const { ctx, sent } = stub()
      await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'dm' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.where-rule.done'))
      expect(sent[0]?.text).toContain('"pattern":"admin.*"')
      expect(sent[0]?.text).toContain('"where":"dm"')
    })
  })

  describe('broadcast-add', () => {
    it('answers usage when an argument is absent', async () => {
      const { ctx, sent } = stub()
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.broadcast-add.usage'))
    })

    it('confirms the added target naming the channel and conversation as the pair they actually are', async () => {
      const { ctx, sent } = stub()
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal', conversation: 'c:1' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.broadcast-add.done'))
      expect(sent[0]?.text).toContain('"channel":"signal"')
      expect(sent[0]?.text).toContain('"conversation":"c:1"')
    })

    it('surfaces the mycelium’s own diagnostic untranslated rather than a generic failure', async () => {
      const { ctx, sent } = stub({ addBroadcastTarget: () => Promise.reject(new Error('boom')) })
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal', conversation: 'c:1' }), ctx)
      expect(sent[0]?.text).toBe('boom')
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

    it('surfaces the mycelium’s own diagnostic untranslated rather than a generic failure', async () => {
      const { ctx, sent } = stub({ broadcast: () => Promise.reject(new Error('boom')) })
      await handlers.handleBroadcast(call('broadcast', {}, 'hello everyone'), ctx)
      expect(sent[0]?.text).toBe('boom')
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

    it('lists every confined channel under the right name, not just present somewhere', async () => {
      const { ctx, sent } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate signal console'), ctx)
      // Presence alone survives a {name, channels} swap; the pairing does not.
      expect(sent[0]?.text).toContain('"name":"group-gate"')
      expect(sent[0]?.text).toContain('"channels":"signal, console"')
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
    it('answers its own usage when the locale argument is absent, rather than throwing', async () => {
      const { ctx, sent } = stub()
      await handlers.handleLangGroup(call('lang-group', {}, '', msg({ group: { id: 'g:1', name: 'weekend' } })), ctx)
      expect(sent[0]?.text).toContain(known('reply.lang-group.usage'))
    })

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

  /**
   * The reply names what the operator asked for whichever way the arguments were passed on, so
   * nothing below is visible in `sent`: every one of these mutants confirmed success while the
   * mycelium was told something else, or nothing.
   */
  describe('what the mycelium is actually told', () => {
    it('creates the role with every pattern it was given, not with none and not with the first', async () => {
      const { ctx, told } = stub()
      await handlers.handleRoleNew(call('role-new', {}, 'guest media.* help.*'), ctx)
      expect(told).toEqual([['createRole', ['guest', ['media.*', 'help.*']]]])
    })

    it('takes the whole first word as the role name when no pattern follows it', async () => {
      const { ctx, told } = stub()
      await handlers.handleRoleNew(call('role-new', {}, 'guest'), ctx)
      expect(told).toEqual([['createRole', ['guest', []]]])
    })

    it('confines the inhibitor to every channel named, not to none and not to the last', async () => {
      const { ctx, told } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate signal console'), ctx)
      // An empty list means every channel, so a collapse here silently un-confines a gate.
      expect(told).toEqual([['setInhibitorChannels', ['group-gate', ['signal', 'console']]]])
    })

    it('takes the whole first word as the inhibitor name when no channel follows it', async () => {
      const { ctx, told } = stub()
      await handlers.handleInhibitorChannels(call('inhibitor-channels', {}, 'group-gate'), ctx)
      expect(told).toEqual([['setInhibitorChannels', ['group-gate', []]]])
    })

    it('looks an identity up by (channel, who) and assigns by (principalId, role)', async () => {
      const { ctx, told } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
      await handlers.handleGrant(call('grant', { role: 'guest', who: 'bob' }), ctx)
      expect(told).toEqual([['findByIdentity', ['console', 'bob']], ['assignRole', ['p2', 'guest']]])
    })

    it('looks an identity up by (channel, who) and revokes by (principalId, role)', async () => {
      const { ctx, told } = stub({ findByIdentity: () => Promise.resolve({ id: 'p2' }) })
      await handlers.handleRevoke(call('revoke', { role: 'guest', who: 'bob' }), ctx)
      expect(told).toEqual([['findByIdentity', ['console', 'bob']], ['revokeRole', ['p2', 'guest']]])
    })

    it('enables the named plugin rather than disabling it', async () => {
      const { ctx, told } = stub()
      await handlers.handlePluginEnable(call('plugin-enable', { name: 'radarr' }), ctx)
      expect(told).toEqual([['enable', ['radarr']]])
    })

    it('disables the named plugin rather than enabling it', async () => {
      const { ctx, told } = stub()
      await handlers.handlePluginDisable(call('plugin-disable', { name: 'radarr' }), ctx)
      expect(told).toEqual([['disable', ['radarr']]])
    })

    it('writes the setting as (name, key, value), not the transpose', async () => {
      const { ctx, told } = stub()
      await handlers.handlePluginSet(call('plugin-set', { name: 'radarr', key: 'port', value: '8080' }), ctx)
      expect(told).toEqual([['setSetting', ['radarr', 'port', 8080]]])
    })

    it('sets the context rule as (pattern, where), not the transpose', async () => {
      const { ctx, told } = stub()
      await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'dm' }), ctx)
      expect(told).toEqual([['setContextRule', ['admin.*', 'dm']]])
    })

    it('registers the broadcast target as (channel, conversationId), not the transpose', async () => {
      const { ctx, told } = stub()
      await handlers.handleBroadcastAdd(call('broadcast-add', { channel: 'signal', conversation: 'c:1' }), ctx)
      expect(told).toEqual([['addBroadcastTarget', [{ channel: 'signal', conversationId: 'c:1' }]]])
    })

    it('writes the principal locale as (principalId, locale), not the transpose', async () => {
      const { ctx, told } = stub()
      await handlers.handleLang(call('lang', { locale: 'fr' }), ctx)
      expect(told).toEqual([['setPrincipalLocale', ['p1', 'fr']]])
    })

    it('writes the conversation locale as (channel, conversationId, locale), not the transpose', async () => {
      const { ctx, told } = stub()
      const message = msg({ channel: 'signal', conversationId: 'group:g1', group: { id: 'g:1', name: 'weekend' } })
      await handlers.handleLangGroup(call('lang-group', { locale: 'ru' }, '', message), ctx)
      expect(told).toEqual([['setConversationLocale', ['signal', 'group:g1', 'ru']]])
    })
  })

  describe('the arguments a handler must have before it reaches the mycelium', () => {
    it('answers usage for /grant with a role but no recipient, rather than looking up undefined', async () => {
      const { ctx, sent, told } = stub()
      await handlers.handleGrant(call('grant', { role: 'guest' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.grant.usage'))
      expect(told).toEqual([])
    })

    it('answers usage for /revoke with a role but no recipient, rather than looking up undefined', async () => {
      const { ctx, sent, told } = stub()
      await handlers.handleRevoke(call('revoke', { role: 'guest' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.revoke.usage'))
      expect(told).toEqual([])
    })

    it('accepts group as a `where`, not only dm', async () => {
      const { ctx, sent, told } = stub()
      await handlers.handleWhereRule(call('where-rule', { pattern: 'admin.*', where: 'group' }), ctx)
      expect(sent[0]?.text).toContain(known('reply.where-rule.done'))
      expect(told).toEqual([['setContextRule', ['admin.*', 'group']]])
    })
  })

  describe('what each list actually renders', () => {
    it('lists every pattern of a role under that role name, not the first and not transposed', async () => {
      const { ctx, sent } = stub({ listRoles: () => Promise.resolve([{ name: 'owner', patterns: ['media.*', 'help.*'] }]) })
      await handlers.handleRoles(call('roles'), ctx)
      expect(sent[0]?.text).toContain('owner: media.*, help.*')
    })

    it('falls back to the conversation id when a row carries no label, and names its kind', async () => {
      const { ctx, sent } = stub({
        listConversations: () => Promise.resolve([{ conversationId: 'c:2', kind: 'group' }]),
      })
      await handlers.handleConversations(call('conversations'), ctx)
      expect(sent[0]?.text).toContain('c:2 (group)')
    })

    it('renders each setting as key = value, not value = key', async () => {
      const { ctx, sent } = stub({ settings: () => Promise.resolve({ url: 'http://x' }) })
      await handlers.handlePluginConfig(call('plugin-config', { name: 'radarr' }), ctx)
      expect(sent[0]?.text).toContain('url = http://x')
    })
  })

  it('routes each command name to the handler that implements it, and is named admin', () => {
    // The suite calls handlers directly, so nothing else reads the manifest's wiring: a `code:`
    // pointing at another real handler germinates clean and answers the wrong command.
    const manifest = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8')) as {
      name?: string
      commands?: readonly { name?: string, code?: string }[]
    }
    // The name is the translation domain and the prefix every admin.* role pattern matches.
    expect(manifest.name).toBe('admin')
    expect(manifest.commands?.map((c) => [c.name, c.code])).toEqual([
      ['plugins', 'handlePlugins'],
      ['whoami', 'handleWhoami'],
      ['roles', 'handleRoles'],
      ['grant', 'handleGrant'],
      ['revoke', 'handleRevoke'],
      ['role-new', 'handleRoleNew'],
      ['plugin-list', 'handlePluginList'],
      ['plugin-enable', 'handlePluginEnable'],
      ['plugin-disable', 'handlePluginDisable'],
      ['plugin-set', 'handlePluginSet'],
      ['plugin-config', 'handlePluginConfig'],
      ['conversations', 'handleConversations'],
      ['where-rule', 'handleWhereRule'],
      ['broadcast-add', 'handleBroadcastAdd'],
      ['broadcast', 'handleBroadcast'],
      ['inhibitor-channels', 'handleInhibitorChannels'],
      ['lang', 'handleLang'],
      ['lang-group', 'handleLangGroup'],
    ])
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

  it('resolves every argument description the manifest names, in every shipped locale', () => {
    // `enzymeChecks` only reads `commands[].description` (I1/I4): a typo'd or deleted
    // `arg.*.description` key passes conformance and reaches `/help` as the literal key.
    const manifest = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8')) as {
      commands?: readonly { args?: readonly { description?: string }[] }[]
    }
    const argKeys = (manifest.commands ?? []).flatMap((c) => c.args ?? [])
      .map((a) => a.description)
      .filter((d): d is string => d !== undefined)
    expect(argKeys.length).toBeGreaterThan(0)
    for (const key of argKeys) assertReadsExactly(known(key), {})
  })
})
