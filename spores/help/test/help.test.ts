import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { enzymeChecks } from '@mycelo/septum/conformance'
import type { CommandInfo, EnzymeContext, Invocation } from '@mycelo/septum'
import module from '../src/index.js'

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

function stubContext(locale: string, commands: readonly CommandInfo[]) {
  const sent: { text?: string }[] = []
  const asked: { locale: string }[] = []
  const ctx = {
    locale,
    principal: { id: 7, channel: 'signal', externalId: '+3360', roles: ['owner'] },
    t: (key: string, params: Record<string, unknown> = {}) => {
      known(key)
      switch (key) {
        case 'reply.line': return `${String(params.name)}=${String(params.description)}`
        case 'reply.lineWithArgs': return `${String(params.name)}=${String(params.description)}[${String(params.args)}]`
        case 'reply.arg': return `${String(params.name)}:${String(params.description)}:${String(params.state)}`
        case 'reply.argRequired': return 'REQ'
        case 'reply.argOptional': return 'OPT'
        case 'reply.list': return `list[${String(params.lines)}]`
        default: return key
      }
    },
    reply: async (content: { text?: string }) => { sent.push(content) },
    rhiza: () => ({
      available: async (_p: unknown, l: string) => { asked.push({ locale: l }); return commands },
    }),
  }
  return { ctx: ctx as unknown as EnzymeContext, sent, asked }
}

const invocation = { command: 'help', args: {}, raw: '/help' } as unknown as Invocation

describe('the help spore', () => {
  it('asks commands.read for the locale of the message it is answering', async () => {
    const { ctx, asked } = stubContext('fr', [])
    await module.create().handlers.handleHelp(invocation, ctx)
    // Kills the mutant that hardcodes 'en' — the seam half A found unpinned in two places.
    expect(asked).toEqual([{ locale: 'fr' }])
  })

  it('renders one line per command, in the order the scope returned them', async () => {
    const { ctx, sent } = stubContext('en', [
      { qualified: 'help.help', name: 'help', plugin: 'help', description: 'List commands' },
      { qualified: 'links.links', name: 'links', plugin: 'links', description: 'Show services' },
    ])
    await module.create().handlers.handleHelp(invocation, ctx)
    // Plural, and asserted as a sequence: a mutant returning only the last command dies here,
    // where a membership check would let it live.
    expect(sent).toEqual([{ text: 'list[help=List commands\nlinks=Show services]' }])
  })

  it('renders a command with no args exactly as before', async () => {
    const { ctx, sent } = stubContext('en', [
      { qualified: 'help.help', name: 'help', plugin: 'help', description: 'List commands' },
    ])
    await module.create().handlers.handleHelp(invocation, ctx)
    expect(sent).toEqual([{ text: 'list[help=List commands]' }])
  })

  it('renders each argument paired with its own description and required state, not a neighbour\'s', async () => {
    const { ctx, sent } = stubContext('en', [
      {
        qualified: 'admin.grant', name: 'grant', plugin: 'admin', description: 'Give a role',
        args: [
          { name: 'role', description: 'Role name', required: true },
          { name: 'who', description: 'Recipient', required: false },
        ],
      },
    ])
    await module.create().handlers.handleHelp(invocation, ctx)
    // A transposed pairing (role/Recipient/OPT or who/Role name/REQ) would still pass a
    // membership check on names alone — assert the exact per-argument triple instead.
    expect(sent).toEqual([{
      text: 'list[grant=Give a role[role:Role name:REQ\nwho:Recipient:OPT]]',
    }])
  })

  it('renders a mix of commands with and without arguments in the scope\'s order', async () => {
    const { ctx, sent } = stubContext('en', [
      { qualified: 'help.help', name: 'help', plugin: 'help', description: 'List commands' },
      {
        qualified: 'admin.role-new', name: 'role-new', plugin: 'admin', description: 'Create a role',
        args: [{ name: 'name', description: 'Role name', required: true }],
      },
    ])
    await module.create().handlers.handleHelp(invocation, ctx)
    expect(sent).toEqual([{
      text: 'list[help=List commands\nrole-new=Create a role[name:Role name:REQ]]',
    }])
  })

  it('answers the empty case rather than a bare header', async () => {
    const { ctx, sent } = stubContext('en', [])
    await module.create().handlers.handleHelp(invocation, ctx)
    expect(sent).toEqual([{ text: 'reply.none' }])
  })

  it('conforms, with its own catalogues', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await enzymeChecks({
      name: 'help',
      module,
      manifest,
      context: () => stubContext('en', []).ctx,
      catalogs: {
        en: parseYaml(readFileSync(join(here, 'translations', 'en.yaml'), 'utf8')),
        fr: parseYaml(readFileSync(join(here, 'translations', 'fr.yaml'), 'utf8')),
      },
    })
    expect(failures).toEqual([])
  })
})
