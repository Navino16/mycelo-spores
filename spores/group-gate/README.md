# group-gate

An `inhibitor` spore for [Mycelo](https://github.com/Navino16/mycelo). Admits only members of a
configured group on a configured channel, resolved through `ctx.groupMembers()` — the group's
membership lives in the channel itself (a real Signal group, for instance), and Mycelo reads it
rather than duplicating an allowlist.

## An unconfigured or misconfigured `group-gate` refuses ALL traffic on EVERY channel

This spore declares `enforcing: true`. A **dormant** `enforcing` inhibitor refuses every message
on every channel, whatever made it dormant — no configuration at all, a typo in `channel`, a
channel that cannot report group membership, anything `start()` rejects. This is deliberate (core
design §5.1: "a security rule is never silently inert"), and it is also a real foot-gun:
**admission runs before any command can reach the bot**, so no `/plugin-disable` or config command
can undo it. Recovery is through the HTTP API's plugin routes or directly against the database —
not from any channel.

A typo in `groupId` is the milder failure and is **not** in that set: it is validated only as a
non-empty string and `start()` never looks at it, so the spore germinates and refuses only the
configured channel. See "Configuration" below — it fails closed and silently, with no diagnostic.

**`channel` and `groupId` are both required and neither has a default, so a `group-gate` that has
never been configured is dormant — which means installing it and booting silences the whole bot.**
A default would be worse: a made-up group id is a gate that admits nobody while looking configured.

When the bot goes quiet depends on whether Mycelo has booted before. On a **fresh** installation
the first synchronisation **enables** every spore it finds, so the very first boot is already the
one that silences everything. On an installation that has booted before, a newly found spore is
recorded **disabled** and nothing is silenced until you enable it.

So configure it **before** the boot that first germinates it:

1. Boot Mycelo at least once **without** this spore in any directory `mycelo.yaml`'s `spores:`
   names, and **with at least one other spore present**. The install table is what makes the next
   boot no longer a first run, and a boot that discovers nothing writes no rows — so a boot with an
   empty `spores:` leaves the next one still enabling everything it finds, this spore included.
2. Add the spore and restart. It is discovered, recorded **disabled**, and refuses nothing.
3. `PUT /api/plugins/group-gate/settings` with a valid `channel` and `groupId` (below), then
   `POST /api/plugins/group-gate/enable`. Enabling is refused while the settings are incomplete,
   which is the check that keeps a dormant gate off your channels.
4. Restart Mycelo. The gate now germinates and only the configured channel is filtered.

If the bot is already silent because a fresh installation enabled the spore on sight,
`POST /api/plugins/group-gate/disable` and restart, then resume at step 3. The HTTP API is
unaffected by admission, so it still answers while every channel is refusing.

## Confine the gate to the channel it guards

The core can restrict an inhibitor to named channels, and a confined inhibitor that breaks refuses
only on those channels — the rest of the bot keeps answering. For a gate on `signal`:

```
/inhibitor-channels group-gate signal
```

That command comes from whichever enzyme in your installation holds the `restrictions.manage`
scope; there is no HTTP route for it yet. **Set it while the bot still answers** — once the gate is
dormant, admission refuses the very command that would confine it.

Confinement does not replace step 3 above: an unconfigured gate confined to `signal` still refuses
every Signal message. It bounds the blast radius, it does not remove it.

## Configuration

```ts
z.object({
  channel: z.string().min(1),
  groupId: z.string().min(1),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `channel` | string | yes | The hypha this gate confines, by its spore name |
| `groupId` | string | yes | The group whose members are admitted, in that channel's own id format |

`groupId` is **the channel's own identifier, not a name you choose**. A wrong value fails closed
and silently: the group is simply never found, membership comes back empty, and every sender is
refused as a non-member. There is no diagnostic for a typo here, so copy the value rather than
typing it.

For the `signal` spore it is the daemon's **base64 group id** — the `id` field of `signal-cli`'s
own `listGroups`, byte-identical to the `groupInfo.groupId` carried by any inbound group message.
It is **not** the `group:`-prefixed conversation id that `signal` uses elsewhere: drop the prefix.

Worked example, as written through `PUT /api/plugins/group-gate/settings`:

```json
{ "channel": "signal", "groupId": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }
```

## Behaviour

- `start()` calls `ctx.requireCapability(channel, 'group_membership')` and lets it throw. A gate
  that cannot enforce its rule goes dormant rather than admitting everyone.
- `inspect()` allows any message on a channel other than the configured one.
- The gate filters the **sender**, not the conversation. A member of the configured group is
  admitted from anywhere on that channel — a different group the bot belongs to, or a direct
  message. It answers who may use the bot, not where.
- On the configured channel, it resolves membership through `ctx.groupMembers(channel, groupId)`
  and admits only a sender found in that list.
- A `null` answer from `groupMembers` means the channel cannot report membership right now — that
  is a refusal, not an admission. The gate fails closed.
- A `groupMembers` that rejects, or throws, is the same refusal. Letting it propagate would make
  the core refuse every message on every channel, which is the one outcome confinement exists to
  prevent.

## Requires

No `rhiza`. Uses only `InhibitorContext.groupMembers` and `InhibitorContext.requireCapability`,
both supplied by the core.

## Compatibility

Needs `@mycelo/septum@^0.10.0` and a Mycelo core at phase 7 or later.
