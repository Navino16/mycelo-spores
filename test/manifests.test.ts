import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const SPORES = join(import.meta.dirname, '../spores')

function manifestRange(dir: string): string {
  const raw: unknown = parse(readFileSync(join(SPORES, dir, 'spore.yaml'), 'utf8'))
  const range = (raw as { septum?: unknown }).septum
  if (typeof range !== 'string') throw new Error(`${dir}/spore.yaml declares no septum range`)
  return range
}

function resolvedSeptum(dir: string): string {
  const pkg: unknown = JSON.parse(
    readFileSync(join(SPORES, dir, 'node_modules/@mycelo/septum/package.json'), 'utf8'),
  )
  return (pkg as { version: string }).version
}

const dirs = readdirSync(SPORES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

describe('every manifest admits the septum it resolves', () => {
  it.each(dirs)('%s', (dir) => {
    const range = manifestRange(dir)
    const version = resolvedSeptum(dir)
    expect(Bun.semver.satisfies(version, range)).toBe(true)
  })

  // Bun.semver treats an unparseable range as `*`, so a typo would make every assertion
  // above pass vacuously (design §10.1). A caret range rejects 0.0.1; `*` does not.
  it.each(dirs)('%s declares a range that is actually a range', (dir) => {
    expect(Bun.semver.satisfies('0.0.1', manifestRange(dir))).toBe(false)
  })
})
