import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { rhizaChecks } from '@mycelo/septum/conformance'
import type { HealthStatus, Logger, RhizaContext, TranslatableRef } from '@mycelo/septum'
import module from '../src/index.js'
import type { CalendarEntry, RadarrApi, SearchResult } from '../src/api.js'
import { parseCalendar } from '../src/parse.js'
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

  it('reads all three release fields, not only digitalRelease (findings §2)', async () => {
    fake.route('/api/v3/calendar', { body: [
      { title: 'Physical', physicalRelease: iso(5) },
      { title: 'Cinemas', inCinemas: iso(8) },
    ] })
    const { api } = await started()
    const entries = await api.calendar(30) as readonly CalendarEntry[]
    expect(entries.map((e) => e.title)).toEqual(['Physical', 'Cinemas'])
  })

  it('takes the earliest of several dates that fall inside the window', async () => {
    const early = iso(2)
    fake.route('/api/v3/calendar', { body: [{ title: 'Two', inCinemas: early, digitalRelease: iso(9) }] })
    const { api } = await started()
    const entries = await api.calendar(30) as readonly CalendarEntry[]
    expect(entries[0]?.releaseAt.toISOString()).toBe(early)
  })

  it('prefers a date inside the window over an earlier one outside it', async () => {
    // Without the window filter the earliest date wins outright, which prints a release in the past
    // for a film Radarr listed because of its digital date (findings §2.1).
    const inside = iso(5)
    fake.route('/api/v3/calendar', { body: [{ title: 'Reissue', inCinemas: iso(-40), digitalRelease: inside }] })
    const { api } = await started()
    const entries = await api.calendar(30) as readonly CalendarEntry[]
    expect(entries[0]?.releaseAt.toISOString()).toBe(inside)
  })

  it('skips an entry whose title is an empty string', async () => {
    fake.route('/api/v3/calendar', { body: [{ title: '', digitalRelease: iso(5) }] })
    const { api } = await started()
    expect(await api.calendar(30)).toEqual([])
  })

  it('skips an entry whose date does not parse rather than answering Invalid Date', async () => {
    fake.route('/api/v3/calendar', { body: [{ title: 'Soon', digitalRelease: 'soon' }] })
    const { api } = await started()
    expect(await api.calendar(30)).toEqual([])
  })

  it('counts what it skipped, which is the only signal that the wire shape moved', () => {
    const from = new Date()
    const to = new Date(from.getTime() + 30 * 86_400_000)
    const parsed = parseCalendar([{ title: 'Undated' }, { title: 'Dated', digitalRelease: iso(5) }], from, to)
    expect(parsed?.skipped).toBe(1)
    expect(parsed?.entries.length).toBe(1)
  })

  it('sends a window whose end is `days` after its start', async () => {
    fake.route('/api/v3/calendar', { body: [] })
    const { api } = await started()
    await api.calendar(7)
    const query = new URLSearchParams(fake.requests[0]?.query ?? '')
    const span = Date.parse(query.get('end') ?? '') - Date.parse(query.get('start') ?? '')
    expect(span).toBeGreaterThan(0)
    expect(Math.round(span / 86_400_000)).toBe(7)
  })

  it('reaches a reverse-proxied install whose configured url ends in a slash', async () => {
    fake.route('/radarr/api/v3/calendar', { body: [] })
    const rhiza = module.create()
    await rhiza.start(context(`${fake.url}/radarr/`))
    expect(await rhiza.api.calendar(30)).toEqual([])
  })

  it('names error.unreachable, with the domain, before start()', async () => {
    const result = await module.create().api.calendar(30)
    expect(result).toEqual({ domain: 'radarr', key: 'error.unreachable', params: { detail: 'not started' } })
  })
})

describe('the radarr lookup', () => {
  it('marks what is in the library and what is not', async () => {
    // findings §3: a miss carries NO id key. A fixture using `id: 0` instead lets a mutant reading
    // `id === 0` pass while inverting every real result.
    fake.route('/api/v3/movie/lookup', { body: [
      { title: 'Held', year: 2021, id: 12 },
      { title: 'Absent', year: 1984 },
    ] })
    const { api } = await started()
    const results = await api.search('dune') as readonly SearchResult[]
    expect(results.map((r) => r.inLibrary)).toEqual([true, false])
  })

  it('treats an id of zero as absent too, which the wire shape does not produce', async () => {
    fake.route('/api/v3/movie/lookup', { body: [{ title: 'Zero', year: 2000, id: 0 }] })
    const { api } = await started()
    expect((await api.search('zero') as readonly SearchResult[])[0]?.inLibrary).toBe(false)
  })

  it('answers an empty array for a term that matches nothing', async () => {
    fake.route('/api/v3/movie/lookup', { body: [] })
    const { api } = await started()
    expect(await api.search('zzzqqqxyw')).toEqual([])
  })

  it('skips a result carrying no year rather than answering an undefined one', async () => {
    fake.route('/api/v3/movie/lookup', { body: [{ title: 'Yearless' }, { title: 'Dune', year: 2021 }] })
    const { api } = await started()
    const results = await api.search('dune') as readonly SearchResult[]
    expect(results.map((r) => r.title)).toEqual(['Dune'])
  })

  it('escapes the term, so one carrying an ampersand is not truncated', async () => {
    fake.route('/api/v3/movie/lookup', { body: [] })
    const { api } = await started()
    await api.search('this & that')
    expect(fake.requests[0]?.query).toContain('%26')
  })

  it('names error.unauthorized when the key is refused', async () => {
    fake.route('/api/v3/movie/lookup', { status: 401, body: {} })
    const { api } = await started()
    const result = await api.search('dune')
    expect(isRef(result) ? result.key : '').toBe('error.unauthorized')
  })

  it('names error.unexpected when the body is not an array', async () => {
    fake.route('/api/v3/movie/lookup', { body: { message: 'surprise' } })
    const { api } = await started()
    const result = await api.search('dune')
    expect(isRef(result) ? result.key : '').toBe('error.unexpected')
  })

  it('names error.unreachable when the host is gone', async () => {
    const { api } = await started()
    fake.stop()
    const result = await api.search('dune')
    expect(isRef(result) ? result.key : '').toBe('error.unreachable')
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

  it('is degraded on a server error, and says which status', async () => {
    fake.route('/api/v3/system/status', { status: 503, body: {} })
    const { health } = await started()
    expect(await health()).toMatchObject({ state: 'degraded', detail: 'HTTP 503' })
  })

  it('names the content type when a 200 carries HTML instead of JSON (findings §1.2)', async () => {
    fake.route('/api/v3/system/status', { raw: '<html>sign in</html>', type: 'text/html' })
    const { health } = await started()
    const status = await health()
    // The content type is the only thing that tells an authentication proxy apart from a broken
    // Radarr, and both answer 200.
    expect(status.state).toBe('degraded')
    expect(status.detail).toContain('text/html')
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
