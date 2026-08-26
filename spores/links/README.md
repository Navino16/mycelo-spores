# links

An `enzyme` spore for [Mycelo](https://github.com/Navino16/mycelo). Answers with the house's own
service URLs — a Radarr, a Jellyfin, a wiki, whatever the operator runs — each described in the
caller's own language.

Two commands, both code-backed:

| Command | Args | Answers |
|---|---|---|
| `links` | none | Every configured service, one line each: label, URL, and its note if it has one |
| `link` | `label` | One service by label; a refusal naming what labels exist; or, with no argument at all, a usage line |

The manifest declares `label` as `required: true`, but **no core code reads `ArgSpec.required`**:
a missing argument reaches the handler as `undefined` regardless, so `link` answers the usage line
itself rather than relying on a gate that does not exist.

## Configuration

The URLs are the operator's own, not something this spore ships — a catalogue is a resource the
spore ships and an update overwrites, so it holds only the surrounding text.

```ts
z.object({
  services: z.array(z.object({
    label: z.string().min(1),
    url: z.url(),
    note: z.string().optional(),
  })).default([]),
})
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `services` | array | no (defaults to `[]`) | The configured services |
| `services[].label` | string | yes | Short name used with `/link` |
| `services[].url` | string (URL) | yes | The service's address |
| `services[].note` | string | no | A one-line description shown alongside the URL |

Worked example, as written through `PUT /api/plugins/links/settings`:

```json
{
  "services": [
    { "label": "radarr", "url": "https://radarr.example", "note": "films" },
    { "label": "jellyfin", "url": "https://jellyfin.example" }
  ]
}
```

With no services configured, `links` still germinates and `/links` answers that none are set up
yet, rather than sitting dormant until the operator supplies one — see the schema's `.default([])`
above.

## Requires

No `rhiza`. `links` answers entirely from its own settings.

## Compatibility

Needs `@mycelo/septum@^0.10.1` and a Mycelo core at phase 7 or later.
