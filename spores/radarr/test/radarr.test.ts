import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { rhizaChecks } from '@mycelo/septum/conformance'
import type { HealthStatus, Logger, RhizaContext, TranslatableRef } from '@mycelo/septum'
import module from '../src/index.js'
import type { CalendarEntry, RadarrApi, SearchResult } from '../src/api.js'
import { startFakeRadarr } from './fake-radarr.js'
import type { FakeRadarr } from './fake-radarr.js'

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

interface Config { url: string, apiKey: string }

const context = (url: string, apiKey = 'the-key'): RhizaContext<Config> => ({
  config: { url, apiKey },
  logger: silent(),
  emit: () => undefined,
})

const iso = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString()

const isRef = <T>(r: readonly T[] | TranslatableRef): r is TranslatableRef => 'domain' in r

let fake: FakeRadarr
beforeEach(() => { fake = startFakeRadarr() })
afterEach(() => { fake.stop() })

const started = async (): Promise<{ api: RadarrApi, health: () => Promise<HealthStatus> }> => {
  const rhiza = module.create()
  await rhiza.start(context(fake.url))
  return { api: rhiza.api, health: () => rhiza.health() }
}

describe('the radarr calendar', () => {
  it('reads every entry, not just the first, and sorts them by release', async () => {
    fake.route('/api/v3/calendar', { body: [
      { title: 'Later', digitalRelease: iso(20), hasFile: false },
      { title: 'Sooner', digitalRelease: iso(3), hasFile: true },
    ] })
    const { api } = await started()
    const result = await api.calendar(30)
    expect(isRef(result)).toBe(false)
    const entries = result as readonly CalendarEntry[]
    expect(entries.map((e) => e.title)).toEqual(['Sooner', 'Later'])
    expect(entries.map((e) => e.hasFile)).toEqual([true, false])
  })

  it('sends the key as a header and the window as a query', async () => {
    fake.route('/api/v3/calendar', { body: [] })
    const { api } = await started()
    await api.calendar(7)
    expect(fake.requests[0]?.apiKey).toBe('the-key')
    expect(fake.requests[0]?.query).toContain('unmonitored=false')
    expect(fake.requests[0]?.query).toContain('start=')
    expect(fake.requests[0]?.query).toContain('end=')
  })

  it('answers an empty array as an empty array, not as a failure', async () => {
    fake.route('/api/v3/calendar', { body: [] })
    const { api } = await started()
    expect(await api.calendar(30)).toEqual([])
  })

  it('names error.unauthorized on a refused key', async () => {
    fake.route('/api/v3/calendar', { status: 401, body: { message: 'no' } })
    const { api } = await started()
    const result = await api.calendar(30)
    expect(result).toEqual({ domain: 'radarr', key: 'error.unauthorized', params: { detail: 'HTTP 401' } })
  })

  it('names error.unexpected on a body that is not an array', async () => {
    fake.route('/api/v3/calendar', { body: { message: 'surprise' } })
    const { api } = await started()
    const result = await api.calendar(30)
    expect(isRef(result) ? result.key : '').toBe('error.unexpected')
  })

  it('names error.unreachable when the host is gone', async () => {
    const { api } = await started()
    fake.stop()
    const result = await api.calendar(30)
    expect(isRef(result) ? result.key : '').toBe('error.unreachable')
  })

  it('skips an entry with no readable date rather than inventing one', async () => {
    fake.route('/api/v3/calendar', { body: [
      { title: 'Dated', digitalRelease: iso(5) },
      { title: 'Undated' },
    ] })
    const { api } = await started()
    const entries = await api.calendar(30) as readonly CalendarEntry[]
    expect(entries.map((e) => e.title)).toEqual(['Dated'])
  })
})

describe('the radarr lookup', () => {
  it('marks what is in the library and what is not', async () => {
    fake.route('/api/v3/movie/lookup', { body: [
      { title: 'Held', year: 2021, id: 12 },
      { title: 'Absent', year: 1984, id: 0 },
    ] })
    const { api } = await started()
    const results = await api.search('dune') as readonly SearchResult[]
    expect(results.map((r) => r.inLibrary)).toEqual([true, false])
  })
})

describe('radarr health', () => {
  it('is unreachable before start(), which is what the conformance kit exercises', async () => {
    expect(await module.create().health()).toMatchObject({ state: 'unreachable', detail: 'not started' })
  })

  it('is healthy when system/status carries a version', async () => {
    fake.route('/api/v3/system/status', { body: { version: '5.2.6' } })
    const { health } = await started()
    expect(await health()).toMatchObject({ state: 'healthy', detail: 'Radarr 5.2.6' })
  })

  it('is degraded when the host answers without a version', async () => {
    fake.route('/api/v3/system/status', { body: { hello: true } })
    const { health } = await started()
    expect(await health()).toMatchObject({ state: 'degraded' })
  })

  it('is degraded on a refused key, not unreachable', async () => {
    fake.route('/api/v3/system/status', { status: 401, body: {} })
    const { health } = await started()
    expect(await health()).toMatchObject({ state: 'degraded' })
  })

  it('is unreachable when the host is gone', async () => {
    const { health } = await started()
    fake.stop()
    expect(await health()).toMatchObject({ state: 'unreachable' })
  })
})

describe('the radarr spore', () => {
  it('conforms', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await rhizaChecks({
      name: 'radarr',
      manifest,
      module,
      validConfig: { url: 'http://radarr.example', apiKey: 'k' },
      invalidConfig: { url: 'not-a-url', apiKey: '' },
    })
    expect(failures).toEqual([])
  })
})
