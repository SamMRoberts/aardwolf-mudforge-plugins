import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { buildMapPackOutputs, packDirectory, packOutput, previewOutput, validateTerrainRegistry } from '../tools/build-map-pack.mjs';

const registry = JSON.parse(await readFile(resolve(root, packDirectory, 'terrains.json'), 'utf8'));
const outputs = await buildMapPackOutputs(root);
const pack = JSON.parse(outputs.get(packOutput));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('pack covers the complete pinned Aardwolf registry plus MudForge defaults', () => {
  assert.equal(registry.source.revision, 'ac6e40ff5596e285cfcef6739d1dfdc257cfa162');
  assert.equal(registry.source.count, 112);
  assert.match(registry.source.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(registry.terrains.filter(terrain => terrain.id !== null).map(terrain => terrain.id), Array.from({ length: 112 }, (_, index) => index));
  assert.deepEqual(registry.terrains.filter(terrain => terrain.id === null).map(terrain => terrain.name), ['default', 'water']);
  assert.equal(pack.terrainStyles.length, 114);
  assert.equal(new Set(pack.terrainStyles.map(style => style.name)).size, 114);
  assert.deepEqual(pack.terrainStyles.map(style => style.name), registry.terrains.map(terrain => terrain.name.trim().toLowerCase()));
  assert(pack.terrainStyles.some(style => style.name === 'mudschool'));
  assert.deepEqual(Object.keys(pack), ['name', 'description', 'terrainStyles']);
});

test('terrain registry rejects aliases, invalid colors and duplicate upstream IDs', () => {
  for (const change of [
    copy => { copy.terrains[1].name = ' INSIDE '; },
    copy => { copy.terrains[0].color = 'red'; },
    copy => { copy.terrains[1].id = 0; },
    copy => { copy.terrains.pop(); copy.terrains.shift(); },
    copy => { copy.terrains[0].name = '../inside'; },
  ]) {
    const copy = structuredClone(registry);
    change(copy);
    assert.throws(() => validateTerrainRegistry(copy));
  }
});

test('every terrain embeds a unique 64px PNG and a matching opaque background', async () => {
  const images = new Set();
  const geometry = new Set();
  for (const style of pack.terrainStyles) {
    assert.deepEqual(Object.keys(style), ['name', 'color', 'image']);
    assert.match(style.color, /^#[a-f0-9]{6}$/);
    assert.match(style.image, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    const png = Buffer.from(style.image.split(',')[1], 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 64);
    assert.equal(png.readUInt32BE(20), 64);
    assert.deepEqual(png, outputs.get(`dist/map-packs/aardwolf-terrain-icons/${style.name}.png`));
    assert(!images.has(digest(png)), `${style.name}: duplicate image`);
    images.add(digest(png));
    const svg = await readFile(resolve(root, packDirectory, 'icons', `${style.name}.svg`), 'utf8');
    assert(svg.includes(`width="32" height="32" fill="${style.color}"`), style.name);
    assert.match(svg, /viewBox="0 0 32 32"/);
    assert.doesNotMatch(svg, /<(?:script|text|image|foreignObject)\b|\b(?:href|style|onload)=/i);
    // Removing titles and paint must still leave a unique geometric design.
    const shape = svg.replace(/<title>.*?<\/title>/s, '').replace(/(?:fill|stroke|color)="[^"]*"/g, '').replace(/\s+/g, '');
    assert(!geometry.has(shape), `${style.name}: artwork differs only by paint`);
    geometry.add(shape);
  }
});

test('contact sheet includes all terrains at three sizes on both backgrounds', () => {
  const html = outputs.get(previewOutput).toString();
  assert.equal((html.match(/<article>/g) || []).length, 114);
  assert.equal((html.match(/class="samples dark"/g) || []).length, 114);
  assert.equal((html.match(/class="samples light"/g) || []).length, 114);
  for (const size of [16, 24, 32]) assert.equal((html.match(new RegExp(`width="${size}" height="${size}"`, 'g')) || []).length, 228);
  for (const style of pack.terrainStyles) assert(html.includes(`<h2>${style.name}</h2>`));
  assert.doesNotMatch(html, /<script\b|src="https?:/i);
});

test('map-pack rebuilds are byte-identical without network or system fonts', async () => {
  const second = await buildMapPackOutputs(root);
  assert.deepEqual([...outputs.keys()], [...second.keys()]);
  for (const [path, bytes] of outputs) assert(bytes.equals(second.get(path)), path);
});
