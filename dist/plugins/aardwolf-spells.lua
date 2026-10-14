plugin = {
  id = "aardwolf-spells", name = "Aardwolf Spells", version = "0.2.0",
  author = "Sam Roberts", description = "Character-specific skills, spells and damage ability buttons backed by SQLite."
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
local refresh, synchronize, buildClient, render, nextRefresh, persist, commandOverride
local widget, saving, queue, queueTotal = nil, false, {}, 0
local restoredIdentity = false
local damage = { details = {}, members = {}, times = {}, commands = {} }
local TYPES = { "acid", "air", "bash", "cold", "earth", "electric", "energy", "fire", "holy",
  "light", "magic", "mental", "negative", "pierce", "slash", "shadow", "sonic", "water" }
local typeSet = {}
for _, value in ipairs(TYPES) do typeSet[value] = true end
local DAMAGE_FOOTER = "To see all skills/spells for your class, use 'allspells <class>'"
local SKILL_COMMANDS = { ["dirt kicking"] = "dirt" }
local USAGE = 'Usage: awspells refresh | refresh-all | cancel | show | status | command "<skill>" [command] | command-reset "<skill>"'

local function groupKey(kind, damageType) return kind .. ":" .. damageType end
local function emptyDamage() return { details = {}, members = {}, times = {}, commands = {} } end
local function clone(value)
  if type(value) ~= "table" then return value end
  local result = {}
  for key, item in pairs(value) do result[key] = clone(item) end
  return result
end
local function equal(left, right)
  if type(left) ~= type(right) then return false end
  if type(left) ~= "table" then return left == right end
  for key, item in pairs(left) do if not equal(item, right[key]) then return false end end
  for key in pairs(right) do if type(left[key]) == "nil" then return false end end
  return true
end
local function singleCommand(value)
  return type(value) == "string" and #value > 0 and #value <= 128
    and string.match(value, "^[%a][%w _'%-]*$") ~= nil
end

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
  local current = state()
  broadcastToPlugin(id, PREFIX .. "state", json.encode({ version = 1, status = current, snapshot = current.connected and snapshot or nil }))
end

local function publish()
  if render then render() end
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

local function finishCancelled()
  cancelCapture()
  busy, reason = preparing or saving, "cancelled"
  publish()
end

local function failure(message)
  cancelCapture()
  pendingEntries, queue, queueTotal = nil, {}, 0
  collectionCancelled = true
  busy, lastError, reason = preparing or saving, message, "refresh failed"
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
  damage, saving, queue, queueTotal, restoredIdentity = emptyDamage(), false, {}, 0, false
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

local READ_DAMAGE = "SELECT 'detail' AS tag,name AS a,kind AS b,mana AS c FROM ability_details UNION ALL "
  .. "SELECT 'member',kind,damage_type,name FROM damage_memberships UNION ALL "
  .. "SELECT 'time',kind,damage_type,collected_at FROM damage_refreshes UNION ALL "
  .. "SELECT 'command',name,command,NULL FROM skill_commands ORDER BY tag,a,b,c LIMIT 500 OFFSET ?"

local function loadSaved(done)
  loadSnapshot(function(saved, issue)
    if issue then done(nil, nil, issue); return end
    local restored, offset = emptyDamage(), 0
    local names = {}
    if saved then for _, item in ipairs(saved.entries) do names[string.lower(item.name)] = true end end
    local function page()
      database.query(READ_DAMAGE, { offset }, guarded(function(result, readIssue)
        if readIssue then done(nil, nil, readIssue); return end
        local ok = pcall(function()
          -- 1,000 details/overrides, 36 × 1,000 memberships and 36 times.
          assert(offset + #result.rows <= 38036, "damage data exceeds limit")
          for _, row in ipairs(result.rows) do
            local tag, a, b, c = row[1], row[2], row[3], nullable(row[4])
            if tag == "detail" then
              assert(type(a) == "string" and names[a] and (b == "skill" or b == "spell"), "invalid detail")
              assert(type(c) == "nil" or (type(c) == "number" and c >= 0 and c <= 9007199254740991 and c == math.floor(c)), "invalid mana")
              assert(not restored.details[a], "duplicate detail")
              restored.details[a] = { kind = b, mana = c }
            elseif tag == "member" or tag == "time" then
              assert((a == "skill" or a == "spell") and typeSet[b], "invalid damage group")
              local key = groupKey(a, b)
              if tag == "member" then
                assert(type(c) == "string" and names[c], "invalid membership")
                restored.members[key] = restored.members[key] or {}
                assert(not restored.members[key][c], "duplicate membership")
                restored.members[key][c] = true
              else
                assert(type(c) == "number" and c >= 0 and c <= 9007199254740991 and c == math.floor(c), "invalid refresh time")
                assert(not restored.times[key], "duplicate refresh time")
                restored.times[key] = c
                restored.members[key] = restored.members[key] or {}
              end
            else
              assert(tag == "command" and type(a) == "string" and #a > 0 and #a <= 128
                and string.lower(a) == a and not string.find(a, "%c") and singleCommand(b), "invalid command")
              assert(not restored.commands[a], "duplicate command")
              restored.commands[a] = b
            end
          end
        end)
        if not ok then done(nil, nil, { code = "invalid_damage_data", outcome = "rejected" }); return end
        offset = offset + #result.rows
        if #result.rows == 500 then page(); return end
        for key, members in pairs(restored.members) do
          if not restored.times[key] then done(nil, nil, { code = "invalid_damage_data", outcome = "rejected" }); return end
          for name in pairs(members) do
            local info = restored.details[name]
            if not info or string.sub(key, 1, #info.kind + 1) ~= info.kind .. ":" then
              done(nil, nil, { code = "invalid_damage_data", outcome = "rejected" }); return
            end
          end
        end
        done(saved, restored)
      end))
    end
    page()
  end)
end

local function prepare(done)
  restoredIdentity = true
  local sqlState = client.sqlite.status()
  if not sqlState.available then done({ code = sqlState.reason, outcome = "rejected" }); return end
  local function readSaved()
    loadSaved(function(value, restored, issue)
      if not issue then snapshot, damage, uncertain = value, restored, false; publish() end
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
        .. "display_order INTEGER NOT NULL UNIQUE)" },
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS ability_details (name TEXT PRIMARY KEY COLLATE NOCASE,"
        .. "kind TEXT NOT NULL CHECK(kind IN ('skill','spell')),mana INTEGER)" },
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS damage_memberships (kind TEXT NOT NULL,damage_type TEXT NOT NULL,"
        .. "name TEXT NOT NULL COLLATE NOCASE,PRIMARY KEY(kind,damage_type,name))" },
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS damage_refreshes (kind TEXT NOT NULL,damage_type TEXT NOT NULL,"
        .. "collected_at INTEGER NOT NULL,PRIMARY KEY(kind,damage_type))" },
      { kind = "execute", sql = "CREATE TABLE IF NOT EXISTS skill_commands (name TEXT PRIMARY KEY COLLATE NOCASE,command TEXT NOT NULL)" }
    }, guarded(function(_, createIssue)
      if createIssue then database.close(); database = nil; done(createIssue); return end
      readSaved()
    end))
  end))
end

local function sameSnapshot(left, right)
  if not left or not right then return left == right end
  if left.characterName ~= right.characterName or left.collectedAt ~= right.collectedAt
    or #left.entries ~= #right.entries then return false end
  for index, item in ipairs(left.entries) do
    local other = right.entries[index]
    if item.name ~= other.name or item.level ~= other.level or item.sn ~= other.sn
      or item.percent ~= other.percent or item.unusable ~= other.unusable then return false end
  end
  return true
end

local function committed(value, updated)
  snapshot, damage, saving, busy, uncertain = value, updated, false, false, false
  reason = collectionCancelled and "cancelled" or (lastError and "refresh stopped" or "saved")
  publish()
  if value then echo("Aardwolf Spells: saved " .. tostring(#value.entries) .. " skills/spells for " .. value.characterName .. ".") end
  if not collectionCancelled then nextRefresh() end
end

local function sqlCell(value)
  if type(value) == "nil" then return client.sqlite.null end
  return value
end

local function writeCandidate(candidate, updated, statements)
  saving, reason = true, "saving"
  publish()
  database.transaction(statements, guarded(function(_, issue)
    if not issue then committed(candidate, updated); return end
    if issue.outcome ~= "unknown" then saving = false; failure(issueText(issue)); return end
    uncertain, reason = true, "checking unknown SQLite outcome"
    publish()
    loadSaved(function(saved, restored, readIssue)
      saving = false
      if readIssue then failure("SQLite outcome is unknown; refresh will read the database before another collection."); return end
      snapshot, damage, uncertain = saved, restored, false
      if sameSnapshot(saved, candidate) and equal(restored, updated) then committed(saved, restored)
      else failure("SQLite did not confirm this collection; saved list reloaded.") end
    end)
  end))
end

-- Each statement stays below the bridge's 1,000 positional parameter ceiling.
local function insertRows(statements, sql, rows, width, suffix)
  for first = 1, #rows, 100 do
    local placeholders, params = {}, {}
    for index = first, math.min(first + 99, #rows) do
      local cells = {}
      for column = 1, width do
        table.insert(cells, "?")
        table.insert(params, sqlCell(rows[index][column]))
      end
      table.insert(placeholders, "(" .. table.concat(cells, ",") .. ")")
    end
    table.insert(statements, { kind = "execute", sql = sql .. table.concat(placeholders, ",") .. (suffix or ""), params = params })
  end
end

persist = function(entries, request)
  local updated, combined = clone(damage), {}
  if request.kind then
    local positions = {}
    if snapshot then
      for index, item in ipairs(snapshot.entries) do
        combined[index], positions[string.lower(item.name)] = clone(item), index
      end
    end
    local key = groupKey(request.kind, request.damageType)
    updated.members[key], updated.times[key] = {}, getCurrentTime()
    for _, item in ipairs(entries) do
      local name = string.lower(item.name)
      if updated.details[name] and updated.details[name].kind ~= request.kind then
        failure("Conflicting ability kind; previous list retained."); return
      end
      local index = positions[name] or (#combined + 1)
      combined[index] = { name = item.name, level = item.level, sn = item.sn, percent = item.percent, unusable = item.unusable }
      updated.details[name] = { kind = request.kind, mana = item.mana }
      updated.members[key][name] = true
    end
  else
    combined = entries
    local names = {}
    for _, item in ipairs(entries) do names[string.lower(item.name)] = true end
    for name in pairs(updated.details) do if not names[name] then updated.details[name] = nil end end
    for _, members in pairs(updated.members) do
      for name in pairs(members) do if not names[name] then members[name] = nil end end
    end
  end
  local candidate
  if #combined > 0 then
    local valid
    valid, candidate = pcall(libraryApi.protocol.spellsSnapshot, {
      schemaVersion = 1, characterName = characterName, collectedAt = getCurrentTime(), entries = combined
    })
    if not valid then failure("Invalid ability snapshot; previous list retained."); return end
  end
  local statements = { { kind = "execute", sql = "DELETE FROM abilities" } }
  local rows = {}
  for index, item in ipairs(combined) do rows[index] = { item.name, item.level, sqlCell(item.sn), sqlCell(item.percent), item.unusable, index } end
  insertRows(statements, "INSERT INTO abilities (name,level,sn,percent,unusable,display_order) VALUES ", rows, 6)
  if request.kind then
    local params = { request.kind, request.damageType }
    table.insert(statements, { kind = "execute", sql = "DELETE FROM damage_memberships WHERE kind=? AND damage_type=?", params = params })
    rows = {}
    for _, item in ipairs(entries) do
      table.insert(rows, { string.lower(item.name), request.kind, sqlCell(item.mana) })
    end
    insertRows(statements, "INSERT INTO ability_details (name,kind,mana) VALUES ", rows, 3,
      " ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,mana=excluded.mana")
    rows = {}
    for _, item in ipairs(entries) do table.insert(rows, { request.kind, request.damageType, string.lower(item.name) }) end
    insertRows(statements, "INSERT INTO damage_memberships (kind,damage_type,name) VALUES ", rows, 3)
    table.insert(statements, { kind = "execute", sql = "INSERT INTO damage_refreshes (kind,damage_type,collected_at) VALUES (?,?,?)"
      .. " ON CONFLICT(kind,damage_type) DO UPDATE SET collected_at=excluded.collected_at",
      params = { request.kind, request.damageType, updated.times[groupKey(request.kind, request.damageType)] } })
  else
    table.insert(statements, { kind = "execute", sql = "DELETE FROM ability_details WHERE name NOT IN (SELECT name FROM abilities)" })
    table.insert(statements, { kind = "execute", sql = "DELETE FROM damage_memberships WHERE name NOT IN (SELECT name FROM abilities)" })
  end
  if candidate then
    table.insert(statements, { kind = "execute", sql = "INSERT INTO metadata (id,schema_version,character_name,collected_at,entry_count)"
      .. " VALUES (1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,"
      .. "character_name=excluded.character_name,collected_at=excluded.collected_at,entry_count=excluded.entry_count",
      params = { characterName, candidate.collectedAt, #combined } })
  end
  writeCandidate(candidate, updated, statements)
end

local function arm(request)
  capture = { request = request, started = false, entries = {}, names = {}, expiresAt = getCurrentTime() + 60000 }
  reason, lastError = "waiting for " .. request.command .. " header", nil
  captureTimer = addTimer(60000, function()
    if initialized and capture then
      if capture.discard then finishCancelled()
      else failure(request.command .. " timed out before its footer; previous list retained.") end
    end
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

refresh = function(request)
  request = request or { command = "allspells" }
  if busy then return "Aardwolf Spells is already collecting or saving." end
  local ready, message = eligible()
  if not ready then return message end
  busy, preparing, collectionCancelled, lastError, reason = true, true, false, nil,
    uncertain and "reconciling SQLite" or "opening SQLite"
  publish()
  prepare(function(issue)
    preparing = false
    if collectionCancelled then busy = saving or capture ~= nil; publish(); return end
    if issue then failure(issueText(issue)); return end
    local ready = eligible()
    if not ready then failure("Character is no longer active; previous list retained."); return end
    if arm(request) then
      expectedSend = true
      local ok, accepted = pcall(send, request.command)
      expectedSend = false
      if not ok or accepted == false then failure("Could not send " .. request.command .. "; previous list retained.") end
    end
  end)
  return "Aardwolf Spells refresh requested."
end

nextRefresh = function()
  if busy then return end
  if #queue == 0 then queueTotal = 0; publish(); return end
  local ready, message = eligible()
  if not ready then queue, queueTotal = {}, 0; lastError, reason = message, "refresh stopped"; publish(); return end
  local request = table.remove(queue, 1)
  refresh(request)
end

local function refreshAll()
  if busy then return "Aardwolf Spells is already collecting or saving." end
  local ready, message = eligible()
  if not ready then return message end
  queue, queueTotal = {}, 36
  for _, damageType in ipairs(TYPES) do
    for _, kind in ipairs({ "skill", "spell" }) do
      table.insert(queue, { kind = kind, damageType = damageType, command = kind .. "s " .. damageType })
    end
  end
  nextRefresh()
  return "Damage refresh requested."
end

local function cancelCollection()
  if not busy then return "No collection in progress." end
  queue, queueTotal, collectionCancelled = {}, 0, true
  -- The server cannot cancel a sent command. Discard its remaining output before
  -- admitting another query, so an old header/empty result cannot update it.
  if capture then capture.discard, capture.entries, capture.names = true, {}, {} end
  pendingEntries = nil
  busy = preparing or saving or capture ~= nil
  reason = saving and "cancelling after save" or (capture and "cancelling; waiting for response" or "cancelled")
  publish()
  return "Aardwolf Spells collection cancelled."
end

local function finishCapture()
  local request, entries = capture.request, capture.entries
  cancelCapture()
  if not request.kind and #entries == 0 then failure("Empty allspells output; previous list retained."); return end
  if preparing then pendingEntries, reason = { entries = entries, request = request }, "waiting for SQLite"; publish()
  else persist(entries, request) end
end

local function validateRow(item)
  return pcall(libraryApi.protocol.spellsSnapshot, {
    schemaVersion = 1, characterName = characterName, collectedAt = getCurrentTime(), entries = { item }
  })
end

local function damageLine(line)
  local request = capture.request
  if line == "No " .. request.kind .. "s found." and not capture.started then finishCapture(); return end
  local header = request.kind == "skill" and "^Skill name%s+Learned%s+Damage%s*$"
    or "^Spell name%s+Mana%s+Learned%s+Spell#%s+Damage%s*$"
  if string.match(line, header) then capture.started, reason = true, "collecting " .. request.command; publish(); return end
  if not capture.started then return end
  if line == DAMAGE_FOOTER then finishCapture(); return end
  if not string.match(line, "^Level%s") then return end
  local levelText, name, percentText, damageText, manaText, snText
  if request.kind == "skill" then
    levelText, name, percentText, damageText = string.match(line, "^Level%s+(%d+)%s*:%s*(.-)%s+(%d+)%%%s+(%a+)%s*$")
  else
    levelText, name, manaText, percentText, snText, damageText = string.match(line,
      "^Level%s+(%d+)%s*:%s*(.-)%s+(%d+)%s+(%d+)%%%s+(%d+)%s+(%a+)%s*$")
  end
  if not name or string.lower(damageText) ~= request.damageType then failure("Malformed or mismatched damage row; previous list retained."); return end
  name = trim(name)
  local unusable = false
  if string.sub(name, 1, 1) == "*" then unusable, name = true, trim(string.sub(name, 2)) end
  if string.sub(name, -1) == "*" then unusable, name = true, trim(string.sub(name, 1, -2)) end
  local item = { name = name, level = tonumber(levelText), percent = tonumber(percentText),
    sn = tonumber(snText), mana = tonumber(manaText), unusable = unusable }
  if not validateRow(item) or (manaText and (type(item.mana) ~= "number" or item.mana < 0 or item.mana > 9007199254740991)) then
    failure("Malformed damage row; previous list retained."); return
  end
  local key = string.lower(name)
  if capture.names[key] then failure("Duplicate damage row; previous list retained."); return end
  if #capture.entries >= 1000 then failure("Damage list exceeds 1,000 rows; previous list retained."); return end
  capture.names[key] = true
  table.insert(capture.entries, item)
end

function onLine(sessionId, rawLine, cleanLine)
  if not initialized or sessionId ~= getSessionId() or not capture or type(cleanLine) ~= "string" then return end
  if getCurrentTime() >= capture.expiresAt then
    if capture.discard then finishCancelled()
    else failure(capture.request.command .. " timed out; previous list retained.") end
    return
  end
  local line = trim(cleanLine)
  if capture.discard then
    local request = capture.request
    if (not request.kind and line == FOOTER) or (request.kind and (line == DAMAGE_FOOTER
      or line == "No " .. request.kind .. "s found.")) or string.match(line, "^%[.*%]%s*>$") then finishCancelled() end
    return
  end
  if capture.request.kind then damageLine(line); return end
  if string.match(line, "^Skill/Spell name%s+Level%s+Sn%s+%%%s*$") then
    capture.started, reason = true, "collecting"
    publish()
    return
  end
  if not capture.started then return end
  if line == FOOTER then finishCapture(); return end
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
  local kind, damageType = string.match(command, "^(%a+)s%s+(%a+)$")
  local request
  if command == "allspells" then request = { command = command }
  elseif (kind == "skill" or kind == "spell") and typeSet[damageType] then
    request = { command = kind .. "s " .. damageType, kind = kind, damageType = damageType }
  end
  if request then
    if capture then
      if expectedSend then expectedSend = false
      else failure("Overlapping ability commands; previous list retained.") end
      return
    end
    if busy then
      queue, queueTotal = {}, 0
      if preparing then failure("Overlapping ability commands; previous list retained.") end
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
    if arm(request) then
      prepare(function(issue)
        preparing = false
        if collectionCancelled then busy = saving or capture ~= nil; publish(); return end
        if issue then failure(issueText(issue)); return end
        if pendingEntries then
          local pending = pendingEntries
          pendingEntries = nil
          persist(pending.entries, pending.request)
        elseif capture then publish()
        else busy = false; publish() end
      end)
    else preparing, busy = false, false end
  elseif (string.match(command, "^allspells%s+") or command == "skills" or command == "spells"
    or string.match(command, "^skills%s") or string.match(command, "^spells%s")) and (capture or preparing or saving) then
    if saving then cancelCollection()
    else failure("Filtered ability command interrupted collection; previous list retained.") end
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
  if not session.negotiated then
    queue, queueTotal = {}, 0
    if capture or preparing then failure("GMCP negotiation lost; previous list retained.") end
    reason = "waiting for negotiated GMCP"; publish(); return
  end
  local status = client.get("char.status") or {}
  if #queue > 0 and (not session.negotiated or status.state ~= 3) then
    queue, queueTotal = {}, 0
    lastError = "Refresh all stopped; wait for active state and refresh again."
  end
  if status.state == 3 and not automaticAttempted then
    automaticAttempted = true
    automaticCharacterKey = key
    refresh()
  elseif automaticAttempted and not restoredIdentity and not busy then
    busy, preparing, collectionCancelled, reason = true, true, false, "loading saved abilities"
    prepare(function(issue)
      preparing = false
      if collectionCancelled then busy = saving or capture ~= nil; publish(); return end
      if issue then failure(issueText(issue)); return end
      busy, reason = false, "saved abilities loaded"
      publish()
    end)
  else publish() end
end

function onDisconnect(sessionId)
  if not initialized or sessionId ~= getSessionId() then return end
  resetIdentity()
  automaticAttempted, automaticCharacterKey, lastError, reason = false, nil, nil, "disconnected"
  publish()
end

local function abilityCommand(item, kind)
  if kind == "spell" then return item.sn and ("cast " .. tostring(item.sn)) or nil end
  local name = string.lower(item.name)
  local command = damage.commands[name] or SKILL_COMMANDS[name] or name
  return singleCommand(command) and command or nil
end

local function selected(kind, damageType)
  if not snapshot then return nil end
  local members = damage.members[groupKey(kind, damageType)] or {}
  local status, base = client.get("char.status") or {}, client.get("char.base") or {}
  local level = status.level or base.level
  local best
  for _, item in ipairs(snapshot.entries) do
    local name = string.lower(item.name)
    local info = damage.details[name]
    if members[name] and info and info.kind == kind and not item.unusable and item.percent and item.percent > 1
      and (not level or item.level <= level) then
      if not best or item.level > best.level or (item.level == best.level and (item.percent > best.percent
        or (item.percent == best.percent and name < string.lower(best.name)))) then best = item end
    end
  end
  return best
end

local function refreshTime(timestamp)
  if type(formatTime) == "function" then return formatTime(timestamp, "YYYY-MM-DD HH:mm:ss") end
  return "saved"
end

render = function()
  if not widget then return end
  local ready = connected()
  local status = client and client.get("char.status") or {}
  local canUse = ready and characterKey and not busy and (status.state == 3 or status.state == 8)
  local canRefresh = ready and characterKey and not busy and status.state == 3
  local summary = (characterName or "Character unknown") .. "; " .. reason
  if queueTotal > 0 then summary = summary .. " (" .. tostring(queueTotal - #queue) .. "/" .. tostring(queueTotal) .. ")" end
  if lastError then summary = summary .. ": " .. lastError end
  setBoundValue(widget, "status", summary)
  setBoundValue(widget, "refreshDisabled", canRefresh and "false" or "true")
  setBoundValue(widget, "cancelDisabled", busy and not collectionCancelled and "false" or "true")
  for _, damageType in ipairs(TYPES) do
    for _, kind in ipairs({ "skill", "spell" }) do
      local key = groupKey(kind, damageType)
      local binding = kind .. "_" .. damageType
      local item, timestamp = selected(kind, damageType), damage.times[key]
      local label = timestamp and "None learned" or "Not refreshed"
      local tooltip = timestamp and ("No eligible learned " .. kind .. ". Last refreshed: " .. refreshTime(timestamp) .. ".")
        or ("Refresh " .. kind .. "s " .. damageType .. " to collect abilities.")
      local command
      if item then
        label, command = item.name, abilityCommand(item, kind)
        tooltip = item.name .. ": level " .. tostring(item.level) .. ", learned " .. tostring(item.percent) .. "%; "
          .. (command or "Command unavailable") .. "; last refreshed " .. refreshTime(timestamp) .. "."
        if kind == "skill" then tooltip = tooltip .. ' Override: awspells command "' .. item.name .. '" <command>' end
      end
      setBoundValue(widget, binding .. "_name", label)
      setBoundValue(widget, binding .. "_tip", tooltip)
      setBoundValue(widget, binding .. "_disabled", canUse and item and command and "false" or "true")
    end
  end
end

local function panelMarkup()
  local html = { [[<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:dark;font:13px system-ui,sans-serif;color:#e6edf5;background:#131b27}*{box-sizing:border-box}
body{margin:0;padding:12px}header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
h1{font-size:14px;margin:0;font-weight:650}.toolbar{display:flex;gap:6px}button{font:inherit;color:inherit;background:#233247;
 border:1px solid #435772;border-radius:5px;min-height:30px;padding:5px 9px;cursor:pointer}button:hover:not(:disabled){background:#30465f}
button:focus-visible{outline:2px solid #8bc3ff;outline-offset:2px}button:disabled{opacity:.5;cursor:default}
.status{font-size:12px;color:#b9c7d8;margin:0 0 10px;overflow-wrap:anywhere}.row,.headings{display:grid;
 grid-template-columns:68px minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center}.headings{color:#9eafc3;font-size:11px;margin-bottom:5px}
.row{padding:5px 0;border-top:1px solid #29374b}.damage{text-transform:capitalize;font-weight:600}.ability{display:flex;gap:4px;min-width:0;align-items:center}
.use{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.refresh{flex:none;width:28px;padding:4px;min-height:30px}
.kind{display:none}.toolbar button{font-size:12px;white-space:nowrap}
@media(max-width:419px){.headings{display:none}.row{grid-template-columns:68px minmax(0,1fr);gap:5px 8px}
.damage{grid-row:span 2}.kind{display:inline-block;width:32px;flex:none;font-size:10px;color:#9eafc3}.toolbar{gap:4px}
header{align-items:flex-start;flex-wrap:wrap}h1{font-size:13px}.row{padding:7px 0}}
@media(max-width:259px){body{padding:8px}.row{grid-template-columns:minmax(0,1fr)}.damage{grid-row:auto}}
</style></head><body><header><h1>Damage Abilities</h1><div class="toolbar">
<button type="button" data-mud-action="refresh-all" aria-disabled="true" disabled data-mud-bind-attr="aria-disabled:refreshDisabled">Refresh all</button>
<button type="button" data-mud-action="cancel" aria-disabled="true" disabled data-mud-bind-attr="aria-disabled:cancelDisabled">Cancel</button></div></header>
<p class="status" role="status" aria-live="polite" data-mud-bind="status">Waiting for API Core</p>
<div class="headings" aria-hidden="true"><span>Damage</span><span>Skill</span><span>Spell</span></div>]] }
  for _, damageType in ipairs(TYPES) do
    table.insert(html, '<div class="row"><span class="damage">' .. damageType .. '</span>')
    for _, kind in ipairs({ "skill", "spell" }) do
      local key = kind .. "_" .. damageType
      local actionKey = groupKey(kind, damageType)
      table.insert(html, '<div class="ability"><span class="kind">' .. (kind == "skill" and "Skill" or "Spell") .. '</span>'
        .. '<button type="button" class="use" data-mud-action="use:' .. actionKey .. '" aria-disabled="true" disabled'
        .. ' data-mud-bind-attr="title:' .. key .. '_tip;aria-disabled:' .. key .. '_disabled" data-mud-bind="' .. key .. '_name">Not refreshed</button>'
        .. '<button type="button" class="refresh" data-mud-action="refresh:' .. actionKey .. '" title="Refresh ' .. kind .. 's ' .. damageType
        .. '" aria-label="Refresh ' .. kind .. 's ' .. damageType .. '" aria-disabled="true" disabled'
        .. ' data-mud-bind-attr="aria-disabled:refreshDisabled">&#8635;</button></div>')
    end
    table.insert(html, '</div>')
  end
  table.insert(html, [[<script>
// ARIA bindings are strings; mirror them to the native boolean property.
function syncDisabled(button) { button.disabled = button.getAttribute('aria-disabled') !== 'false'; }
document.querySelectorAll('button').forEach(syncDisabled);
new MutationObserver(function(records) {
  records.forEach(function(record) { syncDisabled(record.target); });
}).observe(document.body, {subtree:true, attributes:true, attributeFilter:['aria-disabled']});
</script></body></html>]])
  return table.concat(html)
end

local function panelAction(event)
  if not initialized or type(event) ~= "table" or type(event.action) ~= "string" then return end
  if event.action == "cancel" then cancelCollection(); return end
  local response
  if event.action == "refresh-all" then lastError = nil; response = refreshAll()
  else
    local verb, kind, damageType = string.match(event.action, "^(%a+):(%a+):(%a+)$")
    if (kind ~= "skill" and kind ~= "spell") or not typeSet[damageType] then return end
    if verb == "refresh" then
      lastError = nil
      response = refresh({ kind = kind, damageType = damageType, command = kind .. "s " .. damageType })
    elseif verb == "use" then
      local status = client and client.get("char.status") or {}
      if not connected() or not characterKey or busy or (status.state ~= 3 and status.state ~= 8) then return end
      local item = selected(kind, damageType)
      local command = item and abilityCommand(item, kind)
      if not command then return end
      local ok, accepted = pcall(send, command)
      if not ok or accepted == false then lastError = "Could not send ability command."; publish() end
      return
    else return end
  end
  -- Rejected actions should explain how to recover without erasing saved data.
  if not busy and response and not lastError then lastError = response; publish() end
end

commandOverride = function(args)
  local operation, name, value = string.match(args, '^(command[%-%a]*)%s+"([^"]+)"%s*(.-)%s*$')
  if operation ~= "command" and operation ~= "command-reset" then return USAGE end
  name = string.lower(trim(name))
  if #name == 0 or #name > 128 or string.find(name, "%c") then return "Invalid skill name." end
  if operation == "command" and value == "" then
    return name .. ": " .. (damage.commands[name] or SKILL_COMMANDS[name] or name)
  end
  if operation == "command-reset" and value ~= "" then return USAGE end
  if operation == "command" and not singleCommand(value) then return "Use one command of 1-128 characters without separators." end
  if busy then return "Aardwolf Spells is already collecting or saving." end
  local ready, message = eligible()
  if not ready then return message end
  busy, preparing, collectionCancelled, lastError, reason = true, true, false, nil, "opening SQLite"
  publish()
  prepare(function(issue)
    preparing = false
    if collectionCancelled then busy = saving or capture ~= nil; publish(); return end
    if issue then failure(issueText(issue)); return end
    local ready = eligible()
    if not ready then failure("Character is no longer active; command not saved."); return end
    local info = damage.details[name]
    if operation == "command" and (not info or info.kind ~= "skill") then failure("Refresh this skill's damage list before setting its command."); return end
    local updated, statements = clone(damage), {}
    if operation == "command" then
      updated.commands[name] = value
      statements[1] = { kind = "execute", sql = "INSERT INTO skill_commands (name,command) VALUES (?,?)"
        .. " ON CONFLICT(name) DO UPDATE SET command=excluded.command", params = { name, value } }
    else
      updated.commands[name] = nil
      statements[1] = { kind = "execute", sql = "DELETE FROM skill_commands WHERE name=?", params = { name } }
    end
    writeCandidate(snapshot, updated, statements)
  end)
  return "Skill command update requested."
end

function init()
  if initialized then return end
  libraryApi = require("aardwolf-api")
  if type(libraryApi.protocol) ~= "table" or type(libraryApi.protocol.spellsSnapshot) ~= "function" then
    echo("Aardwolf Spells requires aardwolf-api 0.3.0 or later; update the loaded library and reload Spells.")
    return
  end
  initialized = true
  widget = createWidget({ type = "html", name = "damage-abilities", title = "Aardwolf Damage Abilities",
    position = { x = 100, y = 160 }, size = { width = 540, height = 560 } })
  if type(widget) ~= "string" or widget == "" then
    widget = nil; echo("Aardwolf Spells: damage panel unavailable; collection remains available.")
  else
    setWidgetProperty(widget, "content", panelMarkup())
    registerWidgetEvent(widget, "action", panelAction)
  end
  if not registered then onPluginBroadcast(receive); registered = true end
  registerCommand("awspells", function(args)
    local command = string.lower(trim(args))
    if command == "refresh" then return refresh() end
    if command == "refresh-all" then return refreshAll() end
    if command == "cancel" then return cancelCollection() end
    if command == "show" then
      if widget then showWidget(widget, true); return "Damage panel opened." end
      return "Damage panel unavailable; reload Aardwolf Spells."
    end
    if string.match(command, "^command") then return commandOverride(trim(args)) end
    if command ~= "" and command ~= "status" then return USAGE end
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
  if widget then destroyWidget(widget); widget = nil end
  resetIdentity()
  for _, unsubscribe in ipairs(unsubscribers) do unsubscribe() end
  unsubscribers = {}
  if client then client.stop() end
  client = nil
  consumers, automaticAttempted, automaticCharacterKey, lastError, reason = {}, false, nil, nil, "not started"
  broadcastPlugin(PREFIX .. "stopped")
end
