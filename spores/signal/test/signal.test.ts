import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { hyphaChecks } from '@mycelo/septum/conformance'
import type { HyphaContext, IncomingMessage, Logger } from '@mycelo/septum'
import module from '../src/index.js'
import { normalize } from '../src/normalize.js'
import { startFakeDaemon, type FakeDaemon, type FakeRequest } from './fake-daemon.js'

const here = join(import.meta.dirname, '..')

const frame = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'frames', `${name}.json`), 'utf8'))

const SENDER_UUID = '00000000-0000-4000-8000-000000000001'
const GROUP_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

describe('normalising a signal-cli notification', () => {
  it('maps a direct message, identifying the sender by uuid', () => {
    const message = normalize(frame('inbound-dm'))
    expect(message?.channel).toBe('signal')
    expect(message?.group).toBeUndefined()
    expect(message?.text).toBe('spike dm')
    expect(message?.sender.externalId).toBe(SENDER_UUID)
    expect(message?.sender.displayName).toBe('Test Sender')
  })

  it('maps a group message, carrying the group id', () => {
    const message = normalize(frame('inbound-group'))
    expect(message?.group?.id).toBe(GROUP_ID)
    expect(message?.group?.name).toBe('Test Group')
    expect(message?.text).toBe('spike dm')
  })

  it('ignores a typing indicator: it arrives on the same stream as messages (findings §4)', () => {
    expect(normalize(frame('typing'))).toBeNull()
  })

  it('ignores an envelope carrying no *Message key at all', () => {
    expect(normalize(frame('envelope-only'))).toBeNull()
  })

  it('ignores a remote delete: dataMessage is present but message is null (findings §4)', () => {
    expect(normalize(frame('remote-delete'))).toBeNull()
  })

  it('ignores a frame that is not a receive notification', () => {
    expect(normalize({ jsonrpc: '2.0', result: {}, id: 'x' })).toBeNull()
    expect(normalize(null)).toBeNull()
    expect(normalize('not an object')).toBeNull()
  })
})

function tmpSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'signal-spore-'))
  return join(dir, 'socket')
}

function respondToVersion(request: FakeRequest, daemon: FakeDaemon): boolean {
  if (request.method !== 'version') return false
  daemon.respond(request.id, { version: 'fake' })
  return true
}

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
}

function context(config: { socket: string; account: string }, emitted: IncomingMessage[]): HyphaContext<typeof config> {
  return { config, logger: noopLogger, emit: (message) => emitted.push(message) }
}

async function connected(daemon: FakeDaemon, socketPath: string, account = '+33700000000') {
  const instance = module.create()
  const emitted: IncomingMessage[] = []
  const ctx = context({ socket: socketPath, account }, emitted)
  await instance.connect(ctx)
  return { instance, emitted, daemon: daemon }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the signal hypha lifecycle', () => {
  it('fails naming the socket path when signal-cli is not there', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'signal-spore-')), 'socket')
    const instance = module.create()
    const ctx = context({ socket: socketPath, account: '+33700000000' }, [])
    expect(instance.connect(ctx)).rejects.toThrow(socketPath)
  })

  it('does not emit between connect() and listen(), and does emit after', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      respondToVersion(request, daemon)
    })
    const { instance, emitted } = await connected(daemon, socketPath)

    daemon.notify(frame('inbound-dm'))
    await wait(50)
    // The phase-3 split: an enzyme pushing from its own start() must reach a
    // connected-but-not-yet-listening channel with nothing emitted.
    expect(emitted).toEqual([])

    instance.listen()
    daemon.notify(frame('inbound-dm'))
    await wait(50)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.text).toBe('spike dm')

    await instance.stop()
    daemon.stop()
  })

  it('ignores a typing indicator and a remote delete once listening', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      respondToVersion(request, daemon)
    })
    const { instance, emitted } = await connected(daemon, socketPath)
    instance.listen()

    daemon.notify(frame('typing'))
    daemon.notify(frame('remote-delete'))
    daemon.notify(frame('envelope-only'))
    await wait(50)
    expect(emitted).toEqual([])

    await instance.stop()
    daemon.stop()
  })

  it('sends a direct message with the recipient the conversationId carries', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'send') daemon.respond(request.id, { timestamp: 1, results: [] })
    })
    const { instance } = await connected(daemon, socketPath)

    await instance.send(SENDER_UUID, { text: 'hello' })

    const sendRequest = daemon.requests.find((r) => r.method === 'send')
    expect(sendRequest?.params).toEqual({
      account: '+33700000000',
      message: 'hello',
      recipient: [SENDER_UUID],
    })

    await instance.stop()
    daemon.stop()
  })

  it('sends a group message with groupId in place of recipient', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'send') daemon.respond(request.id, { timestamp: 1, results: [] })
    })
    const { instance } = await connected(daemon, socketPath)

    await instance.send(`group:${GROUP_ID}`, { text: 'hello group' })

    const sendRequest = daemon.requests.find((r) => r.method === 'send')
    expect(sendRequest?.params).toEqual({
      account: '+33700000000',
      message: 'hello group',
      groupId: GROUP_ID,
    })

    await instance.stop()
    daemon.stop()
  })

  it('rejects on a per-recipient send failure, naming the recipient and the reason', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'send') {
        daemon.respondError(request.id, {
          code: -1,
          message: 'Failed to send message',
          data: {
            response: {
              timestamp: 1,
              results: [{ recipientAddress: { uuid: null, number: '+10000000000', username: null }, type: 'UNREGISTERED_FAILURE' }],
            },
          },
        })
      }
    })
    const { instance } = await connected(daemon, socketPath)

    // Reading only error.message would report "Failed to send message" and lose which
    // recipient failed and why (findings §3) — the rejection must carry both.
    expect(instance.send('+10000000000', { text: 'hi' })).rejects.toThrow(/UNREGISTERED_FAILURE/)

    await instance.stop()
    daemon.stop()
  })

  it('rejects on a validation send failure, carrying the daemon\'s prose', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'send') {
        daemon.respondError(request.id, {
          code: -1,
          message: "Invalid phone number 'not-a-number': No valid characters found.",
          data: null,
        })
      }
    })
    const { instance } = await connected(daemon, socketPath)

    expect(instance.send('not-a-number', { text: 'hi' })).rejects.toThrow(/Invalid phone number/)

    await instance.stop()
    daemon.stop()
  })

  it('refuses to send after the daemon dies, rather than writing into a void', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      respondToVersion(request, daemon)
    })
    const { instance } = await connected(daemon, socketPath)

    // findings §6: a dead daemon gives end() then close(), no error, and write() does
    // not throw — killClient() reproduces exactly that half-close.
    daemon.killClient()
    await wait(50)

    const before = daemon.requests.length
    expect(instance.send(SENDER_UUID, { text: 'hello' })).rejects.toThrow()
    // The refusal must be pre-emptive: no send request should have reached the socket.
    expect(daemon.requests.length).toBe(before)

    daemon.stop()
  })

  it('stops cleanly, and a second stop() does not throw', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      respondToVersion(request, daemon)
    })
    const { instance } = await connected(daemon, socketPath)

    await instance.stop()
    await instance.stop()

    daemon.stop()
  })

  it('lists group members by uuid, matching the form normalize() puts in sender.externalId', async () => {
    const socketPath = tmpSocketPath()
    const otherMember = '00000000-0000-4000-8000-000000000002'
    let listGroupsCalls = 0
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'listGroups') {
        listGroupsCalls += 1
        daemon.respond(request.id, [
          { id: GROUP_ID, members: [{ number: null, uuid: SENDER_UUID, isAdmin: true }, { number: null, uuid: otherMember, isAdmin: false }] },
        ])
      }
    })
    const { instance } = await connected(daemon, socketPath)

    const members = await instance.listGroupMembers?.(GROUP_ID)
    const inboundSender = normalize(frame('inbound-group'))?.sender

    expect(members).toEqual([
      { channel: 'signal', externalId: SENDER_UUID },
      { channel: 'signal', externalId: otherMember },
    ])
    // The whole reason group-gate can work: the two forms must be literally equal.
    expect(members?.some((m) => m.externalId === inboundSender?.externalId)).toBe(true)
    expect(listGroupsCalls).toBe(1)

    await instance.stop()
    daemon.stop()
  })

  it('syncs and retries once on a membership miss, then answers from the retry', async () => {
    const socketPath = tmpSocketPath()
    let listGroupsCalls = 0
    let syncCalls = 0
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'sendSyncRequest') {
        syncCalls += 1
        daemon.respond(request.id, {})
        return
      }
      if (request.method === 'listGroups') {
        listGroupsCalls += 1
        // findings §8: a linked device does not learn about a group on its own — the
        // group is absent on the first listGroups and present only after the sync.
        daemon.respond(request.id, listGroupsCalls === 1 ? [] : [{ id: GROUP_ID, members: [{ number: null, uuid: SENDER_UUID, isAdmin: true }] }])
      }
    })
    const { instance } = await connected(daemon, socketPath)

    const members = await instance.listGroupMembers?.(GROUP_ID)

    expect(syncCalls).toBe(1)
    expect(listGroupsCalls).toBe(2)
    expect(members).toEqual([{ channel: 'signal', externalId: SENDER_UUID }])

    await instance.stop()
    daemon.stop()
  })

  it('answers an empty membership list rather than throwing when the group never appears', async () => {
    const socketPath = tmpSocketPath()
    const daemon = startFakeDaemon(socketPath, (request) => {
      if (respondToVersion(request, daemon)) return
      if (request.method === 'sendSyncRequest') daemon.respond(request.id, {})
      if (request.method === 'listGroups') daemon.respond(request.id, [])
    })
    const { instance } = await connected(daemon, socketPath)

    const members = await instance.listGroupMembers?.(GROUP_ID)
    expect(members).toEqual([])

    await instance.stop()
    daemon.stop()
  })

  it('conforms, with no catalogues of its own', async () => {
    const manifest: unknown = parseYaml(readFileSync(join(here, 'spore.yaml'), 'utf8'))
    const failures = await hyphaChecks({
      name: 'signal',
      manifest,
      module,
      validConfig: { socket: '/tmp/signal.sock', account: '+33700000000' },
      invalidConfig: { socket: '' },
      membershipGroupId: GROUP_ID,
    })
    expect(failures).toEqual([])
  })
})
