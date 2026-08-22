import { afterEach, describe, expect, it } from 'bun:test'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PROBE = join(ROOT, 'test', 'lint', 'probe.generated.ts')

function writeProbe(source: string): void {
  mkdirSync(join(ROOT, 'test', 'lint'), { recursive: true })
  writeFileSync(PROBE, source)
}

async function lintProbe(): Promise<{ code: number, output: string }> {
  const proc = Bun.spawn(['bunx', 'eslint', PROBE], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, output: stdout + stderr }
}

afterEach(() => { rmSync(PROBE, { force: true }) })

describe('the cross-spore import rule', () => {
  it('rejects a value import from another spore', async () => {
    writeProbe([
      "import { defineConfig } from '@mycelo/spore-links'",
      'export const x = defineConfig',
      '',
    ].join('\n'))
    const { code, output } = await lintProbe()
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-imports')
    // Names the specifier, so the message an author reads points at what they wrote.
    expect(output).toContain('@mycelo/spore-links')
  }, 30_000)

  it('allows a type-only import from another spore', async () => {
    writeProbe([
      "import type { EnzymeModule } from '@mycelo/septum'",
      'export type X = EnzymeModule',
      '',
    ].join('\n'))
    const { code, output } = await lintProbe()
    expect(code).toBe(0)
    expect(output).toBe('')
  }, 30_000)
})
