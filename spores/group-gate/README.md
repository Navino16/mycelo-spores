# group-gate

An `inhibitor` spore for [Mycelo](https://github.com/Navino16/mycelo). Admits only members of a
configured group on a configured channel, resolved through `ctx.groupMembers()` — the group's
membership lives in the channel itself (a real Signal group, for instance), and Mycelo reads it
rather than duplicating an allowlist.

## A misconfigured `group-gate` refuses ALL traffic on EVERY channel

This spore declares `enforcing: true`. A **dormant** `enforcing` inhibitor refuses every message
on every channel, whatever made it dormant — a typo in `channel` or `groupId`, a channel that
cannot report group membership, anything. This is deliberate (core design §5.1: "a security rule
is never silently inert"), and it is also a real foot-gun: **admission runs before any command
can reach the bot**, so no `/plugin-disable` or config command can undo it. Recovery is through
the HTTP API's plugin routes or directly against the database — not from any channel.

Read this before configuring `group-gate` in production, not after locking yourself out.

## Configuration

```ts
z.object({
  channel: z.string().min(1),
  groupId: z.string().min(1),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `channel` | string | yes | The hypha this gate confines |
| `groupId` | string | yes | The group whose members are admitted, in that channel's own id format |

Worked example, as written through `PUT /api/plugins/group-gate/settings`:

```json
{ "channel": "signal", "groupId": "g:house" }
```

## Behaviour

- `start()` calls `ctx.requireCapability(channel, 'group_membership')` and lets it throw. A gate
  that cannot enforce its rule goes dormant rather than admitting everyone.
- `inspect()` allows any message on a channel other than the configured one.
- On the configured channel, it resolves membership through `ctx.groupMembers(channel, groupId)`
  and admits only a sender found in that list.
- A `null` answer from `groupMembers` means the channel cannot report membership right now — that
  is a refusal, not an admission. The gate fails closed.

## Requires

No `rhiza`. Uses only `InhibitorContext.groupMembers` and `InhibitorContext.requireCapability`,
both supplied by the core.

## Compatibility

Needs `@mycelo/septum@^0.8.0` and a Mycelo core at phase 7 or later.
