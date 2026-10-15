import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const packDirectory = 'src/map-packs/aardwolf-terrain-icons';
export const packOutput = 'dist/map-packs/aardwolf-terrain-icons.json';
export const previewOutput = 'dist/map-packs/aardwolf-terrain-icons.html';

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

function contactSheet(registry, styles) {
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
header{max-width:760px;margin-bottom:28px}h1{font-size:28px;margin:0 0 10px}header p{line-height:1.6;color:#baccc5}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
article{padding:16px;border:1px solid #384a4e;border-radius:10px;min-width:0;background:#1c282e}
h2{font:600 15px ui-monospace,monospace;overflow-wrap:anywhere;margin:0 0 6px}article p{font-size:12px;color:#baccc5;min-height:30px;margin:0 0 10px}
.samples{display:flex;align-items:center;justify-content:space-around;gap:12px;padding:10px;border-radius:6px;margin-top:8px;min-height:80px}
.dark{background:#0b1117;color:#d0ded8}.light{background:#f3f5f0;color:#273749}figure{margin:0;display:grid;justify-items:center;align-content:end;gap:6px}
img{display:block}figcaption{font-size:10px}@media(max-width:540px){body{padding:16px}}
</style></head><body><header><h1>${escapeHtml(registry.name)}</h1>
<p>${escapeHtml(registry.description)} Each tile appears at 16, 24 and 32 pixels on dark and light backgrounds. Related terrain variants use distinct geometry. Native room colors and flags can override terrain artwork.</p>
<p>Editable SVG sources · ${escapeHtml(registry.version)} · ${styles.length} terrain icons</p></header><main>${cards}</main></body></html>
`;
}

export async function buildMapPackOutputs(root) {
  const directory = resolve(root, packDirectory);
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
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 64 }, font: { loadSystemFonts: false } }).render();
    if (rendered.width !== 64 || rendered.height !== 64) throw new Error(`Terrain icon must be square: ${name}`);
    const png = Buffer.from(rendered.asPng());
    outputs.set(`dist/map-packs/aardwolf-terrain-icons/${name}.png`, png);
    styles.push({ name, color: terrain.color, image: `data:image/png;base64,${png.toString('base64')}` });
  }
  outputs.set(packOutput, Buffer.from(`${JSON.stringify({ name: registry.name, description: registry.description, terrainStyles: styles }, null, 2)}\n`));
  outputs.set(previewOutput, Buffer.from(contactSheet(registry, styles)));
  return outputs;
}
