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
  /** The rhiza names the handler asked for, so the manifest can be checked against them. */
  asked: string[]
}

function stub(answer: readonly CalendarEntry[] | TranslatableRef, defaultDays = 30, locale = 'en'): Stub {
  const sent: { text?: string }[] = []
  const asked: string[] = []
  const api: RadarrApi = {
    calendar: () => Promise.resolve(answer),
    search: () => Promise.resolve([]),
  }
  const ctx = {
    config: { defaultDays },
    locale,
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => ctx.logger },
    rhiza: (name: string) => { asked.push(name); return api },
    has: () => true,
    t: (key: string | TranslatableRef, params: Record<string, unknown> = {}) => (typeof key === 'string'
      ? `${known(key)}(${JSON.stringify(params)})`
      : `${key.domain}:${key.key}`),
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<{ defaultDays: number }>, sent, asked }
}

const call = (args: Record<string, string> = {}): Invocation =>
  ({ command: 'upcoming', args, rest: '' }) as unknown as Invocation

const entry = (title: string, inDays: number, hasFile: boolean): CalendarEntry =>
  ({ title, releaseAt: new Date(Date.now() + inDays * 86_400_000), hasFile })

/**
 * reply.list's parameter bag is JSON, so the day count and the rendered lines can be read back and
 * asserted one by one. A substring of the whole reply passes with two lines' parameters transposed.
 */
function list(text: string | undefined): { days: unknown, lines: string[] } {
  const bag = JSON.parse((text ?? '').replace(/^reply\.list\(/, '').replace(/\)$/, '')) as
    { days: unknown, lines: string }
  return { days: bag.days, lines: bag.lines.split('\n') }
}

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
    const [awaited, held] = list(sent[0]?.text).lines
    // Per line: with both keys present somewhere in the reply the pair can be swapped.
    expect(awaited).toContain('reply.awaited(')
    expect(awaited).toContain('"title":"Dune"')
    expect(held).toContain('reply.held(')
    expect(held).toContain('"title":"Arrival"')
  })

  it('pairs each title with the date of its own release', async () => {
    const { ctx, sent } = stub([
      { title: 'Dune', releaseAt: new Date('2026-03-05T12:00:00Z'), hasFile: false },
      { title: 'Arrival', releaseAt: new Date('2026-04-09T12:00:00Z'), hasFile: true },
    ])
    await module.create().handlers.handleUpcoming(call(), ctx)
    const [dune, arrival] = list(sent[0]?.text).lines
    // Transposing title and date prints `Mar 5, 2026 — Dune`, which any presence assertion passes.
    expect(dune).toContain('"title":"Dune"')
    expect(dune).toContain('"date":"Mar 5, 2026"')
    expect(arrival).toContain('"title":"Arrival"')
    expect(arrival).toContain('"date":"Apr 9, 2026"')
  })

  it('puts each film on its own line', async () => {
    const { ctx, sent } = stub([entry('Dune', 3, false), entry('Arrival', 10, true)])
    await module.create().handlers.handleUpcoming(call(), ctx)
    // join('') would run every film together into one unreadable line.
    expect(list(sent[0]?.text).lines).toHaveLength(2)
  })

  it('heads the list with the number of days it actually covered', async () => {
    const { ctx, sent } = stub([entry('Dune', 3, false)], 30)
    await module.create().handlers.handleUpcoming(call({ days: '7' }), ctx)
    // The empty branch's `days` is pinned elsewhere; the one in the heading was not, so /upcoming 7
    // could announce the next 30 days above seven days of films.
    expect(list(sent[0]?.text).days).toBe(7)
  })

  it('awaits a film with no file and holds one with a file, in that direction', async () => {
    // One entry per call: with two, asserting both keys are present passes with the pair swapped.
    const awaited = stub([entry('Dune', 3, false)])
    await module.create().handlers.handleUpcoming(call(), awaited.ctx)
    expect(awaited.sent[0]?.text).toContain('reply.awaited')
    expect(awaited.sent[0]?.text).not.toContain('reply.held')

    const held = stub([entry('Arrival', 10, true)])
    await module.create().handlers.handleUpcoming(call(), held.ctx)
    expect(held.sent[0]?.text).toContain('reply.held')
    expect(held.sent[0]?.text).not.toContain('reply.awaited')
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

  it('truncates a fractional argument rather than refusing it', async () => {
    // The chosen behaviour, not an accident: for a chat command a useful answer beats a pedantic
    // refusal. `Number(given)` instead of parseInt would print usage.
    const { ctx, sent } = stub([])
    await module.create().handlers.handleUpcoming(call({ days: '5.7' }), ctx)
    expect(sent[0]?.text).toBe('reply.empty({"days":5})')
  })

  it('falls back to the operator default for an empty argument', async () => {
    const { ctx, sent } = stub([], 7)
    await module.create().handlers.handleUpcoming(call({ days: '' }), ctx)
    expect(sent[0]?.text).toBe('reply.empty({"days":7})')
  })

  it('formats the date in the reader\'s locale, not always in English', async () => {
    const fixed: CalendarEntry = { title: 'Dune', releaseAt: new Date('2026-03-05T12:00:00Z'), hasFile: false }
    const { ctx, sent } = stub([fixed], 30, 'fr')
    await module.create().handlers.handleUpcoming(call(), ctx)
    expect(sent[0]?.text).toContain('mars')
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

  it('requires the rhiza it asks for, under the name its manifest declares', async () => {
    const manifest = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8')) as {
      requires?: readonly { rhiza?: string }[]
    }
    const { ctx, asked } = stub([])
    await module.create().handlers.handleUpcoming(call(), ctx)
    // Without the declaration the spore germinates clean and ctx.rhiza throws in the core's bus on
    // every /upcoming while /api/health still says germinated; with the wrong name it is dormant.
    // Every other test here stubs ctx.rhiza, so nothing else looks at the manifest at all.
    expect(manifest.requires).toEqual([{ rhiza: 'radarr' }])
    expect(asked).toEqual(['radarr'])
  })

  it('bounds defaultDays at both ends, not only the lower one', () => {
    const accepts = (c: unknown): boolean => module.configSchema.safeParse(c).success
    expect(accepts({ defaultDays: 30 })).toBe(true)
    expect(accepts({ defaultDays: 0 })).toBe(false)
    // invalidConfig violates the minimum only, so the maximum was pinned by nothing: a value above
    // it is accepted at enable and then makes /upcoming with no argument print usage forever.
    expect(accepts({ defaultDays: 366 })).toBe(false)
    expect(accepts({ defaultDays: 1.5 })).toBe(false)
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
