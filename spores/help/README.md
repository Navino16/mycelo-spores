# help

An `enzyme` spore for [Mycelo](https://github.com/Navino16/mycelo). Answers `/help` with the
commands the caller is **authorized** to invoke, each described in the caller's own language.

A command listed here can still be refused on the specific channel it is asked on: `help` shows
only the authorization filter, not the channel-capability and context-rule gates applied at
dispatch.

## Requires

One scope, from the `mycelium` rhiza:

| Scope | Why |
|---|---|
| `commands.read` | Lists the authorized commands and their rendered descriptions. |

## Configuration

None. `help` takes no settings.

## Compatibility

Needs `@mycelo/septum@^0.10.0` and a Mycelo core at phase 7 or later, where `commands.read` and
`EnzymeContext.locale` were introduced.
