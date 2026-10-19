# Interior floor variants

Generated on 2026-10-19 with the built-in Imagegen tool for Aardwolf Terrain
Icons 4.1.0. Both opaque 1254 × 1254 PNGs are original artwork referenced only
by this pack. The existing 128 × 128 `inside` tile was supplied as a style
reference. Atlas's sheets and all original terrain images remain unchanged.

`inside-wide-planks.png` uses broader staggered horizontal boards;
`inside-parquet.png` uses broad herringbone parquet. The build resamples each
master to a lossless 128 × 128 PNG. The exported `inside.variants` array has ten
slots: original fallback, planks, parquet, original, planks, parquet, original,
planks, parquet, original. The room number modulo ten selects the slot.

## Prompts

### inside-wide-planks.png

Use case: style-transfer. Asset type: a single square full-bleed fantasy map
terrain tile for generic indoor rooms, downsampled to 128x128 and displayed at
16–64 pixels. Reference image: existing Aardwolf inside terrain wooden floor,
use for matching warm amber-brown palette, hand-painted style, lighting and
material only. Create an additional distinct timber floor VARIANT with broader
horizontal oak planks, fewer boards, clearly staggered board ends and a few
restrained knots placed differently from the reference. Crisp readable plank
divisions, soft wood grain, subtle shallow ambient shading, medium value
matching reference. Straight-down orthographic surface fills every edge, no
perspective, no border or vignette, no room walls, no furniture, rugs, props,
people, symbols, text or watermarks. Keep quiet edges, variation in actual board
layout rather than changing hue. Save one square tile.

### inside-parquet.png

Use case: style-transfer. Asset type: single square full-bleed fantasy map
terrain tile, generic interior, reduced to 128x128 and displayed at 16–64
pixels. Reference image: existing Aardwolf inside timber floor, use for
matching amber-brown wood palette, hand-painted style, brightness, grain and
subtle ambient lighting only. Create a second distinct indoor floor VARIANT:
simple broad wooden parquet in a restrained herringbone layout, large readable
blocks, subtle warm wood variation, calm surface. Match the reference overall
hue and midtone values; neither glossy nor ornate. Clear material divisions
and clean soft shading, limited fine-grain noise. Perfect straight-down
orthographic floor surface fills every edge. No perspective, borders,
vignette, walls, furniture, rugs, objects, people, icons, text or watermark.
One square opaque tile, not a sheet or comparison.
