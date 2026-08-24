import type { TranslatableRef } from '@mycelo/septum'

export type FailureKind = 'unreachable' | 'unauthorized' | 'unexpected'

export type Fetched =
  | { ok: true, body: unknown }
  | { ok: false, failure: FailureKind, detail: string }

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Fetched> {
  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    // A refused connection, an unroutable address and the abort all land here, and for the
    // operator they are one case: the box did not answer (findings §6).
    return { ok: false, failure: 'unreachable', detail: describe(e) }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, failure: 'unauthorized', detail: `HTTP ${response.status}` }
  }
  if (!response.ok) return { ok: false, failure: 'unexpected', detail: `HTTP ${response.status}` }
  try {
    return { ok: true, body: await response.json() }
  } catch (e) {
    // A healthy host can answer 200 with a body that is not JSON: HTML behind an auth proxy
    // (findings §1.2), XML from Plex without the JSON opt-in (findings §5). The content type is the
    // only clue to which.
    const type = response.headers.get('content-type') ?? 'no content-type'
    return { ok: false, failure: 'unexpected', detail: `${type}: ${describe(e)}` }
  }
}

const KEYS: Record<FailureKind, string> = {
  unreachable: 'error.unreachable',
  unauthorized: 'error.unauthorized',
  unexpected: 'error.unexpected',
}

/** A rhiza has no reader and cannot translate, so it names the message (design §4.1). */
export const refFor = (failure: FailureKind, detail: string): TranslatableRef =>
  ({ domain: 'radarr', key: KEYS[failure], params: { detail } })
