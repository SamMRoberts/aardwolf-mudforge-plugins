import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

test('spells collector persists atomic character snapshots through real SQLite', { timeout: 30000 }, async () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'aardwolf-spells-')));
  const helper = spawn('python3', [resolve(root, 'tools/sqlite_helper.py'), '--root', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  let unknownNext = false;
  let replacements = 0;
  let awaitingReadback = false;
  let reconciliations = 0;
  const requests = new Map();
  helper.stderr.on('data', bytes => { errors += bytes; });
  const physical = path => path.replace(/^~\/MudForge\/aardwolf-sqlite/, directory);
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(resolve(directory, 'heartbeat.json'))) {
      if (helper.exitCode !== null) throw new Error(errors);
      assert(Date.now() < deadline, 'helper readiness timeout');
      await new Promise(done => setTimeout(done, 25));
    }
    runLua(`
      local world = newWorld(); world.time = bridge_time(); world.connected = true
      world.core()
      local context = world.context("real-spells", "Aardwolf Spells")
      local reader = world.context("reader", "Reader")
      reader.client = freshLibrary().new(reader.host, { spells = true })
      reader.client.start()
      local env = setmetatable({ json = json }, { __index = _G })
      for key, value in pairs(context.host) do env[key] = value end
      context.env = env
      local poll, captureCallback, commands, sends = nil, nil, {}, {}
      function env.getCurrentTime() return bridge_time() end
      function env.addTimer(delay, callback, repeating)
        if delay == 250 then assert(repeating); poll = callback; return "sql-poll" end
        assert(delay == 60000 and not repeating)
        captureCallback = callback
        return "capture-timeout"
      end
      function env.removeTimer(id)
        if id == "sql-poll" then poll = nil else assert(id == "capture-timeout"); captureCallback = nil end
      end
      function env.registerCommand(name, handler) commands[name] = handler end
      function env.send(command) env.onSend(world.id, command); table.insert(sends, command) end
      local library = freshLibrary()
      function env.require(name) assert(name == "aardwolf-api"); return library end
      env.io = {}
      function env.io.open(path, mode)
        if mode == "r" and not bridge_read(path, 1048577) then return nil end
        if mode == "w" then assert(bridge_write(path, "")) end
        local file, buffer = {}, ""
        function file:read(maximum) return bridge_read(path, maximum) end
        function file:write(text) buffer = buffer .. text; assert(bridge_write(path, buffer)); return file end
        function file:close() return true end
        return file
      end
      env.os = { rename = bridge_rename, remove = bridge_remove }
      load_source("spells", env); env.init()
      world.packet("char.base", { name = "Fixture" })
      world.packet("char.status", { state = 3 })
      local function pump(done)
        for index = 1, 800 do
          if done() then return end
          bridge_wait()
          if poll then poll() end
        end
        error("integration timeout: " .. commands.awspells("status"))
      end
      local function line(text) assert(env.onLine(world.id, text, text) == nil) end
      local function header() line("Skill/Spell name            Level  Sn   %"); line("——————————————————————————  —————  --- ---") end
      local function footer() line("* means that you cannot use the skill/spell.") end
      local function waitIdle() pump(function() return not reader.client.spells.status().refreshing end) end
      pump(function() return #sends == 1 end)
      header()
      line(" Axe                            1    -  85 ")
      line(" *Magic missile                 1   62   0 ")
      for index = 1, 248 do line(" Ability " .. tostring(index) .. "    10 12 -") end
      footer(); waitIdle()
      local saved = reader.client.spells.get()
      assert(saved and #saved.entries == 250, commands.awspells("status"))
      assert(saved.entries[1].sn == nil and saved.entries[1].percent == 85)
      assert(saved.entries[2].unusable and saved.entries[2].percent == 0)
      assert(saved.entries[3].percent == nil and saved.entries[3].sn == 12)
      assert(not poll and not captureCallback)

      -- Force a real SQLite rollback after DELETE and before metadata replacement.
      bridge_trigger(true)
      commands.awspells("refresh"); pump(function() return #sends == 2 end)
      header(); line(" Rejectme    1 - 85"); footer(); waitIdle()
      assert(#reader.client.spells.get().entries == 250 and reader.client.spells.status().error)
      assert(bridge_count() == 250)
      bridge_trigger(false)

      -- Replace the successful commit receipt with an unknown result. The
      -- collector must read back the database rather than replaying the write.
      commands.awspells("refresh"); pump(function() return #sends == 3 end)
      bridge_unknown()
      header(); line(" Fly     36 48 85"); footer(); waitIdle()
      assert(#reader.client.spells.get().entries == 1 and not reader.client.spells.status().error)
      assert(bridge_count() == 1)

      -- Reload actually reads the persisted file before collecting again.
      env.cleanup(); assert(reader.client.spells.get() == nil and not poll)
      env.init(); pump(function() return #sends == 4 end)
      assert(reader.client.spells.get().entries[1].name == "Fly")
      header(); line(" Axe    1 - -"); footer(); waitIdle()

      -- A verified new character routes to a separate managed database.
      world.packet("char.base", { name = "Other" })
      assert(reader.client.spells.get() == nil)
      pump(function() return #sends == 5 end)
      header(); line(" Heal    60 54 -"); footer(); waitIdle()
      assert(reader.client.spells.get().characterName == "Other")
      assert(reader.client.spells.get().entries[1].name == "Heal")
      assert(bridge_databases() == 2)
      world.disconnect(); assert(reader.client.spells.get() == nil and not poll and not captureCallback)
      env.cleanup(); reader.client.stop()
    `, {
      bridge_time: () => Date.now(),
      bridge_wait: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); return true; },
      bridge_read: (path, maximum) => {
        path = physical(path);
        if (!existsSync(path)) return null;
        let text = readFileSync(path, 'utf8');
        const request = requests.get(path);
        if (unknownNext && request?.statements?.[0]?.sql === 'DELETE FROM abilities') {
          const response = JSON.parse(text);
          assert(!response.error, 'commit must succeed before simulating a lost receipt');
          text = JSON.stringify({ version: 1, id: response.id, generation: response.generation, error: { code: 'timeout', outcome: 'unknown' } });
          // io.open checks existence with a read before file:read consumes it.
          // Persist the simulated receipt so both reads see the same outcome.
          writeFileSync(path, text, { mode: 0o600 });
          unknownNext = false;
          awaitingReadback = true;
        }
        return Buffer.byteLength(text) <= maximum ? text : null;
      },
      bridge_write: (path, value) => { writeFileSync(physical(path), value, { mode: 0o600 }); return true; },
      bridge_rename: (oldPath, newPath) => {
        const request = JSON.parse(readFileSync(physical(oldPath), 'utf8'));
        requests.set(resolve(directory, 'responses', request.id + '.json'), request);
        if (request.statements[0]?.sql === 'DELETE FROM abilities') replacements++;
        if (awaitingReadback && request.operation === 'query') {
          reconciliations++;
          awaitingReadback = false;
        }
        renameSync(physical(oldPath), physical(newPath));
        return true;
      },
      bridge_remove: path => { path = physical(path); if (existsSync(path)) unlinkSync(path); return true; },
      bridge_unknown: () => { unknownNext = true; return true; },
      bridge_trigger: enabled => {
        const sql = enabled
          ? "CREATE TRIGGER reject_row BEFORE INSERT ON abilities WHEN NEW.name='Rejectme' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END"
          : 'DROP TRIGGER reject_row';
        execFileSync('python3', ['-c', 'from pathlib import Path; import sqlite3, sys; p=next((Path(sys.argv[1])/"databases").glob("*/spells.sqlite")); c=sqlite3.connect(p); c.execute(sys.argv[2]); c.commit(); c.close()', directory, sql]);
        return true;
      },
      bridge_count: () => Number(execFileSync('python3', ['-c', 'from pathlib import Path; import sqlite3, sys; p=next((Path(sys.argv[1])/"databases").glob("*/spells.sqlite")); c=sqlite3.connect(p); print(c.execute("SELECT count(*) FROM abilities").fetchone()[0]); c.close()', directory], { encoding: 'utf8' }).trim()),
      bridge_databases: () => Number(execFileSync('python3', ['-c', 'from pathlib import Path; import sys; print(len(list((Path(sys.argv[1])/"databases").glob("*/spells.sqlite"))))', directory], { encoding: 'utf8' }).trim()),
    });
    assert.equal(replacements, 5, 'unknown outcomes must not replay replacement transactions');
    assert.equal(reconciliations, 1, 'unknown outcomes must query the committed snapshot');
    assert.equal(errors, '');
  } finally {
    const exited = helper.exitCode === null && helper.signalCode === null ? once(helper, 'exit') : null;
    if (exited) { helper.kill('SIGTERM'); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
