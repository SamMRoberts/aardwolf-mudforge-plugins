# Aardwolf API 0.1.0

## Lifecycle and host adapters

`local aardwolf = require("aardwolf-api")` returns a library, not a global
session singleton. `aardwolf.new(host, { packages = { "Char", "Group" } })`
creates a consumer. No host APIs are called while the library loads or during
construction. Supply only the functions the consumer uses.

| Capability | Injected functions |
| --- | --- |
| Required lifecycle/messaging | `findPluginByName`, `onPluginBroadcast`, `broadcastToPlugin`, `on`, `off` |
| Explicit refresh requests | `sendGMCP` |
| Storage | `loadTable`, `saveTable`, `storageStatus` |
| Widget creation/cleanup | `createWidget`, `destroyWidget` |
| Static HTML and reactive bindings | `setWidgetProperty`, `setBoundValue` |
| Widget events | `registerWidgetEvent` |
| Canvas drawing batches | `setActiveWidget` |
| Optional subscriber-error reporting | `reportError(message)` |

Missing required functions and invalid configuration raise errors immediately.
Optional adapters are required only when the associated helper is called.
`reportError` receives a fixed topic description; it never receives server
payloads, exception text or private communication.

Use one consumer per plugin. `packages` is a list containing any of `Core`,
`Char`, `Room`, `Comm`, `Group`; duplicates are removed and unknown names
rejected. Baseline `Core`, `Char`, `Room`, `Comm` remain subscribed even when
no consumer is running. `Group` is negotiated when declared.

| Method | Contract |
| --- | --- |
| `client.start()` | Register once and discover Core; returns current status. Safe to call repeatedly. |
| `client.stop()` | Withdraw requirements, clear snapshots, remove the disconnect listener and destroy owned widgets. Safe to call repeatedly. |
| `client.status()` | Defensive `{ available, connected, negotiated, reason? }` copy. `available` means a matching Core responded. |
| `client.get(package)` | Defensive state snapshot or `nil`; unsupported/event packages raise an error. |
| `client.on(topic, callback)` | Subscribe and return an idempotent unsubscribe function. Each callback receives its own copy. |
| `client.request(kind)` | `true`, or `false, reason`; accepts `char`, `room`, `area`, `quest`. Requires available, connected, negotiated Core. |

Subscribe before starting. Subscriptions remain attached across `stop/start`
until their unsubscribe function is called; owned widgets must be recreated.
MudForge keeps the broadcast callback until plugin unload, so the library
installs it once and gates it on whether the instance is active.

## State and events

State packages are `char.base`, `char.vitals`, `char.stats`, `char.maxstats`,
`char.status`, `char.worth`, `room.info`, `group`. These package names are also
subscription topics. A state reply supplies current snapshots and notifies
every state topic; a missing snapshot is passed as `nil`. A normal GMCP packet
notifies its own topic. Do not count notifications as unique server packets.

Character packets merge fields; an omitted field retains its previous value.
An explicitly invalid known numeric/text field becomes unknown. Room and
Group replace their complete snapshots, including exits and membership.
Group members are normalized to an ordered, one-based Lua list. Server field
names stay intact; vitals maxima come from `char.maxstats`, not `char.vitals`.
Useful unknown extension fields survive bounded copying. No missing numeric
value is filled with zero.

The `comm.channel`, `comm.quest`, `comm.tick`, `comm.repop` topics deliver
transient packets. They have no snapshots, replay or derived quest state.
Consumers decide how to reduce quest events themselves. ANSI channel text is
preserved. Bind it as text or convert it deliberately; never concatenate it
directly into HTML.

Payloads must be tables containing JSON-compatible data. Known numeric strings
are converted to finite numbers. Non-serializable values, NUL-containing
strings, cycles, excessive nesting/size and malformed top-level packets are
discarded. Copying limits are 12 table levels, 8,192 entries per copied value
and 64 KiB per string. Subscriber exceptions do not block other subscribers.

`session` callbacks receive the status shape. Disconnect and Core shutdown
clear snapshots; subscribers should use this topic to render unavailable
state. A consumer receives no Comm backlog when it starts. Reconnect waits for
new packets; old connection data is not used to seed the new connection.
On an iOS screen reattachment Core can restore character data from the
documented cache, while Room/Group still wait for new packets.

Core bootstraps on the first valid `char.base` packet, with a one-second timer
fallback for late enabling. It negotiates only on support-set changes, with
a five-second minimum between attempts. Enabling/disabling consumers coalesces
changes through a timer; declared requirements do not imply that their
negotiation has already reached the server. Timer or transport refusal is
reported in status rather than retried in a loop. Reload Core or reconnect to
retry bootstrap after correcting the underlying failure.

Core never automatically requests fresh character/quest data or changes tags,
channel visibility, rawcolor or debugging options. A late-enabled or reloaded
Core may initially have unknown data; use the explicit refresh methods when
needed. `request("area")` requests server data but this version does not model
an area snapshot or event.

Known competing Cores are detected by installed ID (`aw-core`,
`aardwolf-core`) or display name (`Aardwolf Core`, another `Aardwolf API Core`)
before negotiation. Arbitrary third-party negotiation senders cannot be
detected reliably: installation requires a single owner. Existing consumer
plugins must explicitly adopt this API; the previous `aw-gmcp` contract is not
implemented here.

## Storage

`client.storage.get(key, default)` loads a defensive value or returns the
default when no value exists. Invalid/future envelopes return `nil, reason`.
`client.storage.set(key, value)` returns `true` or `false, reason`. It refuses
nil values, non-JSON data and storage that is not `ready`; a declined native
save also returns failure. `client.storage.status()` forwards the native
status/reason.

Keys are nonempty strings up to 128 characters without NUL. Records use the
name `aardwolf-api:<key>` and envelope `{ schemaVersion = 1, value = value }`.
Reads and writes omit native scope, so storage belongs to the consuming
plugin and world; no app-wide or cross-plugin store is used. Numbers, booleans,
strings and tables preserve their types. Save preferences when they change;
do not rely on cleanup as the sole save point. Live protocol caches are never
persisted by Core.

## UI helpers

| Helper | Contract |
| --- | --- |
| `client.ui.create(config)` | Create owned `html`/`canvas` widget with a stable nonempty `name`; duplicate names reuse the id, changing type is rejected. Returns id or `nil, reason`. |
| `client.ui.content(id, markup)` | Set trusted static markup on an owned HTML widget. |
| `client.ui.bind(id, key, scalar)` | Update a text/style/attribute binding; tables are rejected. External text should use text bindings. |
| `client.ui.on(id, event, callback)` | Register an owned widget event. Handlers are freed on destroy/unload. |
| `client.ui.draw(id, callback)` | Select an owned canvas before a drawing batch. Inject drawing functions into the consumer separately. |
| `client.ui.destroy(id)` | Destroy one owned widget. |
| `client.ui.cleanup()` | Destroy all widgets owned by this instance; never targets the terminal or another consumer's widgets. |
| `client.ui.typography(options)` | Generate CSS for a validated family, size, style, weight and spacing. |
| `aardwolf.percent(value, maximum)` | Clamp to 0–100; return `nil` for invalid inputs or nonpositive maxima. |
| `aardwolf.escape(text)` | Escape HTML text characters; this is not a URL, command or CSS sanitizer. |

Typography defaults: `family = "system-ui"`, `size = 13`, `style = "normal"`,
`weight = "normal"`, `spacing = 0`. Size range is 8–48 px; spacing is -1–8 px;
style is normal/italic and weight normal/bold. A single family name accepts
letters, digits, spaces, underscores and hyphens, at most 80 characters.
Helpers do not apply an app theme or create a central layout manager.

Creation config supplies initial geometry; saved geometry/visibility belongs
to MudForge. Helpers never move, resize or force-show a widget during data
updates. Supply static markup once, feed dynamic server values through text
bindings and clamp numeric style values. Use normal buttons and documented
widget event payloads. Never wire unvalidated server text to a command.

## Internal Core messaging

Protocol version 1 uses `aardwolf-api:`-prefixed, session-scoped plugin
broadcasts. The library discovers **Aardwolf API Core** by name and uses the
returned installed ID, including file-import-generated IDs. Core keys
registrations by the callback's sender ID, not a payload-provided owner.

- `register`: targeted JSON `{ version = 1, packages = [...] }` replaces a consumer declaration; replies with `state`.
- `unregister`: targeted withdrawal during consumer cleanup.
- `ready` / `stopped`: Core lifecycle announcements; consumers rediscover or clear state.
- `state`: targeted JSON `{ version = 1, session = {...}, snapshots = {...} }`.
- `update`: targeted JSON `{ version = 1, package = "...", payload = {...} }`.

Only Core-origin state/update/stopped messages are accepted. Registration
replies can arrive after `start()` returns; consumers observe availability
through `session`, rather than assuming synchronous delivery. Core rebuilds
requirements on registration/withdrawal and prunes unloaded/disabled senders
before sending a support set. Every consumer must call `stop()` in cleanup.

`aardwolf.protocol` exposes pure validation/copy helpers shared by Core. These
are internal implementation support, not the consumer API stability contract.
