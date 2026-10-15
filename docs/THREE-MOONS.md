# Andolor: Three Moons

A separate Aardwolf map pack, version **1.1.0**, with all **114 terrain styles**.
It combines Aardwolf's world with the requested colorful, ethereal fantasy look:
moonlit slate, warm gold, pale jade, opal blue, copper sand and violet magic.

- [Importable pack](../dist/map-packs/aardwolf-three-moons.json)
- [Labeled contact sheet](../dist/map-packs/aardwolf-three-moons.html)
- [Connected map study](../dist/map-packs/aardwolf-three-moons-map-preview.png)
- [Editable SVG artwork](../src/map-packs/aardwolf-three-moons/icons/)
- [Registry and palette](../src/map-packs/aardwolf-three-moons/terrains.json)

The previous [Terrain Icons pack](TERRAIN-ICONS.md) remains available alongside
this one. The plugin catalog and game integrations are unchanged.

## Research and interpretation

Researched **2026-10-15** using official Aardwolf pages and its hosted AardWiki.
These references informed the artwork; the drawings are original interpretations,
not official assets or exact depictions of particular rooms.

| Evidence | Art direction |
| --- | --- |
| [World lore](https://aardwolf.com/wiki/index.php/Help/World) describes Mesolar's cities, Abend's twilight, and the southern Iridian sea. | Slate-and-gold streets, violet cave stone, and blue water with opal highlights. |
| [Aylor](https://aardwolf.com/wiki/index.php/Area/TheGrandCityOfAylor) is a home and travel hub with shops, guilds, an alchemist and a library. | Shop counters, potion shelves, amber lanterns and a welcoming urban palette. |
| The [Aardwolf introduction](https://www.aardwolf.com/) identifies the Aylorian Academy as the starting adventure. | The `mudschool` terrain gets a classroom with a chalkboard, lectern and student desks. |
| [Moons](https://aardwolf.com/wiki/index.php/Mechanics/Moons) identifies white, grey and black moons associated with magic and alignment. | Those three actual colors appear in the moon tile and sanctuary/city mosaics. Cyan and gold are accent light, not additional moon colors. |
| [Alagh](https://aardwolf.com/wiki/index.php/Area/AlaghTheBloodLands) includes old battlefields, the Eastern Desert and southern jungles. | Copper earth, rose-gold dunes and deep jade vegetation. |
| [Gelidus](https://aardwolf.com/wiki/index.php/Area/Gelidus) has frozen terrain and icy mountains. | Fractured blue ice, pale crystal ridges and silver highlights. |
| [The Planes](https://www.aardwolf.com/wiki/index.php/Help/ThePlanes) connects varied planes through the Astral Plane. | Luminous arches, astral pools, violet spirals and distinct supernatural terrain. |

The older World helpfile and newer [Weather help](https://aardwolf.com/wiki/index.php/Help/Weather)
differ about seasons. This pack makes no season or climate simulation claim.

Region names describe **visual inspiration**. MudForge matches styles by terrain
name, so an ice room anywhere receives the ice design. The pack cannot detect a
continent, alignment, active moon, quest, danger level or actual lighting. The
preview layouts are invented studies, not navigable maps of Aylor or other areas.
Moon patterns are decoration and do not report current game conditions.

## Personal design brief

The strongest preferences came directly from this conversation: vivid fantasy
color, an ethereal mood, a modern game feel, and rooms that connect visually.
The user's established preference for compact, readable tooling also favors
clear terrain shapes and quiet room centers beneath player markers and flags.

The pack therefore uses richer effects on landmarks, with calmer streets and
floors between them. Shop interiors, portals, classrooms, crystals and the three
moons have distinct arrangements. Roads retain directional junction shapes, and
numbered terrain variants retain distinct scenery. Gold guides the eye
without placing an emblem or bright frame on every room. No preferred class,
alignment or clan is assumed.

## Location interiors in 1.1.0

Twenty indoor location types now depict the space occupied by the player from
above, replacing roof/exterior symbols and isolated landmark icons:

- `castle`: slate hall, royal runner, columns, masonry and hanging banners.
- `shop` and `lottery`: counters, merchandise, shelves and clerk furnishings.
- `temple`: altar, candles, pews and a three-moon floor mosaic.
- `mudschool`: chalkboard, lectern and student desks.
- `office`, `archive`, `bookshelves` and `bookshelves_ns`: desks, documents and
  book stacks, with the named shelf orientations preserved.
- `inside`, `hallway`, `palace_room` and `redcarpet`: furnished rooms, corridors
  and decorated interior floors.
- `hut` and `cabin`: timber floors, sleeping areas and hearths. The hut has a
  bedroll and clay firepit; the cabin has a bed, bookcase and dining table.
- `crypt` and `dungeon`: sarcophagus, ironwork, shackles and interior masonry.
- `insideice`, `hellinside` and `hellhall`: furnished chambers using ice or
  infernal materials.

The palette and open space between furnishings keep room overlays legible.
These are terrain-based interior illustrations, not surveyed room furniture or
actual exit/wall positions. Natural and outdoor terrain designs are unchanged.
The connected preview includes a castle/palace cluster and six interior samples.

## Import, compare and restore

1. In the intended world, open **Map settings → General → Map Pack Management**.
2. Use **Export Pack** to back up your current styles. For a complete map backup,
   export the world with **Map Data** included.
3. Use **Choose File...** to select `aardwolf-three-moons.json`.
4. To compare with the previous design, import `aardwolf-terrain-icons.json`.
   To restore your own styles, import the backup from step 2.

**Pack import replaces the entire terrain-style list rather than merging it.**
Custom styles missing from the chosen pack are removed. This behavior was
observed with the original pack in browser client v2.0.3702; this new pack uses
the same structure. It has not been installed into the active map by this task.
Native import, rendering and persistence of Three Moons remain unverified.

Per-room colors can hide artwork; symbols, flags, walls and player markers are
client overlays. A pack cannot restyle them. Matching edge colors apply within
material families; different materials still have visible boundaries.

## Sources, builds and verification

The checked-in registry retains all 112 environments from Aardwolf client database
revision `ac6e40ff5596e285cfcef6739d1dfdc257cfa162`, plus `default` and `water`.
Names use lowercase normalization, including `mudschool`. Coverage does not assert
that no newer live-server terrains exist.

Each SVG is independently editable on a 32-unit grid, with paths, gradients and
material patterns. PNGs render at **128 × 128** using the existing pinned
`@resvg/resvg-js` **2.6.2**. There are no font glyphs, external images or network
requirements. Normal builds read the checked-in SVG sources directly.

```sh
npm run build
node --test tests/map-pack.test.mjs tests/distribution.test.mjs
npm test
npm run build:check
git diff --check
```

Both packs participate in deterministic builds. Tests cover registry coverage,
normalized unique keys, valid colors, unique image and geometry hashes, PNG
sizes, fully opaque pixels, matching material edges, embedded previews and
byte-identical rebuilds. A cross-pack check confirms that every Three Moons
image differs from the previous pack while retaining the same terrain keys.
The importable JSON still contains only `name`, `description` and `terrainStyles`.

Visual review uses all 114 tiles at 16, 24 and 32 pixels on both light and dark
backgrounds, together with the connected-layout PNG. These are offline renders;
no new native-client acceptance or browser import evidence is claimed.

Validation for this revision passed: **19 focused pack/distribution checks**,
**184 JavaScript tests and 21 Python tests** in the full suite, the deterministic
check of **241 generated files**, and `git diff --check`. The 20 revised interiors
were visually inspected at 128 pixels and at 16, 24 and 32 pixels on both
backgrounds; automated coverage checks all 114 designs.
