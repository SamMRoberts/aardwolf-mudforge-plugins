import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { root } from '../tools/build-repository.mjs';
import { buildMapPackOutputs, mapPackNames, validateTerrainRegistry } from '../tools/build-map-pack.mjs';

const shopVariantNames = ['shop-counter', 'shop-display', 'shop-shelves'];
const manualShopNames = ['shop-merchant', 'shop-apothecary', 'shop-smith'];

const atlasManifest = JSON.parse(await readFile(resolve(root, 'src/atlas/assets/manifest.json'), 'utf8'));

function decodePng(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // Decode at native resolution independently of the map-pack extraction path.
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}"/></svg>`, { font: { loadSystemFonts: false } }).render();
}

const atlasSheets = new Map(await Promise.all(atlasManifest.sheets.map(async sheet => {
  const { width, pixels } = decodePng(await readFile(resolve(root, 'src/atlas/assets', `${sheet.id}.png`)));
  return [sheet.id, { width, pixels }];
})));

for (const packName of mapPackNames) {
  const themed = packName === 'aardwolf-three-moons';
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
    const manualNames = themed ? [] : manualShopNames;
    assert.equal(registry.terrains.length, 114);
    assert.equal(pack.terrainStyles.length, themed ? 114 : 117);
    assert.equal(new Set(pack.terrainStyles.map(style => style.name)).size, themed ? 114 : 117);
    assert.deepEqual(pack.terrainStyles.map(style => style.name), [...registry.terrains.map(terrain => terrain.name.trim().toLowerCase()), ...manualNames]);
    assert(pack.terrainStyles.some(style => style.name === 'mudschool'));
    assert.deepEqual(Object.keys(pack), ['name', 'description', 'terrainStyles']);
  });

  if (themed) test('Three Moons retains all existing portable pack outputs', async () => {
    for (const [path, bytes] of outputs) assert.deepEqual(bytes, await readFile(resolve(root, path)), path);
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

  if (!themed) test(`${packName}: terrain registry rejects unsafe, duplicate and invalid variant names`, () => {
    for (const variants of ['shop-counter', [], [null], ['../shop'], ['SHOP'], [' shop-counter '], ['shop'], ['water'],
      ['shop-counter', 'shop-counter'], Array.from({ length: 10 }, (_, index) => `shop-variant-${index}`)]) {
      const copy = structuredClone(registry);
      copy.terrains.find(terrain => terrain.name === 'shop').variants = variants;
      assert.throws(() => validateTerrainRegistry(copy), `variants: ${JSON.stringify(variants)}`);
    }
    const copy = structuredClone(registry);
    copy.terrains.find(terrain => terrain.name === 'default').variants = ['shop-counter'];
    assert.throws(() => validateTerrainRegistry(copy), 'variant names must be unique across terrain styles');
  });

  if (!themed) test(`${packName}: manual image registry rejects invalid arrays, names and collisions`, () => {
    for (const manualImages of ['shop-merchant', [], null, {}]) {
      const copy = structuredClone(registry);
      copy.manualImages = manualImages;
      assert.throws(() => validateTerrainRegistry(copy), /manual images/i, JSON.stringify(manualImages));
    }
    for (const manualImages of [[null], ['../shop'], ['SHOP'], [' shop-merchant '], ['shop'], ['water'],
      ['shop-counter'], ['shop-merchant', 'shop-merchant']]) {
      const copy = structuredClone(registry);
      copy.manualImages = manualImages;
      assert.throws(() => validateTerrainRegistry(copy), /manual image/i, JSON.stringify(manualImages));
    }
    const copy = structuredClone(registry);
    delete copy.manualImages;
    assert.doesNotThrow(() => validateTerrainRegistry(copy), 'manual images are optional');
  });

  test(`${packName}: every terrain embeds a unique opaque 128px PNG with its registry fallback color`, async () => {
    const images = new Set();
    const geometry = new Set();
    for (const style of pack.terrainStyles) {
      assert.deepEqual(Object.keys(style), !themed && style.name === 'shop'
        ? ['name', 'color', 'image', 'variants'] : ['name', 'color', 'image']);
      assert.match(style.color, /^#[a-f0-9]{6}$/);
      const terrain = registry.terrains.find(terrain => terrain.name.trim().toLowerCase() === style.name)
        || (!themed && manualShopNames.includes(style.name) ? registry.terrains.find(terrain => terrain.name === 'shop') : null);
      assert(terrain, `${style.name}: missing fallback color source`);
      assert.equal(style.color, terrain.color);
      assert.match(style.image, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
      const png = Buffer.from(style.image.split(',')[1], 'base64');
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 128);
      assert.equal(png.readUInt32BE(20), 128);
      assert.deepEqual(png, outputs.get(`dist/map-packs/${packName}/${style.name}.png`));
      const { pixels } = decodePng(png);
      assert(!images.has(digest(pixels)), `${style.name}: duplicate image`);
      images.add(digest(pixels));
      for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255, `${style.name}: transparent pixel`);
      if (!themed) continue;
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

  if (!themed) test(`${packName}: shop selects three generic opaque variants through all ten vnum slots`, async () => {
    const shop = pack.terrainStyles.find(style => style.name === 'shop');
    const shopTerrain = registry.terrains.find(terrain => terrain.name === 'shop');
    assert.deepEqual(shopTerrain.variants, shopVariantNames);
    assert.deepEqual(pack.terrainStyles.filter(style => style.variants).map(style => style.name), ['shop']);
    const images = [];
    const pixelsSeen = new Set(pack.terrainStyles.map(style => digest(decodePng(Buffer.from(style.image.split(',')[1], 'base64')).pixels)));
    for (const name of shopVariantNames) {
      const source = await readFile(resolve(root, packDirectory, 'variants', `${name}.png`));
      assert.equal(source.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(source.readUInt32BE(16), source.readUInt32BE(20), `${name}: source must be square`);
      assert(source.readUInt32BE(16) >= 128 && source.readUInt32BE(16) <= 4096, `${name}: source must be 128–4096 pixels`);
      const emitted = outputs.get(`dist/map-packs/${packName}/${name}.png`);
      assert(emitted, `${name}: missing distributed variant PNG`);
      assert.equal(emitted.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(emitted.readUInt32BE(16), 128);
      assert.equal(emitted.readUInt32BE(20), 128);
      const { pixels } = decodePng(emitted);
      const sourceAtRoomSize = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><image href="data:image/png;base64,${source.toString('base64')}" width="128" height="128"/></svg>`, { font: { loadSystemFonts: false } }).render();
      assert.deepEqual(pixels, sourceAtRoomSize.pixels, `${name}: exported artwork differs from the full source image`);
      const hash = digest(pixels);
      assert(!pixelsSeen.has(hash), `${name}: variant duplicates an existing image`);
      pixelsSeen.add(hash);
      for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255, `${name}: transparent pixel`);
      images.push(`data:image/png;base64,${emitted.toString('base64')}`);
    }
    const [first, second, third] = images;
    assert.deepEqual(shop.variants, ['', first, second, third, '', first, second, third, '', first]);
    // MudForge indexes these slots by vnum % 10; empty slots retain the base image.
    const selected = Array.from({ length: 10 }, (_, index) => shop.variants[(10000 + index) % 10] || shop.image);
    assert.equal(selected.filter(image => image === shop.image).length, 3);
    assert.equal(selected.filter(image => image === first).length, 3);
    assert.equal(selected.filter(image => image === second).length, 2);
    assert.equal(selected.filter(image => image === third).length, 2);
  });

  if (!themed) test(`${packName}: vendor artwork is selectable by terrain name and excluded from automatic variants`, async () => {
    assert.deepEqual(registry.manualImages, manualShopNames);
    const automaticVariants = new Set(pack.terrainStyles.flatMap(style => style.variants || []).filter(Boolean));
    const variantHashes = new Set([...automaticVariants].map(image => digest(decodePng(Buffer.from(image.split(',')[1], 'base64')).pixels)));
    const shop = pack.terrainStyles.find(style => style.name === 'shop');
    for (const name of manualShopNames) {
      const style = pack.terrainStyles.find(style => style.name === name);
      assert(style, `${name}: missing selectable terrain style`);
      assert(!Object.hasOwn(style, 'variants'), `${name}: manually selected vendors must not have automatic variants`);
      const source = await readFile(resolve(root, packDirectory, 'variants', `${name}.png`));
      const emitted = outputs.get(`dist/map-packs/${packName}/${name}.png`);
      assert(emitted, `${name}: missing manual PNG`);
      assert.equal(emitted.readUInt32BE(16), 128);
      assert.equal(emitted.readUInt32BE(20), 128);
      const { pixels } = decodePng(emitted);
      const sourceAtRoomSize = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><image href="data:image/png;base64,${source.toString('base64')}" width="128" height="128"/></svg>`, { font: { loadSystemFonts: false } }).render();
      assert.deepEqual(pixels, sourceAtRoomSize.pixels, `${name}: preserved manual artwork differs from source`);
      const image = `data:image/png;base64,${emitted.toString('base64')}`;
      assert.deepEqual(style, { name, color: shop.color, image });
      assert(!automaticVariants.has(image), `${name}: manual artwork appears in an automatic variant slot`);
      assert(!variantHashes.has(digest(pixels)), `${name}: manual artwork duplicates an automatic variant`);
      assert(!shop.variants.includes(style.image), `${name}: manual terrain image must never be selected by shop vnum`);
      for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255, `${name}: transparent pixel`);
    }
  });

  if (!themed) test(`${packName}: every tile exactly matches its named Atlas room rectangle`, () => {
    assert.equal(atlasManifest.terrains.length, registry.terrains.length);
    for (const terrain of registry.terrains) {
      const name = terrain.name.trim().toLowerCase();
      const rectangle = atlasManifest.terrains.find(item => item.name === name);
      assert(rectangle, `${name}: missing Atlas rectangle`);
      assert.equal(rectangle.id, terrain.id, `${name}: Atlas terrain ID differs`);
      const sheet = atlasSheets.get(rectangle.sheet);
      const { pixels } = decodePng(outputs.get(`dist/map-packs/${packName}/${name}.png`));
      for (let y = 0; y < 128; y++) {
        const sourceOffset = ((rectangle.y + y) * sheet.width + rectangle.x) * 4;
        assert.deepEqual(pixels.subarray(y * 128 * 4, (y + 1) * 128 * 4),
          sheet.pixels.subarray(sourceOffset, sourceOffset + 128 * 4), `${name}: Atlas artwork differs on row ${y}`);
      }
    }
  });

  test(`${packName}: contact sheet includes all terrains at three sizes on both backgrounds`, () => {
    const html = outputs.get(previewOutput).toString();
    const cardCount = themed ? 114 : 120;
    assert.equal((html.match(/<article>/g) || []).length, cardCount);
    assert.equal((html.match(/class="samples dark"/g) || []).length, cardCount);
    assert.equal((html.match(/class="samples light"/g) || []).length, cardCount);
    for (const size of [16, 24, 32]) assert.equal((html.match(new RegExp(`width="${size}" height="${size}"`, 'g')) || []).length, cardCount * 2);
    for (const style of pack.terrainStyles) assert(html.includes(`<h2>${style.name}</h2>`));
    assert.doesNotMatch(html, /<script\b|src="https?:/i);
    assert(html.includes('class="map-study"'));
    assert(html.includes('not a native-client capture'));
    if (themed) {
      assert.equal((html.match(/class="repeat-grid"/g) || []).length, 114);
      assert(html.includes('3 × 3 tiled'));
      assert(html.includes('Dense 5 × 5 tiling study'));
    } else {
      assert(html.includes('Atlas artwork'));
      assert(!html.includes('Editable SVG sources'));
      for (const name of shopVariantNames) assert(html.includes(`<h2>${name}</h2>`));
      const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
      const shopIndex = headings.indexOf('shop');
      assert.deepEqual(headings.slice(shopIndex, shopIndex + 4), ['shop', ...shopVariantNames]);
      assert.deepEqual(headings.slice(-3), manualShopNames);
      assert.equal((html.match(/Manual assignment only/g) || []).length, 3);
      assert.match(html, /generic/i);
    }
  });

  if (themed) test(`${packName}: terrain pixels are opaque and preserve the pack edge contract`, async () => {
    for (const terrain of registry.terrains) {
      const name = terrain.name.toLowerCase();
      const svg = await readFile(resolve(root, packDirectory, 'icons', `${name}.svg`), 'utf8');
      const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
      assert.equal(rendered.width, 128);
      assert.equal(rendered.height, 128);
      const pixels = rendered.pixels;
      const edgeColors = new Set();
      for (let index = 0; index < rendered.width; index++) {
        for (const [x, y] of [[index, 0], [index, 127], [0, index], [127, index]]) {
          const offset = (y * rendered.width + x) * 4;
          const pixel = pixels.subarray(offset, offset + 4);
          edgeColors.add(pixel.toString('hex'));
        }
      }
      assert(edgeColors.size > 1, `${name}: a flat-color perimeter reintroduces a room frame`);
      assert(svg.includes('id="terrain-surface"'), `${name}: missing repeating surface`);
      for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255, `${name}: transparent pixel`);
    }
    const urbanNames = ['city', 'shop', 'castle', 'alley', 'temple'];
    const urban = registry.terrains.filter(terrain => urbanNames.includes(terrain.name));
    assert.equal(new Set(urban.map(terrain => terrain.color)).size, 1, 'adjoining urban terrain shares its stone edge color');
    const timberRooms = registry.terrains.filter(terrain => ['inside', 'hut', 'cabin', 'office', 'archive'].includes(terrain.name));
    assert.equal(new Set(timberRooms.map(terrain => terrain.color)).size, 1, 'timber interiors share their floor edge color');
    assert(timberRooms.every(terrain => terrain.family === 'wood'));
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

test('Atlas map pack validates its manifest and lossless sheets before exporting', async t => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'aardwolf-map-pack-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const atlasDirectory = resolve(fixtureRoot, 'src/atlas/assets');
  const registryDirectory = resolve(fixtureRoot, 'src/map-packs/aardwolf-terrain-icons');
  await mkdir(atlasDirectory, { recursive: true });
  await mkdir(registryDirectory, { recursive: true });
  await copyFile(resolve(root, 'src/map-packs/aardwolf-terrain-icons/terrains.json'), resolve(registryDirectory, 'terrains.json'));
  await mkdir(resolve(registryDirectory, 'variants'));
  for (const name of [...shopVariantNames, ...manualShopNames]) {
    await copyFile(resolve(root, 'src/map-packs/aardwolf-terrain-icons/variants', `${name}.png`), resolve(registryDirectory, 'variants', `${name}.png`));
  }
  for (const sheet of atlasManifest.sheets) {
    await copyFile(resolve(root, 'src/atlas/assets', `${sheet.id}.png`), resolve(atlasDirectory, `${sheet.id}.png`));
  }
  const manifestPath = resolve(atlasDirectory, 'manifest.json');
  for (const [label, mutate] of [
    ['unsupported manifest', copy => { copy.version = 2; }],
    ['missing terrain', copy => { copy.terrains.pop(); }],
    ['mismatched terrain ID', copy => { copy.terrains[0].id = 999; }],
    ['missing sheet reference', copy => { copy.terrains[0].sheet = 'missing'; }],
    ['out-of-bounds rectangle', copy => { copy.terrains[0].x = copy.sheets[0].width; }],
  ]) {
    await t.test(label, async () => {
      const copy = structuredClone(atlasManifest);
      mutate(copy);
      await writeFile(manifestPath, JSON.stringify(copy));
      await assert.rejects(buildMapPackOutputs(fixtureRoot), /Atlas/);
    });
  }
  await t.test('lookup follows terrain names instead of manifest order and uses only lossless sheets', async () => {
    const copy = structuredClone(atlasManifest);
    copy.terrains.reverse();
    await writeFile(manifestPath, JSON.stringify(copy));
    const actual = await buildMapPackOutputs(fixtureRoot);
    const expected = await buildMapPackOutputs(root);
    assert.deepEqual(actual, expected);
  });
  await t.test('variant artwork must exist and be a square opaque PNG', async t => {
    const variantPath = resolve(registryDirectory, 'variants/shop-counter.png');
    const original = await readFile(variantPath);
    const image = (width, height, opaque) => Buffer.from(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${opaque ? `<rect width="${width}" height="${height}" fill="#85603b"/>` : ''}</svg>`, { font: { loadSystemFonts: false } }).render().asPng());
    const oversized = Buffer.from(original);
    oversized.writeUInt32BE(4097, 16);
    oversized.writeUInt32BE(4097, 20);
    for (const [label, bytes, error] of [
      ['missing', null, /ENOENT/],
      ['malformed', Buffer.from('not a PNG'), /square PNG/i],
      ['nonsquare', image(128, 256, true), /square PNG/i],
      ['undersized', image(64, 64, true), /square PNG/i],
      ['oversized', oversized, /square PNG/i],
      ['transparent', image(128, 128, false), /opaque/i],
    ]) {
      await t.test(label, async () => {
        try {
          if (bytes) await writeFile(variantPath, bytes);
          else await rm(variantPath);
          await assert.rejects(buildMapPackOutputs(fixtureRoot), error);
        } finally {
          await writeFile(variantPath, original);
        }
      });
    }
  });
  await t.test('manual artwork is required and rejects transparent images', async () => {
    const manualPath = resolve(registryDirectory, 'variants/shop-merchant.png');
    const original = await readFile(manualPath);
    try {
      await rm(manualPath);
      await assert.rejects(buildMapPackOutputs(fixtureRoot), /ENOENT/);
      const transparent = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"/>', { font: { loadSystemFonts: false } }).render().asPng();
      await writeFile(manualPath, transparent);
      await assert.rejects(buildMapPackOutputs(fixtureRoot), /opaque/i);
    } finally {
      await writeFile(manualPath, original);
    }
  });
  await t.test('PNG dimensions must match declared sheet dimensions', async () => {
    await writeFile(manifestPath, JSON.stringify(atlasManifest));
    const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>').render().asPng();
    await writeFile(resolve(atlasDirectory, `${atlasManifest.sheets[0].id}.png`), png);
    await assert.rejects(buildMapPackOutputs(fixtureRoot), /Atlas.*dimensions|dimensions.*Atlas/i);
  });
});

test('Three Moons is a separate complete design rather than an alias of the original pack', async () => {
  const original = await buildMapPackOutputs(root, mapPackNames[0]);
  const themed = await buildMapPackOutputs(root, mapPackNames[1]);
  const originalPack = JSON.parse(original.get(`dist/map-packs/${mapPackNames[0]}.json`));
  const themedPack = JSON.parse(themed.get(`dist/map-packs/${mapPackNames[1]}.json`));
  assert.equal(themedPack.name, 'Andolor: Three Moons');
  const originalCanonicalStyles = originalPack.terrainStyles.filter(style => !manualShopNames.includes(style.name));
  assert.equal(originalCanonicalStyles.length, 114);
  assert.deepEqual(themedPack.terrainStyles.map(style => style.name), originalCanonicalStyles.map(style => style.name));
  for (let index = 0; index < themedPack.terrainStyles.length; index++) {
    assert.notEqual(themedPack.terrainStyles[index].image, originalCanonicalStyles[index].image);
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
