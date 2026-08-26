import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const SPORES = join(import.meta.dirname, '../spores')

/** The directory whose spore.yaml declares this name. The two may differ (discover.ts:6). */
export function locate(name: string, root: string = SPORES): string {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const raw: unknown = parse(readFileSync(join(root, entry.name, 'spore.yaml'), 'utf8'))
    if ((raw as { name?: unknown }).name === name) return join(root, entry.name)
  }
  throw new Error(`no spore declares the name '${name}'`)
}

if (import.meta.main) {
  const name = Bun.argv[2]
  if (name === undefined) {
    console.error('usage: bun tools/locate.ts <manifest-name>')
    process.exit(1)
  }
  console.log(locate(name))
}
