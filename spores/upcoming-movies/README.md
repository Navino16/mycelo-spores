# upcoming-movies

An `enzyme` spore for [Mycelo](https://github.com/Navino16/mycelo). Answers `/upcoming` by
rendering Radarr's release calendar as a chat reply.

| Command | Args | Answers |
|---|---|---|
| `upcoming` | `days` (optional) | The films Radarr expects in the given window, or the operator's `defaultDays` if none is given |

`/upcoming` and `/upcoming 7` are both valid. An argument that starts with no digit at all, or that
parses to a whole number outside 1–365, answers `usage`; anything else has its leading digits read
and the rest ignored — `/upcoming 7.5` and `/upcoming 7abc` are both silently read as `7`.

## Configuration

```ts
z.object({
  defaultDays: z.number().int().min(1).max(365).default(30),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `defaultDays` | integer | no (defaults to `30`) | How many days ahead to look when no argument is given |

## Requires

One `rhiza`: `radarr`. `upcoming-movies` is **dormant** without a `radarr` connector configured,
and it needs **no media server** — whether a film has already been downloaded (`hasFile`) comes
from Radarr itself, not from anything this spore checks.

When Radarr is unreachable or refuses the request, `/upcoming` answers Radarr's own sentence,
rendered in the caller's language, and the rest of the bot keeps answering everything else.

## Known limitations

- `/help` cannot show that `/upcoming` takes an argument: `CommandInfo` carries no `args`. This is
  a gap in the core, not a defect in this spore.

## Compatibility

Needs `@mycelo/septum@^0.10.1` and a Mycelo core at phase 7.5 or later.
