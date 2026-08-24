# plex

A `rhiza` spore for [Mycelo](https://github.com/Navino16/mycelo). Wraps a Plex Media Server's HTTP
API, **read only**: it reads the current sessions, and it never writes anything back — nothing is
ever paused, stopped or changed on the server.

## Configuration

```ts
z.object({
  url: z.url(),
  token: z.string().min(1),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `url` | string (URL) | yes | Plex's base address, e.g. `http://plex.example:32400` |
| `token` | string | yes | A Plex authentication token, declared as a **secret** |

Because `token` is declared as a secret, `GET /api/plugins/plex/settings` returns it masked as
`••••` rather than in the clear, and **sending the mask back is refused** rather than stored — a
`PUT` must carry the real token to change it.

The token travels as an `X-Plex-Token` request **header**, never as a query parameter, so it never
lands in Plex's own access log.

Every request also sends `Accept: application/json`, and this is **not optional**: without it Plex
answers XML, which this spore cannot read, and reports `error.unexpected`.

## Requires

No further `rhiza`. `plex` talks only to the Plex Media Server configured above.

## Health

`GET /api/health` reports one of three states for this spore:

- `healthy` — Plex answered `/identity` and accepted the token on `/status/sessions`, and its
  version is reported.
- `degraded` — the server answered `/identity` (so the box is on) and then refused the token, or
  answered something else unexpected, on `/status/sessions`. This state specifically means *the
  server is reachable and something about the request or the credential is wrong*, distinct from
  the server being off — which is why `health()` issues two requests: `/identity` needs no token
  and answers "is the box on", then `/status/sessions` answers "is the credential good".
- `unreachable` — the box did not answer `/identity` at all: refused connection, DNS failure or
  timeout.

**A dead Plex does not make this spore dormant.** It stays germinated and simply reports
`unreachable` until the box comes back — a temporary outage on Plex's side never takes the rest of
the bot with it.

## Compatibility

Needs `@mycelo/septum@^0.9` and a Mycelo core at phase 7.5 or later.
