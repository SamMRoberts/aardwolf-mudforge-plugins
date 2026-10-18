// Deterministic mechanical extraction of the reviewed Imagegen terrain sheets.
// Crops are explicit because generated sheets do not have perfectly equal cells.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Resvg} from '@resvg/resvg-js';
import jpeg from 'jpeg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'src/atlas/assets');
const registry = JSON.parse(await readFile(resolve(root, 'src/map-packs/aardwolf-three-moons/terrains.json'), 'utf8'));
const crops = [
  {x: [0,265,560,844,1122], y: [0,274,553,820,1093,1402]},
  {x: [0,294,560,834,1122], y: [0,263,533,797,1050,1402]},
  {x: [0,281,561,841,1122], y: [0,280,561,841,1121,1402]},
  {x: [0,281,560,841,1122], y: [0,280,558,834,1110,1402]},
  {x: [0,282,560,841,1122], y: [0,265,535,797,1068,1402]},
  {x: [0,282,561,841,1122], y: [0,279,558,836,1115,1402]},
];
const manifest = {version: 1, sheets: [], terrains: []};
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node tools/build-atlas-art.mjs [--check]');
async function output(file, bytes) {
  const path = resolve(directory, file);
  if (check) {
    if (!Buffer.from(bytes).equals(await readFile(path))) throw new Error(`Stale terrain output: ${file}`);
  } else await writeFile(path, bytes);
}
for (let sheetIndex = 0; sheetIndex < crops.length; sheetIndex++) {
  const id = `terrain-${sheetIndex + 1}`;
  const source = await readFile(resolve(directory, 'source', `${id}.png`));
  const data = `data:image/png;base64,${source.toString('base64')}`;
  const crop = crops[sheetIndex];
  const images = [];
  for (let index = 0; index < 20; index++) {
    const col = index % 4, row = Math.floor(index / 4);
    // Trim the fine divider and avoid sampling neighboring artwork at the edge.
    const x = crop.x[col] + 2, y = crop.y[row] + 2;
    const width = crop.x[col + 1] - x - 2, height = crop.y[row + 1] - y - 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="none"><image href="${data}" width="1122" height="1402"/></svg>`;
    const tile = new Resvg(svg).render().asPng();
    images.push(`<image x="${col*128}" y="${row*128}" width="128" height="128" href="data:image/png;base64,${tile.toString('base64')}"/>`);
    const terrain = registry.terrains[sheetIndex*20 + index];
    if (terrain) manifest.terrains.push({name: terrain.name.trim().toLowerCase(), id: terrain.id, color: terrain.color,
      sheet: id, x: col*128, y: row*128, width: 128, height: 128});
  }
  const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640">${images.join('')}</svg>`).render();
  await output(`${id}.png`, rendered.asPng());
  // Keep lossless normalized sheets for review and editing; the portable plugin
  // embeds high-quality JPEGs to stay below MudForge's 5 MiB catalog limit.
  await output(`${id}.jpg`, jpeg.encode({data: rendered.pixels, width: 512, height: 640}, 85).data);
  manifest.sheets.push({id, file: `${id}.jpg`, width: 512, height: 640});
}
await output('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`${check ? 'Checked' : 'Built'} 6 Atlas texture sheets and 114 terrain mappings`);
