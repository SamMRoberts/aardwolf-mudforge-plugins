# Aardwolf Atlas 0.3.0

Atlas is a standalone, read-only explorer for MudForge's native map. It combines
an overhead view, orbitable 3D terrain slabs, floor selection, an exploded floor
stack, room inspection, search, and native route previews. It needs no API Core,
SQLite helper, File System Access, MUD connection, or runtime asset downloads.

Install `dist/plugins/aardwolf-atlas.lua` through MudForge's Plugin Manager. The
source Lua file is a build template and is not an installable renderer. Open the
world's map first if MudForge has not loaded it; Atlas waits for native map
readiness. The first panel is 900 × 640 pixels. MudForge preserves subsequent
placement, docking, size, and closure. The compact header and toolbar use about
66 pixels at the default panel width. Below 600 pixels wide, docked inspection
moves beneath the map. No room details take map space until a room is selected.

## Controls

| Control | Behavior |
| --- | --- |
| Overhead | North-up orthographic camera; drag to pan |
| 3D | Perspective camera; left-drag to pan; right-drag to orbit |
| Wheel / pinch | Zoom |
| Fit area | Frame the current floor/stack and pause following |
| Reset / Isometric | Reset the camera to its default overhead/isometric placement |
| Follow player | Resume centering on the player's native area and floor |
| Area / Floor | Browse mapped rooms; manual browsing pauses following until the character enters a new area |
| Explode floors | Separate all floors vertically in 3D |
| Gear | Open or raise the floating Atlas Settings window |
| Background click | Clear selection, room details, collision choices, and route preview |
| Room search | Search the loaded area by room ID or name, including unpositioned rooms |
| Room selection | Inspect native metadata and preview a route; never walk |
| Arrow keys, + / − | Pan and zoom when the map canvas has keyboard focus |

Type `awatlas` or `awatlas show` to reopen a closed panel, `awatlas hide` to close
it, and `awatlas native` to open its read-only native mapper companion. The
companion's `interactive=false` setting disables click-to-walk. If WebGL is
unavailable, the panel offers this companion and explains the rendering failure.

Entering a new character area always switches Atlas to that area and floor and
resumes Follow, including after manual panning, zooming or area browsing. Moving
within the same area keeps manual browsing paused. A temporary unknown location
does not count as leaving or entering an area. Opening Atlas with a known mapped
character location starts following that character.

Only the first positioned area is fitted automatically. Later area changes,
including manual area selection and returning with Follow, preserve orthographic
world scale or 3D camera distance and orientation. The map recenters on the
character when following, or the browsed area's bounds otherwise. Use Fit to
frame a new area, or the usual zoom/Reset controls to change scale.

Connections use wide, bright strokes with dark contrast outlines and larger
arrowheads kept clear of room artwork. Ordinary exits are light gray; custom
exits are violet. Open doors have jambs and an open leaf; closed doors use a bar;
locked doors use a bar and padlock. Their indicator colors and visibility are
configurable in Settings. Independent room and exit routing locks retain their
red padlocks regardless of door-indicator settings. Door states and routing locks
remain separate native metadata; Atlas does not infer or change either. Route
previews, player and selection overlays retain priority above connection marks.

## Settings and room details

The gear opens a separate **Atlas Settings** MudForge widget. Changes save
immediately in this plugin's current world; a failed save restores the prior
values and displays an error. Existing Atlas preferences migrate automatically.

| Setting | Default | Behavior |
| --- | --- | --- |
| Show room vnums | On | Show numeric tile labels when space allows. Symbols remain visible when off; search, details, routes and status keep their room numbers. |
| North always on top | Off | Lock 3D heading north-up while allowing tilt above the horizon, pan and zoom. Fit, reset, isometric and view changes retain the lock. Overhead is always north-up. |
| Float room details | Off | Move selected-room details and route preview into a separate **Atlas Room Details** widget. |

The **Exit indicators** section gives each indicator an independent visibility
checkbox and color picker. All five are enabled by default:

| Indicator | Default color | Appearance |
| --- | --- | --- |
| Doors | Amber `#ffd166` | Open-door jambs and leaf, or a closed-door bar; one color for both states. |
| Locked doors | Coral `#ff997d` | Bar and padlock, controlled independently of ordinary doors. |
| Up exits | Green `#87edbd` | Upward arrow for `u` or `up` exits. |
| Down exits | Blue `#80bfff` | Downward arrow for `d` or `down` exits. |
| Area exits | Violet `#c9a1ff` | Outward arrow when the destination's native area differs from the source area, including custom exits. |

Up/down and area symbols appear at the source exit even when the full connection
is visible. They also mark exits to other floors, other areas, or destinations
without coordinates. Doors retain their connection marks when a connection is
drawn and use source-side marks otherwise. Overlapping indicator types are
offset so a door, vertical arrow, and area arrow can appear together. Hidden and
unresolved destinations receive no exit indicators; independent routing-lock
marks keep their existing behavior. Vertical arrows follow the exit's direction,
not the relative room coordinates.

Color and visibility changes redraw immediately, preserve the camera, selection,
route preview, and Follow state, and save per world with the other preferences.
Existing saves acquire the new defaults automatically. A failed save restores
the previous values in the map and Settings window. The initial Settings window
is 340 × 520 pixels, with scrolling available in smaller saved window sizes.

Search stays in the toolbar whether or not a room is selected. Select with a
primary click, a search result, or an overlap choice. A primary background click
clears selection and route output; dragging or right-clicking does not select or
deselect rooms. Closing the floating details window also clears selection, while
leaving floating mode enabled for the next selection. **Dock in Atlas** returns
that window's content to the sidebar without losing the selected room or route.

The settings and details widgets can be moved, resized, and docked using normal
MudForge controls. Their placement is remembered independently. Closing Atlas
hides both auxiliary windows; `awatlas show` restores floating details if a room
remains selected. Settings reopens only from the gear. Reloading clears transient
selection but preserves display preferences. Delayed room/route responses cannot
reopen details after deselection.

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
in MudForge. View/follow/exploded/inspector and display preferences use world-local plugin
`saveTable`; no map copy is persisted.

The Lua adapter waits for `onMapReady`, reads native area lists and room metadata,
and observes `onRoomChange`/`onMapUpdate`. A version-1 handshake precedes messages.
The map widget owns selection and route state; the adapter relays its snapshot
to a lightweight details document. Separate role-bound handshakes initialize
settings and details without creating additional WebGL renderers. The widget pulls chunks of at most 128 room IDs, with a serialized payload budget
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

The 0.2.1 terrain artwork lifts shadow detail and strengthens major material
edges so rooms remain easier to distinguish at small map sizes. The original
source sheets are retained alongside the enhanced masters. All 114 terrain
identities, tile rectangles, and native color/symbol overrides remain unchanged.

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

## Indicator verification (0.3.0)

The automated suite passes 282 JavaScript tests and 25 Python tests, including
82 focused Atlas adapter, settings and renderer tests. Browser checks exercised
all five visibility controls, custom color synchronization, overhead and exploded
3D rendering, a 280-pixel-wide scrolling settings frame, and the 10,000-room
preview. A temporary browser fixture used the built documents with a synthetic
widget bridge; this is separate from native persistence evidence. The iframe
fixture also exposed an Electron-injected MutationObserver exception outside the
Atlas source; the standalone map preview had no console errors.

Native 0.3.0 acceptance remains **pending**. On MudForge 2.0.3701 arm64, a separate
loopback-only world imported successfully, but the plugin-file Import action
returned without creating an installed plugin, including a retry with an
identical temporary copy. Native loading, rendering, color controls and persisted
reload behavior could therefore not be verified. The test session was closed,
the original connected session was restored, and the exported disposable world
was retained rather than permanently deleted. The play-world plugin was not
updated. Earlier acceptance records below apply only to the versions they name.

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

## Recorded 0.1.0 verification — 2026-10-18

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

## 0.2.0 verification — 2026-10-18

The repository suite passes **246 JavaScript tests and 25 Python tests**. Build
checks verify all 245 generated artifacts and catalog integrity; the standalone
Lua plugin is approximately 3.2 MiB, below the 5 MiB limit. Browser checks at
900 × 640 and 390 × 700 verified search and keyboard selection, actual primary
room/background clicks, right-click retention, settings window reuse, vnum
hiding with symbols retained, heading-lock controls, floating details with route
output, docking, and close-to-deselect. Header plus toolbar measured 66 pixels at
900 pixels wide; the narrow controls had no horizontal overflow. Screenshots
were inspected and no application errors were observed; the preview server's
unrelated favicon request returned 404.

Focused tests additionally exercise real Three.js mouse controls and raycasts,
heading constraints across camera operations, pointer cancellation, preference
migration and rollback, native-array normalization, independent readiness,
role/session fencing, selection-close and route-refresh races, cleanup and
world isolation.

New-version native acceptance is **pending**. Installed MudForge 2.0.3701 arm64
was displaying an active connected play session. The computer-use guard refused
two attempts to open the session selector because the user changed the app.
No plugin was imported and no native settings, connections, or world files were
changed. The earlier 0.1.0 native evidence above does not validate 0.2.0.

Still required in disposable disconnected worlds: native floating-window
creation/placement/docking, reload and saved preferences, hide/show, actual mouse
controls, two-world isolation, and before/after native map-export comparisons.
Contract fixtures verify these adapter paths but do not prove native persistence
or rendering. Browser preview windows are browser popups, not MudForge widgets.

## 0.2.1 artwork verification — 2026-10-18

All six runtime terrain sheets were rebuilt from enhanced Imagegen masters.
The edit preserves the original sheet order and terrain subjects while lifting
shadow detail, strengthening feature boundaries, and reducing fine texture
noise. Crops were visually reviewed before producing the same 128 × 128 runtime
tiles. Original source PNGs remain unchanged. Prompt provenance and source paths
are recorded in [the artwork README](../src/atlas/assets/README.md).

Native acceptance for this artwork update has not been performed. Earlier
0.1.0 native results and 0.2.0 contract/browser results do not establish native
rendering of these new sheets.

The full suite passed 246 JavaScript tests and 25 Python tests, including
deterministic crop reproduction, all 114 terrain mappings, JPEG fidelity, and
catalog integrity. `npm run build:check` checked 245 generated artifacts and
`git diff --check` passed. The installable plugin is 3,883,301 bytes (about
3.7 MiB), below the 5 MiB catalog limit. Browser review compared the same
900 × 640 camera before/after, exercised all 114 enhanced terrains in overhead
and perspective views, selected-room artwork, and a 390 × 700 layout. Original
source PNGs, terrain IDs/rectangles, map packs, and renderer behavior are unchanged.

## 0.2.2 verification — 2026-10-18

Focused regression tests reproduce the previous paused-follow area-change bug
and automatic refitting, then verify forced following on area entry, manual
browsing within an area, unknown locations, unassigned areas, rapid transitions
and stale chunks. Real Three.js camera tests cover unchanged orthographic scale
and perspective distance/orientation when recentering between differently sized
areas. Geometry tests cover bidirectional/vertical lanes, door states, room/exit
locks, bounded draw layers, picking, overlay order and resource disposal.

The full suite passed 258 JavaScript tests and 25 Python tests. Deterministic
build verification checked 245 artifacts; `git diff --check` passed. The
installable plugin is 3,909,007 bytes, below the 5 MiB limit.

Browser checks exercised synthetic area transitions, resumed following, floor
changes and same-area manual browsing. Projected room spacing stayed identical
through area round trips: 103.551 pixels overhead and 147.229 pixels in 3D.
Visual review covered connection/door/lock marks in both views, a 900 × 640
layout and a 390 × 700 layout with no horizontal control overflow. The
10,000-room fixture rendered without a failure overlay or console errors.

Native/live character traversal has not been exercised for this version; browser
fixtures and injected host contracts do not establish live MudForge acceptance.
No native map writes, walking, connection changes or play-world installation
were performed.
