import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import luaparse from 'luaparse';
import { buildOutputs, root } from '../tools/build-repository.mjs';

test('all distributed Lua parses as Lua 5.1', async () => {
  for (const folder of ['libs', 'plugins']) {
    for (const file of await readdir(resolve(root, 'src', folder))) {
      const source = await readFile(resolve(root, 'src', folder, file), 'utf8');
      assert.doesNotThrow(() => luaparse.parse(source, { luaVersion: '5.1' }), file);
    }
  }
});

test('catalog lists exact generated source bytes and correct integrity metadata', async () => {
  const outputs = await buildOutputs();
  const catalog = JSON.parse(outputs.get('plugins.json'));
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.plugins.length, 4);
  assert.deepEqual(catalog.plugins.map(plugin => plugin.id), [
    'aardwolf-api-core', 'aardwolf-api-vitals-example', 'aardwolf-vitals', 'aardwolf-spells',
  ]);
  assert.equal(catalog.libraries.length, 1);
  assert.equal(catalog.libraries[0].name, 'aardwolf-api');
  for (const listing of [...catalog.plugins, ...catalog.libraries]) {
    assert.equal(listing.version, listing.id === 'aardwolf-vitals' ? '0.1.3' : listing.name === 'aardwolf-api' ? '0.3.0' : listing.id === 'aardwolf-spells' ? '0.2.2' : '0.1.0');
    assert(!listing.downloadUrl.startsWith('https:'));
    const source = outputs.get(listing.downloadUrl);
    assert.equal(listing.size, source.length);
    assert.equal(listing.sha256, createHash('sha256').update(source).digest('hex'));
  }
});

test('build output is deterministic and generated artifacts are current', async () => {
  const first = await buildOutputs();
  const second = await buildOutputs();
  for (const [path, bytes] of first) {
    assert(bytes.equals(second.get(path)), path);
    assert(bytes.equals(await readFile(resolve(root, path))), `${path}: run npm run build`);
  }
});

test('build check resolves paths from an unrelated working directory', () => {
  assert.match(execFileSync(process.execPath, [resolve(root, 'tools/build-repository.mjs'), '--check'], {
    cwd: '/tmp', encoding: 'utf8',
  }), /Checked 6 repository files/);
});
