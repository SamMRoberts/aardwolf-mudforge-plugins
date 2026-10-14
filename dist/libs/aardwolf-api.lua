library = {
  name = "aardwolf-api", version = "0.2.0", author = "Sam Roberts",
  description = "Session-scoped Aardwolf data, events, storage, SQLite and UI helpers."
}

local M = { version = "0.2.0", coreName = "Aardwolf API Core" }
local PREFIX = "aardwolf-api:"
local STATE = {
  "char.base", "char.vitals", "char.stats", "char.maxstats",
  "char.status", "char.worth", "room.info", "group"
}
local EVENTS = { "comm.channel", "comm.quest", "comm.tick", "comm.repop" }
local PACKAGES = { Core = true, Char = true, Room = true, Comm = true, Group = true }

local function finite(value)
  if type(value) ~= "number" and type(value) ~= "string" then return nil end
  -- MudForge's tonumber("") yields zero; a missing/blank metric is unknown.
  if type(value) == "string" and string.match(value, "^[ \t\r\n]*$") ~= nil then return nil end
  local number = tonumber(value)
  if type(number) ~= "number" or number ~= number or number == math.huge or number == -math.huge then
    return nil
  end
  return number
end

-- A depth/entry bound also rejects cycles without relying on table identity
-- across MudForge's Lua-to-JavaScript boundary.
local function copyValue(value, depth, budget)
  local kind = type(value)
  if kind == "string" then
    assert(string.len(value) <= 65536, "string exceeds 64 KiB")
    local nul = string.find(value, "\0", 1, true)
    assert(type(nul) ~= "number", "NUL is not supported")
    return value
  end
  if kind == "number" then
    assert(finite(value) ~= nil, "non-finite number")
    return value
  end
  if kind == "boolean" or kind == "nil" then return value end
  assert(kind == "table", "value must contain only JSON-compatible data")
  assert(depth < 12, "data exceeds nesting limit (or contains a cycle)")
  local result = {}
  for key, item in pairs(value) do
    budget.count = budget.count + 1
    assert(budget.count <= 8192, "data exceeds entry limit")
    assert(type(key) == "string" or (type(key) == "number" and finite(key) ~= nil), "unsupported key")
    result[key] = copyValue(item, depth + 1, budget)
  end
  return result
end

local function copy(value)
  return copyValue(value, 0, { count = 0 })
end

local function contains(list, value)
  for _, item in ipairs(list) do if item == value then return true end end
  return false
end

local NUMBER_FIELDS = {
  ["char.base"] = { "perlevel", "tier", "remorts", "redos", "level", "pups", "totpups" },
  ["char.vitals"] = { "hp", "mana", "moves" },
  ["char.stats"] = { "str", "int", "wis", "dex", "con", "luck", "hr", "dr", "saves" },
  ["char.maxstats"] = { "maxhp", "maxmana", "maxmoves", "maxstr", "maxint", "maxwis", "maxdex", "maxcon", "maxluck" },
  ["char.status"] = { "level", "tnl", "hunger", "thirst", "align", "state", "enemypct" },
  ["char.worth"] = { "gold", "bank", "qp", "tp", "trains", "pracs", "qpearned" },
  ["room.info"] = { "num" },
  group = { "count", "kills", "exp" },
  ["comm.quest"] = { "timer", "time", "wait", "qp", "tierqp", "pracs", "hardcore", "opk", "trains", "tp", "lucky", "double", "daily", "totqp", "gold", "completed" }
}
local TEXT_FIELDS = {
  ["char.base"] = { "name", "class", "subclass", "race", "clan", "pretitle", "classes" },
  ["char.status"] = { "pos", "enemy" },
  ["room.info"] = { "name", "zone", "terrain", "details" },
  group = { "groupname", "leader", "created", "status" },
  ["comm.channel"] = { "chan", "msg", "player" },
  ["comm.quest"] = { "action", "status", "targ", "target", "room", "area" },
  ["comm.repop"] = { "zone" }
}

local function fields(data, names, numeric, invalid)
  for _, name in ipairs(names) do
    local value = data[name]
    if type(value) ~= "nil" then
      local valid = value
      if numeric then valid = finite(value)
      elseif type(value) ~= "string" then valid = nil end
      data[name] = valid
      if type(valid) == "nil" then invalid[name] = true end
    end
  end
end

local function normalize(packageName, payload)
  if not contains(STATE, packageName) and not contains(EVENTS, packageName) then return nil, "unsupported package" end
  if type(payload) ~= "table" then return nil, "payload must be a table" end
  local ok, data = pcall(copy, payload)
  if not ok then return nil, "payload is not bounded JSON-compatible data" end
  local invalid = {}
  fields(data, NUMBER_FIELDS[packageName] or {}, true, invalid)
  fields(data, TEXT_FIELDS[packageName] or {}, false, invalid)
  if packageName == "room.info" then
    if type(data.exits) == "table" then
      for direction, destination in pairs(data.exits) do data.exits[direction] = finite(destination) end
    else data.exits = nil end
    if type(data.coord) == "table" then
      fields(data.coord, { "id", "x", "y", "cont" }, true, {})
    else data.coord = nil end
  elseif packageName == "group" then
    if type(data.members) == "table" then
      -- JS-origin arrays may be zero-based. Sort numeric keys explicitly so
      -- both representations produce the same ordered Lua member list.
      local keys = {}
      for key, member in pairs(data.members) do
        if type(key) == "number" and key >= 0 and key == math.floor(key) and type(member) == "table" then
          table.insert(keys, key)
        end
      end
      table.sort(keys)
      local members = {}
      for _, key in ipairs(keys) do
        local member = data.members[key]
        fields(member, { "name" }, false, {})
        if type(member.info) == "table" then
          fields(member.info, { "hp", "mhp", "mn", "mmn", "mv", "mmv", "align", "tnl", "qt", "qs", "lvl", "here" }, true, {})
        else member.info = nil end
        table.insert(members, member)
      end
      data.members = members
    else data.members = nil end
  end
  return data, invalid
end

local function requirements(value)
  if type(value) == "nil" then return {} end
  assert(type(value) == "table", "packages must be a list")
  local result = {}
  for key, name in pairs(value) do
    -- MudForge's pairs uses Object.entries, so list indexes arrive as strings.
    local listKey = type(key) == "number" or (type(key) == "string" and string.match(key, "^%d+$") ~= nil)
    assert(listKey and type(name) == "string" and PACKAGES[name] == true, "unsupported Aardwolf package")
    if not contains(result, name) then table.insert(result, name) end
  end
  table.sort(result)
  return result
end

-- Core uses these pure helpers too; no host APIs run when this module loads.
M.protocol = { statePackages = STATE, eventPackages = EVENTS, normalize = normalize, copy = copy, requirements = requirements }

function M.percent(value, maximum)
  local current, limit = finite(value), finite(maximum)
  if type(current) ~= "number" or type(limit) ~= "number" or limit <= 0 then return nil end
  return math.max(0, math.min(100, current / limit * 100))
end

function M.escape(text)
  if type(text) ~= "string" then return "" end
  local out = string.gsub(text, "&", "&amp;")
  out = string.gsub(out, "<", "&lt;")
  out = string.gsub(out, ">", "&gt;")
  out = string.gsub(out, '"', "&quot;")
  out = string.gsub(out, "'", "&#39;")
  return out
end

local function requireHost(host, name)
  assert(type(host[name]) == "function", "aardwolf-api requires host." .. name)
  return host[name]
end

local function storageFor(host)
  local storage = {}
  local function name(key)
    assert(type(key) == "string" and string.len(key) > 0 and string.len(key) <= 128, "storage key must be 1-128 characters")
    assert(type(string.find(key, "\0", 1, true)) ~= "number", "invalid storage key")
    return PREFIX .. key
  end
  function storage.status()
    return requireHost(host, "storageStatus")()
  end
  function storage.get(key, defaultValue)
    local saved = requireHost(host, "loadTable")(name(key))
    if type(saved) ~= "table" then return copy(defaultValue) end
    if saved.schemaVersion ~= 1 then return nil, "unsupported storage schema" end
    if type(saved.value) == "nil" then return nil, "invalid stored value" end
    local ok, value = pcall(copy, saved.value)
    if not ok then return nil, "invalid stored value" end
    return value
  end
  function storage.set(key, value)
    local tableName = name(key)
    if type(value) == "nil" then return false, "nil is not a stored value" end
    local ok, cloned = pcall(copy, value)
    if not ok then return false, "value is not bounded JSON-compatible data" end
    local status, reason = storage.status()
    if status ~= "ready" then return false, reason or ("storage is " .. tostring(status)) end
    local accepted = requireHost(host, "saveTable")(tableName, { schemaVersion = 1, value = cloned })
    if accepted ~= true then return false, "storage refused the write" end
    return true
  end
  return storage
end

local function uiFor(host)
  local ui, owned, names = {}, {}, {}
  function ui.create(config)
    assert(type(config) == "table" and type(config.name) == "string" and config.name ~= "", "widget requires a stable name")
    assert(config.type == "html" or config.type == "canvas", "widget type must be html or canvas")
    if type(names[config.name]) == "string" then
      assert(owned[names[config.name]] == config.type, "widget name already has a different type")
      return names[config.name]
    end
    local id = requireHost(host, "createWidget")(copy(config))
    if type(id) ~= "string" or id == "" then return nil, "widget creation failed" end
    owned[id] = config.type
    names[config.name] = id
    return id
  end
  local function owns(id, kind)
    assert(type(owned[id]) == "string", "widget is not owned by this API instance")
    if kind then assert(owned[id] == kind, "incorrect widget type") end
  end
  function ui.bind(id, key, value)
    owns(id, "html")
    assert(type(key) == "string" and key ~= "", "binding key is required")
    assert(type(value) == "nil" or type(value) == "string" or type(value) == "number" or type(value) == "boolean", "binding value must be scalar")
    if type(value) ~= "nil" then copy(value) end
    requireHost(host, "setBoundValue")(id, key, value)
  end
  function ui.content(id, markup)
    owns(id, "html")
    assert(type(markup) == "string", "markup must be a string")
    requireHost(host, "setWidgetProperty")(id, "content", markup)
  end
  function ui.on(id, event, callback)
    owns(id)
    assert(type(callback) == "function", "widget callback is required")
    requireHost(host, "registerWidgetEvent")(id, event, callback)
  end
  function ui.draw(id, callback)
    owns(id, "canvas")
    assert(type(callback) == "function", "draw callback is required")
    requireHost(host, "setActiveWidget")(id)
    callback()
  end
  function ui.destroy(id)
    owns(id)
    requireHost(host, "destroyWidget")(id)
    owned[id] = nil
    for name, widget in pairs(names) do if widget == id then names[name] = nil end end
  end
  function ui.cleanup()
    for id in pairs(owned) do requireHost(host, "destroyWidget")(id) end
    owned, names = {}, {}
  end
  function ui.typography(options)
    local opts = options or {}
    local family = opts.family or "system-ui"
    assert(type(family) == "string" and string.len(family) <= 80, "font family must be a short string")
    -- Font family is a literal CSS string, never an arbitrary CSS expression.
    assert(string.match(family, "^[a-zA-Z0-9 _-]+$") ~= nil, "invalid font family")
    local size, spacing = finite(opts.size or 13), finite(opts.spacing or 0)
    assert(type(size) == "number" and size >= 8 and size <= 48, "font size must be 8-48")
    assert(type(spacing) == "number" and spacing >= -1 and spacing <= 8, "font spacing must be -1 to 8")
    local style = opts.style or "normal"
    assert(style == "normal" or style == "italic", "font style must be normal or italic")
    local weight = opts.weight or "normal"
    assert(weight == "normal" or weight == "bold", "font weight must be normal or bold")
    local cssFamily = "'" .. family .. "'"
    if family == "system-ui" or family == "serif" or family == "sans-serif" or family == "monospace" then cssFamily = family end
    return "font-family:" .. cssFamily .. ";font-size:" .. tostring(size) .. "px;font-style:" .. style
      .. ";font-weight:" .. weight .. ";letter-spacing:" .. tostring(spacing) .. "px;"
  end
  return ui
end

-- Database values deliberately do not use the GMCP copier: SQL text can
-- contain NUL, and NULL/BLOB/int64 need explicit types across the JSON bridge.
local function sqliteList(value, limit)
  assert(type(value) == "table", "expected a list")
  local indexed, count, start = {}, 0, 1
  for key, item in pairs(value) do
    local index = tonumber(key)
    assert(type(index) == "number" and index >= 0 and index <= limit and index == math.floor(index), "invalid list index")
    assert(type(indexed[index]) == "nil", "duplicate list index")
    indexed[index] = item
    count = count + 1
    if index == 0 then start = 0 end
  end
  assert(count <= limit, "list exceeds limit")
  local result = {}
  for index = start, start + count - 1 do
    assert(type(indexed[index]) ~= "nil", "list contains a hole")
    table.insert(result, indexed[index])
  end
  return result
end

local function sqliteInteger(value)
  assert(type(value) == "string" and string.match(value, "^%-?%d+$") ~= nil, "integer requires decimal text")
  local negative = string.sub(value, 1, 1) == "-"
  local digits = negative and string.sub(value, 2) or value
  assert(digits == "0" or string.sub(digits, 1, 1) ~= "0", "integer must use canonical decimal text")
  local bound = negative and "9223372036854775808" or "9223372036854775807"
  assert(string.len(digits) < 19 or (string.len(digits) == 19 and digits <= bound), "integer exceeds int64")
  return { sqliteType = "integer", value = value }
end

local function sqliteCell(value)
  local kind = type(value)
  if kind == "string" then return { type = "text", value = value } end
  if kind == "boolean" then return { type = "integer", value = value and "1" or "0" } end
  if kind == "number" then
    assert(finite(value) ~= nil, "non-finite parameter")
    if value == math.floor(value) then
      assert(math.abs(value) <= 9007199254740991, "use integer wrapper outside the safe integer range")
      return { type = "integer", value = string.format("%.0f", value) }
    end
    return { type = "real", value = value }
  end
  assert(kind == "table", "unsupported SQL parameter")
  if value.sqliteType == "null" then return { type = "null" } end
  if value.sqliteType == "integer" then
    return { type = "integer", value = sqliteInteger(value.value).value }
  end
  if value.sqliteType == "real" then
    assert(type(value.value) == "number" and finite(value.value) ~= nil, "real requires a finite number")
    return { type = "real", value = value.value }
  end
  assert(value.sqliteType == "blob" and type(value.value) == "string", "unsupported SQL wrapper")
  assert(string.len(value.value) % 4 == 0 and string.match(value.value, "^[A-Za-z0-9+/]*=?=?$") ~= nil, "invalid base64")
  return { type = "blob", value = value.value }
end

local function sqliteStatements(values)
  local result = {}
  for _, item in ipairs(sqliteList(values, 100)) do
    assert(type(item) == "table" and (item.kind == "query" or item.kind == "execute"), "invalid statement kind")
    assert(type(item.sql) == "string" and string.match(item.sql, "%S") ~= nil, "SQL must be nonempty")
    assert(type(string.find(item.sql, "\0", 1, true)) ~= "number", "SQL contains NUL")
    local params = {}
    for _, value in ipairs(sqliteList(item.params or {}, 1000)) do table.insert(params, sqliteCell(value)) end
    table.insert(result, { kind = item.kind, sql = item.sql, params = params })
  end
  return result
end

local function sqliteFor(host, config)
  local api = { null = { sqliteType = "null" }, integer = sqliteInteger }
  function api.real(value)
    assert(type(value) == "number" and finite(value) ~= nil, "real requires a finite number")
    return { sqliteType = "real", value = value }
  end
  function api.blob(value)
    local wrapped = { sqliteType = "blob", value = value }
    sqliteCell(wrapped)
    return wrapped
  end
  local root, characterKey, timeout = "~/MudForge/aardwolf-sqlite", nil, 10000
  if type(config) ~= "nil" then
    assert(type(config) == "table", "sqlite configuration must be a table")
    characterKey = config.characterKey
    assert(type(characterKey) == "string" and string.len(characterKey) > 0 and string.len(characterKey) <= 128
      and type(string.find(characterKey, "\0", 1, true)) ~= "number", "sqlite requires a stable characterKey")
    root = config.bridgeDirectory or root
    assert(type(root) == "string" and string.len(root) <= 1024 and (string.sub(root, 1, 1) == "/" or string.sub(root, 1, 2) == "~/")
      and type(string.find(root, "\0", 1, true)) ~= "number", "invalid SQLite bridge directory")
    root = string.gsub(root, "/+$", "")
    timeout = config.timeoutMs or timeout
    assert(type(timeout) == "number" and finite(timeout) ~= nil and timeout == math.floor(timeout)
      and timeout >= 1000 and timeout <= 60000, "SQLite timeout must be 1000-60000 ms")
    for _, name in ipairs({ "sqliteReadFile", "sqliteWriteFile", "sqliteRenameFile", "sqliteRemoveFile",
      "getPluginId", "getSession", "getCurrentTime", "addTimer", "removeTimer" }) do requireHost(host, name) end
  end
  local running, timer, pending, inflight, handles = false, nil, {}, nil, {}
  local sequence, boot, handleSequence = 0, nil, 0
  local dispatch, poll
  local function problem(code, outcome)
    return { code = code, message = "SQLite operation failed: " .. code, outcome = outcome or "rejected" }
  end
  local function finish(item, result, issue)
    local callback = item.callback
    item.callback = nil
    if type(callback) == "function" then
      local ok = pcall(callback, result, issue)
      if not ok and type(host.reportError) == "function" then pcall(host.reportError, "aardwolf-api SQLite callback failed") end
    end
  end
  local function read(path)
    local ok, text = pcall(host.sqliteReadFile, root .. "/" .. path, 1048577)
    if not ok or type(text) ~= "string" or string.len(text) > 1048576 then return nil end
    local decoded, value = pcall(json.decode, text)
    if decoded and type(value) == "table" then return value end
    return nil
  end
  local function heartbeat()
    local value = read("heartbeat.json")
    if type(value) ~= "table" or value.version ~= 1 or type(value.generation) ~= "string"
      or string.match(value.generation, "^[a-f0-9]+$") == nil or string.len(value.generation) ~= 32
      or type(value.time) ~= "number" or finite(value.time) == nil then return nil end
    local age = host.getCurrentTime() - value.time
    if age < -1000 or age > 5000 then return nil end
    return value
  end
  function api.status()
    local status = { configured = type(config) == "table", connected = false, available = false }
    if not status.configured then status.reason = "unconfigured"; return status end
    local ok, current = pcall(host.getSession)
    status.connected = ok and type(current) == "table" and current.connected == true
    if not running then status.reason = "not_started"
    elseif not status.connected then status.reason = "disconnected"
    else
      local ready = heartbeat()
      status.available = type(ready) == "table"
      status.generation = ready and ready.generation or nil
      if not status.available then status.reason = "helper_unavailable" end
    end
    return status
  end
  local function stopTimer()
    if type(timer) == "string" then pcall(host.removeTimer, timer); timer = nil end
  end
  local function cancel(code)
    stopTimer()
    local submitted, waiting = inflight, pending
    inflight, pending = nil, {}
    if submitted then finish(submitted, nil, problem(code, "unknown")) end
    for _, item in ipairs(waiting) do finish(item, nil, problem(code)) end
  end
  local function decodeCell(cell)
    assert(type(cell) == "table", "invalid result cell")
    if cell.type == "null" then return { sqliteType = "null" } end
    if cell.type == "text" then assert(type(cell.value) == "string"); return cell.value end
    if cell.type == "real" then assert(type(cell.value) == "number" and finite(cell.value) ~= nil); return cell.value end
    if cell.type == "blob" then return api.blob(cell.value) end
    assert(cell.type == "integer", "invalid result type")
    local wrapped = sqliteInteger(cell.value)
    local number = tonumber(wrapped.value)
    if math.abs(number) <= 9007199254740991 then return number end
    return wrapped
  end
  local function decodeResult(kind, value)
    assert(type(value) == "table", "invalid result")
    if kind == "query" then
      local result = { columns = sqliteList(value.columns, 1000), rows = {} }
      for _, column in ipairs(result.columns) do assert(type(column) == "string") end
      for _, row in ipairs(sqliteList(value.rows, 1000)) do
        local decoded = {}
        local cells = sqliteList(row, 1000)
        assert(#cells == #result.columns)
        for _, cell in ipairs(cells) do table.insert(decoded, decodeCell(cell)) end
        table.insert(result.rows, decoded)
      end
      return result
    end
    assert(type(value.changes) == "number" and finite(value.changes) ~= nil and value.changes >= 0)
    return { changes = value.changes, lastInsertId = decodeCell(value.lastInsertId) }
  end
  local function consume(item, value)
    if type(value.error) == "table" then
      local issue = value.error
      assert(type(issue.code) == "string" and string.len(issue.code) <= 128 and string.match(issue.code, "^[a-z0-9_]+$") ~= nil)
      assert(issue.outcome == "rejected" or issue.outcome == "rolled_back" or issue.outcome == "unknown")
      return nil, problem(issue.code, issue.outcome)
    end
    if item.operation == "open" then
      assert(type(value.result) == "table" and value.result.opened == true)
      return item.handle
    end
    if item.operation == "transaction" then
      assert(type(value.result) == "table")
      local result = { results = {} }
      local values = sqliteList(value.result.results, 100)
      assert(#values == #item.statements)
      for index, entry in ipairs(values) do table.insert(result.results, decodeResult(item.statements[index].kind, entry)) end
      return result
    end
    return decodeResult(item.operation, value.result)
  end
  poll = function()
    if not running then return end
    local status = api.status()
    if not status.available then cancel(status.reason); return end
    if inflight then
      local item = inflight
      local value = read("responses/" .. item.id .. ".json")
      if value then
        inflight = nil
        local valid = value.version == 1 and value.id == item.id and value.generation == item.generation
        local ok, result, issue = false, nil, nil
        if valid then ok, result, issue = pcall(consume, item, value) end
        -- Keep helper receipts until its 24-hour pruning pass. A duplicate
        -- request id must not execute twice after the consumer reads a reply.
        if not ok then issue = problem("invalid_response", "unknown") end
        finish(item, result, issue)
      elseif status.generation ~= item.generation then
        inflight = nil; finish(item, nil, problem("helper_restarted", "unknown"))
      elseif host.getCurrentTime() >= item.expiresAt then
        inflight = nil; finish(item, nil, problem("timeout", "unknown"))
      end
    end
    dispatch()
  end
  dispatch = function()
    if inflight then return end
    if #pending == 0 then stopTimer(); return end
    local item = table.remove(pending, 1)
    local status = api.status()
    if not status.available or host.getCurrentTime() >= item.expiresAt then
      finish(item, nil, problem(status.reason or "expired")); dispatch(); return
    end
    item.generation = status.generation
    local request = { version = 1, id = item.id, generation = item.generation, expiresAt = item.expiresAt,
      namespace = item.namespace, database = item.database, operation = item.operation, statements = item.statements }
    local encoded, text = pcall(json.encode, request)
    if not encoded or type(text) ~= "string" or string.len(text) > 1048576 then
      finish(item, nil, problem("message_limit")); dispatch(); return
    end
    local path = root .. "/requests/" .. item.id
    local wrote, accepted = pcall(host.sqliteWriteFile, path .. ".tmp", text)
    if not wrote or accepted ~= true then
      pcall(host.sqliteRemoveFile, path .. ".tmp")
      finish(item, nil, problem("file_write_failed")); dispatch(); return
    end
    local renamed, published = pcall(host.sqliteRenameFile, path .. ".tmp", path .. ".json")
    if not renamed or published ~= true then
      pcall(host.sqliteRemoveFile, path .. ".tmp")
      finish(item, nil, problem("file_publish_failed", "unknown")); dispatch(); return
    end
    inflight = item
  end
  local function submit(selection, operation, statements, callback, handle)
    assert(type(callback) == "function", "SQLite callback is required")
    local item = { callback = callback, database = selection, operation = operation, handle = handle }
    local status = api.status()
    if not status.available then finish(item, nil, problem(status.reason)); return end
    if #pending + (inflight and 1 or 0) >= 32 then finish(item, nil, problem("queue_limit")); return end
    local valid, prepared = pcall(sqliteStatements, statements)
    if not valid or (operation == "transaction" and #prepared == 0) then finish(item, nil, problem("invalid_statement")); return end
    local ok, pluginId = pcall(host.getPluginId)
    if not ok or type(pluginId) ~= "string" or string.len(pluginId) < 1 or string.len(pluginId) > 128
      or type(string.find(pluginId, "\0", 1, true)) == "number" then finish(item, nil, problem("invalid_namespace")); return end
    local timestamp = host.getCurrentTime()
    if type(boot) ~= "string" then
      boot = string.format("%.0f-%d-%d", timestamp, math.random(1, 2147483647), math.random(1, 2147483647))
    end
    sequence = sequence + 1
    item.id, item.expiresAt = boot .. "-" .. tostring(sequence), timestamp + timeout
    item.namespace, item.statements = { pluginId = pluginId, characterKey = characterKey }, prepared
    if type(timer) ~= "string" then
      local installed, id = pcall(host.addTimer, 250, poll, true)
      if not installed or type(id) ~= "string" or id == "" then finish(item, nil, problem("timer_refused")); return end
      timer = id
    end
    table.insert(pending, item)
    dispatch()
  end
  local function open(kind, name, callback)
    assert(type(callback) == "function", "SQLite callback is required")
    if type(name) ~= "string" or string.len(name) < 1 or string.len(name) > 128
      or string.match(name, "^[A-Za-z0-9_-]+$") == nil then finish({ callback = callback }, nil, problem("invalid_database")); return end
    local selection, closed, ready = { kind = kind, name = name }, false, false
    handleSequence = handleSequence + 1
    local handleId = handleSequence
    local handle = {}
    local function operation(kindName, statements, done)
      assert(type(done) == "function", "SQLite callback is required")
      if closed or not ready then finish({ callback = done }, nil, problem("database_closed")); return end
      submit(selection, kindName, statements, done)
    end
    function handle.query(sql, params, done) operation("query", { { kind = "query", sql = sql, params = params } }, done) end
    function handle.execute(sql, params, done) operation("execute", { { kind = "execute", sql = sql, params = params } }, done) end
    function handle.transaction(statements, done) operation("transaction", statements, done) end
    function handle.close() closed = true; handles[handleId] = nil; return true end
    submit(selection, "open", {}, function(result, issue)
      if result then ready = true; handles[handleId] = handle end
      finish({ callback = callback }, result, issue)
    end, handle)
  end
  function api.open(name, callback) open("managed", name, callback) end
  function api.openAlias(name, callback) open("alias", name, callback) end
  local function start() running = true end
  local function cleanup()
    running = false
    local owned = handles
    handles = {}
    for _, handle in pairs(owned) do handle.close() end
    cancel("stopped")
  end
  return api, start, cleanup, function() cancel("disconnected") end
end

function M.new(host, options)
  assert(type(host) == "table", "host adapter is required")
  for _, name in ipairs({ "findPluginByName", "onPluginBroadcast", "broadcastToPlugin", "on", "off" }) do requireHost(host, name) end
  local opts = options or {}
  local packages = requirements(opts.packages)
  local self = {}
  local sqliteStart, sqliteStop, sqliteDisconnect
  self.sqlite, sqliteStart, sqliteStop, sqliteDisconnect = sqliteFor(host, opts.sqlite)
  local active, registered = false, false
  local coreId = nil
  local snapshots, subscribers = {}, {}
  local session = { available = false, connected = false, negotiated = false, reason = "not started" }

  local function notify(topic, value)
    local callbacks = {}
    for _, subscription in ipairs(subscribers) do
      if subscription.topic == topic and subscription.active then table.insert(callbacks, subscription.callback) end
    end
    for _, callback in ipairs(callbacks) do
      local ok = pcall(callback, copy(value))
      if not ok and type(host.reportError) == "function" then
        pcall(host.reportError, "aardwolf-api subscriber failed: " .. topic)
      end
    end
  end
  local function unavailable(reason)
    coreId, snapshots = nil, {}
    session = { available = false, connected = false, negotiated = false, reason = reason }
    notify("session", session)
  end
  local function discover()
    local found = host.findPluginByName(M.coreName)
    if type(found) ~= "table" or type(found.id) ~= "string" or found.enabled == false then
      unavailable("Core is unavailable")
      return
    end
    coreId = found.id
    snapshots = {}
    session = { available = false, connected = false, negotiated = false, reason = "waiting for Core" }
    notify("session", session)
    host.broadcastToPlugin(coreId, PREFIX .. "register", json.encode({ version = 1, packages = packages }))
  end
  local function receive(sender, message, encoded)
    if not active then return end
    if message == PREFIX .. "ready" then
      discover()
      return
    end
    if sender ~= coreId then return end
    if message == PREFIX .. "stopped" then unavailable("Core stopped"); return end
    if type(encoded) ~= "string" then return end
    local decoded, data = pcall(json.decode, encoded)
    if not decoded or type(data) ~= "table" or data.version ~= 1 then return end
    if message == PREFIX .. "state" and type(data.session) == "table" and type(data.snapshots) == "table" then
      session = {
        available = true, connected = data.session.connected == true,
        negotiated = data.session.negotiated == true,
        reason = type(data.session.reason) == "string" and data.session.reason or nil
      }
      snapshots = {}
      if session.connected then
        for _, packageName in ipairs(STATE) do
          local value = normalize(packageName, data.snapshots[packageName])
          if type(value) == "table" then snapshots[packageName] = value end
        end
      end
      notify("session", session)
      for _, packageName in ipairs(STATE) do notify(packageName, snapshots[packageName]) end
    elseif message == PREFIX .. "update" and session.connected then
      local value = normalize(data.package, data.payload)
      if type(value) ~= "table" then return end
      if contains(STATE, data.package) then snapshots[data.package] = value end
      notify(data.package, value)
    end
  end
  local function disconnected()
    if not active then return end
    sqliteDisconnect()
    snapshots = {}
    session.connected, session.negotiated = false, false
    session.reason = "disconnected"
    notify("session", session)
  end
  function self.start()
    if active then return self.status() end
    active = true
    sqliteStart()
    if not registered then host.onPluginBroadcast(receive); registered = true end
    host.on("disconnected", disconnected)
    discover()
    return self.status()
  end
  function self.stop()
    sqliteStop()
    if not active then self.ui.cleanup(); return end
    active = false
    if type(coreId) == "string" then host.broadcastToPlugin(coreId, PREFIX .. "unregister") end
    host.off("disconnected", disconnected)
    unavailable("not started")
    self.ui.cleanup()
  end
  function self.status() return copy(session) end
  function self.get(packageName)
    assert(contains(STATE, packageName), "get supports state packages only")
    return copy(snapshots[packageName])
  end
  function self.on(topic, callback)
    assert(topic == "session" or contains(STATE, topic) or contains(EVENTS, topic), "unsupported topic")
    assert(type(callback) == "function", "subscriber callback is required")
    local subscription = { topic = topic, callback = callback, active = true }
    table.insert(subscribers, subscription)
    return function() subscription.active = false; subscription.callback = nil end
  end
  function self.request(kind)
    if not contains({ "char", "room", "area", "quest" }, kind) then return false, "unsupported refresh request" end
    if not active or not session.available then return false, "Core is unavailable" end
    if not session.connected then return false, "disconnected" end
    if not session.negotiated then return false, session.reason or "GMCP is not negotiated" end
    local sent = requireHost(host, "sendGMCP")("request " .. kind)
    if sent ~= true then return false, "transport refused the request" end
    return true
  end
  self.storage, self.ui = storageFor(host), uiFor(host)
  return self
end

return M
