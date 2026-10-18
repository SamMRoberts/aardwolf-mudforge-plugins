# Aardwolf Atlas 0.1.0

Atlas is a standalone, read-only explorer for MudForge's native map. It combines
an overhead view, orbitable 3D terrain slabs, floor selection, an exploded floor
stack, room inspection, search, and native route previews. It needs no API Core,
SQLite helper, File System Access, MUD connection, or runtime asset downloads.

Install `dist/plugins/aardwolf-atlas.lua` through MudForge's Plugin Manager. The
source Lua file is a build template and is not an installable renderer. Open the
world's map first if MudForge has not loaded it; Atlas waits for native map
readiness. The first panel is 900 × 640 pixels. MudForge preserves subsequent
placement, docking, size, and closure. Below 600 pixels wide, inspection moves
beneath the map.

## Controls

| Control | Behavior |
| --- | --- |
| Overhead | North-up orthographic camera; drag to pan |
| 3D | Perspective camera; drag to orbit; right-drag to pan |
| Wheel / pinch | Zoom |
| Fit area | Frame the current floor/stack and pause following |
| Reset / Isometric | Reset the camera to its default overhead/isometric placement |
| Follow player | Resume centering on the player's native area and floor |
| Area / Floor | Browse mapped rooms; manual browsing pauses following |
| Explode floors | Separate all floors vertically in 3D |
| Room search | Search the loaded area by room ID or name, including unpositioned rooms |
| Room selection | Inspect native metadata and preview a route; never walk |
| Arrow keys, + / − | Pan and zoom when the map canvas has keyboard focus |

Type `awatlas` or `awatlas show` to reopen a closed panel, `awatlas hide` to close
it, and `awatlas native` to open its read-only native mapper companion. The
companion's `interactive=false` setting disables click-to-walk. If WebGL is
unavailable, the panel offers this companion and explains the rendering failure.

Room selection shows terrain artwork, original terrain value, identity, area,
coordinates, notes, details, exits, doors, flags, locks, weights, and user data.
Overlapping room coordinates open a selection list. Hidden rooms are omitted
from map and search. Rooms without finite XYZ coordinates remain searchable;
Atlas does not invent positions. Native room-color overrides replace map-tile
textures; terrain artwork remains visible in the inspector. Flag color and symbol
use the first defining flag in native room-flag order, matching the native
renderer; room color and room symbol take precedence independently. Flag
definitions refresh on readiness, map invalidation, and explicit `awatlas show`.
Use that command after editing flag definitions if the native client emits no
room update. Structured room details are displayed as inert JSON text, bounded
to 16 KiB with an explicit message for oversized or unserializable values.

Routes use `findPath` with normal native locks and weights. Step count and weighted
cost are separate. Selecting a route step opens its area and floor. A custom exit
is displayed as a direction/command label; Atlas never executes it. Hidden
intermediate route rooms remain unnamed and cannot be selected from the route.

## Assets and architecture

The plugin owns its camera/preferences and display only. Native room IDs, exits,
coordinates, player position, labels, terrain styles, and mapper settings remain
in MudForge. View/follow/exploded/inspector preferences use world-local plugin
`saveTable`; no map copy is persisted.

The Lua adapter waits for `onMapReady`, reads native area lists and room metadata,
and observes `onRoomChange`/`onMapUpdate`. A version-1 handshake precedes messages.
The widget pulls chunks of at most 128 room IDs, with a serialized payload budget
and explicit oversized-record failures. Request generations and map revisions
reject obsolete responses. Inspection metadata and route output also use a
128 KiB budget; oversized results show an explicit error and suggest the native
companion. Routes are never silently truncated or presented as partial successes.
Offline updates need no connected timers. Cleanup
fences callbacks and destroys only Atlas widgets.

Three.js shares room geometry between orthographic and perspective cameras.
Rooms are instanced, connections are batched, textures are cached, and labels
reduce at distant/dense views. Rendering is event-driven and stops while hidden.
Native text is inserted as text, never interpreted as HTML.

Terrain names normalize by trimming and lowercasing, while numeric environment
values resolve through the repository's pinned registry. Numbered/directional
variants remain distinct. Missing/unknown terrain uses `default`; a failed
texture decode uses a neutral fill. Imagery illustrates terrain materials, not
unique room scenery. Assets are embedded in the built plugin and do not replace
the user's imported native terrain pack.

The deterministic build assembles the renderer, pinned Three.js bundle, and local
terrain sheets into the Lua template, then regenerates catalog size and hash.
Run `npm run build`, `npm run build:check`, and `npm test` after changes. The
standalone generated `dist/atlas/aardwolf-atlas.html` uses synthetic preview data;
browser results do not establish native compatibility or live-game acceptance.

## Disposable native acceptance

Generate a world archive without reading or modifying active client storage:

```sh
python3 tools/atlas-acceptance.py make /tmp/atlas-acceptance.mfw
python3 tools/atlas-acceptance.py make /tmp/atlas-acceptance-large.mfw --large
```

Both are named **Atlas Disposable Acceptance** and contain loopback host
`127.0.0.1:1`, `autoConnect=false`, no credentials, no plugins, and no global
settings. Confirm the imported world's connection control remains off; import
UI behavior must be observed separately from the stored auto-connect property.
Do not import these archives into an existing play world. Use the large fixture
as a separate disposable copy after completing the smaller fixture.

The default contains 124 rooms: all 114 terrain keys, an unknown terrain, five
edge cases, and a four-room second area. The large fixture has 10,000 gallery
rooms plus four annex rooms. Sentinel cases:

| IDs | Acceptance scenario |
| --- | --- |
| 10000–10114 | Complete terrain coverage and unknown fallback |
| 10000 / 10118 | Two rooms at identical coordinates |
| 10115 / 10116 | Upper/lower floors, whitespace/case and numeric terrain resolution |
| 10117 | Hidden room |
| 10119 | Missing XYZ coordinates; native importer may assign layout |
| 10001 → 10002 | Directed exit and closed door |
| 10000 → 20000 | Custom portal to another area |
| 20001 | Weight 8; route from 10000 should cost 9 in two steps |
| 20002 / 20003 | Locked room / locked custom exit |
| 10000 | Native color/symbol/flag and literal-markup notes/user-data sentinels |

After import and any native normalization, export a baseline **before enabling
Atlas**. Install the built plugin, exercise both views, dense tiles, floor stack,
search, collision selection, metadata, locked routes, and the native companion.
Check float/dock resizing, small layouts, keyboard controls, hide/reopen,
reload/persistence, offline operation, and two-world isolation. Export again:

```sh
python3 tools/atlas-acceptance.py compare /tmp/atlas-before.mfw /tmp/atlas-after.mfw
```

The comparator also accepts native map JSON exports. It compares all room fields
(including visits/timestamps), settings (including terrain styles), labels,
extras, and mapper state. Only room/label collection ordering and the surrounding
export envelope are excluded. No map field is dismissed as volatile: Atlas does
not own a reason to change one. A baseline exported after import avoids confusing
native import normalization with plugin changes. Report any comparison failure;
do not relax checks merely to obtain a pass.

## Recorded verification — 2026-10-18

Tested on installed MudForge **2.0.3701** in separate, disconnected worlds.
The initial feasibility probe passed WebGL2 rendering, inline Three.js execution,
image decoding, the widget-ready message handshake with a 3 MiB payload, and
resize observation. The full 8.5 MiB development artifact also loaded through
native file import and displayed the complete artwork; this does not establish
catalog download compatibility. The final build enforces the native catalog's
5 MiB download ceiling using deterministic JPEG runtime sheets, retaining PNG
masters and normalized lossless sheets.

Native feature checks observed textured overhead and orbitable perspective views,
individual floors and exploded stacking, area browsing, enlarged terrain
inspection, narrow-panel inspection drawers, and native route results. Forest
room 10003 produced three steps/cost 3. Annex room 20001 produced two steps/cost 9
through the custom portal. Locked room 20002 produced the native rejection.
The importer attempted loopback connection despite the archive's `autoConnect`
setting; it was refused, with zero data sent/received. No game connection was used
by the fixtures.

The large native fixture imported 10,004 records. Atlas loaded 9,999 nonhidden
rooms in its 10,000-room gallery, with 9,996 on floor zero. Overhead and perspective
both rendered; switching to 3D plus fitting and reading UI state took 677 ms via
computer automation. Searching for room 19999 and reading its result took 1,251 ms.
These are end-to-end automation observations, **not frame-time benchmarks**.
Process RSS before/after enabling this large Atlas instance was 219/236 MiB for
MudForge, and 1,343/1,688 MiB for its apparent WebKit content process. The browser
process was not conclusively attributed and had other sessions loaded; these
figures do not isolate Atlas allocations or establish leak freedom.

The standalone browser preview rendered 3D terrain and keyboard-selected room
inspection with no warning/error logs at the time checked. Its routes are fixture
data. Browser evidence and automated adapter/model/build checks do not establish
live Aardwolf acceptance. The final compressed bundle reloaded successfully in both native fixture worlds,
including the 10,000-room gallery. Its size is approximately 1.87 MiB. Native
checks additionally passed overlap selection (10000/10118), keyboard selection,
zero-step/zero-cost routes, readable compact area controls, saved 3D/follow/stack
preferences, docking, and `awatlas hide`, `awatlas show`, and `awatlas native`.
The two worlds retained separate stack preferences and panel placement.

Strict before/after comparisons passed for **both disposable worlds and the
original Aardwolf world**: complete rooms, settings, labels, extras and mapper
state were unchanged. Only export envelopes and collection order were excluded.
The original connected session was restored. Test plugins were disabled and test
sessions closed; the three disposable world files remain available for inspection
and were not permanently deleted. Atlas was not installed into the play world.

The final repository suite passes **223 JavaScript tests and 25 Python tests**;
`npm run build:check` verifies all 243 generated artifacts, and `git diff --check`
passes. Contract tests cover readiness, malformed/stale messages, native array
indexing, missing/overlapping coordinates, custom/directed exits, lock-aware routes,
clearing, texture failures, cleanup, and world isolation. Existing plugin output
bytes are checked unchanged.

Remaining limits: no live Aardwolf traversal/update sequence, forced native GPU
loss, full screen-reader audit, long-duration memory soak, or remote catalog
installation was performed. Native map-update and clearing races are covered by
contract tests rather than destructive UI experiments. The final readiness-prompt
wording correction was verified by its regression test and browser reload. The
catalog has not been published, and no commits or pushes were made.
