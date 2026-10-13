import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { parseMudForgeLua } from '../tools/lua-compatibility.mjs';

test('source and distributed Lua avoid JavaScript reserved bindings', async () => {
  for (const base of ['src', 'dist']) {
    for (const folder of ['libs', 'plugins']) {
      for (const file of await readdir(resolve(root, base, folder))) {
        const label = `${base}/${folder}/${file}`;
        const source = await readFile(resolve(root, label), 'utf8');
        assert.doesNotThrow(() => parseMudForgeLua(source, label));
      }
    }
  }
});

test('reserved Lua bindings fail with a source location before distribution', () => {
  const declarations = [
    'local package = "char.vitals"',
    'local valid, package = nil, nil',
    'local function normalize(package) end',
    'local callback = function(package) end',
    'function client.get(package) end',
    'local function package() end',
    'function package() end',
    'for _, package in ipairs({}) do end',
    'for package = 1, 2 do end',
    'package = "char.vitals"',
  ];
  for (const source of declarations) {
    assert.throws(() => parseMudForgeLua(`-- fixture\n${source}`, 'fixture.lua'),
      /fixture\.lua:2: JavaScript reserved binding 'package'/, source);
  }
  for (const name of ['arguments', 'eval', 'implements', 'interface', 'private',
    'protected', 'public', 'static', 'let', 'yield', 'await', 'class', 'enum', 'default']) {
    assert.throws(() => parseMudForgeLua(`local ${name} = nil`), /reserved binding/);
    assert.throws(() => parseMudForgeLua(`local callback = function(${name}) end`), /reserved binding/);
  }
});

test('protocol package fields, member functions, strings and comments remain valid', () => {
  assert.doesNotThrow(() => parseMudForgeLua(`
    -- package is valid in data, but cannot be a variable.
    local packageName = "package"
    local data = { package = packageName, ["package"] = "char.vitals" }
    data.package = packageName
    local value = data.package
    function data.package(payload) return payload end
  `));
});
