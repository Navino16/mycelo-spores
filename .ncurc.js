// Configuration for npm-check-updates.
//
// Four entries are rejected for three reasons: the typescript-eslint peer range, the
// Bun runtime pin, and the release path's pinned tooling. Raising any of them breaks
// something no version checker can see.
export default {
  reject: [
    // typescript-eslint peers `typescript@">=4.8.4 <6.1.0"`, so TypeScript 7 means
    // giving up type-aware linting entirely. Revisit when it supports 7.
    'typescript',

    // Must track the Bun runtime pinned in .bun-version. Newer types describe APIs
    // the runtime does not have: the compiler accepts the code and it crashes.
    '@types/bun',
    'bun-types',

    // Pinned exactly: the release path must not take an unreviewed minor bump.
    '@changesets/cli',
  ],
}
