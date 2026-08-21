import type { Socket } from 'bun'

export interface SignalNotification {
  method: string
  params: unknown
}

interface SignalSendResult {
  type: string
  recipientAddress?: unknown
}

/**
 * Both send-failure shapes carry `code: -1` (findings §3); this preserves per-recipient
 * detail from `error.data.response.results[]` when the daemon supplies it, so a caller
 * does not lose which recipient failed and why by reading only `error.message`.
 */
export class SignalRpcError extends Error {
  readonly results?: readonly SignalSendResult[]

  constructor(message: string, results?: readonly SignalSendResult[]) {
    super(message)
    this.name = 'SignalRpcError'
    this.results = results
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Owns the socket, newline-delimited-JSON framing, and request/response correlation by
 * `id`. `close`/`end` — not `error` — is the daemon-died signal (findings §6): a dead
 * daemon closes with no `error` event, and a write into the dead socket does not throw.
 */
export class SignalRpc {
  #socket: Socket<undefined> | null = null
  #buffer = ''
  readonly #pending = new Map<string, Pending>()
  #nextId = 0
  #closed = true
  readonly #onNotification: (notification: SignalNotification) => void

  constructor(
    private readonly socketPath: string,
    onNotification: (notification: SignalNotification) => void,
  ) {
    this.#onNotification = onNotification
  }

  /**
   * Opens the socket, then makes one real request: findings §1 measured no handshake at
   * all, so a successful `Bun.connect` is not proof the daemon is alive.
   */
  async connect(): Promise<void> {
    let socket: Socket<undefined>
    try {
      socket = await Bun.connect<undefined>({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => {
            this.#onData(data.toString())
          },
          end: () => {
            this.#onDisconnect()
          },
          close: () => {
            this.#onDisconnect()
          },
        },
      })
    } catch (e) {
      throw new Error(`cannot reach signal-cli at ${this.socketPath}: ${(e as Error).message}`)
    }
    this.#socket = socket
    this.#closed = false

    try {
      await this.request('version', {})
    } catch (e) {
      this.#closed = true
      socket.end()
      this.#socket = null
      throw new Error(`signal-cli at ${this.socketPath} did not answer 'version': ${(e as Error).message}`)
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed || this.#socket === null) {
      return Promise.reject(new Error(`signal-cli connection to ${this.socketPath} is closed`))
    }
    const id = `m${String(this.#nextId)}`
    this.#nextId += 1
    const socket = this.#socket
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', method, params, id })}\n`)
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#socket?.end()
    this.#socket = null
  }

  #onData(chunk: string): void {
    this.#buffer += chunk
    const lines = this.#buffer.split('\n')
    this.#buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      this.#handleLine(line)
    }
  }

  #handleLine(line: string): void {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const id = parsed.id
    if (typeof id === 'string' && this.#pending.has(id)) {
      const pending = this.#pending.get(id)
      this.#pending.delete(id)
      if ('error' in parsed) {
        const error = parsed.error as { message: string; data: unknown }
        const response = (error.data as { response?: { results?: SignalSendResult[] } } | null)?.response
        const results = response?.results
        // Both failure shapes carry code -1 (findings §3); reading only error.message
        // would lose which recipient failed and why for the per-recipient shape.
        const detail = results?.map((r) => `${r.type} (${JSON.stringify(r.recipientAddress)})`).join(', ')
        const message = detail === undefined || detail === '' ? error.message : `${error.message}: ${detail}`
        pending?.reject(new SignalRpcError(message, results))
      } else {
        pending?.resolve(parsed.result)
      }
      return
    }
    if (typeof parsed.method === 'string') {
      this.#onNotification({ method: parsed.method, params: parsed.params })
    }
  }

  #onDisconnect(): void {
    if (this.#closed) return
    this.#closed = true
    this.#socket = null
    for (const pending of this.#pending.values()) {
      pending.reject(new Error(`signal-cli connection to ${this.socketPath} closed`))
    }
    this.#pending.clear()
  }
}
