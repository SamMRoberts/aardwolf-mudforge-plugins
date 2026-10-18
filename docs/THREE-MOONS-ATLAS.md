# Andolor: Three Moons Atlas

Version **1.0.0** applies the approved **Aylor 0.3.0** style to all **114 terrains**.
It is a separate importable successor; both previous packs and the pilot remain
available unchanged.

- [Importable JSON](../dist/map-packs/aardwolf-three-moons-atlas.json)
- [Labeled contact sheet and layout studies](../dist/map-packs/aardwolf-three-moons-atlas.html)
- [Aylor-inspired urban render](../dist/map-packs/aardwolf-three-moons-atlas-urban.png)
- [Wilderness study](../dist/map-packs/aardwolf-three-moons-atlas-wilderness.png)
- [Interiors study](../dist/map-packs/aardwolf-three-moons-atlas-interiors.png)
- [Editable SVGs](../src/map-packs/aardwolf-three-moons-atlas/icons/)
- [Terrain registry and palette](../src/map-packs/aardwolf-three-moons-atlas/terrains.json)

## Visual direction

The 16 approved pilot SVGs are copied exactly, including their geometry, colors,
texture phase, counter and basin shadows, road connections and neutral moon
inlays. The remaining 98 designs extend the same overhead scale and local depth.
Objects are compact; painted ground dominates the room and connects across cells.

City streets, shops, ordinary stone rooms and dungeon interiors share the pilot's
fine hand-cut slate. Caves use that same slate with small mineral cues. Blood is
a local stain instead of a separate red floor. Wood interiors and the ship deck
share the pilot's fine timber; palace rooms retain its quieter limestone.
Infernal fountains retain the shared slate rather than a separate purple tile.

Natural materials use finer periodic ground with related brightness and restrained
grain. Smaller foliage, rock ridges, waves, cloud silhouettes and magical marks
keep the distinct numbered variants. Jade, violet, amber and gold remain in small
details. Directional gradients, carved edges and compact contact shadows provide
depth without a square vignette or bright tile frame.

Overhead features clarify location: central shop counters, bookcases, writing
surfaces, grave markers, a recessed well, seven stair treads, a ship capstan,
castle heraldry and a volcanic crater. Floors remain visible around furnishings.
Main roads preserve the six exact pilot junctions; minor roads, trails and hall
runners continue through their intended edges.

This is still one static image per terrain. It cannot choose transitions from
neighbors, randomize repeated furnishings, place one landmark across a district,
or infer actual room contents, lighting, danger or moon conditions. Different
materials retain visible boundaries. The [Three Moons research](THREE-MOONS.md#research-and-interpretation)
informs the palette and themes; the drawings are interpretations, not official
assets or exact representations of named rooms.

## Preview

The portable HTML includes every terrain at **16, 24, 32 and 60 px** on light and
dark backgrounds, plus a **3 × 3 repeat** for each. Seven larger studies show:

- The same illustrative Aylor streets, directional roads, alternating shop and
  fountain repetition, and material boundaries used in the pilot.
- Wilderness, water, desert, ice and minor routes.
- Urban interiors, dungeon rooms and the underworld.
- Clouds, weather, white/grey/black moons and astral terrain.

Each layout appears at 32 px and 60 px per room. Together they include every
terrain. Walls, flags, arrows and player markers are simulated client overlays;
these renders are not native-client captures or reconstructed room records.

## Import and restore

1. Open **Map settings → General → Map Pack Management** in the intended world.
2. Use **Export Pack** to save your current terrain styles. For a full map backup,
   export the world with **Map Data** included.
3. Use **Choose File...** to select `aardwolf-three-moons-atlas.json`.
4. To restore your previous appearance, import the exported style backup. The
   unchanged `aardwolf-three-moons.json` also remains available for comparison.

Pack import **replaces the entire terrain-style list** rather than merging it;
custom styles absent from the selected pack are removed. This behavior was
previously observed with the original pack in browser client v2.0.3702. Atlas
uses the same JSON structure, but its native import, matching, rendering and
persistence have **not** been exercised. No active map was modified.

Importing applies the coordinated fallback colors as well as the images.
Per-room colors can cover artwork; walls, symbols, flags and player markers are
drawn by the client and remain independent of these terrain images.

## Build and verification

The source registry remains pinned to Aardwolf database revision
`ac6e40ff5596e285cfcef6739d1dfdc257cfa162`: 112 published terrains plus MudForge's
`default` and `water`. Keys are normalized to lowercase, including `mudschool`.
Coverage makes no claim about later live-server additions.

Normal builds read the 114 checked-in, independently editable SVGs on a 32-unit
grid. The existing pinned `@resvg/resvg-js` 2.6.2 renderer exports opaque
**128 × 128** PNGs, including embedded copies in the importable JSON. Artwork
uses vector shapes and gradients, with no font glyphs, external images or network
requirements. No plugin catalog or import-schema changes are involved.

```sh
npm run build
node --test tests/map-atlas.test.mjs tests/map-pack.test.mjs tests/map-pilot.test.mjs tests/distribution.test.mjs
npm test
npm run build:check
git diff --check
```

Tests cover complete registry coverage, unique keys, geometry and image hashes,
opaque PNGs, dimensions, safe SVG content, deterministic output, exact pilot
retention, identical floors per material family, clear landmark margins,
directional route ports, matched street paint, tile/floor join contrast and
complete preview coverage. Existing pack JSON hashes remain pinned. Floor joins
and non-directional repeats are compared with normal interior texture contrast;
opposing corner ports intentionally differ and are checked by direction instead.

Offline visual review covers all 114 designs at the four sample sizes, repeated
grids and mixed environments. Browser rendering and interaction remain unverified
because local-file browser access is blocked; structural HTML checks and offline
PNG review are separate evidence. Native acceptance and connected gameplay are
also unverified. No import, commit, push or publication is part of this update.
