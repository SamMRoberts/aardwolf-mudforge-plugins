import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';
import { parseMudForgeLua } from '../tools/lua-compatibility.mjs';

test('SQLite example parses with MudForge Lua compatibility checks', () => {
  parseMudForgeLua(readFileSync(resolve(root, 'examples/sqlite-consumer.lua'), 'utf8'), 'sqlite example');
});

test('Lua facade and Python CLI round-trip real SQLite through atomic files', { timeout: 20000 }, async () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'aardwolf-sqlite-')));
  const helper = spawn('python3', [resolve(root, 'tools/sqlite_helper.py'), '--root', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  helper.stderr.on('data', bytes => { errors += bytes; });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(resolve(directory, 'heartbeat.json'))) {
      if (helper.exitCode !== null) throw new Error(`helper exited: ${errors}`);
      assert(Date.now() < deadline, 'helper did not become ready');
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    runLua(`
      local world = newWorld(); world.connected = true
      local context = world.context("integration", "SQLite integration")
      local poll
      context.host.sqliteReadFile = bridge_read
      context.host.sqliteWriteFile = bridge_write
      context.host.sqliteRenameFile = bridge_rename
      context.host.sqliteRemoveFile = bridge_remove
      context.host.getCurrentTime = bridge_time
      function context.host.addTimer(delay, callback, repeating)
        assert(delay == 250 and repeating); poll = callback; return "integration-poll"
      end
      function context.host.removeTimer() poll = nil end
      local client = freshLibrary().new(context.host, { sqlite = { characterKey = "fixture", bridgeDirectory = bridge_root() } })
      client.start()
      local function awaitResult(invoke, expectFailure)
        local complete, result, issue = false, nil, nil
        invoke(function(value, problem) complete, result, issue = true, value, problem end)
        for index = 1, 400 do
          if complete then break end
          bridge_wait(); assert(poll); poll()
        end
        assert(complete, "bridge operation timed out")
        if expectFailure then assert(not result and issue and issue.outcome == "rolled_back")
        else assert(result and not issue, issue and issue.code or "missing result") end
        return result
      end
      local db = awaitResult(function(done) client.sqlite.open("roundtrip", done) end)
      awaitResult(function(done) db.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT, optional TEXT, data BLOB, big INTEGER)", {}, done) end)
      awaitResult(function(done) db.execute("INSERT INTO records VALUES (?, ?, ?, ?, ?)", {
        1, [[quoted '" 🐺]], client.sqlite.null, client.sqlite.blob("AP8="), client.sqlite.integer("9223372036854775807")
      }, done) end)
      local result = awaitResult(function(done) db.query("SELECT value, optional, data, big FROM records", {}, done) end)
      assert(result.rows[1][1] == [[quoted '" 🐺]] and result.rows[1][2].sqliteType == "null")
      assert(result.rows[1][3].value == "AP8=" and result.rows[1][4].value == "9223372036854775807")
      awaitResult(function(done) db.transaction({
        { kind = "execute", sql = "INSERT INTO records (id) VALUES (2)" },
        { kind = "execute", sql = "INSERT INTO records (id) VALUES (1)" }
      }, done) end, true)
      result = awaitResult(function(done) db.query("SELECT count(*) FROM records", {}, done) end)
      assert(result.rows[1][1] == 1)
      awaitResult(function(done) db.execute("UPDATE records SET value=? WHERE id=?", { "saved", 1 }, done) end)
      db.close()
      db = awaitResult(function(done) client.sqlite.open("roundtrip", done) end)
      result = awaitResult(function(done) db.query("SELECT value FROM records", {}, done) end)
      assert(result.rows[1][1] == "saved")
      awaitResult(function(done) db.execute("DELETE FROM records WHERE id=?", { 1 }, done) end)
      result = awaitResult(function(done) db.query("SELECT * FROM records", {}, done) end)
      assert(#result.rows == 0)
      client.stop(); assert(not poll and #context.errors == 0)

      -- Execute the shipped example with real filesystem operations behind
      -- its native io/os adapter shape, including reload and repeat runs.
      local env = setmetatable({ json = json }, { __index = _G })
      for key, value in pairs(context.host) do env[key] = value end
      local command
      function env.require(name) assert(name == "aardwolf-api"); return freshLibrary() end
      function env.registerCommand(name, handler) assert(name == "awsql-demo"); command = handler end
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
      load_source("sqlite-example", env)
      env.init()
      assert(command("") == "Usage: awsql-demo <stable-character-key>")
      for pass = 1, 2 do
        assert(string.find(command("example-fixture"), "started", 1, true))
        for index = 1, 400 do
          if #context.errors >= pass then break end
          bridge_wait(); assert(poll); poll()
        end
        assert(context.errors[pass] == "SQLite demo passed: create, insert, read, update, rollback and delete.")
        env.cleanup(); assert(not poll); env.init()
      end
      env.cleanup()
    `, {
      bridge_root: () => directory,
      bridge_time: () => Date.now(),
      bridge_wait: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); return true; },
      bridge_read: (path, maximum) => {
        path = path.replace(/^~\/MudForge\/aardwolf-sqlite/, directory);
        if (!existsSync(path)) return null;
        const text = readFileSync(path, 'utf8');
        return Buffer.byteLength(text) <= maximum ? text : null;
      },
      bridge_write: (path, value) => { writeFileSync(path.replace(/^~\/MudForge\/aardwolf-sqlite/, directory), value, { mode: 0o600 }); return true; },
      bridge_rename: (oldPath, newPath) => { renameSync(oldPath.replace(/^~\/MudForge\/aardwolf-sqlite/, directory), newPath.replace(/^~\/MudForge\/aardwolf-sqlite/, directory)); return true; },
      bridge_remove: path => { path = path.replace(/^~\/MudForge\/aardwolf-sqlite/, directory); if (existsSync(path)) unlinkSync(path); return true; },
    });
    const query = 'from pathlib import Path; import sqlite3, sys; p = next((Path(sys.argv[1]) / "databases").glob("*/roundtrip.sqlite")); c = sqlite3.connect(p); print(c.execute("SELECT count(*) FROM records").fetchone()[0]); c.close()';
    assert.equal(execFileSync('python3', ['-c', query, directory], { encoding: 'utf8' }).trim(), '0');
    assert.equal(errors, '');
  } finally {
    const exited = helper.exitCode === null && helper.signalCode === null ? once(helper, 'exit') : null;
    if (exited) { helper.kill('SIGTERM'); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
