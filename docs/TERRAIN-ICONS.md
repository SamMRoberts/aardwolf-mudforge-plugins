# Aardwolf Terrain Icons

Version **1.0.0** contains **114 original pictograms** with a coordinated palette:
all 112 environments in the published Aardwolf client database, plus MudForge's
`default` and `water`. Every terrain has distinct geometry, including numbered
variants and directional roads. Icons use a 32-unit SVG grid and ship as 64 × 64
PNGs embedded directly in the pack. No image hosting, fonts, Lua plugin, API Core,
SQLite helper, or live connection is needed to use the images.

- [Importable JSON pack](../dist/map-packs/aardwolf-terrain-icons.json)
- [Contact sheet](../dist/map-packs/aardwolf-terrain-icons.html): open the downloaded HTML in a browser for labeled 16, 24 and 32 px samples on dark and light backgrounds
- [Individual PNGs](../dist/map-packs/aardwolf-terrain-icons/)
- [Editable SVGs](../src/map-packs/aardwolf-terrain-icons/icons/)
- [Registry, palette and provenance](../src/map-packs/aardwolf-terrain-icons/terrains.json)

## Import and restore

1. Open the intended world's **Map settings → General**. At **Map Pack
   Management**, choose **Export Pack** to save your current terrain styles.
   Also export the world with **Map Data** included if you want a full backup.
2. Choose **Choose File...** under **Map Pack Management** and select
   `aardwolf-terrain-icons.json`. This is a terrain pack; use this control rather
   than **Import Map Data** or the Plugin Manager.
3. The icons and palette apply immediately. Close the settings popover to inspect
   the map. Reopen the world to check that the styles persisted.
4. To restore your previous styles, use the same **Choose File...** control with
   the pack saved in step 1.

**Pack import replaces the entire terrain-style list.** It does not merge by
terrain name. Custom styles absent from this pack are removed. Matching terrain
colors and images are replaced by this pack's palette and icons. Keep your export
if you want to restore those customizations. This replacement behavior was
verified in the browser client v2.0.3702; native v2.0.3701 acceptance is pending.

Terrain keys are lowercase, matching MudForge's protocol terrain normalization;
the registry's `Mudschool` entry is emitted as `mudschool`. Unknown future terrain
names have no dedicated icon until the registry/artwork is extended. Per-room
color overrides can hide terrain artwork, and symbols and flags can cover parts
of an icon. Tiny map zoom levels necessarily lose detail; the contact sheet shows
the intended small-size appearance.

## Source and build

The registry is pinned to the `environments` table in the [official Aardwolf
client database at revision ac6e40ff](https://github.com/fiendish/aardwolfclientpackage/blob/ac6e40ff5596e285cfcef6739d1dfdc257cfa162/MUSHclient/Aardwolf.db).
Its complete revision, original database SHA-256 and count are recorded in
`terrains.json`. Builds read this checked-in registry and the SVG files, without
network access or personal maps. This covers the published registry, not an
independently verified current live-server sector list. The artwork is original;
no upstream artwork or implementation code is included.

Edit an individual SVG and its registry color/motif together. Each SVG has an
opaque background matching its `color`, simple paths/shapes, and no text glyphs,
external resources or scripts. Keep numbered variants geometrically distinct.
`@resvg/resvg-js` is pinned to **2.6.2** as a development-only renderer; system
fonts are disabled. Consumers need only the generated JSON file.

```sh
npm ci
npm run build
node --test tests/map-pack.test.mjs tests/distribution.test.mjs
npm test
npm run build:check
git diff --check
```

The existing repository build now includes the PNGs, pack, and self-contained HTML
preview. Its plugin/library catalog and distributed Lua remain unchanged.
Tests check pinned registry coverage, normalized keys, invalid registry entries,
unique geometric designs and PNG hashes, dimensions, preview coverage, and
byte-identical rebuilds. These checks do not prove native import or persistence.

## Acceptance evidence

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

**Native acceptance remains pending.** UI automation of the installed
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
