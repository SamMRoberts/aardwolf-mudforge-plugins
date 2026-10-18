import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { Resvg } from '@resvg/resvg-js';
import { assembleAtlasLua, buildAtlasAssets, buildAtlasOutputs, replaceMarker, validateAtlasManifest } from '../tools/build-atlas.mjs';
import { root } from '../tools/build-repository.mjs';

const registry = JSON.parse(await readFile(resolve(root, 'src/map-packs/aardwolf-three-moons/terrains.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'src/atlas/assets/manifest.json'), 'utf8'));

test('Atlas normalized sheets and mapping deterministically match the reviewed source artwork', () => {
  const output = execFileSync(process.execPath, [resolve(root, 'tools/build-atlas-art.mjs'), '--check'], {
    cwd: '/tmp', encoding: 'utf8', timeout: 60000,
  });
  assert.match(output, /Checked 6 Atlas texture sheets and 114 terrain mappings/);
});

test('Atlas assets cover all canonical terrains and embed each local sheet once', async () => {
  validateAtlasManifest(manifest, registry);
  const assets = await buildAtlasAssets(root);
  assert.equal(assets.terrains.length, 114);
  assert.equal(assets.sheets.length, manifest.sheets.length);
  assert.deepEqual(assets.terrains.map(terrain => [terrain.name, terrain.id]), registry.terrains.map(terrain => [terrain.name.trim().toLowerCase(), terrain.id]));
  for (const sheet of assets.sheets) {
    const original = manifest.sheets.find(item => item.id === sheet.id);
    assert.deepEqual(Buffer.from(sheet.image.split(',')[1], 'base64'), await readFile(resolve(root, 'src/atlas/assets', original.file)));
  }
  assert(assets.terrains.every(terrain => !('image' in terrain)), 'Rooms reference shared textures instead of duplicating images');
  assert(assets.sheets.every(sheet => sheet.image.startsWith('data:image/jpeg;base64,')), 'Runtime sheets use compact JPEGs');
});

test('compact runtime textures retain tile resolution and stay close to the lossless sheets', async () => {
  for (const sheet of manifest.sheets) {
    const png = await readFile(resolve(root, 'src/atlas/assets', `${sheet.id}.png`));
    const lossless = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${sheet.width}" height="${sheet.height}"/></svg>`).render().pixels;
    const runtime = jpeg.decode(await readFile(resolve(root, 'src/atlas/assets', sheet.file)), {useTArray: true});
    assert.equal(runtime.width, sheet.width);
    assert.equal(runtime.height, sheet.height);
    let squaredError = 0;
    for (let index = 0; index < lossless.length; index++) {
      if (index % 4 !== 3) squaredError += (lossless[index] - runtime.data[index]) ** 2;
    }
    const meanSquareError = squaredError / (sheet.width * sheet.height * 3);
    const psnr = 10 * Math.log10(255 ** 2 / meanSquareError);
    assert(psnr >= 29, `${sheet.id}: JPEG fidelity is below the reviewed quality budget (${psnr.toFixed(1)} dB)`);
  }
});

test('Atlas rejects incomplete, ambiguous, unsafe and out-of-bounds artwork metadata', () => {
  for (const mutate of [
    copy => { copy.version = 2; },
    copy => { copy.terrains.pop(); },
    copy => { copy.terrains[1].name = copy.terrains[0].name; },
    copy => { copy.terrains[0].name = ' INSIDE '; },
    copy => { copy.terrains[0].id = 999; },
    copy => { copy.terrains[0].color = 'red'; },
    copy => { copy.terrains[0].sheet = 'missing'; },
    copy => { copy.terrains[0].x = -1; },
    copy => { copy.terrains[0].y = 0.5; },
    copy => { copy.terrains[0].width = 129; },
    copy => { copy.terrains[0].x = copy.sheets[0].width; },
    copy => { Object.assign(copy.terrains[1], {sheet:copy.terrains[0].sheet,x:copy.terrains[0].x,y:copy.terrains[0].y}); },
    copy => { copy.sheets[0].file = '../secret.png'; },
    copy => { copy.sheets[0].file = '/tmp/image.png'; },
    copy => { delete copy.sheets[0].id; },
    copy => { delete copy.sheets[0].file; },
    copy => { copy.sheets[0].width = 0; },
    copy => { copy.sheets.push({...copy.sheets[0]}); },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validateAtlasManifest(copy, registry));
  }
});

test('Atlas assembly fails clearly for ambiguous markers or broken Lua boundaries', () => {
  assert.throws(() => replaceMarker('none', '__TEST__', ''), /exactly one/);
  assert.throws(() => replaceMarker('__TEST____TEST__', '__TEST__', ''), /exactly one/);
  assert.equal(replaceMarker('__TEST__', '__TEST__', '$&'), '$&');
  assert.throws(() => assembleAtlasLua('local html = [====[__ATLAS_HTML__]====]', ']====]'), /delimiter/);
  assert.throws(() => assembleAtlasLua('local const = [====[__ATLAS_HTML__]====]', '<p>safe</p>'), /reserved binding/);
});

test('Atlas produces deterministic standalone artifacts without CDN or external asset references', async () => {
  const source = await readFile(resolve(root, 'src/plugins/aardwolf-atlas.lua'), 'utf8');
  const first = await buildAtlasOutputs(root, source);
  const second = await buildAtlasOutputs(root, source);
  assert.deepEqual([...first.keys()], ['dist/plugins/aardwolf-atlas.lua', 'dist/atlas/aardwolf-atlas.html']);
  for (const [path, bytes] of first) assert.deepEqual(bytes, second.get(path), path);
  const lua = first.get('dist/plugins/aardwolf-atlas.lua').toString();
  assert(first.get('dist/plugins/aardwolf-atlas.lua').length < 5 * 1024 * 1024, 'Catalog download must fit MudForge\'s 5 MiB limit');
  const html = first.get('dist/atlas/aardwolf-atlas.html').toString();
  assert.doesNotMatch(lua, /__ATLAS_(?:HTML|STYLE|ASSETS|SCRIPT)__/);
  assert.doesNotMatch(html, /<(?:script|img|link)\b[^>]*(?:src|href)=["'](?:https?:|\/\/)/i);
  assert(!lua.includes('window.ATLAS_PREVIEW=true;'));
  assert(html.includes('window.ATLAS_PREVIEW=true;'));
  assert(html.includes('Copyright (c) 2010-2026 three.js authors'));
  assert(lua.includes('The above copyright notice and this permission notice shall be included'));
  assert.doesNotMatch(lua, /[^\x00-\x7f]/);
  assert(html.includes('&#8593;'), 'Compass arrow survives ASCII Lua encoding as an HTML entity');
  for (const artifact of [lua, html]) assert.equal((artifact.match(/data:image\/jpeg;base64,/g) || []).length, manifest.sheets.length);
});
