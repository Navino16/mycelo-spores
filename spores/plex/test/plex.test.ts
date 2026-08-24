import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { rhizaChecks } from '@mycelo/septum/conformance'
import type { HealthStatus, Logger, RhizaContext, TranslatableRef } from '@mycelo/septum'
import module from '../src/index.js'
import type { PlexApi, PlexSession } from '../src/api.js'
import { stateFor } from '../src/http.js'
import { startFakePlex } from './fake-plex.js'
import type { FakePlex } from './fake-plex.js'

const here = join(import.meta.dirname, '..')

const silent = (): Logger => {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  return logger
}

interface Config { url: string, token: string }

const context = (url: string, token = 'the-token'): RhizaContext<Config> => ({
  config: { url, token },
  logger: silent(),
  emit: () => undefined,
})

const isRef = <T>(r: readonly T[] | TranslatableRef): r is TranslatableRef => 'domain' in r

let fake: FakePlex
beforeEach(() => { fake = startFakePlex() })
afterEach(() => { fake.stop() })

const started = async (): Promise<{ api: PlexApi, health: () => Promise<HealthStatus> }> => {
  const rhiza = module.create()
  await rhiza.start(context(fake.url))
  return { api: rhiza.api, health: () => rhiza.health() }
}

const episode = {
  title: 'The Bells',
  grandparentTitle: 'Game of Thrones',
  viewOffset: 600_000,
  duration: 1_200_000,
  User: { title: 'alice' },
  Player: { title: 'living room', state: 'playing' },
}

const film = {
  title: 'Dune',
  viewOffset: 300_000,
  duration: 1_500_000,
  User: { title: 'bob' },
  Player: { title: 'phone', state: 'paused' },
}

describe('plex sessions', () => {
  it('reads every session, not just the first', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { size: 2, Metadata: [episode, film] } } })
    const { api } = await started()
    const sessions = await api.sessions() as readonly PlexSession[]
    expect(sessions.map((s) => s.title)).toEqual(['The Bells', 'Dune'])
    expect(sessions.map((s) => s.user)).toEqual(['alice', 'bob'])
  })

  it('carries the series for an episode and none for a film', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: [episode, film] } } })
    const { api } = await started()
    const sessions = await api.sessions() as readonly PlexSession[]
    expect(sessions[0]?.series).toBe('Game of Thrones')
    expect(sessions[1]?.series).toBeUndefined()
  })

  it('computes progress as a whole per cent, and null with no duration', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: [
      episode,
      { ...film, duration: 0 },
    ] } } })
    const { api } = await started()
    const sessions = await api.sessions() as readonly PlexSession[]
    expect(sessions[0]?.progress).toBe(50)
    expect(sessions[1]?.progress).toBeNull()
  })

  it('reports a paused session as paused and a playing one as not', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: [episode, film] } } })
    const { api } = await started()
    const sessions = await api.sessions() as readonly PlexSession[]
    // Plex reports a paused session as a session (findings §5.1); both values must survive, or
    // /watching announces someone is watching a film they stopped.
    expect(sessions.map((s) => s.paused)).toEqual([false, true])
  })

  it('treats a container with no Metadata as nobody watching (shape inferred, findings §5.2)', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { size: 0 } } })
    const { api } = await started()
    expect(await api.sessions()).toEqual([])
  })

  it('sends the token as a header, never a query parameter', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { size: 0 } } })
    const { api } = await started()
    await api.sessions()
    expect(fake.requests[0]?.token).toBe('the-token')
    // A query parameter would put the credential in Plex's access log.
    expect(fake.requests[0]?.query).not.toContain('the-token')
  })

  it('asks for JSON, without which Plex answers XML (findings §5)', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { size: 0 } } })
    const { api } = await started()
    await api.sessions()
    expect(fake.requests[0]?.accept).toBe('application/json')
  })

  it('names error.unexpected when there is no MediaContainer at all', async () => {
    fake.route('/status/sessions', { body: [1, 2, 3] })
    const { api } = await started()
    const result = await api.sessions()
    expect(isRef(result) ? result.key : '').toBe('error.unexpected')
  })

  it('names error.unauthorized on a refused token', async () => {
    fake.route('/status/sessions', { status: 401, body: {} })
    const { api } = await started()
    const result = await api.sessions()
    expect(isRef(result) ? result.key : '').toBe('error.unauthorized')
  })

  it('names its own domain on the ref, not another spore\'s', async () => {
    fake.route('/status/sessions', { status: 401, body: {} })
    const { api } = await started()
    // A consumer's manifest permits the domains it requires; a ref naming radarr resolves in no
    // catalogue the reader is allowed, so the key reaches them literally.
    expect(await api.sessions()).toEqual({
      domain: 'plex',
      key: 'error.unauthorized',
      params: { detail: 'HTTP 401' },
    })
  })

  it('names error.unexpected when Metadata is present but not a list', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: { title: 'one' } } } })
    const { api } = await started()
    const result = await api.sessions()
    // Answering [] here would report a moved wire shape as nobody watching.
    expect(isRef(result) ? result.key : '').toBe('error.unexpected')
  })

  it('caps progress at 100 when the offset runs past the duration', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: [
      { ...film, viewOffset: 2_000_000, duration: 1_500_000 },
    ] } } })
    const { api } = await started()
    expect((await api.sessions() as readonly PlexSession[])[0]?.progress).toBe(100)
  })

  it('answers ? for a session carrying neither a user nor a player', async () => {
    fake.route('/status/sessions', { body: { MediaContainer: { Metadata: [
      { title: 'Anonymous', viewOffset: 1, duration: 2 },
    ] } } })
    const { api } = await started()
    const session = (await api.sessions() as readonly PlexSession[])[0]
    expect(session?.user).toBe('?')
    expect(session?.player).toBe('?')
  })

  it('names error.unreachable, with the domain, before start()', async () => {
    expect(await module.create().api.sessions()).toEqual({
      domain: 'plex',
      key: 'error.unreachable',
      params: { detail: 'not started' },
    })
  })
})

describe('plex health', () => {
  it('is unreachable before start()', async () => {
    expect(await module.create().health()).toMatchObject({ state: 'unreachable', detail: 'not started' })
  })

  it('is healthy when identity answers and the token is accepted', async () => {
    fake.route('/identity', { body: { MediaContainer: { version: '1.41.0' } } })
    fake.route('/status/sessions', { body: { MediaContainer: { size: 0 } } })
    const { health } = await started()
    expect(await health()).toMatchObject({ state: 'healthy', detail: 'Plex 1.41.0' })
  })

  it('is degraded, not unreachable, when the host is up and the token is refused', async () => {
    fake.route('/identity', { body: { MediaContainer: { version: '1.41.0' } } })
    fake.route('/status/sessions', { status: 401, body: {} })
    const { health } = await started()
    const status = await health()
    expect(status.state).toBe('degraded')
    expect(status.detail).toContain('token rejected')
  })

  it('asks /identity for JSON too, and sends it no token', async () => {
    fake.route('/identity', { body: { MediaContainer: { version: '1.41.0' } } })
    fake.route('/status/sessions', { body: { MediaContainer: { size: 0 } } })
    const { health } = await started()
    await health()
    const identity = fake.requests.find((r) => r.path === '/identity')
    // Both halves matter: the JSON opt-in applies to every route, and /identity must stay tokenless
    // or it can no longer answer "is the box on" independently of the credential.
    expect(identity?.accept).toBe('application/json')
    expect(identity?.token).toBeNull()
  })

  it('is degraded, not unreachable, when identity answers badly', async () => {
    fake.route('/identity', { status: 500, body: {} })
    const { health } = await started()
    // design §4.3: the state follows the failure KIND. A host answering 500 is up and unwell; calling
    // it unreachable tells the operator to check the box when the box is on.
    expect(await health()).toMatchObject({ state: 'degraded' })
  })

  it('is degraded when identity answers a body that is not JSON, and names the content type', async () => {
    fake.route('/identity', { raw: '<?xml version="1.0"?><MediaContainer/>', type: 'text/xml' })
    const { health } = await started()
    const status = await health()
    // findings §5: without the JSON opt-in Plex answers XML. The content type is what tells that
    // apart from an authentication proxy's HTML, and both arrive as a 200.
    expect(status.state).toBe('degraded')
    expect(status.detail).toContain('text/xml')
  })

  it('maps a failure kind to a state, whichever request produced it', () => {
    // The sessions-side transport failure — identity answers, then the host dies — cannot be staged
    // against a single fake server, so the shared map is pinned directly instead.
    expect(stateFor('unreachable')).toBe('unreachable')
    expect(stateFor('unauthorized')).toBe('degraded')
    expect(stateFor('unexpected')).toBe('degraded')
  })

  it('is unreachable when identity does not answer', async () => {
    const { health } = await started()
    fake.stop()
    expect(await health()).toMatchObject({ state: 'unreachable' })
  })
})

describe('the plex spore', () => {
  it('conforms', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await rhizaChecks({
      name: 'plex',
      manifest,
      module,
      validConfig: { url: 'http://plex.example:32400', token: 't' },
      invalidConfig: { url: 'nope', token: '' },
    })
    expect(failures).toEqual([])
  })
})
