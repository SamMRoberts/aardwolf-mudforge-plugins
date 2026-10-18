# Atlas terrain artwork

Six original texture sheets were generated with the built-in Imagegen tool on
2026-10-18 for this plugin. The original PNGs are retained in `source/`.
These are illustrative terrain surfaces, not depictions of specific rooms.
No existing map-pack artwork was reused. The existing Three Moons registry
supplies the pinned terrain identities, numeric IDs and fallback colors only.

## Prompt set

All six prompts requested one production game terrain atlas artwork asset:
four columns by five rows, 20 square cells, target 1024 × 1280, full bleed with
no gutters, frames, labels, numbers, lettering, UI or characters. The shared
direction was straight-down orthographic, cohesive hand-painted stylized
fantasy diorama surfaces, muted natural colors, soft ambient lighting and
material shapes readable at 128 pixels. No horizon, perspective, baked camera
tilt or shadows outside cells; fill cells edge to edge and keep sparse central
features with quieter edges. Actual generated sheets are 1122 × 1402.

The row-major subject requests were:

1. **Wilderness and base surfaces:** timber flooring; slate city cobblestones;
   grassy field; lush forest; grassy hills; mountain crags; shallow turquoise
   water; deep rough water; neutral empty stone; airy wisps; sand dunes; ocean;
   quicksand; underwater seabed; fractured ice; underground rock; east–west
   cobbled road; road plaza; north–south river; basalt and lava fissures.
2. **Caves, infernal terrain and paths:** cave stone; dungeon flagstones;
   four-way crossroads; school floor with chalk geometry and no letters;
   cyan exit sigil; scorched hell interior; lava fountain; lava crust; embers;
   sulfurous rock; icy interior; red hell hallway; purple infernal ground;
   small north–south road; small east–west road; east–west trail; sandy beach;
   rocky shore; jungle canopy; swamp water and roots.
3. **Open terrain and astral surfaces:** wooden bridge east–west across a river;
   grassy plain; blue-green ocean; broad ocean foam; midnight choppy ocean;
   sunlit meadow; stone-strewn field; autumn field; loose rocks; snow;
   frozen mountain; snowy hills; violet nebula; indigo starfield; burgundy
   cosmic dust; teal astral clouds; castle floor with gold inlay; pillar base;
   almost black stone; north–west corner road.
4. **Urban and interior details:** south–east corner road; east–west–south
   crossroads; cyan mountain crystals; lunar craters; temple mosaic; shop
   counter on timber; emerald clan seal; black marble chess square; ivory
   chess square; lucky coin motif without lettering; alley; blue fountain;
   archive; east–west bookshelves; north–south bookshelves; office desk;
   electric fissures; well; crimson hallway; dark room with sparse red stains.
5. **Weathered places and decorated floors:** dead forest; dead field;
   graveyard; palace marble; crypt slab; dead jungle; ship deck; chaotic sea;
   timber hut; red carpet; underground city cobbles; mist; ash field;
   cabin rug; blue hallway runner; aquamarine fountain; white/yellow flowers;
   pink/blue flowers; north–south stairs; refined Aylor paving.
6. **Weather and fallback:** ruins; overhead tornado; overhead dust devil;
   blue wind; jade wind; lightning; rain puddles; sunlit gold ground; white
   clouds; storm clouds; lavender clouds; rainbow sheen; neutral fallback
   stone; teal water; six unused subdued gray-stone padding cells.

Generated sheets were visually reviewed. Cell boundaries are not perfectly
uniform, so the extraction script records explicit crop boundaries and removes
two pixels from each edge before resampling. This is mechanical asset packing,
not a runtime image-generation step. The original source artwork is never modified.
Artwork is not claimed to be seamlessly tileable; terrain joins and actual
room connectivity remain separate layers.

## Rebuild

From the repository root, run:

```sh
node tools/build-atlas-art.mjs
node tools/build-atlas-art.mjs --check
npm run build
```

Pinned Resvg converts each crop into a 128 × 128 tile and packs six 512 × 640
lossless PNG sheets. Pinned jpeg-js additionally encodes deterministic quality-85
JPEG runtime sheets, keeping the plugin below MudForge's 5 MiB catalog limit.
The original and normalized PNGs remain available for future exports.
The Aardwolf Terrain Icons map pack now exports all 114 cells from these
normalized lossless PNG sheets, using the same manifest rectangles. Its JSON
embeds individual PNG tiles, so native map-pack users do not need Atlas installed.
The separate Three Moons map pack continues to use its own SVG artwork.
`manifest.json` maps all 114 normalized terrain keys to those
rectangles. Cells after `water` on the sixth sheet are unused. Each renderer document
embeds each sheet once and samples within texel centers to avoid adjacent-cell
bleeding. New source art requires reviewing and updating crop boundaries.

## Readability enhancement — Atlas 0.2.1

The built-in Imagegen tool edited all six normalized sheets on 2026-10-18.
Enhanced full-resolution masters are saved at `source/enhanced/terrain-1.png`
through `source/enhanced/terrain-6.png` (1122 × 1402 each). The first-generation
masters remain at `source/terrain-1.png` through `source/terrain-6.png` unchanged.
The build now crops the enhanced masters at the reviewed boundaries recorded in
`tools/build-atlas-art.mjs`, trims two source pixels per edge, then produces the
same six 512 × 640 sheets and 114 existing 128 × 128 terrain rectangles. There
are no runtime filters, new downloads, or changes to native map packs.

The shared edit prompt was:

> Enhance the supplied fantasy game terrain atlas so its existing terrain
> details remain readable when each cell is reduced to 32–64 pixels. Preserve
> the hand-painted fantasy style, terrain identities, composition within every
> cell, original colors and relative hue families. Open up dark midtones and
> shadow detail moderately, make material edges and major shapes crisp,
> strengthen separation between features and their ground, and reduce fine-grain
> texture noise. Preserve depth with clean small shadows; avoid washed-out
> highlights, oversaturation, halos and gritty oversharpening. Dark terrains
> must remain dark but their features distinguishable. Keep exactly four equal
> columns and five equal rows, all 20 cells in the same row-major order and
> relative boundaries, portrait 4:5, with full-bleed artwork and straight-down
> orthographic perspective. Do not add gutters, frames, divider lines, text,
> labels, numbers, watermarks, props, people or UI. Do not merge or reorder cells.

Each of the six edit calls additionally named that sheet's existing terrain
subjects for identity preservation; their row-major subject lists are recorded
in the original prompt set above. Inputs were the corresponding previous
normalized `terrain-N.png` sheets. The enhanced outputs were reviewed as a set
before integration; the new images remain illustrative terrain surfaces.
