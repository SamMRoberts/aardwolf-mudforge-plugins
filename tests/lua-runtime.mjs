import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';
import { root } from '../tools/build-repository.mjs';

function pushValue(L, value) {
  if (value === null || value === undefined) lua.lua_pushnil(L);
  else if (typeof value === 'boolean') lua.lua_pushboolean(L, value);
  else if (typeof value === 'number') lua.lua_pushnumber(L, value);
  else if (typeof value === 'string') lua.lua_pushstring(L, to_luastring(value));
  else {
    lua.lua_newtable(L);
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(value)) lua.lua_pushinteger(L, Number(key) + 1);
      else lua.lua_pushstring(L, to_luastring(key));
      pushValue(L, child);
      lua.lua_settable(L, -3);
    }
  }
}

function readValue(L, index) {
  const absolute = lua.lua_absindex(L, index);
  const kind = lua.lua_type(L, absolute);
  if (kind === lua.LUA_TNIL) return null;
  if (kind === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, absolute);
  if (kind === lua.LUA_TNUMBER) return lua.lua_tonumber(L, absolute);
  if (kind === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, absolute));
  if (kind !== lua.LUA_TTABLE) throw new Error('JSON value is not serializable');
  const entries = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, absolute)) {
    // lua_tolstring mutates a numeric key, which would break lua_next.
    const key = lua.lua_type(L, -2) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : to_jsstring(lua.lua_tostring(L, -2));
    entries.push([key, readValue(L, -1)]);
    lua.lua_pop(L, 1);
  }
  const array = entries.length > 0 && entries.every(([key]) => typeof key === 'number' && key >= 1 && key <= entries.length && Number.isInteger(key));
  if (array) {
    const result = [];
    for (const [key, value] of entries) result[key - 1] = value;
    return result;
  }
  return Object.fromEntries(entries);
}

export function runLua(source) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const fail = error => lauxlib.luaL_error(L, to_luastring(error.message));
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, state => {
    try { lua.lua_pushstring(state, to_luastring(JSON.stringify(readValue(state, 1)))); return 1; }
    catch (error) { return fail(error); }
  });
  lua.lua_setfield(L, -2, to_luastring('encode'));
  lua.lua_pushjsfunction(L, state => {
    try { pushValue(state, JSON.parse(to_jsstring(lua.lua_tostring(state, 1)))); return 1; }
    catch (error) { return fail(error); }
  });
  lua.lua_setfield(L, -2, to_luastring('decode'));
  lua.lua_setglobal(L, to_luastring('json'));
  lua.lua_pushjsfunction(L, state => {
    const name = to_jsstring(lua.lua_tostring(state, 1));
    const files = {
      'aardwolf-api': 'src/libs/aardwolf-api.lua',
      core: 'src/plugins/aardwolf-api-core.lua',
      example: 'src/plugins/aardwolf-api-vitals-example.lua',
    };
    if (!files[name]) return lauxlib.luaL_error(state, to_luastring('unknown fixture source'));
    const code = readFileSync(resolve(root, files[name]), 'utf8');
    const status = lauxlib.luaL_loadbuffer(state, to_luastring(code), null, to_luastring(name));
    if (status !== lua.LUA_OK) return lua.lua_error(state);
    lua.lua_pushvalue(state, 2);
    lua.lua_setupvalue(state, -2, 1);
    lua.lua_call(state, 0, 1);
    return 1;
  });
  lua.lua_setglobal(L, to_luastring('load_source'));
  const fixture = readFileSync(resolve(root, 'tests/fixtures/world.lua'), 'utf8');
  try {
    const status = lauxlib.luaL_loadstring(L, to_luastring(`${fixture}\n${source}`));
    if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    }
  } finally {
    lua.lua_close(L);
  }
}
