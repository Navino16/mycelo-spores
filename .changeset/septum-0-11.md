---
"@mycelo/spore-admin": minor
"@mycelo/spore-group-gate": minor
"@mycelo/spore-help": minor
"@mycelo/spore-links": minor
"@mycelo/spore-now-watching": minor
"@mycelo/spore-plex": minor
"@mycelo/spore-radarr": minor
"@mycelo/spore-signal": minor
"@mycelo/spore-upcoming-movies": minor
---

Declare `septum: "^0.11"`. A caret range below 1.0 is bounded, not a floor, so the previous
declaration excluded the `0.11.0` these spores now resolve — and since the core enforces the range
at germination, at `enable()` and at `inoculate`, a stale one leaves the spore dormant rather than
merely mis-declared. A dormant `group-gate` is an `enforcing` inhibitor, which refuses all traffic
on every channel, so the sweep is not optional.
