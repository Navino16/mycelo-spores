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
| [`help`](spores/help) | `enzyme` | `/help` lists the commands the caller is authorized to invoke, described in their own language | no |
| [`links`](spores/links) | `enzyme` | `/links` and `/link <label>` answer with the house's own service URLs | yes, but it answers "none configured" until you do |
| [`group-gate`](spores/group-gate) | `inhibitor` | Admits only members of a group the channel itself holds — a real Signal group, not a duplicated allowlist | **yes, before its first boot** |
| [`signal`](spores/signal) | `hypha` | Signal channel, over a `signal-cli` JSON-RPC daemon **the operator runs themselves** | **yes**, plus that daemon |

Every spore here requires `@mycelo/septum@^0.8.0` and a Mycelo core at phase 7 or later. Read each
spore's own README before installing it.

## Installing, until phase 8

Release automation arrives with phase 8 and its mechanism is not yet decided, so a spore is
installed today by pointing `mycelo.yaml`'s `spores:` at a directory holding it.

**Do not point it at this repository's whole `spores/` directory on a fresh Mycelo.** `group-gate`
and `signal` both have required settings with no defaults, and on a fresh installation the first
synchronisation *enables* every spore it finds. `group-gate` is `enforcing`, so an unconfigured one
is dormant, and a dormant enforcing inhibitor refuses **every message on every channel** —
recoverable only through the HTTP API. That is the correct behaviour for a security gate and a poor
first five minutes.

Either install only the spores you have configured, or follow
[`group-gate`'s own instructions](spores/group-gate#an-unconfigured-or-misconfigured-group-gate-refuses-all-traffic-on-every-channel)
and configure both before the boot that germinates them.

Contributing guidelines and the plugin authoring guide will land with the core's
documentation phase.
