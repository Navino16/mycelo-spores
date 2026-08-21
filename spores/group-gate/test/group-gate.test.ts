import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { inhibitorChecks } from '@mycelo/septum/conformance'
import module from '../src/index.js'
import type { InhibitorContext, IncomingMessage } from '@mycelo/septum'

const here = join(import.meta.dirname, '..')

const config = { channel: 'signal', groupId: 'g:house' }

const message = (channel: string, externalId: string) => ({
  channel,
  conversationId: 'c:1',
  messageId: 'm:1',
  sender: { channel, externalId },
  text: '/help',
  attachments: [],
  raw: null,
  receivedAt: new Date(),
}) as unknown as IncomingMessage

function stub(members: { channel: string, externalId: string }[] | null) {
  const required: { channel: string, capability: string }[] = []
  const ctx = {
    config,
    requireCapability: (channel: string, capability: string) => { required.push({ channel, capability }) },
    groupMembers: async () => members,
    t: (key: string) => key,
  }
  return { ctx: ctx as unknown as InhibitorContext<typeof config>, required }
}

describe('the group-gate spore', () => {
  it('demands group_membership of the configured channel at start', async () => {
    const { ctx, required } = stub([])
    const inhibitor = module.create()
    await inhibitor.start(ctx)
    // Kills the mutant that drops requireCapability: without it a gate whose channel cannot
    // report members admits everyone silently.
    expect(required).toEqual([{ channel: 'signal', capability: 'group_membership' }])
  })

  it('admits a member', async () => {
    const { ctx } = stub([{ channel: 'signal', externalId: '+3361' }, { channel: 'signal', externalId: '+3362' }])
    const inhibitor = module.create()
    await inhibitor.start(ctx)
    // The plural case: two members, and the one asked about is NOT the last, so a mutant
    // comparing against only the final entry dies.
    expect(await inhibitor.inspect(message('signal', '+3361'), ctx)).toEqual({ allow: true })
  })

  it('refuses a non-member with a reason', async () => {
    const { ctx } = stub([{ channel: 'signal', externalId: '+3361' }])
    const inhibitor = module.create()
    await inhibitor.start(ctx)
    const verdict = await inhibitor.inspect(message('signal', '+3399'), ctx)
    expect(verdict.allow).toBe(false)
    expect(verdict.reason).toBe('reason.not-member')
  })

  it('refuses when membership is unavailable, rather than admitting', async () => {
    const { ctx } = stub(null)
    const inhibitor = module.create()
    await inhibitor.start(ctx)
    const verdict = await inhibitor.inspect(message('signal', '+3361'), ctx)
    // Fail closed. A null answer means the channel cannot report members; admitting here
    // would make the gate silently inert, which design §8 forbids.
    expect(verdict.allow).toBe(false)
    expect(verdict.reason).toBe('reason.unavailable')
  })

  it('leaves another channel alone', async () => {
    const { ctx } = stub([])
    const inhibitor = module.create()
    await inhibitor.start(ctx)
    expect(await inhibitor.inspect(message('console', 'local'), ctx)).toEqual({ allow: true })
  })

  it('refuses everything before start', async () => {
    const { ctx } = stub([{ channel: 'signal', externalId: '+3361' }])
    const inhibitor = module.create()
    const verdict = await inhibitor.inspect(message('signal', '+3361'), ctx)
    expect(verdict.allow).toBe(false)
    expect(verdict.reason).toBe('reason.unstarted')
  })

  it('conforms, with its own catalogues', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const { ctx } = stub([{ channel: 'signal', externalId: '+3361' }])
    const failures = await inhibitorChecks({
      name: 'group-gate',
      manifest,
      module,
      validConfig: config,
      invalidConfig: { channel: 'signal' },
      context: () => ctx,
      allowed: [message('signal', '+3361')],
      denied: [message('signal', '+3399')],
    })
    expect(failures).toEqual([])
  })
})
