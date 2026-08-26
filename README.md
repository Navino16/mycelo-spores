# mycelo-spores

The public plugin registry — the default `sporangium` — for
[Mycelo](https://github.com/Navino16/mycelo).

A `spore` is a distributable Mycelo plugin. This repository holds plugin **sources**;
build output is never committed. Each release is published as a self-contained bundle
attached to a tag of the form `<plugin>@<semver>`.

Four kinds of plugin live here:

| Kind | Purpose | Examples |
|---|---|---|
| `hypha` | Channel — reaches out to the outside world | Signal, Discord |
| `rhiza` | Connected system — two-way exchange with a foreign system | Radarr, Plex |
| `enzyme` | Command — turns an input into a response | `/upcoming` |
| `inhibitor` | Filter — decides whether a sender may be heard at all | group admission |

## What ships here today

| Spore | Kind | What it does | Needs configuring |
|---|---|---|---|
| [`admin`](spores/admin) | `enzyme` | Eighteen commands administering plugins, roles, conversations, broadcast targets, restrictions and locales | no |
| [`help`](spores/help) | `enzyme` | `/help` lists the commands the caller is authorized to invoke, described in their own language | no |
| [`links`](spores/links) | `enzyme` | `/links` and `/link <label>` answer with the house's own service URLs | yes, but it answers "none configured" until you do |
| [`group-gate`](spores/group-gate) | `inhibitor` | Admits only members of a group the channel itself holds — a real Signal group, not a duplicated allowlist | **yes, before its first boot** |
| [`signal`](spores/signal) | `hypha` | Signal channel, over a `signal-cli` JSON-RPC daemon **the operator runs themselves** | **yes**, plus that daemon |
| [`radarr`](spores/radarr) | `rhiza` | Radarr's release calendar and library search, pull only | **yes** |
| [`plex`](spores/plex) | `rhiza` | A Plex Media Server: who is watching what, right now | **yes** |
| [`upcoming-movies`](spores/upcoming-movies) | `enzyme` | `/upcoming` lists the films Radarr expects, and whether it already holds the file | no |
| [`now-watching`](spores/now-watching) | `enzyme` | `/watching` shows what the house's media server is playing | no |

Every spore here depends on `@mycelo/septum@^0.10.1`. `admin`, `help`, `links`, `group-gate` and
`signal` need a Mycelo core at phase 7 or later; `radarr`, `plex`, `upcoming-movies` and
`now-watching` need phase 7.5 or later. Read each spore's own README before installing it.

Every manifest here declares `septum: "^0.10"`, matching `package.json`'s `^0.10.1`. That is not
incidental: under 0.x caret semantics a range below 1.0 is bounded, not an open floor, so a
manifest declaring `^0.8` **excludes** `0.10.0` — the earlier ranges (`^0.5` through `^0.9`) were
wrong the moment any of these spores used something `0.10` added, which every one of them does.
`spore.yaml` still states the minimum the plugin needs and `package.json` states what the
workspace resolves; the two are free to diverge in general, they just don't for anything here.

## Installing, until phase 8

Release automation arrives with phase 8 and its mechanism is not yet decided, so a spore is
installed today by pointing `mycelo.yaml`'s `spores:` at a directory holding it.

**Do not point it at this repository's whole `spores/` directory on a fresh Mycelo.** `group-gate`
and `signal` both have required settings with no defaults, and on a fresh installation the first
synchronisation *enables* every spore it finds. `group-gate` is `enforcing`, so an unconfigured one
is dormant, and a dormant enforcing inhibitor refuses **every message on every channel** —
recoverable through the HTTP API's plugin routes or directly against the database, never from a
channel. That is the correct behaviour for a security gate and a poor first five minutes.

Either install only the spores you have configured, or follow
[`group-gate`'s own instructions](spores/group-gate/README.md#an-unconfigured-or-misconfigured-group-gate-refuses-all-traffic-on-every-channel)
and configure both before the boot that germinates them.

`radarr` and `plex` also have required settings with no defaults, and the same first-synchronisation
auto-enable applies to them — but the failure they produce is a different one. Neither is
`enforcing`, so an unconfigured one going dormant silences nothing else on the bot. What it does is
make its dependent command vanish with no explanation: an unconfigured `radarr` takes `/upcoming`
with it, because `upcoming-movies` requires that rhiza; an unconfigured `plex` takes `/watching`
with it the same way, through `now-watching`'s `any_of`.

## Releasing

1. A release starts by merging a pull request carrying a changeset — write one with
   `bun run changeset`.
2. `bun run changeset -- version` bumps the affected spores and writes their `CHANGELOG.md`.
3. **That version pull request needs `bun run changeset -- add --empty`, or the `changeset` CI job
   fails it** — versioning is what removes the changesets, so the PR that applies it has none by
   construction.
4. **The version pull request must be merged into `develop` before any tag is pushed.**
   `release.yml` triggers on `release: published`, and a `release`-triggered workflow only runs
   from the repository's default branch — `develop` here. Tag first and the release is published
   with no workflow able to attach an asset.
5. Tags are `<manifest-name>@<semver>` and are **GPG-signed by a human**; the release workflow
   reacts to the published GitHub release, it does not create one.

Two contributor traps:

- A change touching a spore needs a changeset, or CI refuses the pull request — run
  `bun run changeset -- add --empty` if the change needs no release.
- **An untracked changeset file is invisible** to `changeset status`, because `@changesets/git`
  reads `git diff` — a contributor who forgets `git add` sees the same error as having written no
  changeset at all.

Contributing guidelines and the plugin authoring guide will land with the core's
documentation phase.
