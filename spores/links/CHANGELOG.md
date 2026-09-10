# @mycelo/spore-links

## 0.5.0

### Minor Changes

- Declare `septum: "^1.0"`. Septum reached `1.0.0`, and a caret below 1.0 is bounded rather than a
  floor, so the previous `^0.12` excludes it — the core enforces the range at germination, at
  `enable()` and at `inoculate`, leaving a stale declaration dormant rather than merely mis-declared.
  
  Unlike the `^0.12` sweep, this one costs almost nothing beyond the range: `InoculateOutcome.warnings`
  changed shape but no spore here reads it, and the conformance kit's new wrong-domain check does not
  reach any spore's refusals. This is the last sweep until septum `2.0.0`: at and above 1.0 a caret is a
  floor within the major, so a `^1.0` spore stays germinated across every future minor.

## 0.4.0

### Minor Changes

- a332be9: Declare `septum: "^0.12"`. A caret range below 1.0 is bounded, not a floor, so the previous
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

## 0.3.0

### Minor Changes

- fbbaed3: Declare `septum: "^0.11"`. A caret range below 1.0 is bounded, not a floor, so the previous
  declaration excluded the `0.11.0` these spores now resolve — and since the core enforces the range
  at germination, at `enable()` and at `inoculate`, a stale one leaves the spore dormant rather than
  merely mis-declared. A dormant `group-gate` is an `enforcing` inhibitor, which refuses all traffic
  on every channel, so the sweep is not optional.

## 0.2.0

### Minor Changes

- df76840: Declare `septum: "^0.10"`. A caret range below 1.0 is bounded, not a floor, so the previous
  declarations excluded the septum these spores are built against.
