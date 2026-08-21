import { describe, expect, it } from 'bun:test'
import module from '../src/index.js'
import type { EnzymeContext, Invocation } from '@mycelo/septum'

const services = [
  { label: 'radarr', url: 'https://radarr.example', note: 'films' },
  { label: 'jellyfin', url: 'https://jellyfin.example' },
]

function stub(config: { services: typeof services }) {
  const sent: { text?: string }[] = []
  const ctx = {
    config,
    locale: 'en',
    principal: { id: 1, channel: 'signal', externalId: '+3360', roles: ['owner'] },
    t: (key: string, params: Record<string, unknown> = {}) => `${key}(${JSON.stringify(params)})`,
    reply: async (content: { text?: string }) => { sent.push(content) },
  }
  return { ctx: ctx as unknown as EnzymeContext<{ services: typeof services }>, sent }
}

const call = (command: string, args: Record<string, string> = {}) =>
  ({ command, args, raw: `/${command}` }) as unknown as Invocation

describe('the links spore', () => {
  it('lists every configured service, not just the last', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLinks(call('links'), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('radarr')
    expect(text).toContain('jellyfin')
  })

  it('renders a service with a note differently from one without', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLinks(call('links'), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('reply.noted')
    expect(text).toContain('reply.line')
  })

  it('answers the empty case', async () => {
    const { ctx, sent } = stub({ services: [] })
    await module.create().handlers.handleLinks(call('links'), ctx)
    expect(sent[0]?.text).toBe('reply.empty({})')
  })

  it('finds one service by label', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link', { label: 'jellyfin' }), ctx)
    expect(sent[0]?.text).toContain('jellyfin')
    expect(sent[0]?.text).not.toContain('radarr')
  })

  it('refuses an unknown label by naming every label that exists', async () => {
    const { ctx, sent } = stub({ services })
    await module.create().handlers.handleLink(call('link', { label: 'plex' }), ctx)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('reply.unknown')
    // Plural: a refusal naming only the first or only the last label is the cardinality
    // defect phase 5.5's mutation campaign found six times.
    expect(text).toContain('radarr')
    expect(text).toContain('jellyfin')
  })
})
