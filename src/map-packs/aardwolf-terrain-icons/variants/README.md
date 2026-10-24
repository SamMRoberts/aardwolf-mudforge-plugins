# Shop artwork

Six opaque square master PNGs are checked in here and resampled to 128 × 128
by the repository build. Builds do not depend on the image-generation cache.

The three generic layouts are assigned automatically under `shop.variants`:

- `shop-counter.png`: angular counters and chunky rectangular furniture.
- `shop-display.png`: rounded tables and curved display furniture.
- `shop-shelves.png`: narrow shelves, a slim desk and a diagonal rack.

They share the original shop's horizontal brown timber floor. Furniture varies
in appearance, location, size and shape, while all four edge-midpoint exits
remain clear.

The vendor-specific masters and exported PNGs are preserved for manual use:

- `shop-merchant.png`: honey parquet, burgundy and blue textiles.
- `shop-apothecary.png`: jade ceramic, lavender cabinets and alchemy tools.
- `shop-smith.png`: charcoal flagstones, steel tools and orange forge light.

The registry's `manualImages` list exports those vendor PNGs and embeds them
as named `shop-merchant`, `shop-apothecary` and `shop-smith` terrain styles.
Each has a base image and fallback color, with no variants. They are excluded
from automatic shop slots, and this build does not assign any rooms. See [Terrain Icons](../../../../docs/TERRAIN-ICONS.md)
for selection slots and import details. Artwork generation/edit history follows.

## 4.2.0 generic variants on common flooring

Generated with the built-in image generation tool on 2026-10-23, using the
original exported `shop.png` as the edit target for all three layouts.
Each call used `transparent_background: false` and this shared prompt followed
by its layout instruction:

```text
Use case: precise-object-edit. Make a GENERIC SHOP furniture-layout variant of this existing RPG shop tile. Input image is the edit target. FLOOR MUST STAY COMMON ACROSS ALL SHOP TILES: keep the reference's same warm medium-dark BROWN HORIZONTAL TIMBER PLANKS, same grain scale, plank width, color, material and even amber lighting across the WHOLE tile. No vertical planks, herringbone, tile, stone, rugs, new floor patterns, or plus-shaped change in floorboard direction. Change ONLY furniture, furnishings and their placement; preserve the shared floor appearance and detailed hand-painted fantasy overhead illustration style. This generic shop can sell anything: use ordinary display counters, empty tables, shelves, neutral CLOSED boxes, baskets, barrels, sacks, a closed ledger and brass scales. No specific vendor identity: no weapons, anvil, forge, fire, potions, bottles, alchemy equipment, herb displays, fabric bolts or prominent food displays. Vary furniture appearance, size, shape, and placement substantially. Reserve the middle 30% of both axes as bare walkable wooden floor: a continuous unobstructed aisle from CENTER to each exact NORTH, EAST, SOUTH and WEST edge midpoint. All furniture must stay in corner regions, and no wall, border, rim, threshold or edge trim may cross any entrance. Full-bleed opaque square tile, floor continues flush to edges. No text, signs, labels, symbols, arrows, people or doors. Strict orthographic top-down view. Keep readable furniture silhouettes at 32x32 pixels.
```

### shop-counter

```text
LAYOUT A — ANGULAR COUNTERS: upper-left corner has a broad compact L-shaped dark walnut counter with brass scales and a closed ledger; upper-right has a small low shelf holding plain closed boxes; lower-left holds one large barrel and two small crates; lower-right holds a compact square dark-wood table and a pair of empty baskets. Furniture has straight chunky rectangular shapes, muted teal-painted panels and brass corner caps. Do not put a counter in the middle of the room.
```

### shop-display

```text
LAYOUT B — ROUND DISPLAY FURNITURE: lower-left corner has a broad circular pale oak empty display table, upper-right has a compact curved kidney-shaped pale oak checkout counter with a closed ledger; upper-left has a low stepped semicircular shelf of closed boxes; lower-right has three small round baskets and a single squat barrel. Furniture silhouettes must be soft and rounded, visibly different from an angular-counter layout. Natural light wood and muted moss-green panels. Preserve original horizontal brown flooring exactly in look.
```

### shop-shelves

```text
LAYOUT C — LONG NARROW SHELVES: lower-right corner holds a long narrow blue-gray painted straight checkout desk with brass scales. Upper-left has two short parallel narrow shelf units of different heights with neutral closed boxes; lower-left has one short diagonal slatted display rack and a small chest; upper-right has a tall compact cabinet, a narrow bench and one basket. Furniture should feel slender and vertical in silhouette with muted blue-gray painted surfaces, distinctly different sizes and locations from round-table and L-counter layouts. All objects remain fully inside corners. Preserve original horizontal brown flooring exactly in look.
```

## 4.1.2 distinct room designs

The three masters were redesigned with the built-in image generation tool,
using their respective 4.1.1 masters as edit targets. The merchant uses bright
honey parquet and burgundy/blue textiles, the apothecary uses jade and ivory
ceramic with lavender curved furnishings, and the smith uses charcoal basalt
and orange forge light. Their furniture silhouettes and placements also differ.
All three retain continuous clear floor paths to the four edge midpoints.

Each edit used `transparent_background: false` and this shared prompt followed
by the corresponding room instruction:

```text
Use case: precise-object-edit. Redesign this shop terrain tile so its room looks unmistakably different even at 32x32 pixels. Input image is the edit target. Retain the detailed hand-painted fantasy RPG illustration style and strict overhead square view, but CHANGE the dominant floor material, overall color palette, furnishing silhouettes and placement substantially. Do not retain the repetitive brown timber room appearance or the old furniture layout. Critical invariant: keep broad continuous walkable floor aisles connecting the center to the midpoint of ALL FOUR edges (north, east, south, west). Reserve the central vertical 30% strip from top to bottom AND central horizontal 30% strip from left to right as completely clear floor. Furniture and props must fit into the four corner regions only. No wall, trim, threshold, shelf, rug with raised edges, barrel or other obstacle across any exit. Full-bleed opaque square tile; no border, no text, no symbols, no people, no arrows, no doors, no perspective/isometric camera. Use large readable shapes with distinct materials; keep fine painted detail.
```

### shop-merchant

```text
GENERAL MERCHANT / TEXTILE BAZAAR: make the dominant floor LIGHT golden honey-colored herringbone parquet, a bright spacious room. Strong burgundy red and royal-blue cloth accents with cream and brass furnishings. Upper-left has a compact ROUND display table with neatly folded colorful cloth. Lower-left has short cloth bolts on a diagonal rack. Upper-right has a low cream-painted counter with brass scales and a red cloth draped fully within that corner. Lower-right has a few neat provision crates and sacks. Give each corner a different silhouette. Broad pale honey parquet fills both crossing aisles without furniture. The whole tile should read bright gold, cream and burgundy rather than dark brown.
```

### shop-apothecary

```text
APOTHECARY / BOTANICAL ALCHEMY SHOP: transform the dominant floor into COOL pale jade-green and ivory octagonal ceramic tiles with a subtle repeating geometric pattern, no wood floor anywhere. Overall sage, turquoise, lavender and silver palette. Upper-right corner holds a compact CURVED lavender cabinet with a few large glowing turquoise and purple potion bottles. Lower-left corner holds a lush cluster of broad-leaf medicinal plants in pale pots. Upper-left has a small round stone mortar table. Lower-right has an elegant glass distillation apparatus on a silver worktable. Make the furnishing shapes soft and curved. Keep jade ceramic floor clear through the crossing aisles and edge midpoints. The room should read cool green, ivory and violet at tiny size, distinctly different from a golden merchant room or dark forge.
```

### shop-smith

```text
BLACKSMITH / STONE FORGE: replace ALL wooden floor with rough COOL CHARCOAL-GRAY basalt flagstones, large irregular slabs, slightly blue steel tones. Strong orange-red fire and bright steel accents. Put the substantial masonry forge in the LOWER-LEFT CORNER, with vivid glowing orange coals and warm reflected light localized around it. Put a large recognizable steel anvil on a square dark stone base in the UPPER-RIGHT corner. Upper-left holds a short diagonal weapon rack with broad silver blades and a round shield. Lower-right has stacked iron ingots and a small tool bench. Reposition everything from the reference so the layout differs clearly. Keep the entire central crossing of dark blue-gray stone floor unobstructed through all four edge midpoints. The whole room should read cool stone and orange forge glow, with almost no brown timber.
```

## 4.1.1 cardinal exit clearance

The three masters were edited with the built-in image generation tool, each
using its own 4.1.0 master as the edit target. Furnishings occupy corner areas,
leaving continuous open floor through the center to all four edge midpoints.
The edit prompts request broad crossing aisles and floor extending flush to
each entrance. Final images are visually reviewed at source and exported sizes.
The original Atlas shop is outside this three-image update.

Each edit used `transparent_background: false` and this shared prompt, followed
by its image-specific instruction below:

```text
Use case: precise-object-edit. Edit this existing square fantasy RPG shop terrain tile. The image is the edit target. Preserve the shop's identity, warm dark timber palette, detailed hand-painted pixel-like style, overhead viewpoint, and opaque square format. CRITICAL LAYOUT: north, east, south and west exits are at the exact MIDPOINT of each edge. Clear a broad unobstructed PLUS-SHAPED WALKING AISLE across the entire tile: the vertical strip from x=35% to x=65% is bare walkable wooden floor from the very top edge to the very bottom edge; the horizontal strip from y=35% to y=65% is bare walkable wooden floor from the very left edge to the very right edge. These two full-width strips intersect at the center. No furniture, shelf, counter, barrel, crate, sack, plant, anvil, forge, wall, railing, raised threshold, or edge trim may enter either strip or cross any of the four exit openings. All furnishings must fit fully inside the four corner regions, outside those central strips. Remove the continuous outer frame/rim, especially across the four midpoint exits, and extend the matching floor flush to the image edges in those openings. Do not draw exit symbols, arrows, text, labels, people, grid lines, or doors; the client will draw exits. Keep natural floor plank lines, but no framing lines across entrances.
```

### shop-merchant

```text
Keep merchant cloth, provisions, barrels and sacks in the corners. Replace the large L-shaped left counter with a compact counter entirely in the upper-left corner. Split the northern shelves into separate upper-left and upper-right units, leaving the middle third of the top edge completely clear.
```

### shop-apothecary

```text
Keep the potion bottles, herb jars, mortar and pestle, and dried herbs in corner work areas. Split the northern shelves into separate upper-left and upper-right units. Split the right-side workbench into upper-right and lower-right units, leaving the middle third of the right edge completely clear. Remove or relocate bottom-center crates into the lower corners.
```

### shop-smith

```text
Keep tools, iron stock, the small glowing forge and the anvil. Put the forge entirely in the upper-right corner, the anvil entirely in the upper-left corner, tool racks in the upper-left corner and stock in lower corners. Split or shorten all racks and benches so that the middle third of all four edges and both crossing aisles are only clear walkable floor.
```

## Original 4.1.0 generation prompts

Each prompt used `transparent_background: false` and the original exported
`dist/map-packs/aardwolf-terrain-icons/shop.png` as its reference image.

### General merchant

```text
Use case: stylized-concept. Create one square fantasy RPG shop terrain tile, an additional GENERAL MERCHANT variant for a MUD mapper. Reference image is the existing shop tile: match its richly detailed hand-painted pixel-like fantasy illustration, warm dark timber, amber highlights, strict orthographic overhead view. Use the same overall scale and floor-to-furnishings ratio. New layout: shelves of folded cloth and sacks along upper edge, barrels and bundled provisions in lower corners, a small L-shaped wooden merchant counter along left edge, broad clear worn wooden plank floor through center and right. A few teal textile accents. Completely opaque, artwork fills square edge to edge, no border or framing, no text, no labels, no people, no grid, no perspective or isometric angle, no outside scenery. Legible silhouette when reduced to 128x128 and 32x32. Reference is for style and shop identity; make a clearly distinct furniture layout. Output just one tile.
```

### Apothecary

```text
Use case: stylized-concept. Create one square fantasy RPG shop terrain tile, an additional APOTHECARY variant for a MUD mapper. Reference image is the existing shop tile: match its richly detailed hand-painted pixel-like fantasy illustration, warm dark timber, amber highlights, strict orthographic overhead view. Use the same overall scale and floor-to-furnishings ratio. New layout: Shelves of jewel-toned glass potion bottles and herb jars across upper edge, a short counter against right edge with mortar and pestle, hanging bundles of dried herbs in corners, a few small crates along bottom edge. Broad empty dark timber floor in center, muted emerald and amber accents. Completely opaque, artwork fills square edge to edge, no border or framing, no text, no labels, no people, no grid, no perspective or isometric angle, no outside scenery. Legible silhouette when reduced to 128x128 and 32x32. Reference is for style and shop identity; make a clearly distinct furniture layout. Output just one tile.
```

### Smith's shop

```text
Use case: stylized-concept. Create one square fantasy RPG shop terrain tile, an additional SMITH'S SHOP variant for a MUD mapper. Reference image is the existing shop tile: match its richly detailed hand-painted pixel-like fantasy illustration, warm dark timber, amber highlights, strict orthographic overhead view. Use the same overall scale and floor-to-furnishings ratio. New layout: Low racks with iron tools and a few swords along upper edge, a small forge with softly glowing coals in upper right corner, a compact anvil on a stump along left edge, small barrel of metal rods in bottom corner. Broad empty worn timber and dark stone work floor through center, iron gray and restrained amber highlights. Completely opaque, artwork fills square edge to edge, no border or framing, no text, no labels, no people, no grid, no perspective or isometric angle, no outside scenery. Legible silhouette when reduced to 128x128 and 32x32. Reference is for style and shop identity; make a clearly distinct furniture layout. Output just one tile.
```
