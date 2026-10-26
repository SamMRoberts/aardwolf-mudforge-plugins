# Aardwolf Terrain Icons

Version **4.2.1** contains **117 terrain styles**: all 112 environments in the
published Aardwolf client database, MudForge's `default` and `water`, and three
named shop styles for manual assignment. The standard `shop` style also has
**three generic furniture variants**. The 114 base styles use Atlas's hand-painted terrain
artwork, exported from its normalized lossless sheets as individual 128 × 128
PNGs. These depict terrain types rather than specific rooms. Each PNG is embedded
directly in the JSON; no image hosting, Atlas plugin, API Core, SQLite helper,
or live connection is needed. The existing pack name, filename, terrain keys,
fallback colors and import structure are preserved. The separate Three Moons
pack keeps its SVG artwork.

The original shop alternates with three **generic shop layouts**. They share
warm horizontal timber flooring and differ in furniture appearance, placement,
size and shape: angular counters (`shop-counter`), rounded displays
(`shop-display`) and narrow shelves (`shop-shelves`). All three retain clear
floor aisles to the north, east, south and west edge midpoints.

The preserved vendor artwork is included in the JSON as three **named terrain
styles for manual assignment**: `shop-merchant`, `shop-apothecary` and
`shop-smith`. Each has its own embedded PNG and the base shop fallback color.
None has a `variants` array or appears in another terrain's automatic slots.
The standalone PNGs are also retained. This update does not assign any rooms.

The client's `variants` array selects by the last decimal digit of the room
number: 0, 4 and 8 use the original; 1, 5 and 9 use angular counters; 2 and 6 use
rounded displays; 3 and 7 use narrow shelves. The same room keeps the same image
across reloads. Empty slots fall back to the original image, which also remains
available to clients without variant support. Other terrain images, keys and
fallback colors are preserved; no room data needs editing.

- [Importable JSON pack](../dist/map-packs/aardwolf-terrain-icons.json)
- [Contact sheet](../dist/map-packs/aardwolf-terrain-icons.html): open the downloaded HTML in a browser for labeled 16, 24 and 32 px samples on dark and light backgrounds, including the generic shop variants, an original/varied comparison and the three manual images
- [Connected map preview](../dist/map-packs/aardwolf-terrain-icons-map-preview.png): town, woodland/river and dungeon studies, plus six biome swatches, with simulated client walls
- [Individual PNGs](../dist/map-packs/aardwolf-terrain-icons/)
- Manual artwork: [merchant](../dist/map-packs/aardwolf-terrain-icons/shop-merchant.png), [apothecary](../dist/map-packs/aardwolf-terrain-icons/shop-apothecary.png), [smith](../dist/map-packs/aardwolf-terrain-icons/shop-smith.png)
- [Atlas artwork and provenance](../src/atlas/assets/README.md)
- [Atlas terrain rectangles](../src/atlas/assets/manifest.json)
- [Shop variant sources and prompts](../src/map-packs/aardwolf-terrain-icons/variants/README.md)
- [Registry, palette and provenance](../src/map-packs/aardwolf-terrain-icons/terrains.json)

## Import and restore

1. Open the intended world's **Map settings → General**. At **Map Pack
   Management**, choose **Export Pack** to save your current terrain styles.
   Also export the world with **Map Data** included if you want a full backup.
2. Choose **Choose File...** under **Map Pack Management** and select
   `aardwolf-terrain-icons.json`. This is a terrain pack; use this control rather
   than **Import Map Data** or the Plugin Manager.
3. The images and palette apply immediately. Close the settings popover to inspect
   the map. Reopen the world to check that the styles persisted.
4. To restore your previous styles, use the same **Choose File...** control with
   the pack saved in step 1.

**Pack import replaces the entire terrain-style list.** It does not merge by
terrain name. Custom styles absent from this pack are removed. Matching terrain
colors and images are replaced by this pack's palette and icons. Keep your export
if you want to restore those customizations. This replacement behavior was
verified with the 1.0.0 pack in the browser client v2.0.3702. The 4.2.1 pack keeps
the same terrain keys and adds the optional `variants` field on `shop`. Native
acceptance of the new artwork is pending; this task does not install it into the active map.

Terrain keys are lowercase, matching MudForge's protocol terrain normalization;
the registry's `Mudschool` entry is emitted as `mudschool`. Unknown future terrain
names have no dedicated icon until the registry/artwork is extended. Per-room
color overrides can hide terrain artwork, and symbols and flags can cover parts
of a tile. MudForge draws its walls, room outlines, player markers and other
overlays above the terrain image. A terrain pack cannot remove or restyle those
client overlays. Atlas artwork is not guaranteed to tile seamlessly; adjacent
images can have visible joins even within one material family. Tiny map zoom
levels lose scenery detail. The contact sheet shows both individual tiles and
connected room layouts to help judge those joins at actual room sizes.

## Source and build

The registry is pinned to the `environments` table in the [official Aardwolf
client database at revision ac6e40ff](https://github.com/fiendish/aardwolfclientpackage/blob/ac6e40ff5596e285cfcef6739d1dfdc257cfa162/MUSHclient/Aardwolf.db).
Its complete revision, original database SHA-256 and count are recorded in
`terrains.json`. Builds read this checked-in registry, Atlas's manifest and its
six normalized lossless PNG sheets and six checked-in shop masters (three
generic automatic variants and three vendor-specific manual images),
without network access or personal maps.
This covers the published registry, not an independently verified current
live-server sector list. The artwork was generated and reviewed for Atlas;
[its README](../src/atlas/assets/README.md) records the prompts and enhancement
process. No upstream artwork or implementation code is included.

`tools/build-map-pack.mjs` matches each terrain by normalized name and validates
its ID, sheet and rectangle against the registry before cropping. It uses the
PNG companion of each Atlas runtime JPEG sheet to avoid additional compression
loss. Update the Atlas artwork through `tools/build-atlas-art.mjs`, then run the
repository build to refresh the map pack. The former SVGs under this pack's
`icons/` directory and their registry motifs are retained as historical sources;
they no longer supply its exported images. The registry colors still provide
the existing fallbacks. `@resvg/resvg-js` is pinned to **2.6.2** as a
development-only renderer; system fonts are disabled. Consumers need only the
generated JSON file.

Generic and manual masters live in this pack's `variants/` directory and are resampled to
128 × 128 by the same renderer. The builder rejects unsafe or duplicate variant
names, nonsquare or oversized PNGs, and transparent pixels. It embeds the three
generic images in ten selection slots, retaining empty slots for the base image.
The registry's `manualImages` list exports the preserved vendor PNGs and adds
each as a named entry in `terrainStyles`, with no automatic variants. Those PNGs are also shown in the contact sheet
with a manual-assignment label. The ten-slot automatic selection follows the
public client's [room-number selection and import/export source](https://play.mudvault.org/_next/static/chunks/273.7c82974a5122fd4c.js),
inspected on 2026-10-23. Source inspection does not establish native acceptance.

```sh
npm ci
npm run build
node --test tests/map-pack.test.mjs tests/distribution.test.mjs
npm test
npm run build:check
git diff --check
```

The existing repository build now includes the PNGs, pack, and self-contained HTML
preview, including the connected-layout PNG. Its plugin/library catalog and
distributed Lua remain unchanged.
Tests check pinned registry coverage, normalized keys, invalid registry and
Atlas metadata, unique tile pixels, dimensions, opacity, preview coverage and
byte-identical rebuilds. All 114 exported images are compared pixel for pixel
with their corresponding lossless Atlas sheet rectangles. The separate Three
Moons pack retains its SVG geometry and material-edge checks. These checks do
not prove native import or persistence.

## Acceptance evidence

The [versioned acceptance evidence matrix](ACCEPTANCE-EVIDENCE.md) keeps
offline, synthetic-browser, actual browser-client and desktop native results
separate. Historical import results do not validate newer artwork or pack bytes.

### 4.2.1 named vendor terrain styles

The JSON now includes `shop-smith`, `shop-apothecary` and `shop-merchant` as
independent terrain styles, each with its own embedded image and base shop
fallback color. They have no variants and remain excluded from all automatic
variant slots. Their PNGs and the generic shop layouts are unchanged. The pack
contains 117 terrain styles; the separate Three Moons pack retains 114.
All **294 JavaScript tests and 27 Python tests**, the **251** generated-file
checks, and diff whitespace checks passed. Vendor masters and exported PNGs
were verified byte-identical to the preserved artwork.
No room assignments or native import/persistence tests were performed.

### 4.2.0 generic automatic variants and manual artwork

Only the new generic furniture layouts populate the ten `shop.variants` slots.
They share horizontal brown timber flooring with the original shop and keep
the four edge-midpoint exit paths clear. The original merchant, apothecary and
smith source masters and 128 px exports are byte-identical to their 4.1.2
versions. They remain separate manual-use files and are excluded from all
embedded terrain styles. No rooms were assigned or altered.

The original shop and generic variants were visually reviewed side by side at
128, 32, 24 and 16 px. Tests check complete pinned terrain coverage, generic
selection, manual exclusion, preserved manual pixels, invalid metadata/assets,
contact-sheet coverage and deterministic outputs. Native import, rendering and
persistence remain untested; this update does not install the pack into a world.
Verification passed: **294 JavaScript tests and 26 Python tests**, all **251**
generated-file checks, and diff whitespace checks. The 41 focused map-pack and
distribution tests passed before the full suite.

### 4.1.2 distinct shop rooms

The three variants now use different floor materials, palettes, furniture
silhouettes and layouts: bright honey parquet and textiles for the merchant,
jade/ivory ceramic and lavender cabinets for the apothecary, and charcoal
flagstones with steel and orange fire for the smith. All retain open paths
through the center to north, east, south and west edge midpoints.

The edited masters and exported PNGs were visually reviewed at 128, 32, 24 and
16 px beside the original shop. The self-contained contact sheet was rebuilt;
browser inspection of its local-file URL was blocked by the browser URL policy.
All **291 JavaScript tests and 26 Python tests**, **248** generated-file checks,
and diff whitespace checks passed. All 114 original base styles and images
were compared with the previous pack and remain unchanged.
Native import, rendering and persistence remain untested.

### 4.1.1 shop exit clearance

The merchant, apothecary and smith variants now leave open floor at the north,
east, south and west edge midpoints, with continuous aisles through the center.
Counters, shelves and stock have been split or moved to corner areas. The
original shop, other terrain images, colors and variant selection are preserved.

The three edited masters and their 128, 32, 24 and 16 px exports were visually
inspected. All **291 JavaScript tests and 26 Python tests**, **248** generated-file
checks, and diff whitespace checks passed. Native rendering, import and
persistence were not run; this update does not install the pack into a world.

### 4.1.0 shop variations

Three additional shop images accompany the unchanged original. The contact
sheet includes all four shop designs on light and dark backgrounds and an
original/varied 20-room comparison at 32 px. The comparison uses the same ten
slots as the pack. These are illustrative previews, not client captures.
Tests cover variant names and files, dimensions, opacity, source/output pixels,
unique artwork, selection slots, export comparison, and deterministic rebuilds.
Verification passed: **291 JavaScript tests and 26 Python tests**, all **248**
generated-file checks, and diff whitespace checks. The rebuilt PNGs were
visually inspected at 128, 32, 24 and 16 px, and the contact sheet and shop
comparison rendered in the in-app browser.
Native import, rendering and persistence of these variants remain unverified;
the pack has not been installed into an active world.

### 4.0.0 Atlas artwork

All 114 exported terrain images now come from the enhanced Atlas sheets. The
contact sheet and connected-layout PNG use those same images, with simulated
walls. They are illustrative previews, not native-client captures. Existing
1.0.0 import evidence below establishes only the historical format behavior;
native import, rendering and persistence of 4.0.0 remain unverified. This update
does not install the pack into the active world.

Verification passed: **267 JavaScript tests and 25 Python tests**, the generated
file check for all 245 repository outputs, and diff whitespace checks. The
connected-layout PNG was visually inspected. Native acceptance was not run;
this revision was validated through generated assets and offline tests.

### 3.0.0 artwork

This revision overhauls the shapes and materials as well as the palette. Large,
irregular flagstones replace the small brick grid. Forests use overlapping leaf
shapes, layered shadows and directional highlights instead of rounded tree
symbols. Timber has grain and knots; water has depth patches and fine flowing
highlights. Shingled roofs, scalloped market canvas, segmented fountain rims,
faceted rocks, luminous lava and arcane details extend that treatment to scenery.
Directional roads now have visible paving and distinct junction geometry.

The full fantasy palette combines silver limestone, emerald foliage, turquoise
water, golden sand, warm timber, violet magic and orange lava. A narrower plain
perimeter reduces the visible room grid while keeping exact shared edge colors.
The 128-pixel PNG resolution and import format are unchanged from 2.3.0.

The new tiles replace all 114 sources and generated PNGs. Repository checks cover
the same import structure plus fully opaque pixels, exact material-color edges,
and an embedded connected-layout preview. The town study follows the connected
city/shop arrangement from the supplied screenshot. The contact sheet and PNG
study are illustrative renders with simulated walls; they are not evidence of
native-client installation or rendering. Native 3.0.0 acceptance remains pending.
All 114 redesigned tiles were inspected in labeled overviews at 16, 24 and
32 pixels on light and dark backgrounds, together with the rendered connected-map
study. Automated checks cover all **685 preview images** and their embedded PNGs.
A fresh browser check of this revision could not run because the browser tool
blocked the local-file URL; the image-loading and overflow observations from
2.3.0 are not new 3.0.0 browser evidence. **176 JavaScript tests and 21 Python
tests**, the deterministic build check, and diff whitespace checks passed.

### Historical 1.0.0 browser acceptance

Repository checks passed: 174 JavaScript tests, 21 Python tests, the deterministic
build check, and diff whitespace checks. All 114 designs were visually inspected
at 16, 24 and 32 px on dark and light backgrounds; the browser contact sheet
loaded all 684 samples without image failures or horizontal overflow.

Browser **v2.0.3702** was tested in a fresh, isolated profile using a disposable
world with one room per icon plus an unmatched `acceptance-only` sentinel terrain.
The terrain pack imported successfully, displayed map icons, removed the sentinel
style, and retained all 114 embedded images after a page reload. Full world exports
before import and after reload confirmed that all **115 room records and their
exits**, labels/extras, and map settings outside `terrainStyles` were unchanged.
All exported styles exactly matched the generated pack. No public MUD connection
or game command was used. The test world used loopback port 1; the client's initial
connection attempt failed, and the reload restored it disconnected. On the first
fixture reload the client normalized zoom from 1 to 2; the full preservation
comparison passed on a repeated import/reload at the restored zoom of 2.

**Native 1.0.0 acceptance remained pending.** UI automation of the installed
**v2.0.3701** was interrupted twice by activity outside this chat. The icon pack
was not installed into the active Aardwolf map by this task, and no native test
world was created. Browser evidence does not establish macOS WebKit/native
rendering, native importer semantics, or persistence across closing and reopening
the desktop world.

To repeat acceptance in a disposable client/world:

```sh
python3 tools/terrain_acceptance.py make /tmp/terrain-icons-acceptance.mfw
```

Import that world in a **separate disposable session** with Settings and Layout
unchecked. It includes map data only, no plugins or credentials, and a loopback
address. Export the imported world to `before.mfw` **before** importing the pack;
the importer adds visit metadata, so compare client exports rather than comparing
the original fixture to a client export. Import the terrain pack, inspect icons,
close/reopen the disposable world, then export it to `after.mfw` and run:

```sh
python3 tools/terrain_acceptance.py compare before.mfw after.mfw
```

The comparison rejects any changed room record/exit, labels/extras, unrelated map
setting, missing icon, or style mismatch. Inspect the unmatched sentinel style to
confirm replacement behavior on the tested version. Restore the previously
selected world and remove only test resources after native acceptance. Do not use
the active Aardwolf world as the acceptance target.
