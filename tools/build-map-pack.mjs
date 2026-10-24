import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { validateAtlasManifest } from './build-atlas.mjs';

export const packDirectory = 'src/map-packs/aardwolf-terrain-icons';
export const packOutput = 'dist/map-packs/aardwolf-terrain-icons.json';
export const previewOutput = 'dist/map-packs/aardwolf-terrain-icons.html';
export const mapPreviewOutput = 'dist/map-packs/aardwolf-terrain-icons-map-preview.png';
export const mapPackNames = ['aardwolf-terrain-icons', 'aardwolf-three-moons'];
const tilePixels = 128;

export function validateTerrainRegistry(registry) {
  const names = new Set();
  const ids = new Set();
  const variants = new Set();
  if (!registry.name || !registry.description || !Array.isArray(registry.terrains)) {
    throw new Error('Invalid terrain registry metadata');
  }
  for (const terrain of registry.terrains) {
    const name = typeof terrain.name === 'string' ? terrain.name.trim().toLowerCase() : '';
    if (!/^[a-z][a-z0-9_]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate terrain: ${name}`);
    if (!/^#[0-9a-f]{6}$/.test(terrain.color)) throw new Error(`Invalid terrain color: ${name}`);
    if (typeof terrain.motif !== 'string' || !terrain.motif.trim()) throw new Error(`Missing terrain motif: ${name}`);
    if (terrain.id !== null) {
      if (!Number.isInteger(terrain.id) || terrain.id < 0 || ids.has(terrain.id)) throw new Error(`Invalid terrain ID: ${name}`);
      ids.add(terrain.id);
    }
    names.add(name);
    if (terrain.variants !== undefined) {
      if (!Array.isArray(terrain.variants) || !terrain.variants.length || terrain.variants.length > 9) {
        throw new Error(`Invalid terrain variants: ${name}`);
      }
      for (const variant of terrain.variants) {
        if (typeof variant !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(variant) || variants.has(variant)) {
          throw new Error(`Invalid or duplicate terrain variant: ${name}`);
        }
        variants.add(variant);
      }
    }
  }
  if ([...variants].some(variant => names.has(variant))) throw new Error('Terrain variant collides with a terrain name');
  if (registry.manualImages !== undefined) {
    if (!Array.isArray(registry.manualImages) || !registry.manualImages.length) {
      throw new Error('Invalid manual images');
    }
    const manualImages = new Set();
    for (const name of registry.manualImages) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(name)
          || names.has(name) || variants.has(name) || manualImages.has(name)) {
        throw new Error(`Invalid or duplicate manual image: ${name}`);
      }
      manualImages.add(name);
    }
  }
  if (ids.size !== registry.source?.count) throw new Error('Terrain count differs from pinned registry');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function connectedMapPreview(styles, themed = false) {
  const images = new Map(styles.map(style => [style.name, style.image]));
  function scene(rows, legend, originX, originY, size) {
    let tiles = '';
    let walls = '';
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const terrain = legend[rows[y][x]];
        if (!terrain) continue;
        const image = images.get(terrain);
        if (!image) throw new Error(`Missing map preview terrain: ${terrain}`);
        const left = originX + x * size;
        const top = originY + y * size;
        tiles += `<image href="${image}" x="${left}" y="${top}" width="${size}" height="${size}"/>`;
        // Show approximate host-drawn outer walls, leaving adjoining rooms open.
        if (!legend[rows[y - 1]?.[x]]) walls += `M${left} ${top}h${size}`;
        if (!legend[rows[y + 1]?.[x]]) walls += `M${left} ${top + size}h${size}`;
        if (!legend[rows[y][x - 1]]) walls += `M${left} ${top}v${size}`;
        if (!legend[rows[y][x + 1]]) walls += `M${left + size} ${top}v${size}`;
      }
    }
    return `${tiles}<path d="${walls}" fill="none" stroke="#e1dfcf" stroke-width="2" opacity=".85"/>`;
  }
  const town = scene(themed ? [
    'SSKII', 'SSKII', 'KKKKK', 'WWKRR', 'WWKRR',
  ] : [
    ' C    ', 'CCCSSS', '    S ', '   CCC', '   CCC', '   CC ', '    C ',
  ], { C: 'city', S: 'shop', A: 'aylorcity', M: 'mudschool', T: 'temple', F: 'fountain', E: 'areaexit', K: 'castle', P: 'palace_room', I: 'insideice', W: 'well', R: 'ruins' }, 40, themed ? 40 : 64, themed ? 96 : 64);
  const woodland = scene([
    'FFFFFFFF', 'FFFGWWFF', 'FGGGWWGF', 'FGGGWWGG', 'FFFFWWFF',
  ], { F: 'forest', G: 'field', W: 'river' }, 544, 40, 48);
  const dungeon = scene(themed ? [
    ' DR   DD', ' DDDDDCD', ' C D  DD', ' DDDDDRD', '    DD  ',
  ] : [
    ' DD   DD', ' DDDDDDD', ' D D  DD', ' DDDDDDD', '    DD  ',
  ], { D: 'dungeon', C: 'cave', R: 'ruins' }, 544, 336, 48);
  const biomes = scene(themed ? ['KSPTHL'] : ['DWILSF'], themed ? {
    K: 'castle', S: 'shop', P: 'palace_room', T: 'temple', H: 'cabin', L: 'archive',
  } : {
    D: 'desert', W: 'inside', I: 'ice', L: 'hell2', S: 'space2', F: 'flowers2',
  }, 40, 528, 64);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="608" viewBox="0 0 1024 608">
<rect width="1024" height="608" fill="#101925"/>${town}${woodland}${dungeon}${biomes}
<rect x="${themed ? 236 : 44}" y="${themed ? 236 : 132}" width="${themed ? 88 : 56}" height="${themed ? 88 : 56}" fill="none" stroke="#d75647" stroke-width="3"/>
</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}

function contactSheet(registry, styles, mapPreview, themed = false, atlas = false, manualStyles = []) {
  const manualNames = new Set(manualStyles.map(style => style.name));
  const samplesStyles = styles.flatMap((style, index) => [style,
    ...(registry.terrains[index].variants || []).map((name, variantIndex) => ({ name, image: style.variants[variantIndex + 1] })),
  ]).concat(manualStyles);
  const variantCount = samplesStyles.length - styles.length - manualStyles.length;
  const cards = samplesStyles.map(style => {
    const terrain = registry.terrains.find(terrain => terrain.name.trim().toLowerCase() === style.name);
    const motif = manualNames.has(style.name) ? 'Vendor-specific artwork for manual use'
      : atlas ? `${terrain ? 'Atlas terrain' : 'Generic shop variant'} surface: ${style.name}` : terrain.motif;
    const samples = ['dark', 'light'].map(theme => `<div class="samples ${theme}" aria-label="${theme} background">${[16, 24, 32].map(size =>
      `<figure><img src="${style.image}" width="${size}" height="${size}" alt="${escapeHtml(motif)}"><figcaption>${size} px</figcaption></figure>`).join('')}</div>`).join('');
    const repeated = themed ? `<figure class="repeat-study"><div class="repeat-grid" role="img" aria-label="${escapeHtml(style.name)} repeated in a 3 by 3 map grid" style="background-image:url('${style.image}')"></div><figcaption>3 × 3 tiled · 32 px rooms</figcaption></figure>` : '';
    return `<article><h2>${escapeHtml(style.name)}</h2><p>${escapeHtml(motif)}</p>${manualNames.has(style.name) ? '<p>Manual assignment only</p>' : ''}${samples}${repeated}</article>`;
  }).join('\n');
  const shop = styles.find(style => style.name === 'shop');
  const shopStudy = shop?.variants ? `<section class="shop-study"><h2>Shop variations</h2><p>Original shop and three generic furniture layouts: angular counters, rounded displays and narrow shelves. All three use common timber flooring. Each square is a 32 px room; room numbers 10000–10019 select stable images by their last digit. Vendor-specific images shown below are named terrain styles for manual assignment and are excluded from shop's automatic selection.</p>${[false, true].map(varied => `<figure><div class="shop-grid" role="img" aria-label="${varied ? 'Varied' : 'Original'} shop terrain across 20 rooms">${Array.from({ length: 20 }, (_, index) => {
    const image = varied ? shop.variants[(10000 + index) % 10] || shop.image : shop.image;
    return `<span style="background-image:url('${image}')"></span>`;
  }).join('')}</div><figcaption>${varied ? 'With three additional variants' : 'Original single image'}</figcaption></figure>`).join('')}</section>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(registry.name)} — contact sheet</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#12191e;color:#edf4f1;font:14px system-ui,sans-serif}
header{max-width:900px;margin-bottom:28px}h1{font-size:28px;margin:0 0 10px}header p{line-height:1.6;color:#baccc5}
.map-study{max-width:1024px;margin:0 0 32px}.map-study img{width:100%;height:auto;border-radius:8px}.map-study figcaption{line-height:1.6;font-size:12px;color:#baccc5;margin-top:8px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
article{padding:16px;border:1px solid #384a4e;border-radius:10px;min-width:0;background:#1c282e}
h2{font:600 15px ui-monospace,monospace;overflow-wrap:anywhere;margin:0 0 6px}article p{font-size:12px;color:#baccc5;min-height:30px;margin:0 0 10px}
.samples{display:flex;align-items:center;justify-content:space-around;gap:12px;padding:10px;border-radius:6px;margin-top:8px;min-height:80px}
${themed ? '.repeat-study{margin-top:12px}.repeat-grid{width:96px;height:96px;background-size:32px 32px;background-repeat:repeat}\n' : ''}.dark{background:#0b1117;color:#d0ded8}.light{background:#f3f5f0;color:#273749}figure{margin:0;display:grid;justify-items:center;align-content:end;gap:6px}
${shop?.variants ? '.shop-study{margin:0 0 32px;max-width:640px;display:flex;gap:24px;flex-wrap:wrap}.shop-study h2,.shop-study p{width:100%;margin:0}.shop-study p{line-height:1.6;color:#baccc5}.shop-grid{display:grid;grid-template-columns:repeat(5,32px)}.shop-grid span{width:32px;height:32px;background-size:32px 32px}\n' : ''}img{display:block}figcaption{font-size:10px}@media(max-width:540px){body{padding:16px}}
</style></head><body><header><h1>${escapeHtml(registry.name)}</h1>
<p>${escapeHtml(registry.description)} ${themed ? 'Surfaces repeat across room boundaries. Continuous runners and narrow shelf or counter runs replace full furnished-room scenes. Each terrain also appears below in a 3 × 3 repeat test.' : atlas ? 'Room tiles use the enhanced Aardwolf Atlas terrain artwork. These illustrative surfaces are not depictions of specific rooms and are not guaranteed to tile seamlessly.' : 'Related rooms share quiet material edges. Shaded scenery stays within the tile so streets, floors and ground can read continuously.'} MudForge draws walls, room borders, symbols and player markers above these tiles.</p>
<p>${atlas ? 'Atlas artwork · lossless PNG crops' : 'Editable SVG sources'} · ${escapeHtml(registry.version)} · ${styles.length + manualStyles.length} terrain ${manualStyles.length ? 'styles' : 'tiles'}${variantCount ? ` + ${variantCount} generic shop variants` : ''}${manualStyles.length ? ` · ${manualStyles.length} for manual assignment` : ''}</p></header>
<figure class="map-study"><img src="data:image/png;base64,${mapPreview.toString('base64')}" width="1024" height="608" alt="${themed ? 'Dense terrain tiling: shops, castle runners, ice chambers, wells and ruins in the supplied screenshot arrangement; woodland and river; dungeon slate' : 'Connected fantasy tile studies: limestone town and market at left, emerald woodland and turquoise river at upper right, slate dungeon at lower right; gold sand, timber, cyan ice, orange lava, violet magic and flowers along the bottom left'}"><figcaption>${themed ? 'Dense 5 × 5 tiling study based on the supplied screenshot (left): shop, castle, ice chamber, well and ruins. Woodland and river appear at upper right; dungeon slate appears below. ' : 'Connected layout study: town (left), woodland and river (upper right), dungeon (lower right). '}${themed ? 'Interior samples along the bottom left: castle, shop, palace, temple, cabin and archive.' : 'Biome palette along the bottom left: desert, timber, ice, lava, astral terrain and flowers.'} Walls and player outline are simulated to show how tiles sit beneath client overlays; this is an illustrative preview, not a native-client capture. Individual tiles appear below at 16, 24 and 32 pixels.</figcaption></figure>
${shopStudy}<main>${cards}</main></body></html>
`;
}

async function renderTerrainImage(directory, variant) {
  const source = await readFile(resolve(directory, 'variants', `${variant}.png`));
  if (source.length < 33 || source.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || source.toString('ascii', 12, 16) !== 'IHDR'
      || source.readUInt32BE(16) < tilePixels || source.readUInt32BE(16) > 4096
      || source.readUInt32BE(16) !== source.readUInt32BE(20)) {
    throw new Error(`Terrain variant must be a square PNG between 128 and 4096 pixels: ${variant}`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><image href="data:image/png;base64,${source.toString('base64')}" width="128" height="128"/></svg>`;
  const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const pixels = rendered.pixels;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 255) throw new Error(`Terrain variant must be opaque: ${variant}`);
  }
  const png = Buffer.from(rendered.asPng());
  return png;
}

export async function buildMapPackOutputs(root, packName = mapPackNames[0]) {
  if (!mapPackNames.includes(packName)) throw new Error(`Unknown map pack: ${packName}`);
  const directory = resolve(root, 'src/map-packs', packName);
  const outputStem = `dist/map-packs/${packName}`;
  const registry = JSON.parse(await readFile(resolve(directory, 'terrains.json'), 'utf8'));
  validateTerrainRegistry(registry);
  const atlas = packName === 'aardwolf-terrain-icons';
  const atlasTerrains = new Map();
  const atlasSheets = new Map();
  if (atlas) {
    const assetDirectory = resolve(root, 'src/atlas/assets');
    const manifest = JSON.parse(await readFile(resolve(assetDirectory, 'manifest.json'), 'utf8'));
    validateAtlasManifest(manifest, registry);
    for (const terrain of manifest.terrains) atlasTerrains.set(terrain.name, terrain);
    for (const sheet of manifest.sheets) {
      // Export the lossless companion, avoiding another JPEG compression pass.
      const png = await readFile(resolve(assetDirectory, `${sheet.id}.png`));
      if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || png.toString('ascii', 12, 16) !== 'IHDR'
          || png.readUInt32BE(16) !== sheet.width || png.readUInt32BE(20) !== sheet.height) {
        throw new Error(`Atlas PNG dimensions differ from manifest: ${sheet.id}`);
      }
      atlasSheets.set(sheet.id, { ...sheet, image: `data:image/png;base64,${png.toString('base64')}` });
    }
  } else {
    const expectedFiles = registry.terrains.map(terrain => `${terrain.name.trim().toLowerCase()}.svg`).sort();
    const actualFiles = (await readdir(resolve(directory, 'icons'))).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw new Error('Terrain artwork differs from registry');
  }
  const outputs = new Map();
  const styles = [];
  for (const terrain of registry.terrains) {
    const name = terrain.name.trim().toLowerCase();
    let svg;
    if (atlas) {
      const tile = atlasTerrains.get(name);
      const sheet = atlasSheets.get(tile.sheet);
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tilePixels}" height="${tilePixels}" viewBox="${tile.x} ${tile.y} ${tile.width} ${tile.height}"><image href="${sheet.image}" width="${sheet.width}" height="${sheet.height}"/></svg>`;
    } else {
      svg = await readFile(resolve(directory, 'icons', `${name}.svg`), 'utf8');
    }
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: tilePixels }, font: { loadSystemFonts: false } }).render();
    if (rendered.width !== tilePixels || rendered.height !== tilePixels) throw new Error(`Terrain icon must be square: ${name}`);
    const png = Buffer.from(rendered.asPng());
    outputs.set(`${outputStem}/${name}.png`, png);
    const style = { name, color: terrain.color, image: `data:image/png;base64,${png.toString('base64')}` };
    if (terrain.variants) {
      const variantImages = [];
      for (const variant of terrain.variants) {
        const png = await renderTerrainImage(directory, variant);
        outputs.set(`${outputStem}/${variant}.png`, png);
        variantImages.push(`data:image/png;base64,${png.toString('base64')}`);
      }
      // MudForge selects by room.num % 10, not by the variant array length.
      // Empty slots use the unchanged base image, including in older clients.
      style.variants = Array.from({ length: 10 }, (_, index) => {
        const choice = index % (variantImages.length + 1);
        return choice ? variantImages[choice - 1] : '';
      });
    }
    styles.push(style);
  }
  // Named vendor terrains are selectable explicitly; they never enter shop variants.
  const manualStyles = [];
  for (const name of registry.manualImages || []) {
    const png = await renderTerrainImage(directory, name);
    outputs.set(`${outputStem}/${name}.png`, png);
    manualStyles.push({ name, color: styles.find(style => style.name === 'shop').color,
      image: `data:image/png;base64,${png.toString('base64')}` });
  }
  outputs.set(`${outputStem}.json`, Buffer.from(`${JSON.stringify({ name: registry.name, description: registry.description, terrainStyles: [...styles, ...manualStyles] }, null, 2)}\n`));
  const themed = packName === 'aardwolf-three-moons';
  const mapPreview = connectedMapPreview(styles, themed);
  outputs.set(`${outputStem}-map-preview.png`, mapPreview);
  outputs.set(`${outputStem}.html`, Buffer.from(contactSheet(registry, styles, mapPreview, themed, atlas, manualStyles)));
  return outputs;
}
