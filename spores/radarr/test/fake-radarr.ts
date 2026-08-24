export interface FakeRoute {
  status?: number
  body?: unknown
  /** Sent verbatim, for a body that is not JSON at all. */
  raw?: string
  /** Content type of a `raw` body. Bun defaults a string body to text/plain. */
  type?: string
}

export interface FakeRadarr {
  readonly url: string
  readonly requests: readonly { path: string, query: string, apiKey: string | null }[]
  route(path: string, route: FakeRoute): void
  stop(): void
}

/** A real HTTP server on an ephemeral port. No Radarr, no network, no credential. */
export function startFakeRadarr(): FakeRadarr {
  const routes = new Map<string, FakeRoute>()
  const requests: { path: string, query: string, apiKey: string | null }[] = []

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      requests.push({ path: url.pathname, query: url.search, apiKey: request.headers.get('X-Api-Key') })
      const route = routes.get(url.pathname)
      if (route === undefined) return new Response('no such route', { status: 404 })
      if (route.raw !== undefined) {
        return new Response(route.raw, {
          status: route.status ?? 200,
          ...(route.type === undefined ? {} : { headers: { 'Content-Type': route.type } }),
        })
      }
      return Response.json(route.body ?? null, { status: route.status ?? 200 })
    },
  })

  return {
    url: server.url.origin,
    requests,
    route: (path, route) => { routes.set(path, route) },
    stop: () => { void server.stop(true) },
  }
}
