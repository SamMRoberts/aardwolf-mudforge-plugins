# Aylor Map Cohesion Pilot

The approved 0.3.0 artwork now also ships in the separate
[Three Moons Atlas](THREE-MOONS-ATLAS.md), which extends this style to all 114
terrains. This 16-terrain pilot and its fixed comparisons remain unchanged.

A separate **16-terrain visual study**, version **0.3.0**, comparing the current
Three Moons 1.3.1 artwork with a finer overhead environment with restored material
depth, richer color and artistic detail. It is **not an importable pack**.
Both production packs, their artwork and the plugin catalog
remain unchanged.

- [Open the standalone comparison](../dist/map-pilots/aylor-cohesion.html)
- [Current at left, pilot at right](../dist/map-pilots/aylor-cohesion/urban-comparison.png)
- [Frozen 0.2.0 pilot reference](../src/map-pilots/aylor-cohesion/reference/urban-0.2.0.png)
- [Editable SVG artwork](../src/map-pilots/aylor-cohesion/icons/)
- [Terrain manifest](../src/map-pilots/aylor-cohesion/pilot.json)

## Art direction

The **0.3.0** color pass adds about **4 HSL saturation points** to the shared
materials and **8 points** to colored landmark accents, capped at 100%. Hues and
base lightness are preserved, allowing for RGB rounding. White, grey and black
moon gradient colors are unchanged. Gradient highlights gain **2 lightness
points**, and shadow stops lose **2 points**. Existing counter and basin contact
shadows gain **2 opacity points**, without changing their size or spread.

All 16 tiles retain the 0.2.0 geometry, one-third paving scale, texture phase,
lighting direction, road widths and landmark footprints. No whole-room darkening,
halos or colored fountain floors are introduced.

The screenshot made large flagstones, repeated counters, bright flames and
contrasting fountain floors more noticeable than the streets themselves. The
pilot reduces paving to roughly a third of the previous scale and uses the same
slate beneath city streets, alleys, shops, temples, roads and fountains.

The 0.2.0 refinement keeps the first pilot's pulled-back scale and common floor,
while restoring the richer material treatment preferred in Three Moons. The
earlier hand-cut stone geometry is reused at **one-third scale**, with its
directional gradients, recessed joints and lit edges. Timber has shaded boards,
grain and knots; limestone has carved inlays. The same slate surface remains
shared by every urban terrain. Material phase is selected to keep joins quiet.

Compact scenery has layered cast shadows, carved basin rims, recessed water,
glass reflections, wood grain, small coins and brass details. These stay within
the established landmark scale rather than enlarging the furniture. Material
joints remain offset from the room edges; no room-wide light falloff, square
lighting frame or flat-color perimeter is added.

The central shop counter is about 28% of a tile wide, with a tiny merchandise
cluster. Basins are about 22% wide. Gold, jade and violet remain concentrated in
these details. The infernal basin has one small ember accent instead of repeated
large flames and a separate purple ground. At 16 pixels, these cues are small
silhouettes and accents, not detailed depictions of individual merchandise.

All six main road variants keep their existing connections: north–south,
east–west, four-way, northwest, southeast, and east–west–south. Their paving
narrows from 10 to 6 units on the 32-unit artwork grid.

## Review the layouts

The first comparison section shows the **frozen 0.2.0 pilot versus 0.3.0** on the
same urban layout, with identical simulated overlays. Its source PNG is a fixed
review reference, not an external image used in terrain artwork. A geometry
snapshot and layout hash guard against accidental scale, placement or fixture
changes during this color pass.

The production-pack comparisons remain available as identical current/pilot pairs for:

1. An **Aylor-inspired urban arrangement**, including courtyards, streets,
   interiors and landmarks. This is illustrative; it is not a reconstruction
   of actual room records, exits or a navigable Aylor map.
2. **Long streets and junctions**, using all six directional variants.
3. **Alternating shops and infernal fountains**, stressing the repetition
   problem in the supplied screenshot.
4. **Solid material blocks and mixed boundaries**, showing slate, timber,
   limestone and their transitions.

Layout studies default to **32 px rooms**. Select **60 px rooms** to examine the
scale seen in the screenshot; scroll a panel horizontally when needed. Every
terrain also has current/pilot samples at **16, 24, 32 and 60 pixels** on dark
and light backgrounds, plus a **3 × 3 repeat** at 32 pixels.

White walls, arrows, flags and player markers are simulated and identical in
each pair. They help assess readability but are not rendered by the pack. The
individual artwork and comparison PNGs were reviewed offline; native MudForge
import and persistence are outside this preview-only pilot.

Accept the direction when streets and connected ground read first, mixed shop
and fountain areas no longer become strongly colored patches, and the small
landmarks remain useful at normal map size. The counter and basins leave all
four room edges unobstructed. Repeated cues still exist: one static image per
terrain cannot provide neighbor-aware transitions or room-specific variation.

## Builds and verification

`npm run build` renders the 16 independently editable SVGs at **128 × 128**,
produces paired layout PNGs at 60 pixels per room, and embeds all images in a
portable HTML comparison. The builder receives the current production pack
bytes from the same build, so the two sides use a consistent baseline. It uses
the existing pinned `@resvg/resvg-js` **2.6.2**, with no artwork fonts, external
images, new dependencies or network requirements.

```sh
node --test tests/map-pilot.test.mjs tests/map-pack.test.mjs tests/distribution.test.mjs
npm test
npm run build:check
git diff --check
```

Pilot tests cover the exact 16 terrains, unique image and geometry hashes,
opaque square PNGs, a shared slate floor, material join contrast, clear landmark
edge corridors, correct road ports, comparison fixtures, HTML sample coverage,
frozen-reference integrity, preserved geometry and neutral moon colors,
deterministic output and pinned production-pack hashes. Existing pack tests
continue to validate both complete packs. The repository build now includes
**267 generated files**, including **26 pilot outputs**.

Offline validation for **0.3.0** on **2026-10-18** passed **31 focused checks**, **196
JavaScript tests and 21 Python tests**, `build:check`, and diff checks. All 16
designs were reviewed in repeated grids and at the four sample sizes. The
comparison layouts and frozen 0.2.0 reference were reviewed as rendered PNGs.
Geometry and neutral moon paints match the saved 0.2.0 snapshot. Browser automation could
not open the local HTML because its URL policy blocks `file:` URLs, so browser
layout and size-selector interaction remain unverified.

Review this pilot before extending the style to all 114 terrains or producing
an importable successor. No active map, room records or client overlays have
been modified. No commit or publication is part of the pilot task.
