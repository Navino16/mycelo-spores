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
- `degraded` — the transport worked but the answer was bad, on either request: a 5xx, a body that
  is not JSON, or (on `/status/sessions` specifically) a refused token. The box is up; something
  about the request or the credential is not right. `health()` issues two requests precisely so
  this can be told apart from the box being off: `/identity` needs no token and answers "is the box
  on", then `/status/sessions` answers "is the credential good".
- `unreachable` — the transport itself failed, on either request: a refused connection, a DNS
  failure or a timeout. The box did not answer at all.

The state follows the **kind** of failure, never which of the two requests produced it — a 500 on
`/identity` is `degraded`, the same as a 500 on `/status/sessions` would be.

**A dead Plex does not make this spore dormant.** It stays germinated and simply reports
`unreachable` until the box comes back — a temporary outage on Plex's side never takes the rest of
the bot with it.

## Compatibility

Needs `@mycelo/septum@^0.9` and a Mycelo core at phase 7.5 or later.
