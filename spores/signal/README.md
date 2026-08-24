# signal

A `hypha` spore for [Mycelo](https://github.com/Navino16/mycelo). A channel over
[`signal-cli`](https://github.com/AsamK/signal-cli)'s JSON-RPC daemon, which **the operator runs
themselves**. This spore does not spawn, supervise, or bundle `signal-cli` — it only dials the
socket. Nothing in a manifest lets a spore declare that it needs an external service (`externals:`
is for native npm dependencies, not this), so the requirement lives here.

## Before installing this spore

1. **Register or link the bot's Signal number first**, outside Mycelo entirely. This spore never
   does device linking or registration; by the time you configure it, `signal-cli` must already
   have a working account.
2. **Run the daemon yourself**, long-lived, for example:

   ```sh
   docker run --rm --name mycelo-signald --user "$(id -u):$(id -g)" \
     -v "$HOME/.local/share/signal-cli:/data" \
     registry.gitlab.com/packaging/signal-cli/signal-cli-native:latest \
     -d /data daemon --socket /data/socket --receive-mode on-start
   ```

   `-d /data` is what points `signal-cli` at the mounted volume — without it the daemon reads its
   default data directory inside a `--rm` container and will not find the account you just linked
   or registered.

   `--user` matters: the published image runs as uid 101, and a host-owned mount without it fails
   every write with `Permission denied`. Running as your own user also makes the socket ordinarily
   readable by the Bun process that hosts Mycelo.

3. **Point Mycelo at the socket path that command produces** — in the example above,
   `$HOME/.local/share/signal-cli/socket`.

## `--receive-mode`, and why it is not this spore's choice

`signal-cli daemon` accepts `on-start`, `on-connection`, or `manual`. This spore assumes
**`on-start`**: it expects inbound notifications to already be flowing on the socket it connects
to, and it does not send anything to change that. Running the daemon with `manual` means Mycelo
never sees a message; that is an operator choice this spore has no way to detect or correct.

Signal's own protocol expects a linked device to receive regularly — a daemon that sits idle for
long periods is a state Signal treats as abnormal. Run it long-lived with `on-start`, not on
demand.

## Configuration

```ts
z.object({
  socket: z.string().min(1),
  account: z.string().min(1),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `socket` | string | yes | Path to the `signal-cli` daemon's unix socket |
| `account` | string | yes | The bot's own number, in E.164 — the one place a real phone number belongs |

Both are required and neither has a default, so an unconfigured `signal` is **dormant** — it
germinates and then fails `connect()`. On a **fresh** installation the first synchronisation
*enables* every spore it finds, so the very first boot is already the one where `signal` is
enabled and dormant; on an installation that has booted before, a newly found spore is recorded
**disabled** and nothing happens until you enable it. A dormant hypha silences only its own
channel, unlike `group-gate`.

No format is enforced on either value beyond non-emptiness: `signal-cli`'s own error is more
useful than a validator that is stricter than the service it configures.

## `connect()` fails loudly, naming the socket

There is no JSON-RPC handshake on connect — `signal-cli` sends nothing at all. A successful socket
connection is therefore not proof the daemon is alive; `connect()` makes one free, side-effect-free
`version` request and rejects, **naming the socket path**, if the daemon answers with an error, or
if nothing answers within a few seconds. That message is the only thing standing between "the
daemon isn't running" and a silent, permanently dormant plugin.

## Identity: UUIDs, not phone numbers

Inbound messages and group membership both identify a person by their Signal UUID, never by phone
number — a message's `sender.externalId` and a group member's UUID are the *same string*, which is
what lets `group-gate` compare them. An operator reading `channel_identity` for this channel will
see UUIDs, not the numbers they think in; the sender's profile name (not under their control by
anyone but them) surfaces separately as `displayName`.

## A group's conversation id is `group:<groupId>`

This spore needs to tell, from an otherwise-opaque `conversationId`, whether a reply goes to a
person or to a group — so a group's conversation id is the daemon's own base64 `groupId` prefixed
with `group:` (a direct message's conversation id is just the sender's uuid, with no prefix). This
is internal to the spore, not something `signal-cli` sends, but an operator still has to type it:
it is the value `/broadcast-add` or any other conversation-id-taking command needs for a Signal
group.

## Group membership can be stale, and self-corrects on the next miss

A linked device does not learn about a new group, or about someone added to one, by itself —
`signal-cli` only picks that up after an explicit sync with the primary device. `listGroupMembers`
calls `sendSyncRequest` and retries once whenever the group is not found on the first attempt, so a
miss caused by staleness corrects itself the next time anyone asks. If a group membership change
still is not visible, check whether `signal-cli` itself has learned it before suspecting Mycelo.

## Not implemented

Signal itself has attachments and reactions; this spore does not, and so it does **not declare
them**. The manifest lists `group_membership` only. The core derives a channel's capabilities from
the manifest, so declaring one that `send()` cannot serve would make Mycelo accept a command
requiring it and fail at the last moment with a generic error, and would make
`ctx.capabilities.has('reactions')` answer `true` on a channel that has none. Both are declared
here the day they are implemented, not before.

`send()` still **throws** on a reply carrying an attachment or a reaction, as defence in depth:
with the capability undeclared the core refuses such a command first, but a reply reaching this
spore anyway must fail loudly rather than vanish.

Reconnection after the daemon disappears is not attempted either: `send()` refuses once the socket
has closed, but recovering the connection is left to the operator restarting the plugin (or
Mycelo).

## Compatibility

Needs `@mycelo/septum@^0.9.0` and a Mycelo core at phase 7 or later. Measured against
`signal-cli 0.14.7+morph027+1`.
