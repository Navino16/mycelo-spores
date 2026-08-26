# now-watching

An `enzyme` spore for [Mycelo](https://github.com/Navino16/mycelo). Answers `/watching` with what
the house's media server is playing right now.

## Requires

```yaml
requires:
  - any_of: [{ rhiza: jellyfin }, { rhiza: plex }]
```

**One of** Jellyfin or Plex, not both. The group is mandatory — `optional` is rejected on an
`any_of` group by septum — so with neither installed the spore is **dormant**, not degraded.

`jellyfin` is listed first and **no `jellyfin` spore is published anywhere**. So on every real
install today, resolution collapses to `plex`, and the handler picks its branch with
`ctx.has('jellyfin')` / `ctx.has('plex')` at call time, not from which name came first in the
manifest. An operator reading `requires` top to bottom and expecting Jellyfin support to exist
would be wrong; this file is what corrects that.

The two services do not answer the same shape, so the branches are not interchangeable: a Plex
session carries a player and a watch progress, a Jellyfin session carries a device and no
progress. `/watching` renders each with its own catalogue keys.

## Behaviour

`/watching` takes no argument. It lists every current session, one line each, distinguishing a
film from an episode. A missing progress renders as `?`, never `0%` — `0%` would claim someone is
at the very start when Plex simply reported no usable duration. A paused session says so; a
playing one does not.

## What this does not prove

Only the *chosen* alternative ever enters a spore's resolved dependencies — germination does not
keep the alternative it did not pick. So this spore's Jellyfin branch has never run against a real
Jellyfin server, and nothing here proves the behaviour of an `any_of` with **both** alternatives
installed, nor the open question recorded since phase 3: an installed-but-broken first alternative
would leave the requirer dormant while a healthy second sits unused. Both need a published
`jellyfin` spore, which needs a Jellyfin server to write it against.

## Compatibility

Needs `@mycelo/septum@^0.10.0` and a Mycelo core at phase 7.5 or later.
