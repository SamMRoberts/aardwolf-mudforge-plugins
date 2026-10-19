# Aardwolf Terrain Icons

Version **4.1.0** contains **114 room terrain images from Aardwolf Atlas**
and **two additional timber-floor variants for `inside` rooms**:
all 112 environments in the published Aardwolf client database, plus MudForge's
`default` and `water`. The pack uses Atlas's enhanced, hand-painted terrain
artwork, exported from its normalized lossless sheets as individual 128 × 128
PNGs. These depict terrain types rather than specific rooms. Each PNG is embedded
directly in the JSON; no image hosting, Atlas plugin, API Core, SQLite helper,
or live connection is needed. The existing pack name, filename, terrain keys,
fallback colors and import structure are preserved. The separate Three Moons
pack keeps its SVG artwork.

The original `inside` floor now alternates with broad staggered planks and
herringbone parquet, using MudForge's `variants` image array. Selection is stable
by room number: its last decimal digit selects one of ten slots. Digits 0, 3, 6
and 9 use the original; 1, 4 and 7 use broad planks; 2, 5 and 8 use parquet.
Actual proportions depend on the area's room numbers. Empty variant slots fall
back to the original image; clients without variant support still have that
base image. Other indoor terrain types, all terrain names and fallback colors
are unchanged. No room data needs to be edited.

- [Importable JSON pack](../dist/map-packs/aardwolf-terrain-icons.json)
- [Contact sheet](../dist/map-packs/aardwolf-terrain-icons.html): labeled 16, 24 and 32 px samples on dark and light backgrounds, plus an original/varied interior comparison
- [Connected map preview](../dist/map-packs/aardwolf-terrain-icons-map-preview.png): town, woodland/river and dungeon studies, plus six biome swatches, with simulated client walls
- [Individual PNGs](../dist/map-packs/aardwolf-terrain-icons/)
- [Atlas artwork and provenance](../src/atlas/assets/README.md)
- [Atlas terrain rectangles](../src/atlas/assets/manifest.json)
- [Registry, palette and provenance](../src/map-packs/aardwolf-terrain-icons/terrains.json)
- [Interior variant sources and prompts](../src/map-packs/aardwolf-terrain-icons/variants/README.md)

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
verified with the 1.0.0 pack in the browser client v2.0.3702. The 4.0.0 pack keeps
the same terrain keys and base import format; 4.1.0 adds the optional `variants`
field on `inside`. Native acceptance of the new artwork
is pending; this task does not install it into the active map.

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
six normalized lossless PNG sheets, plus the two checked-in interior variant
PNGs, without network access or personal maps.
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

Variant masters live in this pack's `variants/` directory and are resampled to
128 × 128 by the same pinned renderer. The builder rejects unsafe or duplicate
variant names, nonsquare/oversized PNGs and transparent variant pixels. It embeds
the two images in ten selection slots under `inside`, with empty slots for the
base-image fallback. This follows the public client's
[room-number variant selection](https://play.mudvault.org/_next/static/chunks/1368.6d48732e73a20a4f.js)
observed on 2026-10-19. Import/export preservation and image preloading were
inspected in that code; this is source evidence, not native acceptance.

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

The two additional PNGs are tested for unique opaque pixels, source/rendered
image agreement, embedded image equality and the exact ten-slot selection
pattern. The contact sheet includes all 116 images and a 24-room comparison.

## Acceptance evidence

### 4.1.0 interior variants

The two new timber floors were generated with the built-in Imagegen tool and
reviewed against the original floor. All 114 base images and the separate Three
Moons outputs remain unchanged. The original and new floors were visually
inspected at 16, 24, 32, 64 and 128 pixels and in repeated interior layouts.
Verification passed: **289 JavaScript tests and 26 Python tests**, the
deterministic check for all **247** generated repository files, and whitespace
checks. Native import, room-number variant rendering
and persistence have not been tested for this revision. The pack is not
installed into the active world by this update.

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
