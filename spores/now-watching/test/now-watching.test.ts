import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { enzymeChecks } from '@mycelo/septum/conformance'
import type { EnzymeContext, Invocation, TranslatableRef } from '@mycelo/septum'
import module from '../src/index.js'
import type { PlexSession } from '@mycelo/spore-plex'

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
const PLEX = catalogueKeys(join(here, '..', 'plex'), 'en.yaml')

function known(key: string): string {
  if (!OWN.has(key)) throw new Error(`no such key in translations/en.yaml: ${key}`)
  return key
}

interface Installed {
  jellyfin?: readonly unknown[] | TranslatableRef
  plex?: readonly PlexSession[] | TranslatableRef
}

function stub(installed: Installed): { ctx: EnzymeContext<unknown>, sent: { text?: string }[] } {
  const sent: { text?: string }[] = []
  const ctx = {
    config: {},
    locale: 'en',
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, child: () => ctx.logger },
    has: (name: string) => Object.hasOwn(installed, name),
    rhiza: (name: string) => ({
      sessions: () => Promise.resolve(name === 'jellyfin' ? installed.jellyfin : installed.plex),
    }),
    t: (key: string | TranslatableRef, params: Record<string, unknown> = {}) => (typeof key === 'string'
      ? `${known(key)}(${JSON.stringify(params)})`
      : `${key.domain}:${key.key}`),
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<unknown>, sent }
}

const call = (): Invocation => ({ command: 'watching', args: {}, rest: '' }) as unknown as Invocation

const session = (over: Partial<PlexSession> = {}): PlexSession =>
  ({ title: 'Dune', user: 'alice', player: 'phone', progress: 20, paused: false, ...over })

/**
 * reply.list's parameter bag is JSON, so the rendered lines can be read back and asserted one by
 * one. A substring of the whole reply passes with two lines' parameters transposed.
 */
function rendered(text: string | undefined): string[] {
  const bag = JSON.parse((text ?? '').replace(/^reply\.list\(/, '').replace(/\)$/, '')) as { lines: string }
  return bag.lines.split('\n')
}

describe('the now-watching spore', () => {
  it('reaches plex when jellyfin, the first alternative, is absent', async () => {
    const { ctx, sent } = stub({ plex: [session()] })
    await module.create().handlers.handleWatching(call(), ctx)
    expect(sent[0]?.text).toContain('reply.plex-film')
  })

  it('renders every session, not just the first', async () => {
    const { ctx, sent } = stub({ plex: [session({ title: 'Dune' }), session({ title: 'Arrival', user: 'bob' })] })
    await module.create().handlers.handleWatching(call(), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('Dune')
    expect(text).toContain('Arrival')
    expect(text).toContain('bob')
  })

  it('distinguishes an episode from a film', async () => {
    const { ctx, sent } = stub({ plex: [session({ title: 'Dune' }), session({ title: 'The Bells', series: 'Game of Thrones' })] })
    await module.create().handlers.handleWatching(call(), ctx)
    const [film, episode] = rendered(sent[0]?.text)
    // Per line, not across the reply: with both keys present somewhere the branch can be inverted.
    expect(film).toContain('reply.plex-film(')
    expect(film).toContain('"title":"Dune"')
    expect(episode).toContain('reply.plex-episode(')
    expect(episode).toContain('"series":"Game of Thrones"')
  })

  it('puts each session on its own line', async () => {
    const { ctx, sent } = stub({ plex: [session({ title: 'Dune' }), session({ title: 'Arrival' })] })
    await module.create().handlers.handleWatching(call(), ctx)
    // join('') would run every session together into one unreadable line.
    expect(rendered(sent[0]?.text)).toHaveLength(2)
  })

  it('shows a missing progress as ? rather than as 0 per cent', async () => {
    const { ctx, sent } = stub({ plex: [session({ progress: null })] })
    await module.create().handlers.handleWatching(call(), ctx)
    // The line is nested inside reply.list's JSON, so the quotes arrive escaped.
    expect(sent[0]?.text ?? '').toMatch(/progress\\":\\"\?/)
  })

  it('says a paused session is paused, and a playing one is not', async () => {
    const { ctx, sent } = stub({ plex: [session({ paused: true }), session({ title: 'Arrival' })] })
    await module.create().handlers.handleWatching(call(), ctx)
    const [first, second] = rendered(sent[0]?.text)
    // The catalogue drives the wording through an ICU select, so the handler's job is only to pass
    // the state — and to pass a DIFFERENT one per session (findings §5.1). Asserted per line: with
    // both words present somewhere in the reply the pair can be swapped.
    expect(first).toContain('"state":"paused"')
    expect(second).toContain('"state":"playing"')
  })

  it('passes paused for a paused session and playing for a playing one, in that direction', async () => {
    // One session per call: with two, asserting both words are present passes with the pair swapped.
    const paused = stub({ plex: [session({ paused: true })] })
    await module.create().handlers.handleWatching(call(), paused.ctx)
    expect(paused.sent[0]?.text).toContain('paused')
    expect(paused.sent[0]?.text).not.toContain('playing')

    const playing = stub({ plex: [session({ paused: false })] })
    await module.create().handlers.handleWatching(call(), playing.ctx)
    expect(playing.sent[0]?.text).toContain('playing')
    expect(playing.sent[0]?.text).not.toContain('paused')
  })

  it('names the player, not the user, as the device', async () => {
    const { ctx, sent } = stub({ plex: [
      session({ user: 'alice', player: 'living room' }),
      session({ user: 'bob', player: 'kitchen', series: 'Game of Thrones' }),
    ] })
    await module.create().handlers.handleWatching(call(), ctx)
    const [film, episode] = rendered(sent[0]?.text)
    // The pairing, not the presence: both values survive the two parameters being transposed, and
    // /watching then prints every person on a device named after themselves. Both branches carry
    // the same pair and only one of them was pinned.
    expect(film).toContain('"user":"alice"')
    expect(film).toContain('"player":"living room"')
    expect(episode).toContain('"user":"bob"')
    expect(episode).toContain('"player":"kitchen"')
  })

  it('answers the empty case when nobody is watching', async () => {
    const { ctx, sent } = stub({ plex: [] })
    await module.create().handlers.handleWatching(call(), ctx)
    expect(sent[0]?.text).toBe('reply.empty({})')
  })

  it('renders the rhiza ref rather than a sentence of its own', async () => {
    const { ctx, sent } = stub({ plex: { domain: 'plex', key: 'error.unreachable' } })
    await module.create().handlers.handleWatching(call(), ctx)
    expect(sent[0]?.text).toBe('plex:error.unreachable')
  })

  it('prefers jellyfin when it is the resolved alternative, and renders its own shape', async () => {
    // Unreachable in this deployment: jellyfin is not installed. Written and driven anyway,
    // because a handler hardcoded to plex passes every test that only ever has plex (design §12).
    const { ctx, sent } = stub({
      jellyfin: [
        { title: 'Dune', user: 'alice', device: 'tablet' },
        { title: 'The Bells', series: 'Game of Thrones', user: 'bob', device: 'tv' },
      ],
      plex: [session({ title: 'never rendered' })],
    })
    await module.create().handlers.handleWatching(call(), ctx)
    const [film, episode] = rendered(sent[0]?.text)
    expect(film).toContain('reply.jellyfin-film(')
    expect(film).toContain('"user":"alice"')
    expect(film).toContain('"device":"tablet"')
    expect(episode).toContain('reply.jellyfin-episode(')
    expect(episode).toContain('"user":"bob"')
    expect(episode).toContain('"device":"tv"')
    expect(sent[0]?.text ?? '').not.toContain('never rendered')
  })

  it('says so when neither alternative resolved', async () => {
    const { ctx, sent } = stub({})
    await module.create().handlers.handleWatching(call(), ctx)
    expect(sent[0]?.text).toBe('reply.none({})')
  })

  it('renders only refs plex actually ships', () => {
    for (const key of ['error.unreachable', 'error.unauthorized', 'error.unexpected']) {
      expect(PLEX.has(key), `plex/en.yaml is missing ${key}`).toBe(true)
    }
  })

  it('conforms, with its own catalogues', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await enzymeChecks({
      name: 'now-watching',
      module,
      manifest,
      context: () => stub({ plex: [] }).ctx,
      catalogs: {
        en: parseYaml(readFileSync(join(here, 'translations', 'en.yaml'), 'utf8')),
        fr: parseYaml(readFileSync(join(here, 'translations', 'fr.yaml'), 'utf8')),
      },
    })
    expect(failures).toEqual([])
  })
})
