# @mycelo/spore-admin

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
