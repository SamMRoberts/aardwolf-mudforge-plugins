# Shop variants

Three additional opaque square master PNGs generated with the built-in image
generation tool on 2026-10-23. Each used the unchanged exported Atlas
`shop.png` as the style reference. The masters are checked in here; the build
resamples the complete images to 128 × 128 and embeds them under the existing
`shop` terrain entry. No generated-image cache path is needed to rebuild.

- `shop-merchant.png`: general provisions, cloth, sacks and an L-shaped counter.
- `shop-apothecary.png`: potion shelves, herbs and a side workbench.
- `shop-smith.png`: tools, anvil and forge.

The scenery is decorative: room-number selection does not infer actual shop
inventory. The base shop image, terrain keys and colors remain unchanged.
Client selection slots are documented in [Terrain Icons](../../../../docs/TERRAIN-ICONS.md).
These scenes match the Atlas overhead style but are not seamless floor textures.

## Generation prompts

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
