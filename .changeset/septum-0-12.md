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

Declare `septum: "^0.12"`. A caret range below 1.0 is bounded, not a floor, so the previous
declaration excluded the `0.12.0` these spores now resolve, and the core enforces the range at
germination, at `enable()` and at `inoculate` — a stale one leaves the spore dormant rather than
merely mis-declared. A dormant `group-gate` is an `enforcing` inhibitor, which refuses all traffic
on every channel, so the sweep is not optional.

Unlike the `^0.11` sweep, this one is not a range bump alone: `admin` calls seven of the eleven
mycelium methods that now resolve an `Outcome` instead of rejecting. Against a `0.11` septum its
handlers waited for a rejection that never comes and answered *done* to a refusal, so `/grant`,
`/revoke`, `/role-new`, `/plugin-enable`, `/plugin-disable`, `/plugin-set` and `/plugin-config`
now read `ok` and render the refusal's `common`-domain ref in the reader's language. A throw from
those methods is an infrastructure fault and reaches the bus untouched.
