import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { enzymeChecks } from '@mycelo/septum/conformance'
import module from '../src/index.js'
import type { EnzymeContext, EnzymeModule, Invocation } from '@mycelo/septum'

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

const services = [
  { label: 'radarr', url: 'https://radarr.example', note: 'films' },
  { label: 'jellyfin', url: 'https://jellyfin.example' },
]

function stub(config: { services: typeof services }) {
  const sent: { text?: string }[] = []
  const ctx = {
    config,
    locale: 'en',
    principal: { id: 1, channel: 'signal', externalId: '+3360', roles: ['owner'] },
    t: (key: string, params: Record<string, unknown> = {}) => `${known(key)}(${JSON.stringify(params)})`,
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<{ services: typeof services }>, sent }
}

const call = (command: string, args: Record<string, string> = {}) =>
  ({ command, args, raw: `/${command}` }) as unknown as Invocation

describe('the links spore', () => {
  it('lists every configured service, not just the last', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLinks(call('links'), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('radarr')
    expect(text).toContain('jellyfin')
    // One catalogue key carries the whole layout, so a translator can reorder it: the lines
    // must arrive as a parameter of reply.list, not be joined onto it in code.
    expect(text.startsWith('reply.list({"lines":')).toBe(true)
    expect(text.split('\n')).toHaveLength(1)
  })

  it('renders a service with a note differently from one without', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLinks(call('links'), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('reply.noted')
    expect(text).toContain('reply.line')
  })

  it('answers the empty case', async () => {
    const { ctx, sent } = stub({ services: [] })
    await module.create().handlers.handleLinks(call('links'), ctx)
    expect(sent[0]?.text).toBe('reply.empty({})')
  })

  it('finds one service by label', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link', { label: 'jellyfin' }), ctx)
    expect(sent[0]?.text).toContain('jellyfin')
    expect(sent[0]?.text).not.toContain('radarr')
  })

  it('answers with usage when the label arg is missing entirely', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link'), ctx)
    expect(sent[0]?.text).toBe('reply.usage({})')
  })

  it('answers with usage when the label arg is an empty string', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link', { label: '' }), ctx)
    expect(sent[0]?.text).toBe('reply.usage({})')
  })

  it('refuses an unknown label by naming every label that exists', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link', { label: 'plex' }), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('reply.unknown')
    // Plural: a refusal naming only the first or only the last label is the cardinality
    // defect phase 5.5's mutation campaign found six times.
    expect(text).toContain('radarr')
    expect(text).toContain('jellyfin')
  })

  it('conforms, with its own catalogues', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await enzymeChecks({
      name: 'links',
      // EnzymeHarness wants EnzymeModule<unknown>; handlers is a function-typed property,
      // so TS checks it contravariantly and Config does not narrow to unknown on its own.
      module: module as EnzymeModule<unknown>,
      manifest,
      context: () => stub({ services }).ctx,
      // label empty and url malformed: exercises the array-index issue paths the
      // project's settings validator has never seen (design §9).
      validConfig: { services },
      invalidConfig: { services: [{ label: '', url: 'not-a-url' }] },
      catalogs: {
        en: parseYaml(readFileSync(join(here, 'translations', 'en.yaml'), 'utf8')),
        fr: parseYaml(readFileSync(join(here, 'translations', 'fr.yaml'), 'utf8')),
      },
    })
    expect(failures).toEqual([])
  })
})
