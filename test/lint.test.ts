import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const DIR = join(ROOT, 'test', 'lint')

// One probe file per case rather than a shared path: the cases shell out to eslint over the live
// tree, so a shared path makes them race.
async function lint(name: string, lines: readonly string[]): Promise<{ code: number, output: string }> {
  const probe = join(DIR, `${name}.generated.ts`)
  mkdirSync(DIR, { recursive: true })
  writeFileSync(probe, `${lines.join('\n')}\n`)
  try {
    const proc = Bun.spawn(['bunx', 'eslint', probe], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    return { code: await proc.exited, output: stdout + stderr }
  } finally {
    rmSync(probe, { force: true })
  }
}

// Both ends, because a `*.generated.ts` surviving an aborted run breaks `eslint .` for the whole
// repository, and the config cannot ignore the directory without making these tests measure nothing.
beforeAll(() => { rmSync(DIR, { recursive: true, force: true }) })
afterAll(() => { rmSync(DIR, { recursive: true, force: true }) })

describe('the cross-spore import rule', () => {
  it('rejects a value import from another spore', async () => {
    const { code, output } = await lint('value-import', [
      "import { defineConfig } from '@mycelo/spore-links'",
      'export const x = defineConfig',
    ])
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-imports')
    // Names the specifier, so the message an author reads points at what they wrote.
    expect(output).toContain('@mycelo/spore-links')
  }, 30_000)

  it('rejects a re-export from another spore', async () => {
    const { code, output } = await lint('re-export', [
      "export { defineConfig } from '@mycelo/spore-links'",
    ])
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-imports')
    expect(output).toContain('@mycelo/spore-links')
  }, 30_000)

  it('allows a type-only import from another spore', async () => {
    // The specifier must match `@mycelo/spore-*` or the test discriminates nothing: with
    // `@mycelo/septum` here, flipping allowTypeImports off leaves this green.
    const { code, output } = await lint('type-import', [
      "import type { LinksConfig } from '@mycelo/spore-links'",
      'export type X = LinksConfig',
    ])
    expect(code).toBe(0)
    expect(output).toBe('')
  }, 30_000)

  it('rejects reaching another spore by a relative path', async () => {
    // Resolves while both spores share one `spores:` root and throws in a multi-root install, so
    // the package-specifier rule alone left the natural in-monorepo mistake permitted.
    const { code, output } = await lint('relative-import', [
      "import type { CalendarEntry } from '../../spores/radarr/src/api.js'",
      'export type X = CalendarEntry',
    ])
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-imports')
    expect(output).toContain('relative path')
  }, 30_000)

  it('rejects a dynamic import of another spore', async () => {
    // no-restricted-imports does not visit ImportExpression at this version, so this form is
    // covered by no-restricted-syntax and the rule name is what proves which one fired.
    const { code, output } = await lint('dynamic-import', [
      "export const load = async (): Promise<unknown> => import('@mycelo/spore-radarr')",
    ])
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-syntax')
  }, 30_000)

  it('rejects a dynamic import by a relative path', async () => {
    const { code, output } = await lint('dynamic-relative', [
      "export const load = async (): Promise<unknown> => import('../../spores/radarr/src/api.js')",
    ])
    expect(code).toBe(1)
    expect(output).toContain('no-restricted-syntax')
  }, 30_000)
})
