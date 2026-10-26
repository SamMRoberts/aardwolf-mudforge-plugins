# Andolor: Three Moons

A separate Aardwolf map pack, version **1.3.1**, with all **114 terrain styles**.
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

The pack uses connected floor materials, with sparse terrain cues and clearer
landmarks where needed. Roads retain directional junction shapes, and numbered
variants retain distinct scenery. Gold guides the eye without placing a bright
frame on every room. No preferred class, alignment or clan is assumed.

## Clear shop exits in 1.3.1

The shop now has a compact, freestanding counter in the center of the tile.
Potion bottles, the coin tray and cast shadows remain, with uninterrupted stone
floor around all four sides so no potential exit appears blocked. The other
113 terrain images are unchanged from 1.3.0.

## Material depth in 1.3.0

All 114 tiles now have additional material detail. Stone, cavern and ice slabs
have directional gradients, recessed joints and lit bevels. Raised scenery has
layered cast shadows and shaded surfaces; gold accents have brighter reflections.
Wood grain, carpet fibers, mineral scratches, grass blades and paired ripple
highlights give each surface its own texture. Texture placement varies by terrain.

Lighting follows the individual surfaces rather than framing each square room.
The periodic floor geometry, connected runners, counters and shelf runs are
preserved, as are the distinct road junctions and numbered terrain variants.
These are static illustrated light and shadow, independent of game lighting.

## Shop recognition in 1.2.1

The shop counter is deeper and warmer, with three distinct glass potion bottles
and a gold coin tray. These stronger merchandise cues occupy the counter band,
leaving the walking floor clear and the counter continuous across adjacent shops.
That revision changed only the shop; 1.3.0 adds material depth across the pack.

## Connected surfaces in 1.2.0

The supplied dense-grid screenshot exposed a weakness in 1.1.0: a complete
furnished interior repeated in every room looked like a grid of small dioramas.
Even identical plain border pixels could not make the furniture and framed rugs
flow together. This revision replaces that approach with repeating surfaces.

- Castle and hallway runners extend through the north/south boundaries, with
  quieter inlay and no repeated columns, banners or separate rug end caps.
- Shops and lotteries use thin counter runs and small merchandise accents.
  Library shelving extends across east/west or north/south boundaries.
- Ice chambers and ruins use continuous material, carving and fracture patterns
  without repeated benches, braziers or large ruin-shaped objects.
- Wells have a small water-ring inset; offices, cabins and huts keep compact
  furnishing cues. Palace marble and crimson carpet have dedicated surfaces.
- All 114 terrain backgrounds now paint to the full tile boundary. Periodic
  stone polygons extend across the seam, and wrapped texture geometry replaces
  the inset flat-color strip. The older Terrain Icons pack is unchanged.

The preview reproduces the screenshot's **5 × 5 terrain arrangement**: shops,
castle, ice chambers, wells and ruins. Every contact-sheet card also includes a
**3 × 3 repeat at 32 pixels per room**, in addition to its 16/24/32 px samples.

A terrain pack supplies one static image per terrain. It cannot choose different
furniture based on adjacent rooms or place one counter across an entire area.
These patterns reduce the visual repetition; repeated terrain cues still exist.
They remain interior-themed, without claiming actual furniture or wall positions.
Different materials have visible transitions, and client-drawn walls, symbols
and player markers remain separate from this artwork.

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
client overlays. A pack cannot restyle them. Three Moons uses repeating surfaces that continue across tile edges; different
materials still have visible boundaries. The fallback terrain color is not a
guarantee that every painted border pixel has that same color.

## Sources, builds and verification

See the [versioned acceptance evidence matrix](ACCEPTANCE-EVIDENCE.md) for
artifact hashes, environment details and the limits of historical offline checks.

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
sizes, fully opaque pixels, varied painted edge pixels, join contrast, repeated
contact-sheet previews and byte-identical rebuilds. A cross-pack check confirms that every Three Moons
image differs from the previous pack while retaining the same terrain keys.
The importable JSON still contains only `name`, `description` and `terrainStyles`.

Visual review covers all 114 designs both individually and in 3 × 3 repeats,
plus the dense screenshot arrangement. These are offline renders; native
acceptance of 1.3.1 remains pending. No active map was modified.

The source test for Three Moons now checks painted surfaces at the perimeter,
not a uniform flat border. A join-contrast test checks the screenshot terrains
and the main floor/shelving patterns against their interior texture contrast.
These checks help detect seams; they do not replace visual review.

Validation passed for 1.3.0: **20 focused pack/distribution checks**, **185
JavaScript tests and 21 Python tests**, `build:check` across **241 generated
files**, and `git diff --check`. All 114 PNGs differ from 1.2.1. Every terrain
was visually reviewed in 3 × 3 repeats and at 16/24/32 pixels on light and dark
backgrounds, along with the connected map study. Native import and persistence
were not exercised for this artwork revision.

The same automated checks passed for 1.3.1. The centered shop was reviewed in
the connected map study, in repeats and at small sizes. A pixel comparison
against the bare floor confirms that the counter and its shadows leave a clear
floor margin at every edge. Only the shop PNG changed; native acceptance remains
pending.
