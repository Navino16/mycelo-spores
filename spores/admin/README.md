# admin

An `enzyme` spore for [Mycelo](https://github.com/Navino16/mycelo). Reads and administers the
mycelium — plugins, roles, conversations, broadcast targets, restrictions and locales — through
eighteen commands, all code-backed, all answering in the caller's own language.

| Command | Args | Answers |
|---|---|---|
| `plugins` | none | The name of every installed plugin |
| `whoami` | none | The sender's channel identity and roles |
| `roles` | none | Every role and the command patterns it carries |
| `grant` | `role`, `who` | Gives a role to a channel identity |
| `revoke` | `role`, `who` | Takes a role away from a channel identity |
| `role-new` | `name` `[pattern...]` | Creates a role with the given command patterns |
| `plugin-list` | none | Every installed plugin and its kind and state |
| `plugin-enable` | `name` | Enables an installed plugin |
| `plugin-disable` | `name` | Disables an installed plugin |
| `plugin-set` | `name`, `key`, `value` | Sets one configuration value on a plugin |
| `plugin-config` | `name` | A plugin's settings, secrets redacted |
| `conversations` | none | Every conversation the bot has seen |
| `where-rule` | `pattern`, `where` | Confines a command pattern to `dm` or `group` |
| `broadcast-add` | `channel`, `conversation` | Adds a broadcast target |
| `broadcast` | `text` | Sends one message to every configured broadcast target |
| `inhibitor-channels` | `name` `[channel...]` | Confines an inhibitor to named channels |
| `lang` | `locale` | Sets the sender's own language |
| `lang-group` | `locale` | Sets the conversation's language — groups only |

`plugin-set`'s `value` is parsed as JSON first and kept as a raw string only when that fails, so
`/plugin-set radarr port 8080` writes the number `8080`, not the string `"8080"`.

## Requires

One `rhiza`, `mycelium`, with eleven scopes:

| Scope | What it backs |
|---|---|
| `plugins.read` | `plugins`, `plugin-list` |
| `plugins.toggle` | `plugin-enable`, `plugin-disable` |
| `plugins.configure` | `plugin-config`, `plugin-set` |
| `principals.read` | `grant`, `revoke` (resolving `who` to an identity) |
| `roles.read` | `roles` |
| `roles.assign` | `grant`, `revoke` |
| `roles.manage` | `role-new` |
| `conversations.read` | `conversations` |
| `messages.broadcast` | `broadcast` |
| `restrictions.manage` | `where-rule`, `broadcast-add`, `inhibitor-channels` |
| `locale.manage` | `lang`, `lang-group` |

`spore.yaml`'s `septum: "^0.10"` is the **minimum** this plugin needs — not the version it was
built against. `package.json`'s `@mycelo/septum: "^0.10.1"` is what the workspace actually
resolves and publishes against; the two ranges answer different questions. They agree here for the
same reason they agree across the whole registry: a caret range below 1.0 is bounded, not a floor,
so the older range this manifest used to declare was already incompatible with the `0.10.1` the
workspace resolves — not because `admin` itself needs something `0.10` added (`CLAUDE.md`). It does
not: `admin`'s handlers only read `Invocation.args`, a phase-2 member, never `CommandInfo.args` or
`ArgInfo`, and its manifest's own `args:`/`required:` fields predate `0.10`. `mycelo`'s own
fixtures still diverge, for the opposite reason: of its 11, 10 carry a `package.json` resolving
`^0.10.0`, and all 11 manifests declare an older range (6×`^0.5`, 2×`^0.7`, 2×`^0.8`, 1×`^0.9`).

## Argument description keys are command-scoped here

Of the eight other spores in this registry, only `links` and `upcoming-movies` declare any
argument at all — the rest declare none, so a flat `arg.<name>.description` convention has never
had to survive a collision. It cannot survive one here: `name` alone is an argument of **six**
commands with **three** distinct meanings — the role name in `role-new`, the plugin name in
`plugin-enable`, `plugin-disable`, `plugin-set` and `plugin-config`, and the inhibitor name in
`inhibitor-channels`. A flat key would give all six the same description. Every argument here is
keyed `command.<command>.arg.<name>.description` instead — nothing in the manifest schema enforces
either convention, since a command's `description` is just a free string the core resolves as a
catalogue key, so this is a documentation choice, not a validated one.

## Some diagnostics stay in English

Thirteen of the core's own rejections — `role 'x' does not exist`, a plugin's own refusal reason
from `enable()`, a Zod issue array — surface through `(e as Error).message` verbatim, in whatever
language the mycelium itself writes them in, which today is English. Those are the **mycelium's**
sentences, not this spore's catalogue: swallowing them and replacing them with a generic failure
would remove the one piece of information the operator needs. A French-speaking operator running
`/grant guest bob` against an unknown role sees a French frame around an English diagnostic.

## `fixtures/admin` is a different artefact

`mycelo`'s own `fixtures/admin` is a test fixture, not a distributed spore, and it is allowed to
diverge from this one: it declares four scopes this spore does not need
(`principals.manage`, `messages.send`, `health.read`, `commands.read`), ships a third,
deliberately incomplete `ru.yaml` to demonstrate the cascade-to-default behaviour, and carries
**no** command-scoped argument key at all — 17 of its 19 argument descriptions are literal English
prose and the remaining two (`lang`, `lang-group`) share one flat `arg.locale.description`. This
spore is the one meant for an operator to install.

## Compatibility

Needs `@mycelo/septum@^0.10.1` and a Mycelo core at phase 7 or later.
