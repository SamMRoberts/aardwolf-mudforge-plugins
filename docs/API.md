# Aardwolf API 0.10.0

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

Library **0.8.2** rolls back a startup host exception and returns an unavailable
status with `reason = "Client startup failed"`; another explicit `start()` retries.
Shutdown attempts every cleanup step even if a host operation throws. Failed
withdrawals and listener removals can be retried by another explicit `stop()` or
`start()`; failed widget destruction stays owned for another `stop()` attempt.
Lifecycle failures use fixed `reportError` messages without native exception text.

Callback dispatch respects same-turn unsubscription and stops an obsolete batch
when a callback stops, restarts or disconnects the consumer. Initial state replay
also stops after such a change. These rules apply to protocol, inventory and
Spells subscriptions; callbacks still receive independent defensive copies.

## State and events

State packages are `char.base`, `char.vitals`, `char.stats`, `char.maxstats`,
`char.status`, `char.worth`, `room.info`, `group`. These package names are also
subscription topics. A state reply supplies current snapshots and notifies
every state topic; a missing snapshot is passed as `nil`. A normal GMCP packet
notifies its own topic. Do not count notifications as unique server packets.

Character packets merge fields for the same character; an omitted field retains
its previous value. Core 0.4.3 clears character snapshots when a different
character name arrives or the known name becomes invalid, then publishes the
character's state to consumers.
Levels, tiers and other omitted fields cannot carry across that identity change.
An explicitly invalid known numeric/text field becomes unknown. Room and
Group replace their complete snapshots, including exits and membership.
Group members are normalized to an ordered, one-based Lua list. Library 0.9.1
accepts non-negative integer keys and digit-only string keys, including zero-based,
one-based and sparse indices, and orders members by numeric index. Non-table
members and malformed indices are ignored. If several table members share an
equivalent numeric index (for example `1`, `"1"` and `"01"`), all members at that
index are omitted; selection never depends on host iteration order. The server's
`count` is normalized independently and is not recomputed from accepted members.
Member values and extension fields are defensively copied through Core updates,
snapshot replay and consumer reads. Server field names stay intact; vitals maxima
come from `char.maxstats`, not `char.vitals`.
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

Core never automatically requests fresh character/quest data or changes
channel visibility, rawcolor or debugging options. Inventory consumers explicitly
opt in to the monitoring setup and collection described below; other consumers
do not cause tag changes. A late-enabled or reloaded Core may initially have
unknown data; use the explicit refresh methods when needed. `request("area")` requests server data but this version does not model
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

## Upgrading from SQLite support

Version 0.4.0 removes `client.sqlite` and the Python file bridge. Passing
`options.sqlite` now raises `SQLite support was removed; use native storage`.
Use `client.storage` for bounded preferences and structured data, or native
`loadTable`/`saveTable` with a feature-specific schema for larger datasets.
The existing storage envelope, keys and plugin/world scope are unchanged.
Arbitrary SQL, aliases and database transactions have no native-storage API
replacement. Spells 0.3.0 stores its character records in native storage; use
the [one-time migration guide](SQLITE.md) to preserve legacy data.

## Spells

Pass `spells = true` when constructing a consumer to subscribe to the optional
**Aardwolf Spells** provider. Existing consumers are opted out by default.
This uses only the required lifecycle/messaging adapters. Start/stop the
consumer as usual. The provider owns collection and native persistence and
sends only successfully saved snapshots.

| Method | Behavior |
| --- | --- |
| `client.spells.get()` | Defensive snapshot, or `nil` before a saved list is loaded and after disconnect/provider shutdown. |
| `client.spells.status()` | Defensive `{ available, connected, refreshing, characterName?, reason?, error? }`. |
| `client.spells.on(callback)` | Subscribe to snapshot/status changes; returns an idempotent unsubscribe function. Callback receives `(snapshotOrNil, status)`. |

Subscribe before `start()` for initial discovery. Calling `on()` does not
immediately invoke the callback; use `get()` and `status()` for an already
started instance. Callback errors are contained and do not block other readers.
`available` means the provider responded, independently of GMCP Core status.
During refresh or a failed replacement, `get()` retains the prior committed
snapshot. Consumers do not trigger collection or persistence work by reading.

```lua
local client = aardwolf.new(host, { spells = true })
local unsubscribe = client.spells.on(function(snapshot, status)
  if type(snapshot) == "table" then
    echo("Saved abilities: " .. tostring(#snapshot.entries))
  end
end)
client.start()
-- Later: unsubscribe(); client.stop()
```

Snapshots are
`{ schemaVersion = 1, characterName, collectedAt, entries = { ... } }`.
`collectedAt` is Unix milliseconds. Entries are in server display order:
`{ name, level, sn?, percent?, unusable, area? }`. Names are preserved; integer Sn
and percentage fields are omitted for server dashes. Percentage includes zero.
`unusable` is a boolean from an explicit star, not inferred from level or
percentage. Both skills and spells are represented without inferring a type.

Spells 0.4.0 with library 0.5.0 captures `spells area` and sets `area = true`
on existing entries matched by name (case-insensitively). This optional boolean
is preserved in native storage and defensive consumer snapshots; older records
without it remain valid. A completed area result removes stale flags from names
absent from that result, including an empty `No spells found.` result. Missing
`area` does not establish whether area discovery has run. Area results do not
add entries or replace canonical names, levels, Sn, percentages, unusable flags
or damage enrichment. Full and combat refreshes preserve flags for retained
names. Refresh all runs both combat queries followed by `spells area`; plain
`allspells` alone does not run area discovery.

Spells 0.2.4 also merges committed `skills combat` and `spells combat` results
into these canonical fields. A bulk refresh retains unrelated entries and
existing display order, appending newly discovered names. `collectedAt` reflects
the latest committed full, bulk or area collection, not command-override changes.
Damage memberships, ability kind/mana, per-filter timestamps and command
mappings remain provider-owned; the public methods and schema are unchanged.
Each bulk result replaces all damage memberships/details for its kind and marks
absent types empty, while preserving the other kind and command mappings.
Empty bulk results clear that kind's memberships/details, retaining canonical
entries. Only `allspells` replaces the complete list.

Discovery works in either load order using the installed provider ID found by
name. The `aardwolf-spells:` channel uses `ready`, `stopped`,
`subscribe`, `unsubscribe`, and targeted `state` messages.
Subscribe carries `{ version = 1 }`; state carries
`{ version = 1, status, snapshot? }`. Readers accept state only from the
discovered provider, validate names/numeric fields/flags/schema, and bound
messages to 1 MiB and snapshots to 1,000 unique entries. Shutdown/disconnect
invalidates cached data; reconnect and provider reload discover again.
This leaves Core's GMCP package messages and negotiation contract unchanged.

## Inventory

Library **0.6.0** and API Core **0.2.0** provide one shared, transient inventory
collector per session. Pass `inventory = true` to `aardwolf.new`; the default is
opted out. This feature uses only the required lifecycle/messaging adapters in
the consuming plugin. Core owns all inventory commands; consumers do not inject
`send` or `sendGMCP` for inventory access. An older Core without inventory
capability reports inventory unavailable while existing GMCP methods still work.
API **0.8.0** / Core **0.4.0** additionally support explicit combat potion use
through the additive `combatPotions` capability described below.

```lua
local client = aardwolf.new(host, { inventory = true })
local unsubscribe = client.inventory.on(function(snapshot, status)
  if status.available then
    for _, bag in ipairs(client.inventory.getContainers()) do
      echo(tostring(bag.id) .. ": " .. bag.name)
    end
  end
end)
local unsubscribeResults = client.inventory.onResult(function(result)
  echo(result.requestId .. ": " .. result.outcome)
end)
client.start()
-- Explicitly request a discovered bag's contents:
-- local requestId, reason = client.inventory.lookIn(bagId)
-- Later: unsubscribe(); unsubscribeResults(); client.stop()
```

Subscribe before `start()`. Neither subscription method calls the callback
immediately; use the cached getters when subscribing to an already started
instance. Subscribers receive defensive copies, and callback errors do not stop
other subscribers. Unsubscribe functions are idempotent.

| Method | Contract |
| --- | --- |
| `client.inventory.get()` | Defensive cached `{ items, scopes, details }` snapshot. All three maps are empty while unavailable. Never sends a command. |
| `client.inventory.getItem(id)` | Known item or `nil`; does not search unopened containers. |
| `client.inventory.getContainers()` | Ordered list of known storage containers, including worn bags; numeric item type 11, without guessing from names. Drink containers (type 12) remain distinct. |
| `client.inventory.getContents(containerId)` | Cached container scope or `nil` when entirely unobserved. Only `known = true` with empty `entries` means a completed empty listing. |
| `client.inventory.getDetails(id)` | Cached tagged item details or `nil`. |
| `client.inventory.getWearSlots()` | Defensive cached `{ known, stale, entries }`; entries are `{ id, keyword, description, wearFlag }`. Never sends a command. |
| `client.inventory.status()` | Defensive `{ available, connected, active, potionReady, collecting, characterName?, reason?, error? }`. `active` requires an identified character in state 3 and a connected, negotiated session. `potionReady` additionally permits fighting state 8 when Core advertises `combatPotions`; it does not mean the collector is idle. |
| `client.inventory.diagnostics(scopeKey?)` | API 0.10.0: bounded, defensive, passive diagnostics. Includes local/provider versions, readiness, advertised capabilities, collector details when supported, and freshness summaries for inventory/equipment plus one optional `container:<id>`. No names, raw output or exception text. |
| `client.inventory.on(callback)` | Notify `(snapshot, status)` on cache/status changes; `snapshot` is always a table. |
| `client.inventory.refresh()` | Request carried inventory and equipment through `invdata` and `eqdata`. |
| `client.inventory.refreshWearSlots()` | Request current equipment-slot discovery through serialized `wearable` then `eqdata`; requires API 0.9.0 / Core 0.5.0 and capability `wearSlots`. |
| `client.inventory.lookIn(containerId)` | Request one container through `invdata <id>`. |
| `client.inventory.identify(id)` | Request tagged item details through `invdetails <id>`. Known items inside containers are refused; retrieve and observe the item in inventory first. Does not move items, send the separate `identify` command or cast a spell. |
| `client.inventory.onResult(callback)` | Notify a result table `{ requestId, outcome, reason? }` for requests issued by this consumer. |

Diagnostics schema version 1 returns `{ version, libraryVersion, provider,
available, connected, active, potionReady, readiness, capabilities, collector?,
scopes }`. `provider` contains optional `coreVersion` and `libraryVersion` advertised
by Core; these may differ from the consumer's library version. Unknown versions
are omitted. `readiness` is `unavailable`, `disconnected`, `waiting`, `ready` or
`combat-ready`; this is character eligibility, independent of a busy collector.
Capabilities include `inventory`, `inventoryDiagnostics` and a filtered
`inventoryActions` list. Missing/unsupported diagnostics capability or invalid
collector schema omits `collector`, never fabricates idle or zero queued reads.

Core 0.6.0 advertises `capabilities.inventoryDiagnostics = 1` and `provider` in
`state`. Its existing `inventory-status.status` adds optional `diagnostics` with
`{ version = 1, phase, drain, queuedReads, monitoring, operation?, lastFailure? }`.
`phase` is `idle`, `waiting`, `reading` or `draining`; `drain` is `none`,
`closing-tag` or `reconnect` (ambiguous boundaries). `queuedReads` is 0–64 jobs,
excluding the active read and coalesced request waiters. `operation` contains
`{ kind, waitingFor, manual }`; kind is `inventory`, `equipment`, `container`,
`details` or `wearSlots`, and waitingFor is `opening-tag` or `closing-tag`.
Wearable discovery waits for the tagged equipment boundary, even while its
untagged slot rows arrive. Failure categories are `timeout`, `transport-refused`,
`interrupted`, `invalid-response`, `limit`, `not-ready` or `request-failed`;
successful reads/drains retain history until generation reset.

`scopes` contains at most three `{ scope, freshness, count?, collectedAt? }`
summaries. Freshness is `unknown`, `partial`, `stale`, `empty` or `fresh`; a
partial scope has no complete count. These labels describe cache completeness
and invalidation, with the existing collection timestamp when present; reads do
not apply an age threshold. Invalid optional scope selectors are ignored.
Reading diagnostics allocates only a result copy: it never sends, schedules,
publishes, saves, advances work or releases a drain barrier. Existing status and
snapshot contracts remain compatible. Inventory Management adds its own workflow
phase/outcome and bounded manual recovery guidance to its widget diagnostic
property and terminal report; those are not collector API fields.

A snapshot is `{ items, scopes, details }`. `items` and `details` use decimal
object-ID strings as keys. `scopes` uses `inventory`, `equipment` and
`container:<id>` keys. Each scope is
`{ key, entries, known, stale, collectedAt? }`; entries preserve server listing
order and `collectedAt` uses Unix milliseconds after a completed listing. An
unscanned container observed through live item movements may have partial entries
with `known = false, stale = true`; these entries do not establish its complete
contents. A wholly unobserved scope is absent from `scopes`. Item records are
`{ id, flags, name, level, type, unique, wearLocation, timer, location }`, where
`id` is a positive safe integer, `unique` is boolean and `location` is its scope
key. Names preserve embedded commas and Aardwolf color codes. Timer and wear
location retain the server's `-1` sentinel rather than treating it as unknown.
Render names as text or deliberately convert their color codes; never treat them
as trusted HTML or commands.

Details contain the documented common header fields (`id`, `level`, `itemType`,
`value`, `weight`, `wearLocation`, `flags`, `owner`, `fromClanName`, `timer`,
`itemScore`) and raw type-specific `tags = { { tag, value }, ... }`. Header
item type, wear location and flags are text, unlike numeric inventory fields.
Library 0.8.5 accepts both the documented 13-field header and the observed
14-field layout with an additional reserved field before the final item score.
Blank timer and item-score fields remain unknown (`nil`); populated fields must
be finite numbers. Invalid headers and mismatched object IDs still fail without
replacing previously collected details.
Capacity and other type-specific stats have no invented normalized schema.
See Aardwolf's [Invdata](https://www.aardwolf.com/wiki/index.php/Help/Invdata),
[Invdetails](https://www.aardwolf.com/wiki/index.php/Help/Invdetails) and
[Invmon](https://www.aardwolf.com/wiki/index.php/Help/Invmon) references.

### Collection and freshness

The first interested consumer causes Core to send explicit GMCP
`config invmon on` and collect carried inventory/equipment once a connected,
negotiated session has an identified character in active or fighting state
(`char.status` state 3 or 8, from Core 0.4.0). This is a request to enable monitoring, not proof of a particular
undocumented confirmation payload. Core leaves `invmon` enabled on shutdown
because other integrations may share it.

Container contents and details load only on explicit request. Getters never
refresh. Core coalesces duplicate reads and serializes collection; it does not
poll or scan every bag. Live `invmon` and `invitem` tags update known locations;
ambiguous changes trigger bounded reconciliation of affected scopes. Concurrent
events cannot be overwritten by an older listing's completion. Unscanned contents
remain unknown or explicitly partial (`known = false`), rather than being
presented as a completely listed empty bag.

Library **0.8.1** accepts surrounding whitespace on standalone inventory tags
and includes the command and missing opening/closing tag in timeout feedback.
Completing a drain clears the obsolete waiting error while retaining stale data.
Library **0.8.2** treats a matching footer that crosses the frame size limit as
already drained: the oversized response fails and preserves stale cache, while
subsequent explicit reads remain available. A mismatched footer cannot release
the drain barrier.

Library **0.8.3** with Core **0.4.1** parses owned read responses before returning
`false` from Core's `onLine` hook to hide their tags and recognized data. Manual
and unsolicited frames, malformed rows, prompts, errors and live monitoring tags
remain visible. Known owned replies retain suppression while draining; manual
interruptions and ambiguous replies stop suppression. MudForge also skips later
plugins' line hooks and triggers for discarded lines; consumers should use the
shared inventory API rather than parse these hidden replies themselves.

Library **0.8.4** with Core **0.4.2** rejects details requests for known bagged
items at dispatch, including requests queued before a move into a container.
An exact `Item <expected-id> not found.` response before the details opening tag
ends that request as failed without waiting for a nonexistent closing tag.
The error stays visible and last-good details remain cached. The same terminal
response can release a timed-out unopened details reply; manual interruptions
match each pending reply in order by kind and object ID. Unrelated errors and
errors after an opening tag retain the normal closing-tag barrier.

A closing tag commits a complete scope atomically. Malformed, incomplete,
oversized or timed-out collection retains the last-good scope marked stale and
reports failure; it never publishes a partial replacement. Manual tagged commands
are observed without assigning their output to an unrelated owned request.
An interrupted response keeps the collector busy until its matching closing tag
or recognized terminal details error arrives, or the session reconnects. When a manual command interrupts an owned read,
both replies must drain. Ambiguous nested/unsolicited frames require reconnecting;
no read or action is retried automatically. Timer/transport setup failures can be
retried after Core reload or reconnect.
Inventory-specific bounds are 10,000 known items, 256 cached container scopes,
4 KiB per name and 1 MiB per captured frame. Overflow reports failure without
truncation. These do not relax the general API copy limits.

Disconnect, character change, screen reattachment and Core shutdown clear caches
and pending requests. Collection stops when no interested consumer remains. No
inventory data is written to native storage or replayed from an old connection.

### Explicit single-item actions

| Method | Command |
| --- | --- |
| `client.inventory.take(id, containerId)` | `get <id> <containerId>` |
| `client.inventory.put(id, containerId)` | `put <id> <containerId>` |
| `client.inventory.wear(id)` | `wear <id>` |
| `client.inventory.remove(id)` | `remove <id>` |
| `client.inventory.drop(id)` | `drop <id>` |
| `client.inventory.give(id, recipient)` | `give <id> <recipient>` |
| `client.inventory.sell(id)` | `sell <id>` |
| `client.inventory.donate(id)` | `donate <id>` |
| `client.inventory.sacrifice(id)` | `sacrifice <id>` |
| `client.inventory.hold(id)` | `hold <id>`; requires API 0.7.0 / Core 0.3.0. |
| `client.inventory.dual(id)` | `dual <id>`; requires API 0.9.0 / Core 0.5.0, a fresh carried weapon (5), fresh equipment, a discovered secondary slot and empty competing off-hand slots. |

### Item use and capability discovery

API **0.7.0** / Core **0.3.0** add
`client.inventory.use(id, action, options?)` and
`client.inventory.supports(action)`. `supports` returns a boolean for read names
(`refresh`, `lookIn`, `identify`), existing single-item action names, `hold`,
and the six original use actions below. `supports("use")` continues to require
only those six actions; check `supports("enter")`, `supports("dual")` and
`supports("wearSlots")` separately for API 0.9.0 / Core 0.5.0 extensions.
It reports provider support, not current item eligibility or connection activity.
An older inventory-capable Core continues to support existing methods; Hold and
item use fail with an upgrade explanation. A disconnected/unavailable consumer
clears the advertised extensions.

| Use action | Required item and location | Command / options |
| --- | --- | --- |
| `quaff` | Potion (8), carried inventory | `quaff <id>` |
| `eat` | Food (14) or pill (19), carried inventory | `eat <id>` |
| `drink` | Drink container (12), carried inventory | `drink <id>` |
| `recite` | Scroll (2), carried inventory | `recite <id> [target]`; optional `options.target`. |
| `zap` | Wand (3), configured held slot in equipment | `zap <target>`; requires `options.target` and `options.heldSlot`. |
| `brandish` | Staff (4), configured held slot in equipment | `brandish`; requires `options.heldSlot`, no target. |
| `enter` | Portal (20), discovered effective Portal or held slot in equipment | `enter`; requires `options.heldSlot`, no target; API 0.9.0 / Core 0.5.0. |

Targets are single alphabetic names/keywords, optionally prefixed by a positive
selector such as `2.guard`; `all`, whitespace, separators, and arbitrary command
text are rejected. Recite additionally accepts a positive object ID target.
`heldSlot` is a nonnegative safe integer, or its numeric string representation;
learn it from the character's current equipment / `wearable`, rather than
assuming one race-independent number. Server restrictions and skills still apply.

Core requires a fresh, complete scope containing the selected item for Hold and
use. Hold requires carried inventory. For Zap and Brandish, Core checks that the
selected ID has the correct type and occupies `heldSlot` in equipment, with no
ambiguous duplicate occupying that slot. For Enter, Core additionally requires
fresh slot discovery and the selected portal in the discovered `portal` slot,
or `hold` when no Portal slot exists. These commands do not include the item ID.
Bagged items must be explicitly retrieved first;
none of these primitive methods prepares equipment or restores an arrangement.

### Automatic equipment-slot discovery

`refreshWearSlots()` serializes `wearable` and an owned `eqdata` reply through
Core's inventory collector. It requires the `Num Keyword Description Wear Flag`
header, unique well-formed rows and a complete equipment frame before publishing
a new slot snapshot. A row such as `22 feet [ Worn on hooves ]: feet` becomes
`{ id = 22, keyword = "feet", description = "Worn on hooves", wearFlag = "feet" }`.
IDs preserve nonconsecutive and race-specific server locations; keyword and wear
flag remain distinct (`second` and `wield`, for example).

The tagged equipment reply supplies a completion boundary independent of custom
prompts. Collection uses bounded output, timeouts, manual-interruption handling
and connection generations. Missing headers, duplicate/malformed rows, refused
sends and incomplete equipment replies fail without publishing partial slot
results. Recognized owned discovery output follows quiet collection rules;
prompts, errors, unrelated lines and manually requested output remain visible.
Snapshots are transient and cleared with session/character resets. Portal use
refreshes discovery for every confirmed action; neither the primitive getter nor
login starts a discovery read. These methods do not prepare or restore equipment.

### Combat potion access

API **0.8.0** / Core **0.4.0** advertise
`client.inventory.supports("combatPotions")`. `status().active` retains its
state-3-only meaning. The separate `status().potionReady` is true for an
identified, connected, negotiated inventory session in state 3 or fighting
state 8. It is false for sleep, pager, other inactive states, disconnect,
unavailable Core, or an older Core without this advertised capability.
Monitoring and serialized `refresh`, `lookIn`, and `identify` reads can run in
either ready state; a 3↔8 transition does not cancel an in-flight read.

While fighting, Core permits only explicit single-item `take` / `put` of a
known type-8 potion and `use(id, "quaff")` of a carried type-8 potion. The potion's
source scope must be complete and fresh. For moves, Core also validates the
exact source location and a fresh type-11 storage bag carried directly or worn;
nested/inaccessible bags, drink containers, stale scopes, and ordinary items are
rejected. Other actions, including equipment changes, disposal, pills, food,
scrolls, wands, and staves, still require normal active state 3. Core enforces
these restrictions even when a consumer bypasses its local action guard.

Busy potion actions fail immediately rather than queueing for later. The caller
must observe movement or refresh before advancing to another step. A `sent`
result does not establish consumption. Losing ready state cancels pending reads;
the current reply may drain, but old work does not resume after waking. Explicit
live item movement tags continue updating caches; ambiguous inactive-state
updates mark scopes stale without deferring new reads until wake-up. No gameplay
action is automatically resumed or retried.

Older Core versions retain normal-state behavior. Combat potion calls refuse
with a Core 0.4.0 upgrade explanation when `combatPotions` is absent; clients must
not infer combat support from the existing `quaff` capability alone.

Like existing actions, these methods return a request ID or `nil, reason` and
notify `onResult` with `sent` or `failed`. Results can arrive synchronously before
the method returns. `sent` establishes transport handoff only, not a successful
cast or consumption. Busy/inactive calls are never deferred or retried.

Read-request and action methods return a request ID string or `nil, reason`.
Result outcomes are `complete` for a completed read, `sent` for a command handed
to transport and `failed` for failure. An action's `sent` result does not claim
that the server performed it; inventory changes follow observed server tags.

Except for the combat potion actions described above, actions require the
active, identified, connected and negotiated session and an idle collector. Busy/inactive actions fail immediately; they are never queued
for later execution or retried. Every action targets one positive integer object
ID. `give` accepts a single alphabetic recipient name/keyword, optionally prefixed
by a positive selector such as `2.guard`. Whitespace, command separators, bulk
selectors and self-container puts are rejected. No action implicitly removes
worn equipment, retrieves an item from a bag, or drops an item first. In
particular, `sacrifice(id)` targets an item already on the ground, as described
in [Sacrifice help](https://www.aardwolf.com/wiki/index.php/Help/Sacrifice).
Server restrictions and item flags still determine whether commands succeed.

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

- `register`: targeted JSON `{ version = 1, packages = [...], inventory? = true }` replaces a consumer declaration; replies with `state`.
- `unregister`: targeted withdrawal during consumer cleanup.
- `ready` / `stopped`: Core lifecycle announcements; consumers rediscover or clear state.
- `state`: targeted JSON `{ version = 1, session = {...}, snapshots = {...}, capabilities = { inventory = 1, inventoryActions = [...] } }`.
- `update`: targeted JSON `{ version = 1, package = "...", payload = {...} }`.

Inventory adds targeted `inventory-status`, `inventory-scope`,
`inventory-details`, `inventory-wear-slots` and `inventory-result` messages. Each
carries version 1 and a connection generation; requests carry consumer-local
request IDs. Scopes are
transferred separately with inventory-specific validation. Only registered
inventory consumers can request work or receive inventory data. Core 0.3.0 adds
an optional `capabilities.inventoryActions` list (`hold`, `quaff`, `eat`, `drink`,
`recite`, `zap`, `brandish`) without changing `inventory = 1` or protocol version 1.
Core 0.4.0 adds `combatPotions` to that list and the optional boolean
`inventory-status.status.potionReady`; absence means false, and the consumer
accepts true only with the matching advertised capability. Older consumers ignore
these additive fields. Core 0.5.0 adds `wearSlots`, `enter` and `dual` capabilities
and the generation-scoped `inventory-wear-slots` snapshot message. Existing
inventory protocol version 1 and baseline actions remain compatible.

Only Core-origin state/update/stopped and inventory messages are accepted. Registration
replies can arrive after `start()` returns; consumers observe availability
through `session`, rather than assuming synchronous delivery. Core rebuilds
requirements on registration/withdrawal and prunes unloaded/disabled senders
before sending a support set. Every consumer must call `stop()` in cleanup.

`aardwolf.protocol` exposes pure validation/copy helpers shared by Core. These
are internal implementation support, not the consumer API stability contract.
