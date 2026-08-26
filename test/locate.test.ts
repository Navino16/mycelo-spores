import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { locate } from '../tools/locate.js'

const FIXTURES = join(import.meta.dirname, 'fixtures/locate')

describe('locate', () => {
  it('finds a spore by the name its manifest declares', () => {
    expect(locate('radarr')).toBe(join(import.meta.dirname, '../spores/radarr'))
  })

  it('throws naming the name when nothing declares it', () => {
    expect(() => locate('nonesuch')).toThrow(/nonesuch/)
  })

  it('returns the directory, not the name, when they differ', () => {
    expect(locate('renamed-spore', FIXTURES)).toBe(join(FIXTURES, 'mismatched-dir'))
  })

  it('skips a directory with no spore.yaml instead of throwing ENOENT', () => {
    const root = join(FIXTURES, 'no-manifest-root')
    expect(() => locate('nonesuch', root)).toThrow(/no spore declares the name/)
  })
})
