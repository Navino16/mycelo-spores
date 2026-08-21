import { existsSync, unlinkSync } from 'node:fs'
import type { Socket, UnixSocketListener } from 'bun'

export interface FakeRequest {
  method: string
  params: unknown
  id: string
}

export interface FakeDaemon {
  readonly socketPath: string
  readonly requests: FakeRequest[]
  respond(id: string, result: unknown): void
  respondError(id: string, error: { code: number; message: string; data: unknown }): void
  notify(frame: unknown): void
  /** Writes an unencoded line, for testing how the client handles a line that is not JSON. */
  writeRaw(line: string): void
  /** Simulates the daemon dying: a graceful FIN, which findings §6 measured as the real signal. */
  killClient(): void
  stop(): void
}

type Handler = (request: FakeRequest, daemon: FakeDaemon) => void

/** Replays recorded frames over a real unix socket. No Java, no account, no network. */
export function startFakeDaemon(socketPath: string, handle: Handler): FakeDaemon {
  if (existsSync(socketPath)) unlinkSync(socketPath)

  let client: Socket<undefined> | null = null
  let buffer = ''
  const requests: FakeRequest[] = []

  const write = (payload: unknown): void => {
    client?.write(`${JSON.stringify(payload)}\n`)
  }

  const daemon: FakeDaemon = {
    socketPath,
    requests,
    respond: (id, result) => write({ jsonrpc: '2.0', result, id }),
    respondError: (id, error) => write({ jsonrpc: '2.0', error, id }),
    notify: (frame) => write(frame),
    writeRaw: (line) => client?.write(`${line}\n`),
    killClient: () => client?.end(),
    stop: () => listener.stop(true),
  }

  const listener: UnixSocketListener<undefined> = Bun.listen({
    unix: socketPath,
    socket: {
      open: (socket) => {
        client = socket
      },
      data: (_socket, data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === '') continue
          const request = JSON.parse(line) as FakeRequest
          requests.push(request)
          handle(request, daemon)
        }
      },
      close: () => {
        client = null
      },
    },
  })

  return daemon
}
