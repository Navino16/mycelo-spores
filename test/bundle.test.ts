import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { assertDistributable, bundle } from '../tools/bundle.js'

const out = mkdtempSync(join(tmpdir(), 'bundle-'))
afterAll(() => { rmSync(out, { recursive: true, force: true }) })

async function members(archive: string): Promise<string[]> {
  const p = Bun.spawn(['tar', '-tzf', archive], { stdout: 'pipe' })
  await p.exited
  return (await new Response(p.stdout).text()).trim().split('\n')
}

describe('bundle', () => {
  it('produces the distributable tree of design §4.1', async () => {
    const r = await bundle('spores/radarr', out)
    expect(r.name).toBe('radarr')
    const held = await members(r.archive)
    expect(held).toContain('radarr/spore.yaml')
    expect(held).toContain('radarr/index.js')
    expect(held).toContain('radarr/translations/en.yaml')
    expect(held).toContain('radarr/translations/fr.yaml')
    expect(held).toContain('radarr/README.md')
    expect(held.some((m) => m.startsWith('radarr/src/'))).toBe(false)
    await assertDistributable(r.archive, 'radarr')
  })

  it('names the archive for the manifest name and the package version', async () => {
    const r = await bundle('spores/help', out)
    expect(r.archive.endsWith(`help-${r.strain}.tgz`)).toBe(true)
  })

  it('refuses an archive holding a second top-level directory', async () => {
    const stage = join(out, 'two')
    mkdirSync(join(stage, 'radarr'), { recursive: true })
    mkdirSync(join(stage, 'extra'), { recursive: true })
    writeFileSync(join(stage, 'radarr/spore.yaml'), 'name: radarr\n')
    writeFileSync(join(stage, 'extra/f.txt'), 'x')
    const archive = join(out, 'two.tgz')
    await Bun.spawn(['tar', '-czf', archive, '-C', stage, 'radarr', 'extra']).exited
    expect(assertDistributable(archive, 'radarr')).rejects.toThrow(/exactly one root/)
  })

  it('refuses an archive shipping sources, which CODE_ENTRIES would prefer', async () => {
    const stage = join(out, 'src')
    mkdirSync(join(stage, 'radarr/src'), { recursive: true })
    writeFileSync(join(stage, 'radarr/spore.yaml'), 'name: radarr\n')
    writeFileSync(join(stage, 'radarr/src/index.ts'), 'export default {}\n')
    const archive = join(out, 'src.tgz')
    await Bun.spawn(['tar', '-czf', archive, '-C', stage, 'radarr']).exited
    expect(assertDistributable(archive, 'radarr')).rejects.toThrow(/CODE_ENTRIES/)
  })

  it('refuses an archive with no manifest, which discover() would not see', async () => {
    const stage = join(out, 'noman')
    mkdirSync(join(stage, 'radarr'), { recursive: true })
    writeFileSync(join(stage, 'radarr/index.js'), 'export default {}\n')
    const archive = join(out, 'noman.tgz')
    await Bun.spawn(['tar', '-czf', archive, '-C', stage, 'radarr']).exited
    expect(assertDistributable(archive, 'radarr')).rejects.toThrow(/spore\.yaml/)
  })

  it('bundles a module into the given outDir even when it is relative', async () => {
    // A temp dir, not a literal, so an aborted run cannot leave bundled JS in the repository
    // for eslint to trip on (test/lint.test.ts:26-28 guards the identical class).
    const abs = mkdtempSync(join(tmpdir(), 'bundle-rel-'))
    const relOut = relative(process.cwd(), abs)
    try {
      const r = await bundle('spores/radarr', relOut)
      const held = await members(r.archive)
      expect(held).toContain('radarr/index.js')
    } finally {
      rmSync(abs, { recursive: true, force: true })
    }
  })
})
