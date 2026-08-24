# plex

A `rhiza` spore for [Mycelo](https://github.com/Navino16/mycelo). Wraps a Plex Media Server's HTTP
API, **read only**: it reads the current sessions, and it never writes anything back — nothing is
ever paused, stopped or changed on the server.

When nobody is watching, `sessions()` answers an empty list; that shape is inferred from how Plex
reports an empty container elsewhere, not measured directly, and the milestone is what confirms it.

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
- `degraded` — `/identity` succeeded (so the box is on) and `/status/sessions` then did not, for
  any reason: a refused token, an unexpected response, or even that second request itself failing
  to answer. Every `/status/sessions` failure reads as `degraded`, never `unreachable` — only
  `/identity`'s own failure produces that state, which is why `health()` issues two requests:
  `/identity` needs no token and answers "is the box on", then `/status/sessions` answers "is the
  credential good".
- `unreachable` — `/identity` failed for any reason: a refused connection, DNS failure or timeout,
  but also an answer this spore could not use — a non-JSON body, for instance. Because
  `/status/sessions` is only tried once `/identity` succeeds, an `/identity` failure is always
  reported as `unreachable`, even one where the box did technically answer.

**A dead Plex does not make this spore dormant.** It stays germinated and simply reports
`unreachable` until the box comes back — a temporary outage on Plex's side never takes the rest of
the bot with it.

## Compatibility

Needs `@mycelo/septum@^0.9` and a Mycelo core at phase 7.5 or later.
