import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { enzymeChecks } from '@mycelo/septum/conformance'
import type { EnzymeContext, EnzymeModule, Invocation, TranslatableRef } from '@mycelo/septum'
import module from '../src/index.js'
import type { CalendarEntry, RadarrApi } from '@mycelo/spore-radarr'

const here = join(import.meta.dirname, '..')

function catalogueKeys(dir: string, file: string): Set<string> {
  const keys = new Set<string>()
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') { keys.add(prefix); return }
    if (typeof node !== 'object' || node === null) return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, prefix === '' ? k : `${prefix}.${k}`)
    }
  }
  walk(parseYaml(readFileSync(join(dir, 'translations', file), 'utf8')), '')
  return keys
}

const OWN = catalogueKeys(here, 'en.yaml')
// The rhiza's own catalogue, read across the spore boundary. EnzymeHarness.catalogs is keyed by
// locale for one domain only, so the kit cannot compile another spore's keys for us.
const RADARR = catalogueKeys(join(here, '..', 'radarr'), 'en.yaml')

function known(key: string): string {
  if (!OWN.has(key)) throw new Error(`no such key in translations/en.yaml: ${key}`)
  return key
}

interface Stub {
  ctx: EnzymeContext<{ defaultDays: number }>
  sent: { text?: string }[]
}

function stub(answer: readonly CalendarEntry[] | TranslatableRef, defaultDays = 30): Stub {
  const sent: { text?: string }[] = []
  const api: RadarrApi = {
    calendar: () => Promise.resolve(answer),
    search: () => Promise.resolve([]),
  }
  const ctx = {
    config: { defaultDays },
    locale: 'en',
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => ctx.logger },
    rhiza: () => api,
    has: () => true,
    t: (key: string | TranslatableRef, params: Record<string, unknown> = {}) => (typeof key === 'string'
      ? `${known(key)}(${JSON.stringify(params)})`
      : `${key.domain}:${key.key}`),
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<{ defaultDays: number }>, sent }
}

const call = (args: Record<string, string> = {}): Invocation =>
  ({ command: 'upcoming', args, rest: '' }) as unknown as Invocation

const entry = (title: string, inDays: number, hasFile: boolean): CalendarEntry =>
  ({ title, releaseAt: new Date(Date.now() + inDays * 86_400_000), hasFile })

describe('the upcoming-movies spore', () => {
  it('renders every entry, not just the first', async () => {
    const { ctx, sent } = stub([entry('Dune', 3, false), entry('Arrival', 10, true)])
    await module.create().handlers.handleUpcoming(call(), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('Dune')
    expect(text).toContain('Arrival')
    expect(text.startsWith('reply.list(')).toBe(true)
  })

  it('distinguishes a film Radarr already holds from one it awaits', async () => {
    const { ctx, sent } = stub([entry('Dune', 3, false), entry('Arrival', 10, true)])
    await module.create().handlers.handleUpcoming(call(), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('reply.awaited')
    expect(text).toContain('reply.held')
  })

  it('answers the empty case, which a quiet month is', async () => {
    const { ctx, sent } = stub([])
    await module.create().handlers.handleUpcoming(call(), ctx)
    expect(sent[0]?.text).toBe('reply.empty({"days":30})')
  })

  it('uses the operator default when no argument is given', async () => {
    const { ctx, sent } = stub([], 7)
    await module.create().handlers.handleUpcoming(call(), ctx)
    expect(sent[0]?.text).toBe('reply.empty({"days":7})')
  })

  it('takes the argument over the default', async () => {
    const { ctx, sent } = stub([], 30)
    await module.create().handlers.handleUpcoming(call({ days: '5' }), ctx)
    expect(sent[0]?.text).toBe('reply.empty({"days":5})')
  })

  it('answers usage for an argument that is not a number in range', async () => {
    for (const days of ['nope', '0', '400', '-3']) {
      const { ctx, sent } = stub([])
      await module.create().handlers.handleUpcoming(call({ days }), ctx)
      expect(sent[0]?.text, `days=${days}`).toBe('reply.usage({})')
    }
  })

  it('renders the rhiza ref rather than inventing a sentence of its own', async () => {
    const { ctx, sent } = stub({ domain: 'radarr', key: 'error.unreachable', params: { detail: 'x' } })
    await module.create().handlers.handleUpcoming(call(), ctx)
    expect(sent[0]?.text).toBe('radarr:error.unreachable')
  })

  it('renders only refs radarr actually ships', () => {
    // The kit cannot compile another spore's catalogue, so this is what stops a rename in radarr
    // from reaching a real reader as the literal key.
    for (const key of ['error.unreachable', 'error.unauthorized', 'error.unexpected']) {
      expect(RADARR.has(key), `radarr/en.yaml is missing ${key}`).toBe(true)
    }
  })

  it('conforms, with its own catalogues', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await enzymeChecks({
      name: 'upcoming-movies',
      // EnzymeHarness wants EnzymeModule<unknown>; handlers is a function-typed property, so TS
      // checks it contravariantly and Config does not narrow to unknown on its own.
      module: module as EnzymeModule<unknown>,
      manifest,
      context: () => stub([]).ctx,
      validConfig: { defaultDays: 30 },
      invalidConfig: { defaultDays: 0 },
      catalogs: {
        en: parseYaml(readFileSync(join(here, 'translations', 'en.yaml'), 'utf8')),
        fr: parseYaml(readFileSync(join(here, 'translations', 'fr.yaml'), 'utf8')),
      },
    })
    expect(failures).toEqual([])
  })
})
