plugin = {
  id = "aardwolf-spells", name = "Aardwolf Spells", version = "0.1.0",
  author = "Sam Roberts", description = "Collects allspells skills and spells into character-specific SQLite snapshots."
}

local PREFIX = "aardwolf-spells:"
local FOOTER = "* means that you cannot use the skill/spell."
local client, libraryApi, database, characterName, characterKey = nil, nil, nil, nil, nil
local initialized, registered, rebuilding, automaticAttempted = false, false, false, false
local automaticCharacterKey = nil
local generation, captureTimer = 0, nil
local snapshot, capture, busy, uncertain = nil, nil, false, false
local preparing, pendingEntries = false, nil
local collectionCancelled, expectedSend = false, false
local lastError, reason = nil, "waiting for API Core"
local consumers, unsubscribers = {}, {}
local refresh, synchronize, buildClient

local function trim(text) return string.match(text, "^%s*(.-)%s*$") end

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
  local ok, written = pcall(function()
    local value = file:write(text)
    return type(value) ~= "nil" and value ~= false
  end)
  local closed, saved = pcall(function() return file:close() end)
  return ok and written and closed and saved ~= false
end

local function connected()
  if not initialized or type(client) ~= "table" then return false end
  local nativeSession = getSession()
  if type(nativeSession) ~= "table" or nativeSession.connected ~= true then return false end
  local state = client.status()
  return state.available and state.connected and state.negotiated
end

local function state()
  return { connected = connected(), characterName = characterName, refreshing = busy, reason = reason, error = lastError }
end

local function deliver(id)
  broadcastToPlugin(id, PREFIX .. "state", json.encode({ version = 1, status = state(), snapshot = snapshot }))
end

local function publish()
  local loaded = {}
  for _, item in pairs(getLoadedPlugins()) do
    if type(item) == "table" and item.enabled == true then loaded[item.id] = true end
  end
  for id in pairs(consumers) do
    if loaded[id] then deliver(id) else consumers[id] = nil end
  end
end

local function cancelCapture()
  if type(captureTimer) == "string" and captureTimer ~= "" then removeTimer(captureTimer) end
  captureTimer, capture = nil, nil
end

local function failure(message)
  cancelCapture()
  pendingEntries = nil
  collectionCancelled = true
  busy, lastError, reason = preparing, message, "refresh failed"
  publish()
  echo("Aardwolf Spells: " .. message)
end

local function issueText(issue)
  if issue.code == "helper_unavailable" or issue.code == "file_write_failed" or issue.code == "file_publish_failed" then
    return "SQLite unavailable; start tools/sqlite_helper.py and enable this plugin's File System Access, then run awspells refresh."
  end
  return "SQLite " .. issue.code .. " (" .. issue.outcome .. "); run awspells refresh to try again."
end

local function resetIdentity()
  generation = generation + 1
  cancelCapture()
  if database then database.close() end
  database, snapshot, characterName, characterKey = nil, nil, nil, nil
  busy, uncertain, preparing, pendingEntries = false, false, false, nil
  collectionCancelled, expectedSend = false, false
end

local function guarded(callback)
  local token = generation
  return function(value, issue)
    if initialized and token == generation then callback(value, issue)
    elseif type(value) == "table" and type(value.close) == "function" then value.close() end
  end
end

local READ_SNAPSHOT = "SELECT m.schema_version,m.character_name,m.collected_at,m.entry_count,"
  .. "a.name,a.level,a.sn,a.percent,a.unusable,a.display_order "
  .. "FROM metadata m LEFT JOIN abilities a ON 1=1 WHERE m.id=1 ORDER BY a.display_order"

local function nullable(value)
  if type(value) == "table" and value.sqliteType == "null" then return nil end
  return value
end

local function decodeSnapshot(result)
  if #result.rows == 0 then return nil end
  local first = result.rows[1]
  assert(first[1] == 1 and type(first[2]) == "string" and string.lower(first[2]) == characterKey, "invalid metadata")
  assert(first[4] == #result.rows and first[4] > 0 and first[4] <= 1000, "invalid count")
  local value = { schemaVersion = first[1], characterName = first[2], collectedAt = first[3], entries = {} }
  for index, row in ipairs(result.rows) do
    assert(row[1] == first[1] and row[2] == first[2] and row[3] == first[3] and row[4] == first[4], "mixed metadata")
    assert(row[10] == index and (row[9] == 0 or row[9] == 1), "invalid ability order or flag")
    table.insert(value.entries, { name = row[5], level = row[6], sn = nullable(row[7]),
      percent = nullable(row[8]), unusable = row[9] == 1 })
  end
  return libraryApi.protocol.spellsSnapshot(value)
end

local function loadSnapshot(done)
  database.query(READ_SNAPSHOT, {}, guarded(function(result, issue)
    if issue then done(nil, issue); return end
    local ok, value = pcall(decodeSnapshot, result)
    if not ok then done(nil, { code = "invalid_snapshot", outcome = "rejected" }); return end
    done(value)
  end))
end

local function prepare(done)
  local sqlState = client.sqlite.status()
  if not sqlState.available then done({ code = sqlState.reason, outcome = "rejected" }); return end
  local function readSaved()
    loadSnapshot(function(value, issue)
      if not issue then snapshot, uncertain = value, false end
      done(issue)
    end)
  end
  if database then readSaved(); return end
  client.sqlite.open("spells", guarded(function(value, issue)
    if issue then done(issue); return end
    database = value
    database.transaction({
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1),"
        .. "schema_version INTEGER NOT NULL,character_name TEXT NOT NULL,collected_at INTEGER NOT NULL,entry_count INTEGER NOT NULL)" },
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS abilities (name TEXT PRIMARY KEY COLLATE NOCASE,"
        .. "level INTEGER NOT NULL,sn INTEGER,percent INTEGER,unusable INTEGER NOT NULL CHECK(unusable IN (0,1)),"
        .. "display_order INTEGER NOT NULL UNIQUE)" }
    }, guarded(function(_, createIssue)
      if createIssue then database.close(); database = nil; done(createIssue); return end
      readSaved()
    end))
  end))
end

local function sameSnapshot(left, right)
  if not left or not right or left.characterName ~= right.characterName or left.collectedAt ~= right.collectedAt
    or #left.entries ~= #right.entries then return false end
  for index, item in ipairs(left.entries) do
    local other = right.entries[index]
    if item.name ~= other.name or item.level ~= other.level or item.sn ~= other.sn
      or item.percent ~= other.percent or item.unusable ~= other.unusable then return false end
  end
  return true
end

local function committed(value)
  snapshot, busy, uncertain, lastError, reason = value, false, false, nil, "saved"
  publish()
  echo("Aardwolf Spells: saved " .. tostring(#value.entries) .. " skills/spells for " .. value.characterName .. ".")
end

local function sqlCell(value)
  if type(value) == "nil" then return client.sqlite.null end
  return value
end

local function persist(entries)
  local value = { schemaVersion = 1, characterName = characterName, collectedAt = getCurrentTime(), entries = entries }
  local valid, candidate = pcall(libraryApi.protocol.spellsSnapshot, value)
  if not valid then failure("Invalid allspells snapshot; previous list retained."); return end
  local statements = { { kind = "execute", sql = "DELETE FROM abilities" } }
  for first = 1, #entries, 100 do
    local placeholders, params = {}, {}
    for index = first, math.min(first + 99, #entries) do
      local item = entries[index]
      table.insert(placeholders, "(?,?,?,?,?,?)")
      for _, cell in ipairs({ item.name, item.level, sqlCell(item.sn),
        sqlCell(item.percent), item.unusable, index }) do table.insert(params, cell) end
    end
    table.insert(statements, { kind = "execute",
      sql = "INSERT INTO abilities (name,level,sn,percent,unusable,display_order) VALUES " .. table.concat(placeholders, ","),
      params = params })
  end
  table.insert(statements, { kind = "execute", sql = "INSERT INTO metadata (id,schema_version,character_name,collected_at,entry_count)"
    .. " VALUES (1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,"
    .. "character_name=excluded.character_name,collected_at=excluded.collected_at,entry_count=excluded.entry_count",
    params = { characterName, candidate.collectedAt, #entries } })
  reason = "saving"
  publish()
  database.transaction(statements, guarded(function(_, issue)
    if not issue then committed(candidate); return end
    if issue.outcome ~= "unknown" then failure(issueText(issue)); return end
    uncertain, reason = true, "checking unknown SQLite outcome"
    publish()
    loadSnapshot(function(saved, readIssue)
      if readIssue then failure("SQLite outcome is unknown; refresh will read the database before another collection."); return end
      snapshot, uncertain = saved, false
      if sameSnapshot(saved, candidate) then committed(saved)
      else failure("SQLite did not confirm this collection; saved list reloaded.") end
    end)
  end))
end

local function arm()
  capture = { started = false, entries = {}, names = {}, expiresAt = getCurrentTime() + 60000 }
  reason, lastError = "waiting for allspells header", nil
  captureTimer = addTimer(60000, function()
    if initialized and capture then failure("allspells timed out before its footer; previous list retained.") end
  end, false)
  if type(captureTimer) ~= "string" or captureTimer == "" then
    failure("Could not start the collection timeout; previous list retained."); return false
  end
  publish()
  return true
end

local function eligible()
  if not connected() then return false, "API Core, connected GMCP and a verified character are required." end
  if not characterKey then return false, "Waiting for a verified GMCP character name." end
  local status = client.get("char.status") or {}
  if status.state ~= 3 then return false, "Wait until the character is active (outside login, combat, notes and the pager)." end
  return true
end

refresh = function()
  if busy then return "Aardwolf Spells is already collecting or saving." end
  local ready, message = eligible()
  if not ready then return message end
  busy, preparing, collectionCancelled, lastError, reason = true, true, false, nil,
    uncertain and "reconciling SQLite" or "opening SQLite"
  publish()
  prepare(function(issue)
    preparing = false
    if collectionCancelled then busy = false; publish(); return end
    if issue then failure(issueText(issue)); return end
    local ready = eligible()
    if not ready then failure("Character is no longer active; previous list retained."); return end
    if arm() then
      expectedSend = true
      local ok = pcall(send, "allspells")
      expectedSend = false
      if not ok then failure("Could not send allspells; previous list retained.") end
    end
  end)
  return "Aardwolf Spells refresh requested."
end

function onLine(sessionId, rawLine, cleanLine)
  if not initialized or sessionId ~= getSessionId() or not capture or type(cleanLine) ~= "string" then return end
  if getCurrentTime() >= capture.expiresAt then failure("allspells timed out; previous list retained."); return end
  local line = trim(cleanLine)
  if string.match(line, "^Skill/Spell name%s+Level%s+Sn%s+%%%s*$") then
    capture.started, reason = true, "collecting"
    publish()
    return
  end
  if not capture.started then return end
  if line == FOOTER then
    local entries = capture.entries
    cancelCapture()
    if #entries == 0 then failure("Empty allspells output; previous list retained."); return end
    if preparing then pendingEntries, reason = entries, "waiting for SQLite"; publish()
    else persist(entries) end
    return
  end
  -- Separators can use Unicode dashes; avoid byte/UTF-16 assumptions.
  if line == "" or not string.find(line, "%w") then return end
  local name, levelText, snText, percentText = string.match(cleanLine, "^%s+(.-)%s+(%d+)%s+([%d%-]+)%s+([%d%-]+)%s*$")
  if not name then
    -- A table-shaped line with invalid column tokens must not silently disappear.
    if string.match(cleanLine, "^%s+%S.-%s%s+%S") then
      failure("Malformed allspells row; previous list retained.")
    end
    return
  end
  name = trim(name)
  local unusable = false
  if string.sub(name, 1, 1) == "*" then unusable, name = true, trim(string.sub(name, 2)) end
  if string.sub(name, -1) == "*" then unusable, name = true, trim(string.sub(name, 1, -2)) end
  local item = { name = name, level = tonumber(levelText), unusable = unusable }
  if snText ~= "-" then item.sn = tonumber(snText) end
  if percentText ~= "-" then item.percent = tonumber(percentText) end
  local ok = pcall(libraryApi.protocol.spellsSnapshot, {
    schemaVersion = 1, characterName = characterName, collectedAt = getCurrentTime(), entries = { item }
  })
  if not ok or (snText ~= "-" and not string.match(snText, "^%d+$"))
    or (percentText ~= "-" and not string.match(percentText, "^%d+$")) then
    failure("Malformed allspells row; previous list retained."); return
  end
  local key = string.lower(name)
  if capture.names[key] then failure("Duplicate allspells row; previous list retained."); return end
  if #capture.entries >= 1000 then failure("allspells exceeds 1,000 rows; previous list retained."); return end
  capture.names[key] = true
  table.insert(capture.entries, item)
end

function onSend(sessionId, text)
  if not initialized or sessionId ~= getSessionId() or type(text) ~= "string" then return end
  local command = string.lower(trim(text))
  if command == "allspells" then
    if capture then
      if expectedSend then expectedSend = false
      else failure("Overlapping allspells commands; previous list retained.") end
      return
    end
    if busy then
      if preparing then failure("Overlapping allspells commands; previous list retained.") end
      return
    end
    local ready = eligible()
    if not ready then return end
    -- Outgoing user commands cannot wait for asynchronous database setup.
    local sqlState = client.sqlite.status()
    if not sqlState.available or uncertain then
      echo("Aardwolf Spells: run awspells refresh to prepare SQLite before capturing this command.")
      return
    end
    busy, preparing, collectionCancelled = true, true, false
    if arm() then
      prepare(function(issue)
        preparing = false
        if collectionCancelled then busy = false; publish(); return end
        if issue then failure(issueText(issue)); return end
        if pendingEntries then
          local entries = pendingEntries
          pendingEntries = nil
          persist(entries)
        elseif capture then publish()
        else busy = false; publish() end
      end)
    else preparing, busy = false, false end
  elseif string.match(command, "^allspells%s+") and (capture or preparing) then
    failure("Filtered allspells interrupted collection; previous list retained.")
  end
end

local function receive(sender, message, encoded)
  if not initialized then return end
  if message == PREFIX .. "unsubscribe" then consumers[sender] = nil; return end
  if message ~= PREFIX .. "subscribe" or type(encoded) ~= "string" or #encoded > 128 then return end
  local ok, value = pcall(json.decode, encoded)
  if not ok or type(value) ~= "table" or value.version ~= 1 then return end
  local found = false
  for _, item in pairs(getLoadedPlugins()) do if item.id == sender and item.enabled == true then found = true end end
  if found then consumers[sender] = true; deliver(sender) end
end

buildClient = function(key)
  rebuilding = true
  for _, unsubscribe in ipairs(unsubscribers) do unsubscribe() end
  unsubscribers = {}
  if client then client.stop() end
  client = libraryApi.new({
    findPluginByName = findPluginByName, onPluginBroadcast = onPluginBroadcast, broadcastToPlugin = broadcastToPlugin,
    on = on, off = off, getPluginId = getPluginId, getSession = getSession, getCurrentTime = getCurrentTime,
    addTimer = addTimer, removeTimer = removeTimer,
    sqliteReadFile = readFile, sqliteWriteFile = writeFile, sqliteRenameFile = os.rename, sqliteRemoveFile = os.remove,
    reportError = function(message) echo(message) end
  }, { packages = { "Char" }, sqlite = key and { characterKey = key } or nil })
  for _, topic in ipairs({ "session", "char.base", "char.status" }) do
    table.insert(unsubscribers, client.on(topic, synchronize))
  end
  client.start()
  rebuilding = false
end

synchronize = function()
  if not initialized or rebuilding then return end
  local session = client.status()
  if not session.available or not session.connected then
    if characterKey then resetIdentity() end
    reason = session.reason or "waiting for API Core"
    publish()
    return
  end
  local base = client.get("char.base") or {}
  local name = type(base.name) == "string" and trim(base.name) or ""
  if name == "" or #name > 128 or string.find(name, "%c") then
    if characterKey then resetIdentity() end
    reason = "waiting for a verified character name"; publish(); return
  end
  local key = string.lower(name)
  if key ~= characterKey then
    resetIdentity()
    characterName, characterKey, automaticAttempted, lastError = name, key, automaticCharacterKey == key, nil
    buildClient(key)
  end
  if not session.negotiated then reason = "waiting for negotiated GMCP"; publish(); return end
  local status = client.get("char.status") or {}
  if status.state == 3 and not automaticAttempted then
    automaticAttempted = true
    automaticCharacterKey = key
    refresh()
  else publish() end
end

function onDisconnect(sessionId)
  if not initialized or sessionId ~= getSessionId() then return end
  resetIdentity()
  automaticAttempted, automaticCharacterKey, lastError, reason = false, nil, nil, "disconnected"
  publish()
end

function init()
  if initialized then return end
  libraryApi = require("aardwolf-api")
  if type(libraryApi.protocol) ~= "table" or type(libraryApi.protocol.spellsSnapshot) ~= "function" then
    echo("Aardwolf Spells requires aardwolf-api 0.3.0 or later; update the loaded library and reload Spells.")
    return
  end
  initialized = true
  if not registered then onPluginBroadcast(receive); registered = true end
  registerCommand("awspells", function(args)
    local command = string.lower(trim(args))
    if command == "refresh" then return refresh() end
    if command ~= "" and command ~= "status" then return "Usage: awspells refresh | status" end
    local saved = snapshot and (tostring(#snapshot.entries) .. " entries, collected at " .. tostring(snapshot.collectedAt) .. " Unix ms") or "no saved snapshot"
    return "Aardwolf Spells: " .. (characterName or "character unknown") .. "; " .. saved .. "; "
      .. reason .. (lastError and ("; " .. lastError) or "")
  end, "Refresh or inspect the character's saved allspells list")
  buildClient(nil)
  synchronize()
  broadcastPlugin(PREFIX .. "ready")
end

function cleanup()
  if not initialized then return end
  initialized = false
  resetIdentity()
  for _, unsubscribe in ipairs(unsubscribers) do unsubscribe() end
  unsubscribers = {}
  if client then client.stop() end
  client = nil
  consumers, automaticAttempted, automaticCharacterKey, lastError, reason = {}, false, nil, nil, "not started"
  broadcastPlugin(PREFIX .. "stopped")
end
