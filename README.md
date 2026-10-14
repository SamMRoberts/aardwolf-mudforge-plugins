# aardwolf-mudforge-plugins

A shared Lua API and Aardwolf plugins for [MudForge](https://mudforge.org/).
The **0.2.0** library provides a session Core, an injected library facade, storage
and widget helpers, a small reactive vitals example, and a configurable vitals HUD.
It also supports writable local SQLite through an optional Python helper and
file bridge. See [SQLite setup and API](docs/SQLITE.md). Existing plugins retain
their versions; the SQLite helper requires Python 3.11+, File System Access and
a connected session.

| Component | Purpose |
| --- | --- |
| `aardwolf-api` library | Data subscriptions, snapshots, refresh requests, local persistence and consumer-owned UI |
| Aardwolf API Core | One GMCP negotiation owner and one authoritative state cache per session |
| Aardwolf API Vitals Example | HP/mana/moves bindings, an explicit refresh button and saved font-size preferences |
| Aardwolf Vitals | HP/mana/moves, target HP, alignment and character status with floating settings |

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

Aardwolf Vitals **0.1.3** shows **HP, mana and moves** side by side, with labels
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

A second row shows **Target** and **Alignment**, side by side above 480 px and
stacked at narrower widths. A wrapping summary below it shows **Level, TNL,
Hunger, Thirst, State and Position**. These values come from `char.status`;
hunger and thirst are displayed as numbers without assumed units.

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

The **Refresh** circular-arrow icon explicitly requests fresh character GMCP
data through API Core.
Refresh sends no message below the bars. If Core, negotiation or the connection
is unavailable, the reason appears in the Refresh icon's hover text. The plugin
does not automatically send refresh requests.

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
`npm test` also runs Python helper tests against temporary SQLite databases and
a Lua-to-helper integration test through real files; Python 3.11+ is required.

The initial native target is MudForge **2.0.3701**. Native and live-MUD
acceptance remain pending; follow [the separate checklist](docs/NATIVE-ACCEPTANCE.md).
No existing worlds, maps or installed plugins were changed. Aardwolf Vitals
has repository fixture coverage and standalone Chromium layout checks; native
rendering, pulse behavior, keyboard interaction, disk persistence and live GMCP
acceptance remain pending.

`npm audit` currently reports the unpatched moderate `sprintf-js` precision
specifier advisory through Fengari. These are development-only dependencies;
the distributed Lua files contain no Node dependencies. Fixture format strings
are fixed locally. See [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

## References

- [MudForge plugin and library authoring guide](https://mudforge.org/docs/ai-plugin-guide.md)
- [Aardwolf GMCP modules and commands](https://www.aardwolf.com/wiki/index.php/Clients/GMCP)

This foundation does not migrate older plugin suites, provide a mapper or
automate gameplay. Consumers must not send `Core.Supports.Set` themselves.
