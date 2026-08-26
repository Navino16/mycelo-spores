import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/** design §4.1: the distributable unit is a directory, not a file. */
const COPIED = ['spore.yaml', 'README.md', 'translations']

export interface Bundled {
  name: string
  strain: string
  archive: string
}

async function readManifestName(dir: string): Promise<string> {
  const raw: unknown = parse(await readFile(join(dir, 'spore.yaml'), 'utf8'))
  const name = (raw as { name?: unknown }).name
  if (typeof name !== 'string' || name === '') throw new Error(`${dir}/spore.yaml declares no name`)
  return name
}

async function readVersion(dir: string): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const version = (raw as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${dir}/package.json declares no version`)
  }
  return version
}

/** Mutates process.cwd() across an await; a concurrent call can build against another spore's septum. */
export async function bundle(sporeDir: string, outDir: string): Promise<Bundled> {
  const dir = resolve(sporeDir)
  // Absolute before anything uses it: the chdir below would otherwise reinterpret a
  // relative outDir against the spore directory, and the release workflow passes one.
  const out = resolve(outDir)
  // The tag and the asset carry the manifest name: discover.ts:6 says it may differ from
  // the directory name.
  const name = await readManifestName(dir)
  const strain = await readVersion(dir)

  const staging = join(out, 'staging', name)
  await rm(join(out, 'staging'), { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  const entry = join(dir, 'src/index.ts')
  // A spore whose commands are all `respond:` ships no module at all.
  if (existsSync(entry)) {
    const cwd = process.cwd()
    // Under `bun test`, Bun.build() resolves node_modules from process.cwd(), not from the
    // entrypoint's own directory as it does outside the test runner. Measured on Bun 1.4.0.
    process.chdir(dir)
    try {
      const built = await Bun.build({
        entrypoints: [entry],
        target: 'bun',
        outdir: staging,
        naming: 'index.js',
      })
      if (!built.success) throw new AggregateError(built.logs, `bundling ${name} failed`)
      // Bun.build reports success having written outside `staging` if a path was misresolved,
      // and an archive with no entry point passes every other check here.
      if (!existsSync(join(staging, 'index.js'))) {
        throw new Error(`bundling ${name} wrote no index.js into ${staging}`)
      }
    } finally {
      process.chdir(cwd)
    }
  }

  for (const item of COPIED) {
    const from = join(dir, item)
    if (existsSync(from)) await cp(from, join(staging, item), { recursive: true })
  }

  const archive = join(out, `${name}-${strain}.tgz`)
  const tar = Bun.spawn(['tar', '-czf', archive, '-C', join(out, 'staging'), name], {
    stderr: 'pipe',
  })
  if (await tar.exited !== 0) {
    throw new Error(`tar failed for ${name}: ${await new Response(tar.stderr).text()}`)
  }
  await rm(join(out, 'staging'), { recursive: true, force: true })
  return { name, strain, archive }
}

/** design §9.1: exactly one top-level directory, named for the spore, and no sources. */
export async function assertDistributable(archive: string, name: string): Promise<void> {
  const list = Bun.spawn(['tar', '-tzf', archive], { stdout: 'pipe' })
  if (await list.exited !== 0) throw new Error(`unreadable archive ${archive}`)
  const members = (await new Response(list.stdout).text()).trim().split('\n')

  const roots = new Set(members.map((m) => m.split('/')[0]))
  if (roots.size !== 1 || !roots.has(name)) {
    throw new Error(`${archive} must hold exactly one root '${name}', holds ${[...roots].join(', ')}`)
  }
  const source = members.find((m) => m.startsWith(`${name}/src/`))
  if (source !== undefined) {
    throw new Error(`${archive} ships '${source}': CODE_ENTRIES prefers src/index.ts and would load it`)
  }
  if (!members.includes(`${name}/spore.yaml`)) {
    throw new Error(`${archive} ships no spore.yaml: discover() would not see it`)
  }
}

if (import.meta.main) {
  const [sporeDir, outDir] = Bun.argv.slice(2)
  if (sporeDir === undefined || outDir === undefined) {
    console.error('usage: bun run bundle -- <sporeDir> <outDir>')
    process.exit(1)
  }
  const r = await bundle(sporeDir, outDir)
  await assertDistributable(r.archive, r.name)
  console.log(`${r.name}@${r.strain} ${r.archive}`)
}
