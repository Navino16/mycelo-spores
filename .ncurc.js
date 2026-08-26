// Configuration for npm-check-updates.
//
// Three entries are rejected for two reasons: the typescript-eslint peer range and
// the Bun runtime pin. Raising either breaks something no version checker can see.
export default {
  reject: [
    // typescript-eslint peers `typescript@">=4.8.4 <6.1.0"`, so TypeScript 7 means
    // giving up type-aware linting entirely. Revisit when it supports 7.
    'typescript',

    // Must track the Bun runtime pinned in .bun-version. Newer types describe APIs
    // the runtime does not have: the compiler accepts the code and it crashes.
    '@types/bun',
    'bun-types',
  ],
}
