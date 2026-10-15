import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const packDirectory = 'src/map-packs/aardwolf-terrain-icons';
export const packOutput = 'dist/map-packs/aardwolf-terrain-icons.json';
export const previewOutput = 'dist/map-packs/aardwolf-terrain-icons.html';
export const mapPreviewOutput = 'dist/map-packs/aardwolf-terrain-icons-map-preview.png';
export const mapPackNames = ['aardwolf-terrain-icons', 'aardwolf-three-moons'];
const tilePixels = 128;

export function validateTerrainRegistry(registry) {
  const names = new Set();
  const ids = new Set();
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
    ' A    ', 'CCCSSS', '    M ', '   CTC', '   CFC', '   CC ', '    E ',
  ] : [
    ' C    ', 'CCCSSS', '    S ', '   CCC', '   CCC', '   CC ', '    C ',
  ], { C: 'city', S: 'shop', A: 'aylorcity', M: 'mudschool', T: 'temple', F: 'fountain', E: 'areaexit' }, 40, 64, 64);
  const woodland = scene([
    'FFFFFFFF', 'FFFGWWFF', 'FGGGWWGF', 'FGGGWWGG', 'FFFFWWFF',
  ], { F: 'forest', G: 'field', W: 'river' }, 544, 40, 48);
  const dungeon = scene(themed ? [
    ' DR   DD', ' DDDDDCD', ' C D  DD', ' DDDDDRD', '    DD  ',
  ] : [
    ' DD   DD', ' DDDDDDD', ' D D  DD', ' DDDDDDD', '    DD  ',
  ], { D: 'dungeon', C: 'cave', R: 'ruins' }, 544, 336, 48);
  const biomes = scene(['DWILSF'], {
    D: 'desert', W: 'inside', I: 'ice', L: 'hell2', S: 'space2', F: 'flowers2',
  }, 40, 528, 64);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="608" viewBox="0 0 1024 608">
<rect width="1024" height="608" fill="#101925"/>${town}${woodland}${dungeon}${biomes}
<rect x="44" y="132" width="56" height="56" fill="none" stroke="#d75647" stroke-width="3"/>
</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}

function contactSheet(registry, styles, mapPreview, themed = false) {
  const cards = styles.map((style, index) => {
    const terrain = registry.terrains[index];
    const samples = ['dark', 'light'].map(theme => `<div class="samples ${theme}" aria-label="${theme} background">${[16, 24, 32].map(size =>
      `<figure><img src="${style.image}" width="${size}" height="${size}" alt="${escapeHtml(terrain.motif)}"><figcaption>${size} px</figcaption></figure>`).join('')}</div>`).join('');
    return `<article><h2>${escapeHtml(style.name)}</h2><p>${escapeHtml(terrain.motif)}</p>${samples}</article>`;
  }).join('\n');
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
.dark{background:#0b1117;color:#d0ded8}.light{background:#f3f5f0;color:#273749}figure{margin:0;display:grid;justify-items:center;align-content:end;gap:6px}
img{display:block}figcaption{font-size:10px}@media(max-width:540px){body{padding:16px}}
</style></head><body><header><h1>${escapeHtml(registry.name)}</h1>
<p>${escapeHtml(registry.description)} Related rooms share quiet material edges. Shaded scenery stays within the tile so streets, floors and ground can read continuously. MudForge draws walls, room borders, symbols and player markers above these tiles.</p>
<p>Editable SVG sources · ${escapeHtml(registry.version)} · ${styles.length} terrain tiles</p></header>
<figure class="map-study"><img src="data:image/png;base64,${mapPreview.toString('base64')}" width="1024" height="608" alt="${themed ? 'Aardwolf-inspired connected studies: moonlit city, alchemy market, Academy spellbook, three-moon sanctuary and astral arch; jade woodland and opal river; violet caves and ruins' : 'Connected fantasy tile studies: limestone town and market at left, emerald woodland and turquoise river at upper right, slate dungeon at lower right; gold sand, timber, cyan ice, orange lava, violet magic and flowers along the bottom left'}"><figcaption>${themed ? 'Andolor-inspired layout study: Mesolar and Aylor motifs (left), jade wilderness and Iridian-inspired water (upper right), Abend-inspired twilight caves (lower right). These are art-direction references, not surveyed locations or continent detection. ' : 'Connected layout study: town (left), woodland and river (upper right), dungeon (lower right). '}Biome palette along the bottom left: desert, timber, ice, lava, astral terrain and flowers. Walls and player outline are simulated to show how tiles sit beneath client overlays; this is an illustrative preview, not a native-client capture. Individual tiles appear below at 16, 24 and 32 pixels.</figcaption></figure>
<main>${cards}</main></body></html>
`;
}

export async function buildMapPackOutputs(root, packName = mapPackNames[0]) {
  if (!mapPackNames.includes(packName)) throw new Error(`Unknown map pack: ${packName}`);
  const directory = resolve(root, 'src/map-packs', packName);
  const outputStem = `dist/map-packs/${packName}`;
  const registry = JSON.parse(await readFile(resolve(directory, 'terrains.json'), 'utf8'));
  validateTerrainRegistry(registry);
  const expectedFiles = registry.terrains.map(terrain => `${terrain.name.trim().toLowerCase()}.svg`).sort();
  const actualFiles = (await readdir(resolve(directory, 'icons'))).sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw new Error('Terrain artwork differs from registry');
  const outputs = new Map();
  const styles = [];
  for (const terrain of registry.terrains) {
    const name = terrain.name.trim().toLowerCase();
    const svg = await readFile(resolve(directory, 'icons', `${name}.svg`), 'utf8');
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: tilePixels }, font: { loadSystemFonts: false } }).render();
    if (rendered.width !== tilePixels || rendered.height !== tilePixels) throw new Error(`Terrain icon must be square: ${name}`);
    const png = Buffer.from(rendered.asPng());
    outputs.set(`${outputStem}/${name}.png`, png);
    styles.push({ name, color: terrain.color, image: `data:image/png;base64,${png.toString('base64')}` });
  }
  outputs.set(`${outputStem}.json`, Buffer.from(`${JSON.stringify({ name: registry.name, description: registry.description, terrainStyles: styles }, null, 2)}\n`));
  const themed = packName === 'aardwolf-three-moons';
  const mapPreview = connectedMapPreview(styles, themed);
  outputs.set(`${outputStem}-map-preview.png`, mapPreview);
  outputs.set(`${outputStem}.html`, Buffer.from(contactSheet(registry, styles, mapPreview, themed)));
  return outputs;
}
