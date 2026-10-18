import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { root } from '../tools/build-repository.mjs';
import { buildMapPackOutputs } from '../tools/build-map-pack.mjs';
import { pilotNames } from '../tools/build-map-pilot.mjs';
import { atlasStudies } from '../tools/build-map-atlas.mjs';

const slug = 'aardwolf-three-moons-atlas';
const directory = resolve(root, 'src/map-packs', slug);
const registry = JSON.parse(await readFile(resolve(directory, 'terrains.json')));
const outputs = await buildMapPackOutputs(root, slug);
const pack = JSON.parse(outputs.get(`dist/map-packs/${slug}.json`));
const svgs = new Map(await Promise.all(registry.terrains.map(async terrain =>
  [terrain.name, await readFile(resolve(directory, 'icons', `${terrain.name}.svg`), 'utf8')])));
const render = svg => new Resvg(svg, { font: { loadSystemFonts: false } }).render();
const bareFloor = svg => svg.replace(/<g id="landmark"[\s\S]*<\/g>/, '');

test('Atlas carries every approved 0.3.0 pilot tile across without paint or geometry changes', async () => {
  assert.equal(registry.version, '1.0.0');
  for (const name of pilotNames) {
    const approved = await readFile(resolve(root, 'src/map-pilots/aylor-cohesion/icons', `${name}.svg`), 'utf8');
    assert.equal(svgs.get(name), approved, name);
    assert.deepEqual(outputs.get(`dist/map-packs/${slug}/${name}.png`), Buffer.from(render(approved).asPng()), name);
  }
  const original = JSON.parse(await readFile(resolve(root, 'dist/map-packs/aardwolf-three-moons.json')));
  assert.deepEqual(pack.terrainStyles.map(t => t.name), original.terrainStyles.map(t => t.name));
  for (let i = 0; i < pack.terrainStyles.length; i++) assert.notEqual(pack.terrainStyles[i].image, original.terrainStyles[i].image, pack.terrainStyles[i].name);
});

test('all Atlas variants use one identical painted floor per material family', () => {
  const floors = new Map();
  for (const terrain of registry.terrains) {
    // Cave and city floors deliberately share the same slate; scenery carries identity.
    const material = terrain.family === 'cavern' ? 'stone' : terrain.family;
    const floor = Buffer.from(render(bareFloor(svgs.get(terrain.name))).asPng());
    if (floors.has(material)) assert.deepEqual(floor, floors.get(material), `${terrain.name}: different ${material} floor`);
    else floors.set(material, floor);
  }
  assert.deepEqual([...floors.keys()].sort(), ['carpet', 'earth', 'ether', 'grass', 'ice', 'lava', 'marble', 'sand', 'sky', 'stone', 'water', 'wood']);
});

test('all 114 Atlas landmarks differ geometrically even after removing every paint definition', () => {
  const geometry = new Set();
  for (const [name, svg] of svgs) {
    // Compare the actual visible motif; gradient IDs and floor definitions can
    // otherwise make color-only variants appear geometrically different.
    const shape = svg.match(/<g id="landmark"[\s\S]*<\/g>/)[0]
      .replace(/\s(?:fill|stroke|stop-color|fill-opacity|stroke-opacity|opacity|stroke-linecap|stroke-linejoin|stroke-width|id)="[^"]*"/g, '')
      .replace(/\s+/g, '');
    assert(!geometry.has(shape), `${name}: duplicate landmark geometry`);
    geometry.add(shape);
  }
  assert.equal(geometry.size, 114);
});

test('compact Atlas furnishings, basins and overhead landmarks leave every edge unobstructed', () => {
  for (const name of ['shop', 'fountain', 'afountain', 'hellfountain', 'castle', 'mudschool', 'pillar', 'stairs', 'bridge',
    'archive', 'bookshelves', 'bookshelves_ns', 'office', 'lottery', 'hut', 'cabin', 'hellinside', 'insideice',
    'dungeon', 'crypt', 'graveyard', 'ruins', 'bloodyroom', 'bloodyhall', 'city_underground', 'ship', 'chessblack',
    'chesswhite', 'well', 'areaexit', 'clanexit', 'dark', 'default', 'volcano', 'mountain', 'icemount', 'mountain_cyan']) {
    const svg = svgs.get(name);
    const tile = render(svg).pixels;
    const floor = render(bareFloor(svg)).pixels;
    let changed = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const offset = (y * 128 + x) * 4;
      const different = !tile.subarray(offset, offset + 4).equals(floor.subarray(offset, offset + 4));
      if (different) changed++;
      if (x < 8 || x >= 120 || y < 8 || y >= 120) assert(!different, `${name}: scenery blocks floor at ${x},${y}`);
    }
    assert(changed > 0, `${name}: missing landmark`);
    assert(changed < 128 * 128 * 0.25, `${name}: landmark dominates its tile`);
  }
});

function checkContrast(name, svg) {
  const { pixels } = render(svg);
  const difference = (x, y, otherX, otherY) => [0, 1, 2].reduce((sum, channel) =>
    sum + Math.abs(pixels[(y * 128 + x) * 4 + channel] - pixels[(otherY * 128 + otherX) * 4 + channel]), 0) / 3;
  let joins = 0;
  let interior = 0;
  for (let index = 0; index < 128; index++) joins += difference(0, index, 127, index) + difference(index, 0, index, 127);
  for (let x = 1; x < 128; x++) for (let y = 0; y < 128; y++) interior += difference(x, y, x - 1, y) + difference(y, x, y, x - 1);
  assert(joins / 256 <= interior / (127 * 256) * 1.35 + 0.5, `${name}: join contrast exceeds normal texture`);
}

test('all Atlas material joins and non-directional tile joins stay within texture contrast', () => {
  for (const terrain of registry.terrains) {
    const svg = svgs.get(terrain.name);
    checkContrast(`${terrain.name} floor`, bareFloor(svg));
    // Different ports at opposing edges of corners are intentional geometry.
    if (!terrain.ports) checkContrast(terrain.name, svg);
  }
});

test('Atlas routes preserve centered ports and connect without narrowing the approved streets', () => {
  const expected = {
    road: ['N', 'S'], road_eastwest: ['E', 'W'], road_crossroads: ['N', 'E', 'S', 'W'],
    crossroad_nw: ['N', 'W'], crossroad_se: ['S', 'E'], crossroad_ews: ['E', 'S', 'W'],
    smallroad: ['N', 'S'], smallroad_ew: ['E', 'W'], trail_ew: ['E', 'W'], hallway: ['N', 'S'], hellhall: ['N', 'S'],
  };
  for (const [name, ports] of Object.entries(expected)) {
    const terrain = registry.terrains.find(t => t.name === name);
    assert.deepEqual(terrain.ports, ports, name);
    const svg = svgs.get(name);
    const tile = render(svg).pixels;
    const floor = render(bareFloor(svg)).pixels;
    for (const [port, point] of Object.entries({ N: [64, 0], E: [127, 64], S: [64, 127], W: [0, 64] })) {
      const offset = (point[1] * 128 + point[0]) * 4;
      assert.equal(!tile.subarray(offset, offset + 4).equals(floor.subarray(offset, offset + 4)), ports.includes(port), `${name}: ${port}`);
    }
  }
  // Main-road connection paints match at both sides of the same seam.
  const cross = render(svgs.get('road_crossroads')).pixels;
  for (const name of ['road', 'road_eastwest', 'crossroad_nw', 'crossroad_se', 'crossroad_ews']) {
    const tile = render(svgs.get(name)).pixels;
    for (const port of expected[name]) {
      const [x, y] = { N: [64, 0], E: [127, 64], S: [64, 127], W: [0, 64] }[port];
      const offset = (y * 128 + x) * 4;
      assert.deepEqual(tile.subarray(offset, offset + 4), cross.subarray(offset, offset + 4), `${name}: ${port} port paint`);
    }
  }
});

test('Atlas contact sheet covers the full registry in samples, repeats and identical-sized layout studies', () => {
  const names = new Set(registry.terrains.map(t => t.name));
  const studies = atlasStudies();
  const shown = new Set(studies.flatMap(study => study.rows.flat().filter(Boolean)));
  assert.deepEqual([...shown].sort(), [...names].sort());
  const html = outputs.get(`dist/map-packs/${slug}.html`).toString();
  for (const study of studies) {
    assert(study.rows.every(row => row.length === study.rows[0].length));
    const png = outputs.get(`dist/map-packs/${slug}-${study.id}.png`);
    assert.equal(png.readUInt32BE(16), study.rows[0].length * 60);
    assert.equal(png.readUInt32BE(20), study.rows.length * 60);
    assert(html.includes(`${study.title}, 32 px rooms`));
    assert(html.includes(`${study.title}, 60 px rooms`));
    assert(html.includes(png.toString('base64')));
  }
});

test('shipping the Atlas leaves both original importable packs byte-for-byte unchanged', async () => {
  for (const [name, hash] of [
    ['aardwolf-terrain-icons', 'f5badaaccfc7ce858e1955211ec8fd99701a6f2a1ef1a1fca1e3d559cfabee80'],
    ['aardwolf-three-moons', '0032a64740034f0e8b030ff002c1d90ed13bbaa1a0451eaed17511f5f4a51619'],
  ]) assert.equal(createHash('sha256').update(await readFile(resolve(root, `dist/map-packs/${name}.json`))).digest('hex'), hash, name);
});
