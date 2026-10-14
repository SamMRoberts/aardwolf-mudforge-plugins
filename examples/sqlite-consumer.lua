-- Run awsql-demo <stable-character-key> in a disposable, connected world.
-- Enable this plugin's File System Access and start tools/sqlite_helper.py first.
plugin = {
  id = "aardwolf-sqlite-example", name = "Aardwolf SQLite Example", version = "0.1.0",
  author = "Sam Roberts", description = "Explicit SQLite CRUD and atomic rollback demonstration."
}

local client, database, busy, unloading = nil, nil, false, false

-- Inject text-only adapters; the helper owns all binary SQLite file access.
local function readFile(path, maximum)
  local file = io.open(path, "r")
  if type(file) == "nil" then return nil end
  local ok, text = pcall(function() return file:read(maximum) end)
  pcall(function() file:close() end)
  if ok then return text end
  return nil
end

local function writeFile(path, text)
  local file = io.open(path, "w")
  if type(file) == "nil" then return false end
  local ok, accepted = pcall(function()
    local written = file:write(text)
    return type(written) ~= "nil" and written ~= false
  end)
  local closed, saved = pcall(function() return file:close() end)
  return ok and accepted and closed and saved ~= false
end

local function finish(issue)
  busy = false
  if database then database.close(); database = nil end
  if not unloading then
    if issue then echo("SQLite demo failed: " .. issue.code .. " (" .. issue.outcome .. ")")
    else echo("SQLite demo passed: create, insert, read, update, rollback and delete.") end
  end
end

local function demonstration()
  client.sqlite.open("sqlite-demo", function(value, issue)
    if issue then finish(issue); return end
    database = value
    database.execute("CREATE TABLE IF NOT EXISTS demo_records (id INTEGER PRIMARY KEY, label TEXT)", {}, function(_, createError)
      if createError then finish(createError); return end
      database.execute("INSERT INTO demo_records (id, label) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET label=excluded.label",
        { 1, "first value" }, function(_, insertError)
        if insertError then finish(insertError); return end
        database.query("SELECT label FROM demo_records WHERE id=?", { 1 }, function(rows, readError)
          if readError then finish(readError); return end
          if #rows.rows ~= 1 or rows.rows[1][1] ~= "first value" then
            finish({ code = "unexpected_read", outcome = "unknown" }); return
          end
          database.execute("UPDATE demo_records SET label=? WHERE id=?", { "updated value", 1 }, function(_, updateError)
            if updateError then finish(updateError); return end
            database.transaction({
              { kind = "execute", sql = "INSERT INTO demo_records (id, label) VALUES (?, ?)", params = { 2, "must roll back" } },
              { kind = "execute", sql = "INSERT INTO demo_records (id, label) VALUES (?, ?)", params = { 1, "duplicate primary key" } }
            }, function(_, rollbackError)
              if type(rollbackError) ~= "table" or rollbackError.outcome ~= "rolled_back" then
                finish(rollbackError or { code = "expected_rollback", outcome = "unknown" }); return
              end
              database.query("SELECT id, label FROM demo_records ORDER BY id", {}, function(saved, verifyError)
                if verifyError then finish(verifyError); return end
                if #saved.rows ~= 1 or saved.rows[1][1] ~= 1 or saved.rows[1][2] ~= "updated value" then
                  finish({ code = "unexpected_rollback", outcome = "unknown" }); return
                end
                database.execute("DELETE FROM demo_records WHERE id=?", { 1 }, function(_, deleteError) finish(deleteError) end)
              end)
            end)
          end)
        end)
      end)
    end)
  end)
end

function init()
  if unloading then unloading = false end
  registerCommand("awsql-demo", function(characterKey)
    if busy then return "SQLite demo is already running." end
    if type(characterKey) ~= "string" or string.match(characterKey, "^[A-Za-z0-9_-]+$") == nil or #characterKey > 128 then
      return "Usage: awsql-demo <stable-character-key>"
    end
    if client then client.stop() end
    local aardwolf = require("aardwolf-api")
    client = aardwolf.new({
      findPluginByName = findPluginByName, onPluginBroadcast = onPluginBroadcast,
      broadcastToPlugin = broadcastToPlugin, on = on, off = off,
      getPluginId = getPluginId, getSession = getSession, getCurrentTime = getCurrentTime,
      addTimer = addTimer, removeTimer = removeTimer,
      sqliteReadFile = readFile, sqliteWriteFile = writeFile,
      sqliteRenameFile = os.rename, sqliteRemoveFile = os.remove
    }, { sqlite = { characterKey = characterKey } })
    client.start()
    local status = client.sqlite.status()
    if not status.available then return "SQLite is unavailable: " .. status.reason end
    busy = true
    demonstration()
    return "SQLite demo started in its dedicated sqlite-demo database."
  end, "Run the local SQLite CRUD and rollback demonstration")
end

function cleanup()
  unloading = true
  if client then client.stop(); client = nil end
  database, busy = nil, false
end
