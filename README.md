# aardwolf-mudforge-plugins

A shared Lua API and Aardwolf plugins for [MudForge](https://mudforge.org/).
The **0.4.0** library provides a session Core, an injected library facade, native
storage and widget helpers, a reactive vitals example, and a configurable vitals HUD.
All plugin persistence uses MudForge's native plugin/world storage. Spells **0.3.1**
retains the native storage introduced in 0.3.0; preserve legacy SQLite data with the
[one-time migration guide](docs/SQLITE.md). Normal use needs no Python process or
File System Access.

| Component | Purpose |
| --- | --- |
| `aardwolf-api` library | Data subscriptions, snapshots, refresh requests, local persistence and consumer-owned UI |
| Aardwolf API Core | One GMCP negotiation owner and one authoritative state cache per session |
| Aardwolf API Vitals Example | HP/mana/moves bindings, an explicit refresh button and saved font-size preferences |
| Aardwolf Vitals | HP/mana/moves, target HP, alignment and character status with floating settings |
| Aardwolf Spells | Native skill/spell snapshots and a dockable panel of learned damage abilities |
| Aardwolf Room Details | Formatted tagged room characters/objects, selection, and automatic room refreshes |
| [Aardwolf Atlas](docs/ATLAS.md) | Standalone native-map explorer with overhead/3D terrain views, room inspection and read-only routes |
| Aardwolf Terrain Icons | Importable pack of 114 fantasy terrain tiles with matching material edges |

## Aardwolf Atlas

[Aardwolf Atlas 0.3.0](docs/ATLAS.md) displays the native map in overhead or
orbitable 3D views, with terrain artwork, floors, area browsing, room inspection,
and lock-aware route previews. Settings includes independent visibility and color
controls for doors, locked doors, up/down exits, and area exits, saved per world.
Source indicators remain visible for exits to other floors and areas; routing
locks keep their independent red markers. Install `dist/plugins/aardwolf-atlas.lua`
by itself; it needs no API Core, connection, or runtime downloads. Type
`awatlas` to reopen its dockable panel. Atlas never walks or edits native map data.
See the guide for controls, build details, and disposable acceptance checks.
Native checks on MudForge 2.0.3701, map-preservation comparisons, and remaining
validation limits are recorded in the guide.

## Terrain icon packs

[Andolor: Three Moons 1.3.1](docs/THREE-MOONS.md) is the new Aardwolf-inspired
alternative: moonlit slate and gold, jade forests, opal water, copper dunes,
glacial crystals and violet astral light. Its 114 styles include three-moon
mosaics, flowing castle runners, central shop counters and continuous interior floors.
Beveled stone, cast shadows and material-specific grain add depth to all 114 tiles. The
[research and design notes](docs/THREE-MOONS.md#research-and-interpretation) explain
the lore and the visual interpretation. Download the
[Three Moons JSON](dist/map-packs/aardwolf-three-moons.json) or open its
[contact sheet](dist/map-packs/aardwolf-three-moons.html), including a dense
5 × 5 layout study and a 3 × 3 repeat for every terrain.

[Aardwolf Terrain Icons 4.2.1](docs/TERRAIN-ICONS.md) uses enhanced Atlas
artwork for all 114 terrain types. Three generic `shop` variants share common
horizontal timber flooring and vary their furniture's appearance, placement,
size and shape. All retain clear paths to the north, east, south and west exits.
The merchant, apothecary and smith images are included as named terrain styles
(`shop-merchant`, `shop-apothecary`, `shop-smith`) for manual assignment, bringing
the pack to 117 styles. They remain excluded from automatic shop variants.

Download the [JSON pack](dist/map-packs/aardwolf-terrain-icons.json) and import
it through **Map settings → General → Map Pack Management → Choose File...**.
Export your existing pack first: importing replaces the terrain-style list.
The [contact sheet](dist/map-packs/aardwolf-terrain-icons.html) includes all
terrain tiles, generic variants and manual images at 16, 24 and 32 px. The pack
needs no Atlas installation, Lua plugin or shared API. The format was
browser-tested with 1.0.0; native acceptance of 4.2.1 is pending.

## Installation

This checkout includes generated install files and a repository catalog. They
have **not been published or installed** by this scaffold.

1. Install `dist/libs/aardwolf-api.lua` through **Plugin Manager → Libraries**.
   Use the library name `aardwolf-api` (no extension).
2. Disable any other Aardwolf GMCP negotiation owner, including **Aardwolf
   Core** / `aw-core` / `aardwolf-core`, in the target world.
3. Install and enable `dist/plugins/aardwolf-api-core.lua` as a plugin.
4. Install `dist/plugins/aardwolf-vitals.lua` for the configurable vitals HUD.
   The development example `dist/plugins/aardwolf-api-vitals-example.lua` remains optional.
5. Optionally install `dist/plugins/aardwolf-spells.lua`. Follow the
   [Spells setup](#aardwolf-spells) below before enabling automatic collection.
6. Optionally install `dist/plugins/aardwolf-room-details.lua` for
   [Room Details](#aardwolf-room-details). It enables room tags and requests a look
   after login; it needs no file permission.

With these files hosted, the root `plugins.json` publishes plugin and
library listings. Add the repository URL in MudForge's repository manager,
then install the library and plugins from their respective tabs. No `.mfp`
package or world/profile data is included. A user-edited/file library can take
precedence over a repository library of the same name; check the loaded copy
when testing updates.

If Vitals reports `loadPlugin(): unsupported Aardwolf package`, update the
shared `aardwolf-api` library from `dist/libs/aardwolf-api.lua`, then reload
API Core and Vitals. Earlier library copies rejected the numeric string keys
returned by MudForge's `pairs()` when reading a valid `{ "Char" }` package list.
Check for an older user-edited/file library taking precedence over the updated
repository copy.

Core discovers registered consumers in either load order. Each consuming
plugin gets its own library instance; Core communicates with them using
world/session-scoped messages. The API does not connect to the MUD itself.

## Aardwolf Vitals

Aardwolf Vitals **0.1.5** shows **HP, mana and moves** side by side, with labels
to the left and current/max values plus percentages over each bar. The compact
header places the connection/data status beside the Vitals title. Bars are
24 px tall at the default font size and grow for larger fonts or wrapped values.
The panel stacks the bars below 480 px width; larger fonts also wrap the bars
as needed. MudForge owns saved placement,
size and visibility; existing geometry is preserved. Initial size is 640 × 150 px.

Current values come from `char.vitals`; maxima come from `char.maxstats`
(`maxhp`, `maxmana`, `maxmoves`), as documented in the
[Aardwolf GMCP reference](https://www.aardwolf.com/wiki/index.php/Clients/GMCP).
Missing or invalid values display `?`, and missing/nonpositive maxima suppress
percentage alerts. Bars clamp to 0–100% without changing the displayed server
numbers. Disconnect or Core unavailability clears the display.

A second row shows **Target**, **TNL** and **Alignment**, wrapping in that order
as the panel narrows. A wrapping summary below it shows **Level, Hunger,
Thirst, State and Position**. These values come from `char.status`;
hunger and thirst are displayed as numbers without assumed units.

TNL uses a teal progress bar that fills toward the next level, with remaining
XP and completion percentage overlaid. Completion is
`(char.base.perlevel - char.status.tnl) / char.base.perlevel × 100`, clamped to
0–100%. The reported remaining XP stays unchanged, including out-of-range
values. Missing/invalid TNL or missing/nonpositive XP per level shows a neutral
empty bar with an unknown percentage (`--`). The tooltip and accessible
description include remaining XP, XP per level and completion. TNL has no
low-vital alerts.

Target displays `enemy` over a red HP bar and `enemypct` alongside it. This is
a reported percentage, not an invented current/max HP pair. Only the fill is
clamped to 0–100%; the reported number is preserved. Player low-vital alerts do
not apply to target HP. Long names truncate visually and remain available in
hover text and the accessible description. An explicitly empty/whitespace enemy
shows **No target** with an empty bar; missing/invalid enemy data shows
**Target unknown**. A supplied enemy is shown regardless of character state.
Missing/invalid target HP displays `--` with an empty fill.

Alignment uses an Evil (red), Neutral (gray), Good (green) scale. Its marker
maps −2500 to the left edge and +2500 to the right edge; the signed number and
category appear over the scale. **Evil** is ≤−875, **Neutral** is −874 through
874, and **Good** is ≥875. Out-of-range values retain their reported number
while the marker stays within the scale. Unknown alignment displays `?` with
no marker. The hover/accessibility description includes the category ranges.

Character state uses the following labels; unrecognized codes display `State N`,
and missing/invalid fields display `?`. Position preserves the supplied text.

| Code | State |
| --- | --- |
| 1 | Login |
| 2 | MOTD/login |
| 3 | Active |
| 4 | AFK |
| 5 | Note |
| 6 | Building/edit |
| 7 | Pager |
| 8 | Combat |
| 9 | Sleeping |
| 11 | Resting/sitting |
| 12 | Running |

Character fields follow the shared API's partial-update rules: omitted fields
retain their previous values, while explicitly invalid fields become unknown.
Target, alignment and summary values clear when the connection, Core or
negotiation is unavailable. No gameplay commands are sent by these displays.

Click the **Settings** gear icon to open a separate floating **Aardwolf Vitals Settings**
window (initially 420 × 520 px). Its controls scroll at smaller sizes.
**Close**, Escape, or the window's × hides it. Clicking Settings reopens the
same window with unfinished edits intact until plugin reload; the window is
created only when requested and stays closed after reload.

Use the settings window to choose a plain font family name (for example `system-ui`,
`Menlo` or `SF Pro Text`), an integer size from 8–48 px, normal/bold weight, and
normal/italic style. Fonts use those available on the device; no font files are
downloaded. Defaults are `system-ui`, 13 px, normal weight and style.

HP uses red, mana blue, and moves yellow. Each vital has independent warning
and critical percentages. Defaults are **Low at ≤30%** and **Critical at ≤15%**
with a gentle border pulse. HP alerts use orange and rose, mana alerts cyan and
indigo, and moves alerts amber and orange; the pulse matches the critical color.
Critical styling takes priority. Thresholds must satisfy
`0 ≤ critical < warning ≤ 100`; fractional thresholds are supported. The pulse
stops when the vital recovers or becomes unknown, and is disabled by the
device's reduced-motion preference. Text labels accompany the alert colors.

**Save settings** and **Reset defaults** persist through the shared API's
plugin/world storage. Failed saves leave applied settings unchanged and show
feedback in the settings window. Save and Reset keep the window open. Invalid
stored settings use defaults without overwriting the stored record. Ordinary
data updates preserve unfinished form edits and focus;
successful Save/Reset synchronizes controls without replacing either widget's
markup.

The bottom-right **Settings** and **Refresh** icons remain visible while the
panel scrolls. Settings places Save, Reset and Close at the lower right. Both
action bars reserve 26 px of space after the buttons to keep the corner clear.
The **Refresh** circular-arrow icon explicitly requests fresh character GMCP
data through API Core.
Refresh sends no message below the bars. If Core, negotiation or the connection
is unavailable, the reason appears in the Refresh icon's hover text. The plugin
does not automatically send refresh requests.

## Aardwolf Room Details

**0.2.3** moves `{roomchars}` and `{roomobjs}` output into one compact, dockable
**Room Details** panel with Characters above Objects. Initial size is 360 × 240;
drag it to an edge of another widget to dock it. MudForge restores saved placement,
size and visibility. Each completed tagged block replaces its own section;
an empty block clears it. Descriptions, aura prefixes, order, duplicate rows,
original whitespace and full descriptions remain in the captured data. Each
nonempty received line is one compact, selectable row; long descriptions use an
ellipsis. Blank spacer lines take no space in the panel. Characters abbreviate
simple parenthesized markers to their first non-space character and join adjacent
markers: `(Golden Aura) (White Aura)` displays as `(G)(W)`. Objects remove leading
indentation for display and abbreviate only consecutive leading markers:
`    (Magic) (Hum) A bag (open).` displays as `(M)(H) A bag (open).`

The **Font settings** gear opens separate controls for **Room text** (6–32 px,
or **Terminal** to follow the console) and **Interface text** (8–20 px). Sizes
save automatically and survive reloads. **Reset** restores terminal-sized room
text and a 12 px interface. Try 10 px room text and a 10 px interface for a
denser panel. The panel keeps the terminal font family and weight and uses
MudForge's native `parseAnsiText`
segments for foreground/background colors, italic, underline and native bright
color handling for intensity. SGR state carries across lines, including styles
set before the opening tag. Text is rendered as text nodes, never as server HTML.
Click or press Space to select a row; the outline preserves text colors. Open
**Details** with the information icon, double-click, or Enter on a selected row.
The dialog shows the original formatted description, including indentation and
unabridged markers. **Copy** copies the original plain text; if clipboard access
is unavailable, it selects the text and explains how to copy manually. Close or
Escape returns focus. Selection and details send no game commands. Identical
snapshots retain selection/details; changed selected lists, rooms, characters
and connections clear them. Unrelated updates preserve focus and scrolling.

The circular-arrow **Refresh** icon shows queued/in-flight feedback in its hover
text and accessible name. Actionable waiting reasons (including sleeping, pager,
Spells collection or missing connection) and unresolved errors appear below the
title when needed. Recovered operations clear only their corresponding errors.
Unchanged view states are not sent to the widget, and unchanged lists are not
rebuilt. The compact bottom-right toolbar keeps **Font settings**, **Auto**, **Details** and
**Refresh** visible while the lists scroll. Copy and Close sit at the lower right
of the Details dialog. Both action bars reserve 24 px of space after the controls
to keep the corner clear. To reclaim unused space below the lists, resize the native
dock tile manually; the plugin preserves MudForge's saved geometry.

On installation/enabling in an authenticated active session, and on each login,
Room Details sends `tags roomobjs on`, `tags roomchars on`, then one `look`.
Repeated status packets and temporary Core restarts do not repeat the setup.
A full plugin reload creates a new runtime and performs one setup again.
Core owns GMCP negotiation; Room Details consumes `Char` and `Room` through
`aardwolf-api`. Disabling/uninstalling the plugin does not turn server tags off.

**Auto** is enabled by default. It queues a follow-up look when combat ends or
after outgoing `get`, `take`, `drop`, `put`, `give`, `sacrifice`, `sac`, `donate`,
`buy` or `sell` commands (including aliases that expand to those commands).
Activity coalesces until the next normal Aardwolf prompt, active state, and
300 ms of quiet, with at least one second between looks. Refreshes wait for any
room block and an available Spells provider's collection/save to finish. There
is no dependency on Spells being installed. Automatic refreshes do not guess
death messages or mutate descriptions. Tag snapshots remain authoritative.

- `awroomdetails show` / `hide` reopens or hides the panel.
- `awroomdetails refresh` (or **Refresh**) requests one look; failed setup can
  be retried explicitly here. Failed sends and response timeouts do not retry.
- `awroomdetails auto on` / `auto off` changes the saved Auto preference.
- `awroomdetails font 10` / `font terminal` sets room text size or restores terminal following.
- `awroomdetails ui-font 10` sets interface text size.
- `awroomdetails status` reports availability, pending work, or the last error.

Tag markers and their contents are hidden from the console only when the panel
is ready, visible and has working formatting APIs. Other output stays visible.
The panel continues collecting while hidden, so it has current data on reopening.
Each block is bounded to 500 lines, 128 KiB and five seconds. Malformed boundaries,
missing closing tags or overflow surface buffered content as incomplete and
release console suppression. Missing/failed formatting leaves output visible.
Room/character changes and disconnects clear stale selection and room data;
Auto and font-size preferences persist.

Offline and browser checks do not establish native formatting, gagging, docking,
or live transport acceptance. See [native acceptance](docs/NATIVE-ACCEPTANCE.md#room-details--023-acceptance-pending).

## Aardwolf Spells

Aardwolf Spells **0.3.1** collects plain `allspells` once after login and stores
every skill and spell row, including future-level entries and rows with a dash
Sn or percentage. It also creates a dockable **Aardwolf Damage Abilities** panel.
Drag it into MudForge's tiled layout; its saved placement and visibility survive
reloads. The original command output, pager controls and prompt remain visible.

Install the **0.4.0** `aardwolf-api` library and API Core. Collection waits for a
verified `char.base.name`, connected/negotiated Core state and
`char.status.state == 3`. Each lowercase character name selects one validated
record in native storage owned by this installed plugin and world. Different
worlds and installed plugin IDs remain isolated; character renames select a new
record. Data follows MudForge's world persistence and backup mechanisms.

For an upgrade, convert each old Spells database to private JSON with
`tools/migrate-spells-storage.py`, then run **`awspells import`** and choose the
file while disconnected. For an optional paste workflow, use
**`awspells import-paste`**, paste the complete converted JSON into the
**Import saved abilities** panel and press **Import saved data**. Check
**`awspells status`** for the last import result if asynchronous terminal output
is not visible; the paste panel also displays feedback. Both paths validate,
save and read back all ability, damage and command data. Identical data is a no-op; a different existing native
record is preserved and the import is refused. Keep the old database and backups.
See [migration instructions](docs/SQLITE.md) before reconnecting and collecting.

### Damage ability panel

Each row displays the best **skill** and best **spell** separately for acid, air,
bash, cold, disease, earth, electric, energy, fire, holy, light, magic, mental,
negative, pierce, slash, shadow, sonic, special and water. Only entries learned **above 1%** qualify;
starred unusable abilities and entries above the known character level are
excluded. Highest level wins, followed by highest learned percentage and then
alphabetical name. Hover over a button for level, percentage, command and last
refresh time. The panel adapts to its available width and height, using the fewest
readable columns that fit the visible rows. Saved damage-type order flows down
each column, then across; each type keeps its Skill and Spell together. Controls
stack when a column is narrow. Below 360 px in height, spacing is reduced and
ability buttons shrink to 22 px without reducing text size. If the rows still
cannot fit, scroll vertically to reach them. Resizing does not change saved order
or visibility.

The compact pane opens at 540 × 400 px unless MudForge restores a saved size.
Its bottom-right toolbar stays visible while the ability list scrolls and uses
icons: pencil for **Edit layout**, circular arrow for **Refresh
all**, and × for **Cancel collection**. The bar reserves 24 px of space after
the buttons to keep the corner clear. Hover for labels or use the keyboard.
Toggle Edit to reveal drag handles and visibility checkboxes for every damage
type and its skill/spell slots, including hidden ones. Checked means visible.
Drag a type by its handle, or focus the handle and press **Alt+Up/Down**, to move
the entire row. Toggle Edit off to return to the ability buttons; using abilities
is disabled during editing, while Refresh and Cancel remain available. The grid
reflows when editing, visibility or ordering changes, with room for edit controls.

Each change saves immediately for the verified character in native plugin table
storage, separately from the saved ability record. Hiding a type preserves its skill
and spell settings; hiding both slots hides that row. Slot visibility applies
regardless of which best ability occupies it. The Edit button remains available
when all rows are hidden. Reloading or changing character exits Edit and restores
that character's layout. Missing preferences use alphabetical order with every
slot visible; invalid preferences use defaults and show feedback. A failed save
restores the last accepted layout and shows the reason. Existing 18-type layouts
retain their order and visibility, with Disease and Special appended and visible.
Refresh all includes hidden types and slots.

Damage data is collected manually. **Refresh all** sends just two commands,
`skills combat` followed by `spells combat`, and groups their rows by the Damage
column. There are no per-type refresh buttons. Saved results appear on load;
**Not refreshed** means that kind's damage list has not completed for the group,
while **None learned** means it completed but currently has no qualifying ability.
Damage types absent from a completed bulk list are also marked empty. Refreshing or an
error retains the prior committed result. **Cancel** stops capture and remaining
requests. A sent query's remaining output is discarded until its footer, empty
result, prompt or original timeout; new refreshes wait for that boundary. An
native save already in progress completes before another collection begins.
Errors stop Refresh all; recover and explicitly run it again. No automatic damage
queries, pager changes, pager-control commands or background retries are sent.

Clicking an ability sends one command without a target. Spell buttons send
`cast <spell number>`; skills use a saved override, a verified mapping (currently
`Dirt kicking` → `dirt`), or the lowercased skill name. Aardwolf decides the default
target. Ability buttons work in active or combat state; refreshes require active
state. Collection/save disables ability buttons to avoid interrupting its output.
Some skills require a command different from their label; configure an override
when necessary. Unsafe fallback commands are disabled.

- `awspells refresh` collects the full `allspells` list and recovers after resolving
  dependency errors. Overlapping collections/saves are refused.
- `awspells refresh-all` collects both bulk damage lists; `awspells cancel` stops it.
- `awspells show` explicitly reopens a closed panel.
- `awspells import` chooses a converted migration JSON file; it works disconnected
  and preserves different existing native data.
- `awspells import-paste` offers a labeled text box for the complete converter JSON,
  including on builds without a file picker. **Import saved data** uses the same
  validation and preservation rules; feedback appears in the panel and terminal.
- `awspells status` (or `awspells`) reports character, saved count/time, errors and
  the last import result.
- `awspells command "Dirt kicking"` inspects the effective command.
- `awspells command "Dirt kicking" dirt` saves a per-character override for a skill
  discovered in a damage list. Overrides are single commands, 1–128 characters,
  using ASCII letters/digits, spaces, underscore, apostrophe or hyphen; command
  separators and multiline commands are refused.
- `awspells command-reset "Dirt kicking"` removes the override.

Sending plain `allspells`, `skills combat` or `spells combat`
also captures its output when storage is ready and collection is idle.
Legacy `skills damage` and `spells damage` commands remain supported for manual capture.
Other filtered commands interrupt capture and never replace the full list.

### Collection and persistence

The full-list header starts parsing and the exact
`* means that you cannot use the skill/spell.` footer completes it. Names,
levels, nullable spell numbers/percentages, explicit star flags and display order
are preserved. A dash percentage does not imply an unusable star flag.
Damage tables start at their Skill/Spell header and complete at
`To see all skills/spells for your class, use 'allspells <class>'`.
`No skills found.` and `No spells found.` are successful empty results.
Repeated page headers are accepted, and indented continuation rows inherit the
preceding level, including across page separators. Continue the pager yourself.
Each capture expires after **60 seconds** and is limited to **1,000 rows**; the
merged canonical list also has a 1,000-entry limit.

Bulk results atomically update canonical ability fields and replace all damage
memberships and details for the queried kind, preserving the other kind.
Omitted/forgotten entries disappear from that kind's damage groups without
deleting canonical abilities or command overrides. An ability can belong to
multiple damage types. A blank Damage column is accepted: the ability remains
in the catalog without a damage-group membership. Unknown nonempty damage types
still reject the collection. Full-list replacement preserves damage enrichment for
retained names and prunes removed associations. Kind, mana, memberships, filter
timestamps and command overrides are saved together with the canonical snapshot
in one native character record. An accepted `saveTable` write precedes publication
of the new data; a refused write retains the prior snapshot. Overrides remain
saved if an ability temporarily disappears. Layout preferences retain their
existing native key and are preserved during migration.

Partial, malformed, duplicate memberships, conflicting or interrupted output retains the
previous committed data. Unavailable storage or a refused save reports the reason
and retains prior data without automatic retries. Disconnect, lost Core and
character changes clear exposed data and cancel pending work. Collection timestamps reflect
the latest committed full or bulk collection; changing a command override
does not change collection time.

Other plugins opt into `{ spells = true }` and use
`client.spells.get()`, `client.spells.status()` or `client.spells.on(callback)`.
The public snapshot remains schema version 1, with updated canonical fields;
damage enrichment is private to the provider. Readers need no storage adapters or
file permission. See [the spells API](docs/API.md#spells).

Offline fixtures cover parsing, selection, command dispatch, native save refusal,
reload, isolation and import validation. Converter tests read temporary legacy
SQLite files and check field preservation, unsupported data refusal and source
preservation. On **2026-10-24**, MudForge **2.0.3915** loaded API 0.4.0 and
Spells 0.3.0 under the existing installed plugin ID. Native picker import, fresh
and repeated paste import, exact exported-record comparison and persistence after
world close/reopen were verified. Existing map data, terrain styles, unrelated
plugin state and widget positions were preserved; temporary fixtures were removed.
Chromium checks use synthetic bindings and do not establish native docking or all
widget interactions. Native acceptance of the 0.3.1 adaptive layout is pending.
Connected collection, pager behavior, broader damage-panel acceptance and live
Aardwolf transport remain pending; see the separate
[native acceptance checks](docs/NATIVE-ACCEPTANCE.md).

## Writing a consumer

```lua
plugin = {
  id = "my-aardwolf-plugin", name = "My Aardwolf Plugin", version = "0.1.0",
  author = "Your name", description = "Reads vitals through the shared API."
}

local client, unsubscribe

function init()
  if type(client) == "table" then return end
  local aardwolf = require("aardwolf-api")
  client = aardwolf.new({
    findPluginByName = findPluginByName,
    onPluginBroadcast = onPluginBroadcast, broadcastToPlugin = broadcastToPlugin,
    on = on, off = off, sendGMCP = sendGMCP
  }, { packages = { "Char" } })
  unsubscribe = client.on("char.vitals", function(vitals)
    if type(vitals) == "table" and type(vitals.hp) == "number" then
      echo("HP: " .. tostring(vitals.hp))
    end
  end)
  client.start()
end

function cleanup()
  if type(client) ~= "table" then return end
  unsubscribe()
  client.stop()
  client = nil
end
```

Use one API instance per consuming plugin. Subscribe before `start()` to
receive the initial state. Subscribe to `session` to clear a display when Core
stops or the connection closes. Call `get()` after subscribing if you need to
render an instance that was already started.

See [the API reference](docs/API.md) for adapters and semantics, and
[the vitals source](src/plugins/aardwolf-api-vitals-example.lua) for a complete
consumer with storage and widgets.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run build:check
git diff --check
```

Edit `src/`; `build` copies exact Lua bytes into `dist/` and regenerates catalog
hashes/sizes. Commit source and generated files together when making a release.
The generator has no timestamps or network dependency and resolves paths
relative to this repository, including when run from another directory.

Builds and tests reject JavaScript reserved names in Lua bindings (parameters,
locals, loop variables and bare function names). Names such as `package` are
valid Lua but can fail in MudForge's JavaScript runtime; use `packageName`
for variables while keeping protocol fields such as `data.package` unchanged.

Tests check Lua 5.1 syntax and execute behavior in **Fengari's Lua 5.3 VM**
with injected host fixtures. This verifies library logic, simulated lifecycle,
and deterministic distribution; it does not execute MudForge's JavaScript
transpiler, native widgets, persistence engine or GMCP transport.
`npm test` also runs Python converter tests against temporary legacy SQLite
databases and other artifact acceptance tests; Python 3 is required for those
tests and the one-time converter. The installed plugins have no Python dependency.

The initial native target was MudForge **2.0.3701**; Spells storage migration
was verified on **2.0.3915** on **2026-10-24**, separately from fixture coverage.
Remaining native and live-MUD checks are tracked in
[the acceptance checklist](docs/NATIVE-ACCEPTANCE.md). Aardwolf Vitals
has repository fixture coverage and standalone Chromium layout checks; native
rendering, pulse behavior, keyboard interaction, disk persistence and live GMCP
acceptance remain pending.

## References

- [MudForge plugin and library authoring guide](https://mudforge.org/docs/ai-plugin-guide.md)
- [Aardwolf GMCP modules and commands](https://www.aardwolf.com/wiki/index.php/Clients/GMCP)

This foundation does not migrate older plugin suites, provide a mapper or
automate gameplay. Consumers must not send `Core.Supports.Set` themselves.
