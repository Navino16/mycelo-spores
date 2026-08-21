import type { Socket } from 'bun'

export interface SignalNotification {
  method: string
  params: unknown
}

interface SignalSendResult {
  type: string
  recipientAddress?: unknown
}

/** See findings §3: both send-failure shapes carry `code: -1`, distinguishable only by `data`. */
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

export interface SignalRpcOptions {
  /** How long connect() waits for a reply to its liveness request before giving up. */
  livenessTimeoutMs?: number
  /** Called when a line from the daemon does not parse as JSON, instead of throwing. */
  onProtocolError?: (error: Error, line: string) => void
}

const DEFAULT_LIVENESS_TIMEOUT_MS = 5_000

/**
 * Owns the socket, newline-delimited-JSON framing, and request/response correlation by
 * `id`. `close`/`end` — not `error` — is the daemon-died signal (findings §6): a dead
 * daemon closes with no `error` event, and a write into the dead socket does not throw.
 */
export class SignalRpc {
  #socket: Socket<undefined> | null = null
  readonly #decoder = new TextDecoder('utf-8')
  #buffer = ''
  readonly #pending = new Map<string, Pending>()
  #nextId = 0
  #closed = true
  readonly #onNotification: (notification: SignalNotification) => void
  readonly #options: SignalRpcOptions

  constructor(
    private readonly socketPath: string,
    onNotification: (notification: SignalNotification) => void,
    options: SignalRpcOptions = {},
  ) {
    this.#onNotification = onNotification
    this.#options = options
  }

  /**
   * Opens the socket, then makes one real, time-bounded request: findings §1 measured no
   * handshake at all, so a successful `Bun.connect` is not proof the daemon is alive, and an
   * accepting-but-silent daemon must not hang germination forever.
   */
  async connect(): Promise<void> {
    let socket: Socket<undefined>
    try {
      socket = await Bun.connect<undefined>({
        unix: this.socketPath,
        socket: {
          data: (_socket, data) => {
            // A single TextDecoder across chunks, with stream:true, so a multi-byte UTF-8
            // sequence split across a chunk boundary decodes correctly instead of as U+FFFD.
            this.#onData(this.#decoder.decode(data, { stream: true }))
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
      await this.request('version', {}, this.#options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS)
    } catch (e) {
      this.#closed = true
      socket.end()
      this.#socket = null
      throw new Error(`signal-cli at ${this.socketPath} did not answer 'version': ${(e as Error).message}`)
    }
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.#closed || this.#socket === null) {
      return Promise.reject(new Error(`signal-cli connection to ${this.socketPath} is closed`))
    }
    const id = `m${String(this.#nextId)}`
    this.#nextId += 1
    const socket = this.#socket
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(id)
              reject(new Error(`no response to '${method}' after ${String(timeoutMs)}ms`))
            }, timeoutMs)
      this.#pending.set(id, {
        resolve: (value) => {
          if (timer !== undefined) clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer)
          reject(error)
        },
      })
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
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (e) {
      this.#options.onProtocolError?.(e as Error, line)
      return
    }
    // JSON.parse('null') and JSON.parse('7') both succeed; reading .id off either throws
    // inside the socket data callback, where no handler can catch it.
    if (typeof raw !== 'object' || raw === null) {
      this.#options.onProtocolError?.(new Error('line is valid JSON but not an object'), line)
      return
    }
    const parsed = raw as Record<string, unknown>
    const id = parsed.id
    if (typeof id === 'string' && this.#pending.has(id)) {
      const pending = this.#pending.get(id)
      this.#pending.delete(id)
      if ('error' in parsed) {
        const error = parsed.error as { message: string; data: unknown }
        const response = (error.data as { response?: { results?: SignalSendResult[] } } | null)?.response
        const results = response?.results
        // findings §3: reading only error.message would lose which recipient failed and why.
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
