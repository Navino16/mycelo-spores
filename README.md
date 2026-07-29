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

## Status

Empty. Plugins arrive with phase 7 of the core implementation; the release automation
arrives with phase 8 and its mechanism is not yet decided.

Contributing guidelines and the plugin authoring guide will land with the core's
documentation phase.
