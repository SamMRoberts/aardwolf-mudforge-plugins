import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, transform } from 'esbuild';
import jpeg from 'jpeg-js';
import { parseMudForgeLua } from './lua-compatibility.mjs';

const pngSignature = '89504e470d0a1a0a';

export function validateAtlasManifest(manifest, registry) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.sheets) || !manifest.sheets.length
      || !Array.isArray(manifest.terrains)) throw new Error('Invalid Atlas asset manifest');
  const sheets = new Map();
  for (const sheet of manifest.sheets) {
    if (typeof sheet.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(sheet.id) || sheets.has(sheet.id)
        || typeof sheet.file !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.(?:png|jpg)$/.test(sheet.file)
        || ![sheet.width, sheet.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096)) {
      throw new Error('Invalid Atlas sheet metadata');
    }
    sheets.set(sheet.id, sheet);
  }
  const expected = new Map(registry.terrains.map(terrain => [terrain.name.trim().toLowerCase(), terrain]));
  const seen = new Set();
  for (const terrain of manifest.terrains) {
    const original = expected.get(terrain.name);
    const sheet = sheets.get(terrain.sheet);
    if (!original || seen.has(terrain.name) || terrain.id !== original.id || !/^#[0-9a-f]{6}$/.test(terrain.color)
        || !sheet || ![terrain.x, terrain.y, terrain.width, terrain.height].every(Number.isSafeInteger)
        || terrain.x < 0 || terrain.y < 0 || terrain.width !== 128 || terrain.height !== 128
        || terrain.x + terrain.width > sheet.width || terrain.y + terrain.height > sheet.height) {
      throw new Error(`Invalid Atlas terrain rectangle: ${terrain.name}`);
    }
    seen.add(terrain.name);
  }
  if (seen.size !== expected.size) throw new Error('Atlas terrain coverage differs from the pinned registry');
  for (const sheet of manifest.sheets) {
    const cells = manifest.terrains.filter(terrain => terrain.sheet === sheet.id);
    if (!cells.length) throw new Error(`Unused Atlas sheet: ${sheet.id}`);
    for (let index = 0; index < cells.length; index++) {
      const a = cells[index];
      for (const b of cells.slice(index + 1)) {
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
          throw new Error(`Overlapping Atlas terrain rectangles: ${a.name}, ${b.name}`);
        }
      }
    }
  }
}

export async function buildAtlasAssets(root) {
  const directory = resolve(root, 'src/atlas/assets');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  const registry = JSON.parse(await readFile(resolve(root, 'src/map-packs/aardwolf-three-moons/terrains.json'), 'utf8'));
  validateAtlasManifest(manifest, registry);
  const sheets = [];
  for (const sheet of manifest.sheets) {
    const bytes = await readFile(resolve(directory, sheet.file));
    const png = sheet.file.endsWith('.png');
    if (png) {
      if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== pngSignature
          || bytes.toString('ascii', 12, 16) !== 'IHDR'
          || bytes.readUInt32BE(16) !== sheet.width || bytes.readUInt32BE(20) !== sheet.height) {
        throw new Error(`Atlas PNG dimensions differ from manifest: ${sheet.file}`);
      }
    } else {
      const decoded = jpeg.decode(bytes, {useTArray: true, tolerantDecoding: false, maxResolutionInMP: 16, maxMemoryUsageInMB: 128});
      if (decoded.width !== sheet.width || decoded.height !== sheet.height) throw new Error(`Atlas JPEG dimensions differ from manifest: ${sheet.file}`);
    }
    sheets.push({ id: sheet.id, width: sheet.width, height: sheet.height, image: `data:image/${png ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}` });
  }
  return { version: 1, sheets, terrains: manifest.terrains.map(({name, id, color, sheet, x, y, width, height}) => ({name, id, color, sheet, x, y, width, height})) };
}

export function replaceMarker(source, marker, value) {
  if (source.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker} marker`);
  return source.replace(marker, () => value);
}

export function assembleAtlasLua(source, html, surfaces = {}) {
  if (html.includes(']====]')) throw new Error('Atlas HTML contains the Lua long-string delimiter');
  let assembled = replaceMarker(source, '__ATLAS_HTML__', html);
  for (const role of ['settings', 'details']) {
    const marker = `__ATLAS_${role.toUpperCase()}_HTML__`;
    if (assembled.includes(marker)) {
      if (!surfaces[role] || surfaces[role].includes(']====]')) throw new Error(`Invalid Atlas ${role} document`);
      assembled = replaceMarker(assembled, marker, surfaces[role]);
    }
  }
  parseMudForgeLua(assembled, 'assembled Aardwolf Atlas');
  return Buffer.from(assembled);
}

export async function buildAtlasOutputs(root, source) {
  const [assets, template, css, bundle, license] = await Promise.all([
    buildAtlasAssets(root),
    readFile(resolve(root, 'src/atlas/index.html'), 'utf8'),
    readFile(resolve(root, 'src/atlas/style.css'), 'utf8'),
    build({ absWorkingDir: root, entryPoints: ['src/atlas/main.js'], bundle: true, write: false,
      format: 'iife', platform: 'browser', target: ['safari16'], minify: true, legalComments: 'none',
      charset: 'ascii', sourcemap: false, logLevel: 'silent' }),
    readFile(resolve(root, 'node_modules/three/LICENSE'), 'utf8'),
  ]);
  const assetJson = JSON.stringify(assets).replace(/</g, '\\u003c');
  // The Lua compatibility parser expects ASCII strings. Encode text for its actual
  // HTML/CSS/JS context while preserving the full bundled renderer's MIT notice.
  const asciiTemplate = template.replace(/[^\x00-\x7f]/gu, character => `&#${character.codePointAt(0)};`);
  const asciiCss = await transform(css, { loader: 'css', charset: 'ascii', minify: true, target: ['safari16'] });
  const script = `/* Three.js\n${license.replace(/©/g, '(c)').replace(/\*\//g, '* /')}*/\n${bundle.outputFiles[0].text}`.replace(/<\/script/gi, '<\\/script');
  let html = replaceMarker(asciiTemplate, '__ATLAS_STYLE__', asciiCss.code);
  html = replaceMarker(html, '__ATLAS_ASSETS__', assetJson);
  html = replaceMarker(html, '__ATLAS_SCRIPT__', script);
  const preview = html.replace('<script>', '<script>window.ATLAS_PREVIEW=true;</script><script>');
  const surfaces = {};
  const auxiliary = new Map();
  const surfaceBundle = await build({ absWorkingDir: root, entryPoints: ['src/atlas/surface.js'], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: ['safari16'], minify: true, charset: 'ascii', logLevel: 'silent' });
  for (const role of ['settings', 'details']) {
    let document = (await readFile(resolve(root, `src/atlas/${role}.html`), 'utf8'))
      .replace(/[^\x00-\x7f]/gu, character => `&#${character.codePointAt(0)};`);
    document = replaceMarker(document, '__ATLAS_STYLE__', asciiCss.code);
    if (role === 'details') document = replaceMarker(document, '__ATLAS_ASSETS__', assetJson);
    document = replaceMarker(document, '__ATLAS_SCRIPT__', surfaceBundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
    surfaces[role] = document;
    auxiliary.set(`dist/atlas/aardwolf-atlas-${role}.html`, Buffer.from(document.replace('<script>', '<script>window.ATLAS_PREVIEW=true;</script><script>')));
  }
  const lua = assembleAtlasLua(source, html, surfaces);
  if (lua.length > 5 * 1024 * 1024) throw new Error('Aardwolf Atlas exceeds MudForge\'s 5 MiB plugin catalog limit');
  return new Map([
    ['dist/plugins/aardwolf-atlas.lua', lua],
    ['dist/atlas/aardwolf-atlas.html', Buffer.from(preview)],
    ...auxiliary,
  ]);
}
