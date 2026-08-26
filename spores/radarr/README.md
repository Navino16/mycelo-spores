# radarr

A `rhiza` spore for [Mycelo](https://github.com/Navino16/mycelo). Wraps Radarr's HTTP API,
**read only**: it polls the calendar and the library search, and it never writes anything back.
There is no webhook and no push path — Radarr never initiates contact with Mycelo.

## Configuration

```ts
z.object({
  url: z.url(),
  apiKey: z.string().min(1),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `url` | string (URL) | yes | Radarr's base address, e.g. `https://host` or `https://host/radarr` for a reverse-proxied install with a subpath |
| `apiKey` | string | yes | Radarr's API key, declared as a **secret** |

Because `apiKey` is declared as a secret, `GET /api/plugins/radarr/settings` returns it masked as
`••••` rather than in the clear. Sending that mask back in a `PUT` is **skipped, not stored**: the
route answers `200 {"ok":true}` and leaves the stored key alone, so a `PUT` must carry the real key
to change it.

The key travels as an `X-Api-Key` request **header**, never as a query parameter, so it never
lands in Radarr's own access log.

A URL with a subpath (`https://host/radarr`) is honoured. Prefer including the subpath: without
it, Radarr answers `307` and redirects to the subpathed URL, and while `fetch` follows the
redirect and keeps the header, it costs one extra round trip per request.

## Requires

No further `rhiza`. `radarr` talks only to the Radarr instance configured above.

## Health

`GET /api/health` reports one of three states for this spore:

- `healthy` — Radarr answered and reported its version.
- `degraded` — every failure where Radarr itself answered: a refused key, any status outside 2xx,
  a `200` whose body is not JSON (behind an authentication proxy, an HTML sign-in page), or a `200`
  carrying no `version` at all.
- `unreachable` — either the box did not answer at all (refused connection, DNS failure, timeout),
  or the spore has not been started, which is the state the conformance kit sees and is reported as
  `not started`.

**A dead Radarr does not make this spore dormant.** It stays germinated and simply reports
`unreachable` until the box comes back — a temporary outage on Radarr's side never takes the rest
of the bot with it.

## Compatibility

Needs `@mycelo/septum@^0.10.1` and a Mycelo core at phase 7.5 or later.
