import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { IntlMessageFormat } from 'intl-messageformat'

const SPORES = join(import.meta.dirname, '..', 'spores')
const FIXTURES = join(import.meta.dirname, 'fixtures')

interface Catalogue {
  spore: string
  locale: string
  messages: Map<string, IntlMessageFormat>
}

/** Flattens `reply: {list: '…'}` to `reply.list`, which is how the core keys a catalogue. */
function flatten(node: unknown, prefix: string, into: Map<string, string>): void {
  if (typeof node === 'string') { into.set(prefix, node); return }
  if (typeof node !== 'object' || node === null) return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix === '' ? key : `${prefix}.${key}`, into)
  }
}

function everyCatalogue(root: string = SPORES): Catalogue[] {
  if (!existsSync(root)) return []
  const found: Catalogue[] = []
  for (const spore of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = join(root, spore.name, 'translations')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const flat = new Map<string, string>()
      flatten(parseYaml(readFileSync(join(dir, file), 'utf8')), '', flat)
      const messages = new Map<string, IntlMessageFormat>()
      for (const [key, text] of flat) messages.set(key, new IntlMessageFormat(text, file.slice(0, -5)))
      found.push({ spore: spore.name, locale: file.slice(0, -5), messages })
    }
  }
  return found
}

interface FormatElementLike {
  type: number
  value?: unknown
  options?: Record<string, { value?: unknown }>
}

function isElementLike(x: unknown): x is FormatElementLike {
  return typeof x === 'object' && x !== null && 'type' in x && typeof x.type === 'number'
}

// type 0 is a literal run and names no parameter; every other type's `value` is the name,
// and select/plural nest further elements per branch in `options`.
function collectArgumentNames(elements: unknown, into: Set<string>): void {
  if (!Array.isArray(elements)) return
  for (const raw of elements) {
    if (!isElementLike(raw)) continue
    if (raw.type !== 0 && typeof raw.value === 'string') into.add(raw.value)
    if (raw.options !== undefined) {
      for (const option of Object.values(raw.options)) collectArgumentNames(option.value, into)
    }
  }
}

function assertSameKeySet(catalogues: Catalogue[]): void {
  const bySpore = new Map<string, Catalogue[]>()
  for (const c of catalogues) bySpore.set(c.spore, [...(bySpore.get(c.spore) ?? []), c])
  for (const [spore, locales] of bySpore) {
    const en = locales.find((l) => l.locale === 'en')
    expect(en, `${spore} must ship en, the bottom of every cascade`).toBeDefined()
    const enKeys = [...(en?.messages.keys() ?? [])].sort()
    for (const other of locales.filter((l) => l.locale !== 'en')) {
      const keys = [...other.messages.keys()].sort()
      // Both directions on purpose: the diff a reader gets names the missing side.
      expect(keys.filter((k) => !enKeys.includes(k)), `${spore}/${other.locale} has extra keys`).toEqual([])
      expect(enKeys.filter((k) => !keys.includes(k)), `${spore}/${other.locale} is missing keys`).toEqual([])
    }
  }
}

function collectParams(catalogues: Catalogue[]): Record<string, string> {
  const names = new Set<string>()
  for (const c of catalogues) {
    for (const m of c.messages.values()) collectArgumentNames(m.getAst(), names)
  }
  // One shared bag: an unused name is ignored, and a message needing a name outside the
  // union throws MissingValueError, which fails as loudly as a surviving brace.
  return Object.fromEntries([...names].map((n) => [n, `<${n}>`]))
}

function renderEveryKey(catalogues: Catalogue[], params: Record<string, string>): string[] {
  const broken: string[] = []
  for (const c of catalogues) {
    for (const [key, message] of c.messages) {
      const rendered = String(message.format(params))
      if (rendered.includes('{') || rendered.includes('}')) {
        broken.push(`${c.spore}/${c.locale}/${key}: ${rendered}`)
      }
    }
  }
  return broken
}

describe('the fixture catalogues', () => {
  const catalogues = everyCatalogue(FIXTURES)

  it('is discovered from the filesystem', () => {
    // Guards the walk itself: a broken discovery would turn every test below into a no-op
    // that passes.
    expect(catalogues.length).toBeGreaterThan(0)
  })

  it('carries the same key set in every locale a spore ships', () => {
    assertSameKeySet(catalogues)
  })

  it('renders every key in every locale with no unsubstituted placeholder', () => {
    const params = collectParams(catalogues)
    // Guards the AST walk itself: a walker silently returning no names would format every
    // message with an empty bag, and a catalogue with no interpolated message at all would
    // then pass with nothing caught.
    expect(Object.keys(params).length).toBeGreaterThan(0)
    expect(renderEveryKey(catalogues, params)).toEqual([])
  })
})

describe('every spore catalogue', () => {
  const catalogues = everyCatalogue()

  // No count guard: zero is a correct answer before any spore ships translations. This scan
  // covers whatever `spores/*/translations/` holds, with no edit needed as spores are added.

  it('carries the same key set in every locale a spore ships', () => {
    assertSameKeySet(catalogues)
  })

  it('renders every key in every locale with no unsubstituted placeholder', () => {
    expect(renderEveryKey(catalogues, collectParams(catalogues))).toEqual([])
  })
})
