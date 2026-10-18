import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { root } from '../tools/build-repository.mjs';
import { buildMapPilotOutputs, pilotDirectory, pilotNames, pilotStem, pilotStudies } from '../tools/build-map-pilot.mjs';

const baselineBytes = await readFile(resolve(root, 'dist/map-packs/aardwolf-three-moons.json'));
const baseline = JSON.parse(baselineBytes);
const manifest = JSON.parse(await readFile(resolve(root, pilotDirectory, 'pilot.json'), 'utf8'));
const reference = await readFile(resolve(root, pilotDirectory, 'reference/urban-0.2.0.png'));
const referenceMetadata = JSON.parse(await readFile(resolve(root, pilotDirectory, 'reference/baseline-0.2.0.json'), 'utf8'));
const outputs = await buildMapPilotOutputs(root, baselineBytes);
const artwork = new Map(await Promise.all(pilotNames.map(async name =>
  [name, await readFile(resolve(root, pilotDirectory, 'icons', `${name}.svg`), 'utf8')])));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const render = svg => new Resvg(svg, { font: { loadSystemFonts: false } }).render();
const bareFloor = svg => svg.replace(/<g id="landmark"[^>]*>[\s\S]*?<\/g>/, '');

test('color refinement preserves 0.2.0 geometry, texture phase and neutral moon paints', () => {
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(Object.keys(referenceMetadata.terrains), pilotNames);
  for (const [name, svg] of artwork) {
    const geometry = svg.replace(/<title>[\s\S]*?<\/title>/g, '')
      .replace(/\s(?:fill|stroke|stop-color|color|(?:fill-|stroke-|stop-)?opacity)="[^"]*"/g, '')
      .replace(/\s+/g, '');
    assert.equal(digest(geometry), referenceMetadata.terrains[name].geometrySha256, `${name}: geometry changed during palette refinement`);
    const neutralMoonStops = {};
    for (const match of svg.matchAll(/<radialGradient id="(moon-[^"]+)"[^>]*>([\s\S]*?)<\/radialGradient>/g)) {
      neutralMoonStops[match[1]] = [...match[2].matchAll(/stop-color="([^"]+)"/g)].map(stop => stop[1]);
    }
    assert.deepEqual(neutralMoonStops, referenceMetadata.terrains[name].neutralMoonStops, name);
  }
});

test('refinement comparison preserves the frozen 0.2.0 render and identical urban layout', () => {
  assert.equal(referenceMetadata.version, '0.2.0');
  assert.equal(reference.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(digest(reference), referenceMetadata.urbanSha256);
  assert.equal(digest(JSON.stringify(pilotStudies()[0])), referenceMetadata.urbanStudySha256);
  assert.equal(reference.readUInt32BE(16), referenceMetadata.width);
  assert.equal(reference.readUInt32BE(20), referenceMetadata.height);
  const revised = outputs.get(`${pilotStem}/urban-pilot.png`);
  assert.equal(revised.readUInt32BE(16), referenceMetadata.width);
  assert.equal(revised.readUInt32BE(20), referenceMetadata.height);
  assert(!reference.equals(revised), 'Refinement must visibly change the pilot render');
  const html = outputs.get(`${pilotStem}.html`).toString();
  assert(html.includes('id="refinement"'));
  assert(html.includes('Pilot 0.2.0 · reference'));
  assert(html.includes('Pilot 0.3.0 · modest color and contrast lift'));
  assert(html.includes(reference.toString('base64')));
  assert(html.includes(revised.toString('base64')));
});

test('pilot covers exactly the approved urban scope and produces preview assets only', () => {
  assert.equal(pilotNames.length, 16);
  assert.equal(new Set(pilotNames).size, 16);
  assert.deepEqual(manifest.terrains.map(terrain => terrain.name), pilotNames);
  for (const name of pilotNames) assert(baseline.terrainStyles.some(terrain => terrain.name === name));
  assert.equal(outputs.size, 26);
  for (const path of outputs.keys()) {
    assert(path.startsWith('dist/map-pilots/'));
    assert.doesNotMatch(path, /\.json$/);
  }
});

test('all pilot SVGs and PNGs are safe, opaque, square and geometrically unique', () => {
  const images = new Set();
  const geometry = new Set();
  for (const [name, svg] of artwork) {
    assert.match(svg, /viewBox="0 0 32 32"/);
    assert.doesNotMatch(svg, /<(?:script|text|image|foreignObject)\b|\b(?:href|style|onload)=/i);
    const shape = svg.replace(/<title>.*?<\/title>/s, '').replace(/(?:fill|stroke|color)="[^"]*"/g, '').replace(/\s+/g, '');
    assert(!geometry.has(shape), `${name}: duplicate geometry`);
    geometry.add(shape);
    const rendered = render(svg);
    assert.equal(rendered.width, 128);
    assert.equal(rendered.height, 128);
    const png = outputs.get(`${pilotStem}/${name}.png`);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 128);
    assert.equal(png.readUInt32BE(20), 128);
    assert(Buffer.from(rendered.asPng()).equals(png));
    assert(!images.has(digest(png)), `${name}: duplicate pixels`);
    images.add(digest(png));
    assert.notEqual(png.toString('base64'), baseline.terrainStyles.find(terrain => terrain.name === name).image.split(',')[1]);
    const pixels = rendered.pixels;
    for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 255, name);
  }
});

test('urban landmarks and streets share one continuous slate floor', () => {
  const floor = render(bareFloor(artwork.get('city'))).pixels;
  for (const terrain of manifest.terrains.filter(terrain => terrain.material === 'slate')) {
    assert(render(bareFloor(artwork.get(terrain.name))).pixels.equals(floor), terrain.name);
  }
  assert(!render(bareFloor(artwork.get('inside'))).pixels.equals(floor));
  assert(!render(bareFloor(artwork.get('palace_room'))).pixels.equals(floor));
});

test('material seams stay within the normal interior texture contrast', () => {
  for (const name of ['city', 'inside', 'palace_room']) {
    const { pixels } = render(bareFloor(artwork.get(name)));
    const difference = (x, y, otherX, otherY) => [0, 1, 2].reduce((sum, channel) =>
      sum + Math.abs(pixels[(y * 128 + x) * 4 + channel] - pixels[(otherY * 128 + otherX) * 4 + channel]), 0) / 3;
    let joins = 0;
    let interior = 0;
    for (let index = 0; index < 128; index++) joins += difference(0, index, 127, index) + difference(index, 0, index, 127);
    for (let x = 1; x < 128; x++) {
      for (let y = 0; y < 128; y++) interior += difference(x, y, x - 1, y) + difference(y, x, y, x - 1);
    }
    assert(joins / 256 <= interior / (127 * 256) * 1.35 + 0.5, `${name}: prominent material boundary`);
  }
});

test('shop and fountain scenery leaves all four room edges as bare floor', () => {
  for (const name of ['shop', 'fountain', 'afountain', 'hellfountain']) {
    const full = render(artwork.get(name)).pixels;
    const floor = render(bareFloor(artwork.get(name))).pixels;
    let changed = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const index = (y * 128 + x) * 4;
        if (full.subarray(index, index + 4).equals(floor.subarray(index, index + 4))) continue;
        changed++;
        assert(x >= 32 && x < 96 && y >= 32 && y < 96, `${name}: scenery intrudes into an edge corridor`);
      }
    }
    assert(changed > 0, name);
    assert(changed < 128 * 128 * 0.12, `${name}: landmark dominates the tile`);
  }
});

test('all six road variants retain their exact directional ports and narrow width', () => {
  const directions = { road: 'NS', road_eastwest: 'EW', road_crossroads: 'NESW',
    crossroad_nw: 'NW', crossroad_se: 'SE', crossroad_ews: 'ESW' };
  const positions = { N: [64, 0], E: [127, 64], S: [64, 127], W: [0, 64] };
  for (const [name, ports] of Object.entries(directions)) {
    assert.deepEqual(manifest.terrains.find(terrain => terrain.name === name).ports, [...ports]);
    const full = render(artwork.get(name)).pixels;
    const floor = render(bareFloor(artwork.get(name))).pixels;
    const changed = (x, y) => {
      const index = (y * 128 + x) * 4;
      return !full.subarray(index, index + 4).equals(floor.subarray(index, index + 4));
    };
    for (const [direction, [x, y]] of Object.entries(positions)) assert.equal(changed(x, y), ports.includes(direction), `${name}: ${direction}`);
    for (const position of [0, 32, 96, 127]) {
      assert(!changed(position, 0) && !changed(position, 127), `${name}: overly wide north/south port`);
      assert(!changed(0, position) && !changed(127, position), `${name}: overly wide east/west port`);
    }
  }
});

test('comparison fixtures cover all pilot terrains with paired 60px studies', () => {
  const seen = new Set();
  for (const study of pilotStudies()) {
    assert(study.rows.length > 0);
    for (const row of study.rows) {
      assert.equal(row.length, study.rows[0].length);
      for (const name of row.filter(Boolean)) { assert(pilotNames.includes(name)); seen.add(name); }
    }
    for (const version of ['current', 'pilot']) {
      const png = outputs.get(`${pilotStem}/${study.id}-${version}.png`);
      assert.equal(png.readUInt32BE(16), study.rows[0].length * 60);
      assert.equal(png.readUInt32BE(20), study.rows.length * 60);
    }
    for (const overlay of study.overlays) assert(study.rows[overlay.y]?.[overlay.x]);
  }
  assert.deepEqual([...seen].sort(), [...pilotNames].sort());
});

test('portable HTML includes paired samples, repeated grids and labeled comparison controls', () => {
  const html = outputs.get(`${pilotStem}.html`).toString();
  assert.equal((html.match(/<article>/g) || []).length, 16);
  for (const size of [16, 24, 32, 60]) assert.equal((html.match(new RegExp(`width="${size}" height="${size}"`, 'g')) || []).length, 64);
  assert.equal((html.match(/class="repeat"/g) || []).length, 32);
  assert(html.includes('not an importable pack'));
  assert(html.includes('not a native-client capture'));
  assert(html.includes('id="size32"') && html.includes('id="size60"'));
  assert(html.includes('default-src &#39;none&#39;') || html.includes("default-src 'none'"));
  assert.doesNotMatch(html, /<script\b|src="https?:/i);
  for (const study of pilotStudies()) {
    assert(html.includes(`id="${study.id}"`));
    for (const version of ['current', 'pilot']) assert(html.includes(outputs.get(`${pilotStem}/${study.id}-${version}.png`).toString('base64')));
  }
});

test('pilot rebuilds are byte-identical and production pack baselines remain unchanged', async () => {
  const second = await buildMapPilotOutputs(root, baselineBytes);
  assert.deepEqual([...outputs.keys()], [...second.keys()]);
  for (const [path, bytes] of outputs) assert(bytes.equals(second.get(path)), path);
  // Changing either comparison baseline requires an explicit review, not a pilot rebuild.
  assert.equal(digest(baselineBytes), '0032a64740034f0e8b030ff002c1d90ed13bbaa1a0451eaed17511f5f4a51619');
  assert.equal(digest(await readFile(resolve(root, 'dist/map-packs/aardwolf-terrain-icons.json'))), 'f5badaaccfc7ce858e1955211ec8fd99701a6f2a1ef1a1fca1e3d559cfabee80');
});
