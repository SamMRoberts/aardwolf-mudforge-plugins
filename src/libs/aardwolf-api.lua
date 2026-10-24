library = {
  name = "aardwolf-api", version = "0.4.0", author = "Sam Roberts",
  description = "Session-scoped Aardwolf data, events, native storage and UI helpers."
}

local M = { version = "0.4.0", coreName = "Aardwolf API Core" }
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

-- Normalize bounded lists from Lua and the transpiled runtime.
local function boundedList(value, limit)
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

local function spellInteger(value, minimum, maximum)
  return type(value) == "number" and finite(value) ~= nil and value == math.floor(value)
    and value >= minimum and value <= maximum
end

local function spellText(value, maximum)
  return type(value) == "string" and #value <= maximum and string.match(value, "%S") ~= nil
    and string.find(value, "%c") == nil
end

local function spellsSnapshot(value)
  assert(type(value) == "table" and value.schemaVersion == 1, "invalid spells schema")
  assert(spellText(value.characterName, 128), "invalid spells character")
  assert(spellInteger(value.collectedAt, 0, 9007199254740991), "invalid spells timestamp")
  local result = { schemaVersion = 1, characterName = value.characterName, collectedAt = value.collectedAt, entries = {} }
  local names = {}
  for _, item in ipairs(boundedList(value.entries, 1000)) do
    assert(type(item) == "table" and spellText(item.name, 128), "invalid ability name")
    assert(spellInteger(item.level, 1, 9007199254740991), "invalid ability level")
    assert(type(item.sn) == "nil" or spellInteger(item.sn, 1, 9007199254740991), "invalid ability Sn")
    assert(type(item.percent) == "nil" or spellInteger(item.percent, 0, 100), "invalid ability percent")
    assert(type(item.unusable) == "boolean", "invalid ability flag")
    local key = string.lower(item.name)
    assert(not names[key], "duplicate ability")
    names[key] = true
    table.insert(result.entries, { name = item.name, level = item.level, sn = item.sn,
      percent = item.percent, unusable = item.unusable })
  end
  assert(#result.entries > 0, "empty spells snapshot")
  return result
end

M.protocol.spellsSnapshot = spellsSnapshot

-- A provider distributes committed snapshots; consumers do not access its storage.
local function spellsFor(host, enabled)
  local prefix = "aardwolf-spells:"
  local provider, snapshot = nil, nil
  local active, disconnected = false, false
  local subscribers = {}
  local status = { available = false, connected = false, refreshing = false, reason = enabled and "not started" or "not enabled" }
  local api = {}
  local function notify()
    local callbacks = {}
    for _, item in ipairs(subscribers) do if item.active then table.insert(callbacks, item.callback) end end
    for _, callback in ipairs(callbacks) do
      local ok = pcall(callback, copy(snapshot), copy(status))
      if not ok and type(host.reportError) == "function" then pcall(host.reportError, "aardwolf-api spells subscriber failed") end
    end
  end
  local function clear(reason)
    snapshot = nil
    status = { available = false, connected = false, refreshing = false, reason = reason }
    notify()
  end
  local function discover()
    if not active then return end
    local found = host.findPluginByName("Aardwolf Spells")
    if type(found) ~= "table" or type(found.id) ~= "string" or found.enabled == false then
      provider = nil; clear("Spells provider is unavailable"); return
    end
    provider = found.id
    clear("waiting for Spells provider")
    host.broadcastToPlugin(provider, prefix .. "subscribe", json.encode({ version = 1 }))
  end
  local function receive(sender, message, encoded)
    if not active then return end
    if message == prefix .. "ready" then discover(); return end
    if sender ~= provider then return end
    if message == prefix .. "stopped" then provider = nil; clear("Spells provider stopped"); return end
    if message ~= prefix .. "state" or type(encoded) ~= "string" or #encoded > 1048576 then return end
    local ok, data = pcall(json.decode, encoded)
    if not ok or type(data) ~= "table" or data.version ~= 1 or type(data.status) ~= "table" then return end
    local state = data.status
    if type(state.connected) ~= "boolean" or type(state.refreshing) ~= "boolean"
      or (type(state.characterName) ~= "nil" and not spellText(state.characterName, 128))
      or (type(state.reason) ~= "nil" and not spellText(state.reason, 256))
      or (type(state.error) ~= "nil" and not spellText(state.error, 256)) then return end
    local candidate
    if type(data.snapshot) ~= "nil" then
      local valid
      valid, candidate = pcall(spellsSnapshot, data.snapshot)
      if not valid or not state.connected or type(state.characterName) ~= "string"
        or string.lower(candidate.characterName) ~= string.lower(state.characterName) then return end
    end
    if disconnected then return end
    snapshot = candidate
    status = { available = true, connected = state.connected, refreshing = state.refreshing,
      characterName = state.characterName, reason = state.reason, error = state.error }
    notify()
  end
  function api.get() return copy(snapshot) end
  function api.status() return copy(status) end
  function api.on(callback)
    assert(type(callback) == "function", "spells subscriber callback is required")
    local item = { active = true, callback = callback }
    table.insert(subscribers, item)
    return function() item.active = false; item.callback = nil end
  end
  local function onDisconnect()
    if not active then return end
    disconnected = true; clear("disconnected")
  end
  local function onConnect()
    disconnected = false; discover()
  end
  local function start()
    if not enabled or active then return end
    active, disconnected = true, false
    host.on("connected", onConnect)
    host.on("disconnected", onDisconnect)
    discover()
  end
  local function stop()
    if not active then return end
    active = false
    if provider then host.broadcastToPlugin(provider, prefix .. "unsubscribe") end
    provider = nil
    host.off("connected", onConnect)
    host.off("disconnected", onDisconnect)
    clear("not started")
  end
  return api, start, stop, receive
end

function M.new(host, options)
  assert(type(host) == "table", "host adapter is required")
  for _, name in ipairs({ "findPluginByName", "onPluginBroadcast", "broadcastToPlugin", "on", "off" }) do requireHost(host, name) end
  local opts = options or {}
  assert(type(opts.sqlite) == "nil", "SQLite support was removed; use native storage")
  assert(type(opts.spells) == "nil" or type(opts.spells) == "boolean", "spells option must be boolean")
  local packages = requirements(opts.packages)
  local self = {}
  local spellsStart, spellsStop, spellsReceive
  self.spells, spellsStart, spellsStop, spellsReceive = spellsFor(host, opts.spells == true)
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
    spellsReceive(sender, message, encoded)
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
    snapshots = {}
    session.connected, session.negotiated = false, false
    session.reason = "disconnected"
    notify("session", session)
  end
  function self.start()
    if active then return self.status() end
    active = true
    if not registered then host.onPluginBroadcast(receive); registered = true end
    host.on("disconnected", disconnected)
    discover()
    spellsStart()
    return self.status()
  end
  function self.stop()
    spellsStop()
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
