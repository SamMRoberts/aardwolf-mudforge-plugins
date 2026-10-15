import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { root } from '../tools/build-repository.mjs';
import { buildMapPackOutputs, mapPackNames, validateTerrainRegistry } from '../tools/build-map-pack.mjs';

for (const packName of mapPackNames) {
  const packDirectory = `src/map-packs/${packName}`;
  const packOutput = `dist/map-packs/${packName}.json`;
  const previewOutput = `dist/map-packs/${packName}.html`;
  const mapPreviewOutput = `dist/map-packs/${packName}-map-preview.png`;
  const registry = JSON.parse(await readFile(resolve(root, packDirectory, 'terrains.json'), 'utf8'));
  const outputs = await buildMapPackOutputs(root, packName);
  const pack = JSON.parse(outputs.get(packOutput));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');

  test(`${packName}: pack covers the complete pinned Aardwolf registry plus MudForge defaults`, () => {
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

  test(`${packName}: terrain registry rejects aliases, invalid colors and duplicate upstream IDs`, () => {
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

  test(`${packName}: every terrain embeds a unique 128px PNG and a matching opaque background`, async () => {
    const images = new Set();
    const geometry = new Set();
    for (const style of pack.terrainStyles) {
      assert.deepEqual(Object.keys(style), ['name', 'color', 'image']);
      assert.match(style.color, /^#[a-f0-9]{6}$/);
      assert.match(style.image, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
      const png = Buffer.from(style.image.split(',')[1], 'base64');
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 128);
      assert.equal(png.readUInt32BE(20), 128);
      assert.deepEqual(png, outputs.get(`dist/map-packs/${packName}/${style.name}.png`));
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

  test(`${packName}: contact sheet includes all terrains at three sizes on both backgrounds`, () => {
    const html = outputs.get(previewOutput).toString();
    assert.equal((html.match(/<article>/g) || []).length, 114);
    assert.equal((html.match(/class="samples dark"/g) || []).length, 114);
    assert.equal((html.match(/class="samples light"/g) || []).length, 114);
    for (const size of [16, 24, 32]) assert.equal((html.match(new RegExp(`width="${size}" height="${size}"`, 'g')) || []).length, 228);
    for (const style of pack.terrainStyles) assert(html.includes(`<h2>${style.name}</h2>`));
    assert.doesNotMatch(html, /<script\b|src="https?:/i);
    assert(html.includes('class="map-study"'));
    assert(html.includes('not a native-client capture'));
    if (packName === 'aardwolf-three-moons') {
      assert.equal((html.match(/class="repeat-grid"/g) || []).length, 114);
      assert(html.includes('3 × 3 tiled'));
      assert(html.includes('Dense 5 × 5 tiling study'));
    }
  });

  test(`${packName}: terrain pixels are opaque and preserve the pack edge contract`, async () => {
    for (const terrain of registry.terrains) {
      const name = terrain.name.toLowerCase();
      const svg = await readFile(resolve(root, packDirectory, 'icons', `${name}.svg`), 'utf8');
      const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
      assert.equal(rendered.width, 128);
      assert.equal(rendered.height, 128);
      const pixels = rendered.pixels;
      const expected = Buffer.from([...terrain.color.slice(1).match(/../g).map(part => parseInt(part, 16)), 255]);
      const edgeColors = new Set();
      for (let index = 0; index < rendered.width; index++) {
        for (const [x, y] of [[index, 0], [index, 127], [0, index], [127, index]]) {
          const offset = (y * rendered.width + x) * 4;
          const pixel = pixels.subarray(offset, offset + 4);
          if (packName === 'aardwolf-three-moons') edgeColors.add(pixel.toString('hex'));
          else assert.deepEqual(pixel, expected, `${name}: material seam at ${x},${y}`);
        }
      }
      if (packName === 'aardwolf-three-moons') {
        assert(edgeColors.size > 1, `${name}: a flat-color perimeter reintroduces a room frame`);
        assert(svg.includes('id="terrain-surface"'), `${name}: missing repeating surface`);
      }
      for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255, `${name}: transparent pixel`);
    }
    const urbanNames = packName === 'aardwolf-three-moons'
      ? ['city', 'shop', 'castle', 'alley', 'temple']
      : ['city', 'shop', 'castle', 'alley'];
    const urban = registry.terrains.filter(terrain => urbanNames.includes(terrain.name));
    assert.equal(new Set(urban.map(terrain => terrain.color)).size, 1, 'adjoining urban terrain shares its stone edge color');
    if (packName === 'aardwolf-three-moons') {
      const timberRooms = registry.terrains.filter(terrain => ['inside', 'hut', 'cabin', 'office', 'archive'].includes(terrain.name));
      assert.equal(new Set(timberRooms.map(terrain => terrain.color)).size, 1, 'timber interiors share their floor edge color');
      assert(timberRooms.every(terrain => terrain.family === 'wood'));
    }
  });

  test(`${packName}: pack includes a portable connected-layout preview with room-sized scenery`, () => {
    const png = outputs.get(mapPreviewOutput);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 608);
    assert(outputs.get(previewOutput).includes(Buffer.from(png.toString('base64'))));
  });

  test(`${packName}: map-pack rebuilds are byte-identical without network or system fonts`, async () => {
    const second = await buildMapPackOutputs(root, packName);
    assert.deepEqual([...outputs.keys()], [...second.keys()]);
    for (const [path, bytes] of outputs) assert(bytes.equals(second.get(path)), path);
  });
}

test('Three Moons is a separate complete design rather than an alias of the original pack', async () => {
  const original = await buildMapPackOutputs(root, mapPackNames[0]);
  const themed = await buildMapPackOutputs(root, mapPackNames[1]);
  const originalPack = JSON.parse(original.get(`dist/map-packs/${mapPackNames[0]}.json`));
  const themedPack = JSON.parse(themed.get(`dist/map-packs/${mapPackNames[1]}.json`));
  assert.equal(themedPack.name, 'Andolor: Three Moons');
  assert.deepEqual(themedPack.terrainStyles.map(style => style.name), originalPack.terrainStyles.map(style => style.name));
  for (let index = 0; index < themedPack.terrainStyles.length; index++) {
    assert.notEqual(themedPack.terrainStyles[index].image, originalPack.terrainStyles[index].image);
  }
  await assert.rejects(buildMapPackOutputs(root, '../unknown'), /Unknown map pack/);
});

test('Three Moons floor joins stay within the normal texture contrast', async () => {
  // Uniform border pixels alone hid the framed-room problem. Compare actual
  // joins against interior texture contrast, alongside the dense visual preview.
  for (const name of ['castle', 'shop', 'insideice', 'well', 'ruins', 'hallway', 'palace_room', 'redcarpet', 'bookshelves', 'bookshelves_ns']) {
    const svg = await readFile(resolve(root, 'src/map-packs/aardwolf-three-moons/icons', `${name}.svg`));
    const { pixels } = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
    const difference = (x, y, otherX, otherY) => [0, 1, 2].reduce((sum, channel) =>
      sum + Math.abs(pixels[(y * 128 + x) * 4 + channel] - pixels[(otherY * 128 + otherX) * 4 + channel]), 0) / 3;
    let joins = 0;
    let interior = 0;
    for (let index = 0; index < 128; index++) joins += difference(0, index, 127, index) + difference(index, 0, index, 127);
    for (let x = 1; x < 128; x++) {
      for (let y = 0; y < 128; y++) interior += difference(x, y, x - 1, y) + difference(y, x, y, x - 1);
    }
    const meanJoin = joins / 256;
    const meanInterior = interior / (127 * 256);
    assert(meanJoin <= meanInterior * 1.35 + 0.5, `${name}: tile boundaries contrast more strongly than the floor texture`);
  }
});
