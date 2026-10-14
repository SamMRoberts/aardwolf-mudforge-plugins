import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const fixture = `
function sqliteWorld()
  local world = newWorld()
  world.connected = true
  world.files, world.requests = {}, {}
  world.generation = string.rep("a", 32)
  function world.ready()
    world.files["/bridge/heartbeat.json"] = json.encode({ version = 1, generation = world.generation, time = world.time })
  end
  function world.sqliteConsumer(id, characterKey, timeout)
    local context = world.context(id or "sql-plugin", "SQLite fixture")
    context.timerAdds, context.timerRemoves, context.fileWrites = 0, 0, 0
    function context.host.sqliteReadFile(path, maximum)
      if context.readThrows then error("private read error") end
      assert(maximum == 1048577)
      return world.files[path]
    end
    function context.host.sqliteWriteFile(path, value)
      if context.writeRefused then return false end
      world.files[path] = value
      context.fileWrites = context.fileWrites + 1
      return true
    end
    function context.host.sqliteRenameFile(old, new)
      if context.renameRefused then return false end
      world.files[new], world.files[old] = world.files[old], nil
      table.insert(world.requests, json.decode(world.files[new]))
      return true
    end
    function context.host.sqliteRemoveFile(path) world.files[path] = nil; return true end
    function context.host.addTimer(delay, callback, repeating)
      assert(delay == 250 and repeating == true)
      if context.refuseTimers then return "" end
      context.timerAdds = context.timerAdds + 1
      context.poll = callback
      return "sqlite-poll-" .. context.id
    end
    function context.host.removeTimer(id)
      context.timerRemoves = context.timerRemoves + 1
      context.poll = nil
    end
    context.lib = freshLibrary()
    context.client = context.lib.new(context.host, { sqlite = {
      characterKey = characterKey or "character", bridgeDirectory = "/bridge", timeoutMs = timeout
    } })
    assert(context.fileWrites == 0 and context.timerAdds == 0)
    context.client.start()
    return context
  end
  function world.reply(context, result, issue, request)
    local item = request or world.requests[#world.requests]
    world.files["/bridge/responses/" .. item.id .. ".json"] = json.encode({
      version = 1, id = item.id, generation = item.generation, result = result, error = issue
    })
    context.poll()
  end
  function world.open(context, name)
    local database, errorValue
    context.client.sqlite.open(name or "records", function(value, issue) database, errorValue = value, issue end)
    world.reply(context, { opened = true })
    assert(database and not errorValue)
    return database
  end
  world.ready()
  return world
end
`;

const cases = {
  'SQLite is optional, lazy, and validates configuration without side effects': `
    local world = newWorld(); local context = world.context("plain", "Plain")
    local lib = freshLibrary()
    local plain = lib.new(context.host)
    assert(not plain.sqlite.status().configured)
    local calls = 0
    plain.sqlite.open("records", function(value, issue) calls = calls + 1; assert(not value and issue.code == "unconfigured") end)
    assert(calls == 1)
    assert(not pcall(lib.new, context.host, { sqlite = {} }))
    local sql = sqliteWorld(); local consumer = sql.sqliteConsumer()
    assert(consumer.client.sqlite.status().available)
    assert(#sql.requests == 0 and consumer.timerAdds == 0)
  `,
  'SQLite operates independently of GMCP Core and namespaces every request': `
    local world = sqliteWorld()
    local context = world.sqliteConsumer("one", "first")
    assert(not context.client.status().available)
    local db = world.open(context)
    local first = world.requests[1]
    assert(first.namespace.pluginId == "one" and first.namespace.characterKey == "first")
    assert(first.database.kind == "managed" and first.database.name == "records")
    assert(first.version == 1 and first.expiresAt == 10000)
    local other = world.sqliteConsumer("two", "second")
    world.open(other)
    assert(world.requests[2].namespace.pluginId == "two" and world.requests[2].namespace.characterKey == "second")
    assert(world.requests[1].id ~= world.requests[2].id)
    context.client.sqlite.openAlias("shared", function(value) assert(value) end)
    assert(world.requests[3].database.kind == "alias")
    world.reply(context, { opened = true })
  `,
  'requests serialize and callback reentrancy preserves FIFO and timer ownership': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local order = {}
    db.execute("INSERT INTO sample VALUES (?)", { 1 }, function(value)
      assert(value.changes == 1 and value.lastInsertId == 7)
      table.insert(order, 1)
      db.execute("DELETE FROM sample", {}, function() table.insert(order, 3) end)
    end)
    db.query("SELECT value FROM sample", {}, function(value) table.insert(order, 2); assert(value.rows[1][1] == 2) end)
    assert(#world.requests == 2 and context.timerAdds == 2)
    world.reply(context, { changes = 1, lastInsertId = { type = "integer", value = "7" } })
    assert(#world.requests == 3 and world.requests[3].operation == "query")
    world.reply(context, { columns = { "value" }, rows = { { { type = "integer", value = "2" } } } })
    assert(#world.requests == 4)
    world.reply(context, { changes = 1, lastInsertId = { type = "null" } })
    assert(table.concat(order, ",") == "1,2,3" and context.poll == nil and context.timerRemoves == 2)
  `,
  'NULL BLOB int64 booleans Unicode and NUL preserve their wire types': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local api, received = context.client.sqlite, nil
    db.query("SELECT ?, ?, ?, ?, ?, ?, ?", {
      api.null, api.blob("AP8="), api.integer("9223372036854775807"), false, [[quoted '" 🐺]], "a\\0b", api.real(1e30)
    }, function(value) received = value end)
    local params = world.requests[2].statements[1].params
    assert(params[1].type == "null" and params[2].type == "blob" and params[3].value == "9223372036854775807")
    assert(params[4].type == "integer" and params[4].value == "0" and params[6].value == "a\\0b")
    world.reply(context, { columns = { "a", "a", "c", "d", "e", "f", "g" }, rows = { params } })
    assert(received.columns[1] == received.columns[2] and #received.rows[1] == 7)
    assert(received.rows[1][1].sqliteType == "null" and received.rows[1][2].value == "AP8=")
    assert(received.rows[1][3].sqliteType == "integer" and received.rows[1][4] == 0)
    assert(received.rows[1][6] == "a\\0b")
    assert(params[7].type == "real" and received.rows[1][7] == 1e30)
  `,
  'numeric string and zero-based arrays are accepted without skipping values': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local result
    db.query("SELECT ?, ?", { ["0"] = 1, ["1"] = 2 }, function(value) result = value end)
    assert(#world.requests[2].statements[1].params == 2)
    world.reply(context, { columns = { ["0"] = "a", ["1"] = "b" }, rows = {
      ["0"] = { ["0"] = { type = "integer", value = "1" }, ["1"] = { type = "integer", value = "2" } }
    } })
    assert(result.rows[1][1] == 1 and result.rows[1][2] == 2)
  `,
  'transactions preserve statement order and report helper rollback safely': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local result, issue
    local batch = { { kind = "execute", sql = "INSERT INTO sample VALUES (?)", params = { 1 } },
      { kind = "query", sql = "SELECT * FROM sample" } }
    db.transaction(batch, function(value, errorValue) result, issue = value, errorValue end)
    batch[1].params[1] = 999
    assert(world.requests[2].statements[1].params[1].value == "1")
    world.reply(context, { results = {
      { changes = 1, lastInsertId = { type = "integer", value = "1" } },
      { columns = { "n" }, rows = { { { type = "integer", value = "1" } } } }
    } })
    assert(result.results[2].rows[1][1] == 1 and not issue)
    db.transaction(batch, function(value, errorValue) result, issue = value, errorValue end)
    world.reply(context, nil, { code = "sqlite_constraint_primarykey", message = "private SQL or data", outcome = "rolled_back" })
    assert(not result and issue.outcome == "rolled_back" and not string.find(issue.message, "private", 1, true))
  `,
  'invalid statements names parameters and limits never publish work': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local errors = 0
    local function refused(value, issue) assert(not value and issue.outcome == "rejected"); errors = errors + 1 end
    context.client.sqlite.open("../escape", refused)
    db.query("", {}, refused)
    db.query("SELECT ?", { [2] = 1 }, refused)
    db.query("SELECT ?", { function() end }, refused)
    db.query("SELECT ?", { 9007199254740992 }, refused)
    db.transaction({}, refused)
    db.execute("SELECT 1", { named = 1 }, refused)
    db.query("SELECT ?", { string.rep("x", 1048576) }, refused)
    assert(errors == 8 and #world.requests == 1)
    assert(not pcall(context.client.sqlite.integer, "9223372036854775808"))
    assert(not pcall(context.client.sqlite.blob, "invalid"))
  `,
  'queue limit rejects the 33rd pending request and stop drains every callback': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local cancelled, unknown, rejected = 0, 0, 0
    for index = 1, 33 do db.execute("INSERT INTO sample VALUES (?)", { index }, function(value, issue)
      assert(not value)
      if issue.code == "queue_limit" then rejected = rejected + 1
      else cancelled = cancelled + 1; if issue.outcome == "unknown" then unknown = unknown + 1 end end
    end) end
    assert(rejected == 1 and #world.requests == 2)
    context.client.stop(); context.client.stop()
    assert(cancelled == 32 and unknown == 1 and context.poll == nil)
  `,
  'disconnect rejects unsent work and invalidates only submitted outcomes': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local issues = {}
    local function done(value, issue) table.insert(issues, issue) end
    db.execute("INSERT INTO sample VALUES (1)", {}, done)
    local stalePoll, request = context.poll, world.requests[2]
    db.query("SELECT * FROM sample", {}, done)
    world.disconnect()
    assert(#issues == 2 and issues[1].outcome == "unknown" and issues[2].outcome == "rejected")
    db.query("SELECT 1", {}, done)
    assert(#issues == 3 and issues[3].code == "disconnected")
    world.files["/bridge/responses/" .. request.id .. ".json"] = json.encode({ version = 1, id = request.id,
      generation = request.generation, result = { changes = 1, lastInsertId = { type = "null" } } })
    stalePoll(); assert(#issues == 3)
    world.connected = true; world.ready()
    db.query("SELECT 1", {}, function(value) assert(value) end)
    world.reply(context, { columns = {}, rows = {} })
  `,
  'close drains accepted work; stop closes handles and permits a fresh start': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(); local db = world.open(context)
    local calls = 0
    db.execute("INSERT INTO sample VALUES (1)", {}, function(value) calls = calls + 1; assert(value) end)
    db.close(); db.close()
    db.query("SELECT 1", {}, function(value, issue) calls = calls + 1; assert(issue.code == "database_closed") end)
    world.reply(context, { changes = 1, lastInsertId = { type = "null" } })
    assert(calls == 2)
    local old = world.open(context)
    context.client.stop(); context.client.start()
    old.query("SELECT 1", {}, function(value, issue) assert(issue.code == "database_closed") end)
    world.open(context)
  `,
  'missing stale malformed heartbeat and refused timers fail before publication': `
    local world = sqliteWorld(); local context = world.sqliteConsumer()
    local calls = 0
    local function refused(value, issue) calls = calls + 1; assert(not value and issue.outcome == "rejected") end
    world.time = 6000; context.client.sqlite.open("records", refused)
    world.files["/bridge/heartbeat.json"] = "bad JSON"; context.client.sqlite.open("records", refused)
    world.ready(); context.readThrows = true; context.client.sqlite.open("records", refused)
    context.readThrows = false; context.refuseTimers = true; context.client.sqlite.open("records", refused)
    assert(calls == 4 and #world.requests == 0)
  `,
  'timeout helper restart invalid response and callback exceptions never duplicate calls': `
    local world = sqliteWorld(); local context = world.sqliteConsumer(nil, nil, 1000); local db = world.open(context)
    local issues = {}
    local function done(value, issue) table.insert(issues, issue) end
    db.query("SELECT 1", {}, done)
    world.time = 1000; world.ready(); context.poll()
    assert(issues[1].code == "timeout" and issues[1].outcome == "unknown")
    db.query("SELECT 1", {}, done)
    world.generation = string.rep("b", 32); world.ready(); context.poll()
    assert(issues[2].code == "helper_restarted")
    db.query("SELECT 1", {}, done)
    world.reply(context, { columns = { "a" }, rows = { { { type = "real", value = "invalid" } } } })
    assert(issues[3].code == "invalid_response")
    db.query("SELECT 1", {}, function() error("private callback error") end)
    db.query("SELECT 2", {}, function(value) assert(value); table.insert(issues, { code = "finished" }) end)
    world.reply(context, { columns = {}, rows = {} })
    world.reply(context, { columns = {}, rows = {} })
    assert(issues[4].code == "finished" and #context.errors == 1)
    assert(context.errors[1] == "aardwolf-api SQLite callback failed")
  `,
  'write and publication failures return explicit outcomes and leave no temporary files': `
    local world = sqliteWorld(); local context = world.sqliteConsumer()
    local issues = {}
    local function done(value, issue) table.insert(issues, issue) end
    context.writeRefused = true; context.client.sqlite.open("records", done)
    context.writeRefused = false; context.renameRefused = true; context.client.sqlite.open("records", done)
    assert(issues[1].code == "file_write_failed" and issues[1].outcome == "rejected")
    assert(issues[2].code == "file_publish_failed" and issues[2].outcome == "unknown")
    assert(#world.requests == 0)
    for key in pairs(world.files) do assert(not string.find(key, ".tmp", 1, true)) end
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + source));
