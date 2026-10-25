library = {
  name = "aardwolf-api", version = "0.6.0", author = "Sam Roberts",
  description = "Session-scoped Aardwolf data, events, inventory, native storage and UI helpers."
}

local M = { version = "0.6.0", coreName = "Aardwolf API Core" }
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
    assert(type(item.area) == "nil" or type(item.area) == "boolean", "invalid ability area flag")
    local key = string.lower(item.name)
    assert(not names[key], "duplicate ability")
    names[key] = true
    table.insert(result.entries, { name = item.name, level = item.level, sn = item.sn,
      percent = item.percent, unusable = item.unusable, area = item.area })
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

-- Inventory has its own aggregate limits: a normal inventory can exceed the
-- general protocol copier's 8,192-field budget without containing unsafe data.
local function inventoryId(value)
  if type(value) == "string" and not string.match(value, "^%d+$") then return nil end
  local number = finite(value)
  if not number or number < 1 or number > 9007199254740991 or number ~= math.floor(number) then return nil end
  return number
end

local function inventoryKey(value)
  local id = inventoryId(value)
  if not id then return nil end
  return string.format("%.0f", id)
end

local INVENTORY_ACTIONS = { take = true, put = true, wear = true, remove = true,
  drop = true, give = true, sell = true, donate = true, sacrifice = true }

local function inventoryCommand(kind, args)
  if type(args) ~= "table" then return nil, "invalid inventory arguments" end
  if kind == "refresh" then return "invdata" end
  local id = inventoryKey(args.id)
  if kind == "lookIn" then
    local containerId = inventoryKey(args.containerId or args.id)
    if not containerId then return nil, "invalid container ID" end
    return "invdata " .. containerId
  end
  if not id then return nil, "invalid item ID" end
  if kind == "identify" then return "invdetails " .. id end
  if not INVENTORY_ACTIONS[kind] then return nil, "unsupported inventory action" end
  if kind == "take" or kind == "put" then
    local containerId = inventoryKey(args.containerId)
    if not containerId then return nil, "invalid container ID" end
    if containerId == id then return nil, "an item cannot contain itself" end
    return (kind == "take" and "get" or "put") .. " " .. id .. " " .. containerId
  elseif kind == "give" then
    local recipient = args.recipient
    if type(recipient) ~= "string" or #recipient > 128 then return nil, "invalid recipient" end
    local valid = string.match(recipient, "^[A-Za-z]+$") ~= nil
    if not valid then
      local selector, name = string.match(recipient, "^(%d+)%.([A-Za-z]+)$")
      valid = name ~= nil and inventoryId(selector) ~= nil
    end
    if not valid or string.lower(recipient) == "all" then return nil, "invalid recipient" end
    return "give " .. id .. " " .. recipient
  end
  return kind .. " " .. id
end
M.protocol.inventoryCommand = inventoryCommand

local function inventoryText(value, limit)
  return type(value) == "string" and #value <= limit and not string.find(value, "\0", 1, true)
end

local function inventoryScope(value)
  assert(type(value) == "table" and type(value.key) == "string", "invalid inventory scope")
  local containerId = string.match(value.key, "^container:(%d+)$")
  assert(value.key == "inventory" or value.key == "equipment"
    or (containerId and inventoryKey(containerId) == containerId), "invalid inventory scope key")
  assert(type(value.known) == "boolean" and type(value.stale) == "boolean", "invalid scope freshness")
  assert(spellInteger(value.collectedAt, 0, 9007199254740991), "invalid scope timestamp")
  local result = { key = value.key, known = value.known, stale = value.stale,
    collectedAt = value.collectedAt, entries = {} }
  local ids = {}
  for _, item in ipairs(boundedList(value.entries, 10000)) do
    assert(type(item) == "table" and inventoryId(item.id) == item.id, "invalid inventory item")
    assert(inventoryText(item.name, 4096) and inventoryText(item.flags, 128), "invalid item text")
    assert(spellInteger(item.level, 0, 9007199254740991) and spellInteger(item.type, 0, 9007199254740991), "invalid item type/level")
    assert(type(item.unique) == "boolean" and spellInteger(item.wearLocation, -1, 9007199254740991)
      and spellInteger(item.timer, -1, 9007199254740991), "invalid item fields")
    assert(item.location == value.key, "invalid item location")
    local key = inventoryKey(item.id)
    assert(not ids[key], "duplicate inventory item")
    ids[key] = true
    table.insert(result.entries, { id = item.id, flags = item.flags, name = item.name,
      level = item.level, type = item.type, unique = item.unique,
      wearLocation = item.wearLocation, timer = item.timer, location = item.location })
  end
  return result
end
M.protocol.inventoryScope = inventoryScope

local function inventoryDetails(value)
  assert(type(value) == "table" and inventoryId(value.id) == value.id, "invalid details ID")
  local result = { id = value.id, tags = {} }
  for _, field in ipairs({ "level", "value", "weight", "timer", "itemScore" }) do
    assert(type(value[field]) == "nil" or (type(value[field]) == "number" and finite(value[field]) ~= nil), "invalid details number")
    result[field] = value[field]
  end
  for _, field in ipairs({ "itemType", "wearLocation", "flags", "owner", "fromClanName" }) do
    assert(type(value[field]) == "nil" or inventoryText(value[field], 4096), "invalid details text")
    result[field] = value[field]
  end
  local bytes = 0
  for _, tag in ipairs(boundedList(value.tags, 4096)) do
    assert(type(tag) == "table" and inventoryText(tag.tag, 128) and inventoryText(tag.value, 65536), "invalid details tag")
    bytes = bytes + #tag.tag + #tag.value
    assert(bytes <= 1048576, "details exceed size limit")
    table.insert(result.tags, { tag = tag.tag, value = tag.value })
  end
  return result
end

local function copyInventoryDetails(value)
  if not value then return nil end
  return inventoryDetails(value)
end

-- Tagged inventory collection is shared by Core, never by individual consumers.
local function inventoryInteger(value, minimum)
  local number = finite(value)
  if not number or number ~= math.floor(number) or number < minimum or number > 9007199254740991 then return nil end
  return number
end

local function inventoryItem(line, location)
  if type(line) ~= "string" or #line > 65536 or string.find(line, "\0", 1, true) then return nil end
  local id, flags, name, level, itemType, unique, wearLocation, timer = string.match(line,
    "^%s*(%d+),([^,]*),(.+),(%d+),(%d+),([01]),(%-?%d+),(%-?%d+)%s*$")
  id, level, itemType = inventoryInteger(id, 1), inventoryInteger(level, 0), inventoryInteger(itemType, 0)
  wearLocation, timer = inventoryInteger(wearLocation, -1), inventoryInteger(timer, -1)
  if not id or not level or not itemType or not wearLocation or not timer or not name or #name > 4096
    or not flags or #flags > 128 then return nil end
  return { id = id, flags = flags, name = name, level = level, type = itemType,
    unique = unique == "1", wearLocation = wearLocation, timer = timer, location = location }
end
M.protocol.inventoryItem = inventoryItem

function M.protocol.inventoryCollector(host)
  local service, owners, scopes, details = {}, {}, {}, {}
  local generation, epoch, timeoutSerial = 1, 0, 0
  local connection = { connected = false, negotiated = false }
  local queue, requests, completed, tombstones = {}, {}, {}, {}
  local tombstoneOrder, tombstoneSerial = {}, 0
  local current, capture, timeout, ownSend, draining = nil, nil, nil, false, nil
  local monitoring, setupAttempted, stopped = false, false, false
  local reason, lastError = "waiting for an inventory consumer", nil
  local startNext, enqueue, notify, finish, reconcile

  local function idKey(id) return string.format("%.0f", id) end
  local function containerKey(id) return "container:" .. idKey(id) end
  local function hasEntries(value)
    for _ in pairs(value) do return true end
    return false
  end
  local function interested() return hasEntries(owners) end
  local function active()
    return not stopped and interested() and connection.connected == true and connection.negotiated == true
      and type(connection.characterName) == "string" and connection.characterName ~= "" and connection.state == 3
  end
  local function deliver(owner, kind, data)
    data.version, data.generation = 1, generation
    host.deliver(owner, kind, data)
  end
  local function broadcast(kind, data)
    local token = epoch
    for owner in pairs(owners) do
      if token ~= epoch then return end
      deliver(owner, kind, data)
    end
  end
  local function state()
    return { available = true, connected = connection.connected == true, active = active(),
      collecting = current ~= nil or #queue > 0 or draining ~= nil,
      characterName = connection.characterName, reason = reason, error = lastError }
  end
  notify = function(reset)
    broadcast("inventory-status", { status = state(), reset = reset == true })
  end
  local function sendScope(scope)
    broadcast("inventory-scope", { scope = scope })
  end
  local function stopTimer()
    timeoutSerial = timeoutSerial + 1
    if type(timeout) == "string" and timeout ~= "" then host.removeTimer(timeout) end
    timeout = nil
  end
  local function result(waiter, outcome, issue)
    if not waiter or not owners[waiter.owner] then return end
    local key = waiter.owner .. ":" .. waiter.requestId
    local pending = requests[key]
    if not pending then return end
    if outcome == "complete" then
      pending.remaining = pending.remaining - 1
      if pending.remaining > 0 then return end
    end
    requests[key] = nil
    local history = completed[waiter.owner]
    if not history then history = { ids = {}, order = {} }; completed[waiter.owner] = history end
    history.ids[waiter.requestId] = { outcome = outcome, reason = issue }
    table.insert(history.order, waiter.requestId)
    if #history.order > 256 then history.ids[table.remove(history.order, 1)] = nil end
    deliver(waiter.owner, "inventory-result", { requestId = waiter.requestId, outcome = outcome, reason = issue })
  end
  local function jobResult(job, outcome, issue)
    for _, waiter in ipairs(job and job.waiters or {}) do result(waiter, outcome, issue) end
  end
  local function stale(key)
    local scope = scopes[key]
    if scope and not scope.stale then scope.stale = true; sendScope(scope) end
  end
  local function staleAll()
    local token = epoch
    for key in pairs(scopes) do
      if token ~= epoch then return end
      stale(key)
    end
  end
  local function countItems(replacementKey, replacement)
    local ids, count = {}, 0
    local function add(entries)
      for _, item in ipairs(entries) do
        local key = idKey(item.id)
        if not ids[key] then ids[key] = true; count = count + 1 end
      end
    end
    for key, scope in pairs(scopes) do if key ~= replacementKey then add(scope.entries) end end
    add(replacement or {})
    return count
  end
  local function getItem(id)
    for _, scope in pairs(scopes) do
      for _, item in ipairs(scope.entries) do if item.id == id then return item end end
    end
    return nil
  end
  local function ensureScope(key)
    if scopes[key] then return scopes[key] end
    if string.sub(key, 1, 10) == "container:" then
      local count = 0
      for scopeKey in pairs(scopes) do if string.sub(scopeKey, 1, 10) == "container:" then count = count + 1 end end
      if count >= 256 then return nil end
    end
    scopes[key] = { key = key, known = false, stale = true, entries = {}, collectedAt = host.getCurrentTime() }
    return scopes[key]
  end
  local function forgetDetails(id)
    local key = idKey(id)
    if details[key] then
      details[key] = nil
      broadcast("inventory-details", { details = { id = id, removed = true } })
    end
    if capture and capture.kind == "details" and current and current.expectedId == id then capture.dirty = true end
  end
  local function markRemoved(id)
    local key = idKey(id)
    tombstoneSerial = tombstoneSerial + 1
    tombstones[key] = tombstoneSerial
    table.insert(tombstoneOrder, { key = key, serial = tombstoneSerial })
    if #tombstoneOrder > 10000 then
      local oldest = table.remove(tombstoneOrder, 1)
      if tombstones[oldest.key] == oldest.serial then tombstones[oldest.key] = nil end
    end
  end
  local function scopeFits(key, entries)
    local ok, encoded = pcall(json.encode, { version = 1, generation = generation,
      scope = { key = key, entries = entries, known = true, stale = false, collectedAt = host.getCurrentTime() } })
    return ok and type(encoded) == "string" and #encoded <= 8388608
  end
  local function removeItem(id)
    local affected = {}
    for key, scope in pairs(scopes) do
      local entries = {}
      for _, item in ipairs(scope.entries) do
        if item.id ~= id then table.insert(entries, item) else affected[key] = true end
      end
      if affected[key] then scope.entries = entries end
    end
    return affected
  end
  local function observeOverride(id, item)
    if capture and capture.kind ~= "details" then capture.overrides[idKey(id)] = item or false end
  end
  local function moveItem(id, destination, update)
    local token = epoch
    local item = update or getItem(id)
    if destination and not item then return false end
    if item and not getItem(id) and countItems(nil, { item }) > 10000 then return false end
    local target = destination and ensureScope(destination) or nil
    if destination and not target then return false end
    if destination then
      local candidate = {}
      for _, existing in ipairs(target.entries) do if existing.id ~= id then table.insert(candidate, existing) end end
      table.insert(candidate, item)
      if not scopeFits(destination, candidate) then
        lastError, reason = "Inventory scope exceeds message size limit", "Inventory scope exceeds message size limit"
        notify(); return false
      end
    end
    local affected = removeItem(id)
    forgetDetails(id)
    if token ~= epoch then return false end
    if destination then
      item = copy(item); item.location = destination
      if destination == "inventory" or string.sub(destination, 1, 10) == "container:" then item.wearLocation = -1 end
      table.insert(target.entries, item); affected[destination] = true
    else
      forgetDetails(id)
      local pending = { id }
      local index = 1
      while index <= #pending do
        local scope = scopes[containerKey(pending[index])]
        if scope and #scope.entries > 0 then
          for _, child in ipairs(scope.entries) do
            forgetDetails(child.id)
            if token ~= epoch then return false end
            markRemoved(child.id)
            observeOverride(child.id, nil)
            table.insert(pending, child.id)
          end
          scope.entries, scope.known, scope.stale = {}, false, true
          affected[scope.key] = true
        end
        index = index + 1
      end
      markRemoved(id)
    end
    observeOverride(id, destination and item or nil)
    for key in pairs(affected) do
      if token ~= epoch then return false end
      sendScope(scopes[key])
    end
    return token == epoch
  end
  local function cancelQueue(issue)
    local previous, token = queue, epoch
    queue = {}
    for _, job in ipairs(previous) do
      if token ~= epoch then return end
      jobResult(job, "failed", issue)
    end
  end
  finish = function(outcome, issue, shouldDrain)
    local job, token = current, epoch
    stopTimer()
    if shouldDrain and job then draining = { key = job.key, kind = job.kind } end
    current, capture = nil, nil
    if issue then lastError, reason = issue, issue end
    if job then
      if outcome == "failed" and job.kind ~= "details" then stale(job.key) end
      if token ~= epoch then return end
      jobResult(job, outcome, issue)
      if token ~= epoch then return end
    end
    if shouldDrain then cancelQueue(issue) end
    if token ~= epoch then return end
    notify()
    if token == epoch and not shouldDrain then startNext() end
  end
  local function armTimeout()
    timeoutSerial = timeoutSerial + 1
    local token, timerToken = epoch, timeoutSerial
    local ok, timer = pcall(host.addTimer, 10000, function()
      if not stopped and token == epoch and timerToken == timeoutSerial then timeout = nil; finish("failed", "Inventory response timed out; waiting for its closing tag or reconnect", true) end
    end, false)
    if not ok or type(timer) ~= "string" or timer == "" then return false end
    timeout = timer
    return true
  end
  startNext = function()
    if current or draining or #queue == 0 or not active() then return end
    current = table.remove(queue, 1)
    capture = nil
    reason = "waiting for " .. current.command
    if not armTimeout() then finish("failed", "Inventory timeout timer refused", false); return end
    ownSend = true
    local ok, accepted = pcall(host.send, current.command)
    ownSend = false
    if not ok or accepted == false then finish("failed", "Inventory command transport refused", false); return end
    notify()
  end
  enqueue = function(key, kind, command, waiter)
    local job
    if current and current.key == key and current.kind == kind and not current.manual then job = current end
    if not job then
      for _, candidate in ipairs(queue) do if candidate.key == key and candidate.kind == kind then job = candidate; break end end
    end
    if not job then
      if #queue >= 64 then return false, "Inventory read queue is full" end
      job = { key = key, kind = kind, command = command, waiters = {} }
      table.insert(queue, job)
    end
    if waiter then table.insert(job.waiters, waiter) end
    return true
  end
  reconcile = function(keys)
    if draining then return end
    local ordered = {}
    for key in pairs(keys) do table.insert(ordered, key) end
    table.sort(ordered, function(a, b)
      local left = a == "inventory" and "0" or a == "equipment" and "1" or a
      local right = b == "inventory" and "0" or b == "equipment" and "1" or b
      return left < right
    end)
    for _, key in ipairs(ordered) do
      stale(key)
      local command = key == "inventory" and "invdata" or key == "equipment" and "eqdata"
        or "invdata " .. string.sub(key, 11)
      -- A dirty in-flight frame needs a fresh read after it, not another waiter on it.
      local queued = false
      for _, candidate in ipairs(queue) do if candidate.key == key and candidate.kind == "scope" then queued = true end end
      if not queued and #queue < 64 then table.insert(queue, { key = key, kind = "scope", command = command, waiters = {} }) end
    end
    startNext()
  end
  local function monitor(line)
    local token = epoch
    local data = string.match(line, "^%s*{invitem}(.*)$")
    if data then
      local item = inventoryItem(data, "inventory")
      if item and tombstones[idKey(item.id)] then return true end
      if item then
        local known = getItem(item.id)
        if known then item.location = known.location; item.wearLocation = known.wearLocation end
        if not moveItem(item.id, item.location, item) and token == epoch then
          staleAll()
          if token == epoch then reconcile({ inventory = true, equipment = true }) end
        end
      else staleAll(); reconcile({ inventory = true, equipment = true }) end
      return true
    end
    local action, id, containerId, wearLocation = string.match(line, "^%s*{invmon}(%d+),(%d+),(%-?%d+),(%-?%d+)%s*$")
    if not action then
      if string.match(line, "^%s*{invmon}") then staleAll(); reconcile({ inventory = true, equipment = true }); return true end
      return false
    end
    action, id = inventoryInteger(action, 0), inventoryInteger(id, 1)
    containerId, wearLocation = inventoryInteger(containerId, -1), inventoryInteger(wearLocation, -1)
    if not action or not id or not containerId or not wearLocation then staleAll(); reconcile({ inventory = true, equipment = true }); return true end
    local item = getItem(id)
    local source = item and item.location
    local destination
    if action == 1 or action == 4 or action == 5 or action == 10 or action == 12 then destination = "inventory"
    elseif action == 2 then destination = "equipment"
    elseif action == 6 and containerId > 0 then destination = containerKey(containerId)
    elseif action ~= 3 and action ~= 6 and action ~= 7 and action ~= 9 and action ~= 11 then
      staleAll(); reconcile({ inventory = true, equipment = true }); return true
    end
    if destination then tombstones[idKey(id)] = nil end
    if item and action == 2 then item = copy(item); item.wearLocation = wearLocation end
    local known = moveItem(id, destination, item)
    if token ~= epoch then return true end
    local affected = {}
    if not known or (action == 6 and containerId < 1) or (action == 5 and containerId < 1) then
      affected.inventory, affected.equipment = true, true
      for key in pairs(scopes) do if string.sub(key, 1, 10) == "container:" and scopes[key].known then affected[key] = true end end
      if capture and capture.kind ~= "details" then capture.dirty = true end
    end
    if containerId > 0 and (action == 5 or action == 6) then
      local key = containerKey(containerId)
      if scopes[key] and scopes[key].known and not known then affected[key] = true end
    end
    if source and not known then affected[source] = true end
    if hasEntries(affected) then reconcile(affected) end
    return true
  end
  local function header(line)
    if line == "{invdata}" then return "scope", "inventory" end
    if line == "{eqdata}" then return "scope", "equipment" end
    local id = string.match(line, "^{invdata (%d+)}$")
    if id then id = inventoryInteger(id, 1); if id then return "scope", containerKey(id) end end
    if line == "{invdetails}" then return "details", nil end
    return nil, nil
  end
  local function detailsHeader(line)
    local text = string.match(line, "^{invheader}(.*)$")
    if not text then return nil end
    local values = {}
    for value in string.gmatch(text .. "|", "(.-)|") do table.insert(values, value) end
    if #values ~= 13 then return nil end
    local id, level = inventoryInteger(values[1], 1), inventoryInteger(values[2], 0)
    local value, weight = finite(values[4]), finite(values[5])
    local timer, itemScore = finite(values[10]), finite(values[13])
    if not id or not level or not value or not weight or not timer or not itemScore then return nil end
    return { id = id, level = level, itemType = values[3], value = value, weight = weight,
      wearLocation = values[6], flags = values[7], owner = values[8], fromClanName = values[9],
      timer = timer, itemScore = itemScore, tags = {}, collectedAt = host.getCurrentTime() }
  end
  local function commitScope(frame)
    if frame.dirty then return false, "Inventory changed during an incomplete observation" end
    local entries, ids = {}, {}
    for _, item in ipairs(frame.entries) do
      local override = frame.overrides[idKey(item.id)]
      if override == nil then table.insert(entries, item); ids[idKey(item.id)] = true
      elseif override and override.location == frame.key then table.insert(entries, override); ids[idKey(item.id)] = true end
    end
    for key, item in pairs(frame.overrides) do
      if item and item.location == frame.key and not ids[key] then table.insert(entries, item); ids[key] = true end
    end
    if countItems(frame.key, entries) > 10000 then return false, "Inventory exceeds 10000 known items" end
    if not scopeFits(frame.key, entries) then return false, "Inventory scope exceeds message size limit" end
    local scope = ensureScope(frame.key)
    if not scope then return false, "Inventory exceeds 256 cached containers" end
    local omitted = {}
    for _, previous in ipairs(scope.entries) do
      if not ids[idKey(previous.id)] then table.insert(omitted, previous.id) end
    end
    -- A replacement can reveal losses even when no monitor tag was received.
    -- Remove the old object's details and any cached contents it owned.
    for _, id in ipairs(omitted) do
      moveItem(id, nil)
      if frame.epoch ~= epoch then return false, "Inventory session changed" end
      markRemoved(id)
    end
    local affected = {}
    for _, item in ipairs(entries) do
      tombstones[idKey(item.id)] = nil
      for key, other in pairs(scopes) do
        if key ~= frame.key then
          local kept = {}
          for _, existing in ipairs(other.entries) do
            if existing.id ~= item.id then table.insert(kept, existing) else affected[key] = true end
          end
          if affected[key] then other.entries = kept end
        end
      end
    end
    scope.entries, scope.known, scope.stale, scope.collectedAt = entries, true, false, host.getCurrentTime()
    for key in pairs(affected) do
      sendScope(scopes[key])
      if frame.epoch ~= epoch then return false, "Inventory session changed" end
    end
    sendScope(scope)
    return true
  end
  function service.line(rawLine, cleanLine)
    if not interested() or not connection.connected or not monitoring or type(cleanLine) ~= "string" then return end
    local line = cleanLine
    if capture then
      capture.bytes = capture.bytes + #line + 1
      if capture.bytes > 1048576 then finish("failed", "Inventory frame exceeds 1 MiB", true); return end
    end
    if monitor(line) then return end
    local kind, key = header(line)
    if draining then
      local expected = draining.footers and draining.footers[1]
        or (draining.kind == "details" and "{/invdetails}" or draining.key == "equipment" and "{/eqdata}" or "{/invdata}")
      if not draining.ambiguous and line == expected then
        if draining.footers then table.remove(draining.footers, 1) end
        if not draining.footers or #draining.footers == 0 then
          draining, reason = nil, "ready"; notify(); startNext()
        end
      end
      return
    end
    if kind then
      if capture then
        finish("failed", "Nested inventory frame interrupted collection; reconnect to reset", true)
        draining = { ambiguous = true }; return
      end
      local matches = current and current.kind == kind and (kind == "details" or current.key == key)
      if current and not matches then
        finish("failed", "Unsolicited inventory frame interrupted collection; reconnect to reset", true)
        draining = { ambiguous = true }; return
      end
      capture = { epoch = epoch, kind = kind, key = key, owned = matches == true, entries = {}, ids = {}, overrides = {}, bytes = #line,
        tags = 0, dirty = false }
      if not current then
        current = { key = key, kind = kind, command = "manual tagged inventory", waiters = {}, manual = true }
        if not armTimeout() then finish("failed", "Inventory timeout timer refused", true) end
      end
      notify(); return
    end
    if not capture then return end
    local frame = capture
    local closing = line == "{/invdata}" or line == "{/eqdata}" or line == "{/invdetails}"
    if closing then
      if (frame.kind == "details" and line ~= "{/invdetails}")
        or (frame.kind == "scope" and ((frame.key == "equipment" and line ~= "{/eqdata}")
          or (frame.key ~= "equipment" and line ~= "{/invdata}"))) then
        finish("failed", "Mismatched inventory closing tag", false); return
      end
      local ok, issue
      if frame.kind == "details" then
        local detail = frame.details
        local expected = current and current.expectedId
        if frame.dirty then ok, issue = false, "Item changed during detail collection"
        elseif not detail or (expected and detail.id ~= expected) then ok, issue = false, "Inventory details identify a different item"
        else
          local valid, normalized = pcall(inventoryDetails, detail)
          if not valid then finish("failed", "Malformed or oversized inventory details", false); return end
          detail = normalized
          local count = 0
          for _ in pairs(details) do count = count + 1 end
          if not details[idKey(detail.id)] and count >= 10000 then ok, issue = false, "Inventory details exceed 10000 items"
          else details[idKey(detail.id)] = detail; broadcast("inventory-details", { details = detail }); ok = true end
        end
      else ok, issue = commitScope(frame) end
      if frame.epoch ~= epoch then return end
      if ok then reason, lastError = "ready", nil; finish("complete", nil, false)
      else finish("failed", issue, false) end
      return
    end
    if frame.kind == "scope" then
      local item = inventoryItem(line, frame.key)
      if not item or frame.ids[idKey(item.id)] or #frame.entries >= 10000 then
        finish("failed", "Malformed, duplicate or oversized inventory row", true); return
      end
      frame.ids[idKey(item.id)] = true; table.insert(frame.entries, item)
    else
      if string.match(line, "^{invheader}") then
        if frame.details then finish("failed", "Duplicate inventory details header", true); return end
        frame.details = detailsHeader(line)
        if not frame.details or (current.expectedId and frame.details.id ~= current.expectedId) then
          finish("failed", "Malformed or mismatched inventory details header", true)
        end
      else
        local tag, value = string.match(line, "^{([%w_%-]+)}(.*)$")
        if not tag or not frame.details or #tag > 128 or #value > 65536 or frame.tags >= 512 then
          finish("failed", "Malformed or oversized inventory detail tag", true); return
        end
        frame.tags = frame.tags + 1; table.insert(frame.details.tags, { tag = tag, value = value })
      end
    end
  end
  function service.sent(command)
    if ownSend or not interested() or not connection.connected or not monitoring or type(command) ~= "string" then return end
    command = string.lower(command)
    local verb = string.match(string.lower(command), "^%s*([%a]+)")
    if verb ~= "invdata" and verb ~= "eqdata" and verb ~= "invdetails" then return end
    if current or draining then
      -- The server may still owe the old reply and the newly sent manual
      -- reply. Drain both in order; consuming only one could let the other
      -- satisfy a later request for the same scope.
      local barrier = draining
      if current then
        barrier = { footers = { current.kind == "details" and "{/invdetails}"
          or current.key == "equipment" and "{/eqdata}" or "{/invdata}" } }
        finish("failed", "Manual inventory command interrupted collection", true)
      elseif not barrier.footers and not barrier.ambiguous then
        barrier = { footers = { barrier.kind == "details" and "{/invdetails}"
          or barrier.key == "equipment" and "{/eqdata}" or "{/invdata}" } }
      end
      if barrier.footers then
        table.insert(barrier.footers, verb == "invdetails" and "{/invdetails}" or verb == "eqdata" and "{/eqdata}" or "{/invdata}")
        if #barrier.footers > 64 then barrier = { ambiguous = true } end
      end
      cancelQueue("Manual inventory command interrupted collection")
      stopTimer(); current, capture, draining = nil, nil, barrier
      reason, lastError = "Waiting for interrupted inventory output or reconnect", "Manual inventory command interrupted collection"
      notify(); return
    end
    -- Idle manual output may update the cache, but has no owned waiters.
    cancelQueue("Manual inventory command interrupted collection")
    stopTimer(); current, capture = nil, nil
    reason = "waiting for manual inventory output"
    current = { key = verb == "eqdata" and "equipment" or "inventory", kind = verb == "invdetails" and "details" or "scope",
      command = command, waiters = {}, manual = true }
    local containerId = string.match(command, "^%s*invdata%s+(%d+)%s*$")
    if containerId then current.key = containerKey(tonumber(containerId)) end
    if current.kind == "details" then current.expectedId = inventoryInteger(string.match(command, "^%s*invdetails%s+(%d+)%s*$"), 1) end
    if not armTimeout() then finish("failed", "Inventory timeout timer refused", true) end
    notify()
  end
  function service.subscribe(owner)
    if stopped then return end
    local fresh, token = not owners[owner], epoch
    owners[owner] = true
    deliver(owner, "inventory-status", { status = state(), reset = fresh })
    if token ~= epoch or not owners[owner] then return end
    for _, scope in pairs(scopes) do
      deliver(owner, "inventory-scope", { scope = scope })
      if token ~= epoch or not owners[owner] then return end
    end
    for _, detail in pairs(details) do
      deliver(owner, "inventory-details", { details = detail })
      if token ~= epoch or not owners[owner] then return end
    end
    service.sync(connection)
  end
  function service.unsubscribe(owner)
    owners[owner] = nil
    completed[owner] = nil
    for key, pending in pairs(requests) do if pending.owner == owner then requests[key] = nil end end
    if not interested() then service.reset("waiting for an inventory consumer") end
  end
  function service.generation() return generation end
  function service.reset(issue)
    epoch, generation = epoch + 1, generation + 1
    -- Invalidate command eligibility before result/status callbacks can run.
    connection = { connected = connection.connected, negotiated = false }
    stopTimer()
    current, capture, draining, scopes, details, requests, completed, tombstones = nil, nil, nil, {}, {}, {}, {}, {}
    queue, tombstoneOrder, tombstoneSerial = {}, {}, 0
    monitoring, setupAttempted, reason, lastError = false, false, issue or "waiting for login", nil
    -- The generation reset fails each consumer's pending requests. Publish only
    -- after clearing everything so callbacks can safely start a fresh session.
    notify(true)
  end
  function service.sync(value)
    if stopped then return end
    local previous = connection
    local changed = previous.characterName and (not value.characterName or string.lower(previous.characterName) ~= string.lower(value.characterName))
    if (previous.connected and not value.connected) or changed then
      local expected = epoch + 1
      service.reset(changed and "Character changed" or "disconnected")
      if epoch ~= expected then return end
    end
    connection = { connected = value.connected == true, negotiated = value.negotiated == true,
      characterName = value.characterName, state = value.state }
    if not active() then
      if current then finish("failed", "Character is no longer active", true) end
      notify(); return
    end
    if not setupAttempted then
      setupAttempted = true
      local ok, accepted = pcall(host.sendGMCP, "config invmon on")
      if not ok or accepted ~= true then lastError, reason = "Inventory monitoring transport refused", "Inventory monitoring transport refused"; notify(); return end
      monitoring, reason = true, "collecting inventory"
      enqueue("inventory", "scope", "invdata"); enqueue("equipment", "scope", "eqdata")
    end
    notify(); startNext()
  end
  function service.request(owner, request)
    if not owners[owner] or type(request) ~= "table" or type(request.requestId) ~= "string"
      or #request.requestId == 0 or #request.requestId > 128 or string.find(request.requestId, "%c") then return end
    local waiter = { owner = owner, requestId = request.requestId }
    local requestKey = owner .. ":" .. request.requestId
    if requests[requestKey] then return end
    local previous = completed[owner] and completed[owner].ids[request.requestId]
    if previous then
      deliver(owner, "inventory-result", { requestId = request.requestId, outcome = previous.outcome, reason = previous.reason })
      return
    end
    local outstanding = 0
    for _, pending in pairs(requests) do if pending.owner == owner then outstanding = outstanding + 1 end end
    if outstanding >= 64 then
      deliver(owner, "inventory-result", { requestId = request.requestId, outcome = "failed", reason = "Inventory request limit reached" })
      return
    end
    requests[requestKey] = { owner = owner, remaining = request.kind == "refresh" and 2 or 1 }
    if request.generation ~= generation then result(waiter, "failed", "Inventory connection generation changed"); return end
    if not active() or not monitoring then result(waiter, "failed", "Inventory requires an active character and monitoring"); return end
    if draining then result(waiter, "failed", "Waiting for interrupted inventory output or reconnect"); return end
    local args = type(request.args) == "table" and request.args or {}
    local ok, issue
    if request.kind == "refresh" then
      ok, issue = enqueue("inventory", "scope", "invdata", waiter)
      if ok then ok, issue = enqueue("equipment", "scope", "eqdata", waiter) end
    elseif request.kind == "lookIn" then
      local command, issue = M.protocol.inventoryCommand("lookIn", args)
      local id = inventoryInteger(args.containerId or args.id, 1)
      if not command or not id then result(waiter, "failed", issue or "Invalid container ID"); return end
      ok, issue = enqueue(containerKey(id), "scope", command, waiter)
    elseif request.kind == "identify" then
      local command, issue = M.protocol.inventoryCommand("identify", args)
      local id = inventoryInteger(args.id, 1)
      if not command or not id then result(waiter, "failed", issue or "Invalid item ID"); return end
      local key = "details:" .. idKey(id)
      ok, issue = enqueue(key, "details", command, waiter)
      if ok then
        if current and current.key == key then current.expectedId = id end
        for _, job in ipairs(queue) do if job.key == key then job.expectedId = id end end
      end
    else
      if current or #queue > 0 then result(waiter, "failed", "Inventory collection is busy"); return end
      local command
      command, issue = M.protocol.inventoryCommand(request.kind, args)
      if not command then result(waiter, "failed", issue or "Invalid inventory action"); return end
      ownSend = true
      local sent, accepted = pcall(host.send, command)
      ownSend = false
      if not sent or accepted == false then result(waiter, "failed", "Inventory action transport refused")
      else result(waiter, "sent") end
      return
    end
    if not ok then result(waiter, "failed", issue); return end
    startNext(); notify()
  end
  function service.stop()
    if stopped then return end
    service.reset("Inventory Core stopped")
    stopped, owners = true, {}
  end
  return service
end

local function inventoryFor(host, enabled, dispatch)
  local scopes, details, generation = {}, {}, nil
  local callbacks, results, pending = {}, {}, {}
  local serial, lifetime = 0, 0
  local state = { available = false, connected = false, collecting = false, active = false,
    reason = enabled and "not started" or "not enabled" }
  local api = {}
  local function snapshot()
    local value = { items = {}, scopes = {}, details = {} }
    for key, scope in pairs(scopes) do
      value.scopes[key] = inventoryScope(scope)
      for _, item in ipairs(scope.entries) do value.items[inventoryKey(item.id)] = copy(item) end
    end
    for key, detail in pairs(details) do value.details[key] = copyInventoryDetails(detail) end
    return value
  end
  local function invoke(list, result)
    local calls = {}
    for _, subscription in ipairs(list) do
      if subscription.active then table.insert(calls, subscription.callback) end
    end
    for _, callback in ipairs(calls) do
      local ok
      if result then ok = pcall(callback, copy(result))
      else ok = pcall(callback, snapshot(), copy(state)) end
      if not ok and type(host.reportError) == "function" then pcall(host.reportError, "aardwolf-api inventory subscriber failed") end
    end
  end
  local function clear(reason, available)
    scopes, details, generation = {}, {}, nil
    local previous = pending
    pending = {}
    lifetime = lifetime + 1
    state = { available = available == true, connected = false, collecting = false, active = false, reason = reason }
    for requestId in pairs(previous) do invoke(results, { requestId = requestId, outcome = "failed", reason = reason }) end
    invoke(callbacks)
  end
  local function capability(value, session)
    if not enabled then return end
    if value ~= 1 then clear("inventory requires API Core 0.2.0 or newer", false)
    elseif not session.connected then clear(session.reason or "disconnected", true)
    else
      state.available = true
      state.connected = true
      if not session.negotiated then state.active = false; state.reason = session.reason end
    end
  end
  local function receive(kind, data)
    if not enabled or not state.available then return end
    if not spellInteger(data.generation, 1, 9007199254740991) then return end
    if kind == "inventory-status" then
      if generation and data.generation < generation then return end
      local value = data.status
      if type(value) ~= "table" or type(value.connected) ~= "boolean" or type(value.collecting) ~= "boolean"
        or type(value.active) ~= "boolean" then return end
      for _, field in ipairs({ "characterName", "reason", "error" }) do
        if type(value[field]) ~= "nil" and not inventoryText(value[field], 4096) then return end
      end
      local previous = {}
      if data.generation ~= generation or data.reset == true then
        scopes, details = {}, {}
        previous, pending = pending, {}
        lifetime = lifetime + 1
      end
      generation = data.generation
      state = { available = true, connected = value.connected, collecting = value.collecting,
        active = value.active, characterName = value.characterName, reason = value.reason, error = value.error }
      -- Commit the complete new state before calling user code. A subscriber
      -- may stop or restart the client; nothing after it may restore old state.
      for requestId in pairs(previous) do
        invoke(results, { requestId = requestId, outcome = "failed", reason = value.reason or "inventory reset" })
      end
      invoke(callbacks)
      return
    end
    if generation ~= data.generation or not state.connected then return end
    if kind == "inventory-scope" then
      local ok, scope = pcall(inventoryScope, data.scope)
      if not ok then return end
      local ids, incoming, count, containers = {}, {}, 0, 0
      for key, existing in pairs(scopes) do
        if key ~= scope.key then
          if string.sub(key, 1, 10) == "container:" then containers = containers + 1 end
          for _, item in ipairs(existing.entries) do ids[inventoryKey(item.id)] = true end
        end
      end
      if string.sub(scope.key, 1, 10) == "container:" then containers = containers + 1 end
      for _, item in ipairs(scope.entries) do
        local key = inventoryKey(item.id)
        ids[key], incoming[key] = true, true
      end
      for _ in pairs(ids) do count = count + 1 end
      if count > 10000 or containers > 256 then return end
      -- A move can arrive as two scope messages. The incoming location wins;
      -- remove duplicates without claiming an unknown scope is complete.
      for key, existing in pairs(scopes) do
        if key ~= scope.key then
          local kept = {}
          for _, item in ipairs(existing.entries) do
            if not incoming[inventoryKey(item.id)] then table.insert(kept, item) end
          end
          existing.entries = kept
        end
      end
      scopes[scope.key] = scope
      invoke(callbacks)
    elseif kind == "inventory-details" then
      if type(data.details) == "table" and data.details.removed == true and inventoryId(data.details.id) == data.details.id then
        details[inventoryKey(data.details.id)] = nil
        invoke(callbacks)
        return
      end
      local ok, detail = pcall(inventoryDetails, data.details)
      if not ok then return end
      local key, count = inventoryKey(detail.id), 0
      for _ in pairs(details) do count = count + 1 end
      if not details[key] and count >= 10000 then return end
      details[key] = detail
      invoke(callbacks)
    elseif kind == "inventory-result" then
      if type(data.requestId) ~= "string" or not pending[data.requestId]
        or not contains({ "complete", "sent", "failed" }, data.outcome)
        or (type(data.reason) ~= "nil" and not inventoryText(data.reason, 4096)) then return end
      pending[data.requestId] = nil
      invoke(results, { requestId = data.requestId, outcome = data.outcome, reason = data.reason })
    end
  end
  local function subscribe(list, callback)
    assert(type(callback) == "function", "inventory subscriber callback is required")
    local entry = { active = true, callback = callback }
    table.insert(list, entry)
    return function() entry.active = false; entry.callback = nil end
  end
  function api.get() return snapshot() end
  function api.getItem(id)
    local key = inventoryKey(id)
    if not key then return nil end
    for _, scope in pairs(scopes) do
      for _, item in ipairs(scope.entries) do if inventoryKey(item.id) == key then return copy(item) end end
    end
  end
  function api.getContainers()
    local value = {}
    for _, scope in pairs(scopes) do
      for _, item in ipairs(scope.entries) do if item.type == 11 then table.insert(value, copy(item)) end end
    end
    table.sort(value, function(a, b) return a.id < b.id end)
    return value
  end
  function api.getContents(id)
    local key = inventoryKey(id)
    return key and scopes["container:" .. key] and inventoryScope(scopes["container:" .. key]) or nil
  end
  function api.getDetails(id) return copyInventoryDetails(details[inventoryKey(id)]) end
  function api.status() return copy(state) end
  function api.on(callback) return subscribe(callbacks, callback) end
  function api.onResult(callback) return subscribe(results, callback) end
  local function request(kind, args)
    local command, reason = inventoryCommand(kind, args)
    if not command then return nil, reason end
    if not enabled or not state.available or not generation then return nil, state.reason or "inventory unavailable" end
    if not state.connected then return nil, "disconnected" end
    if not state.active then return nil, "waiting for an active character" end
    if INVENTORY_ACTIONS[kind] and state.collecting then return nil, "inventory collection is busy" end
    local count = 0
    for _ in pairs(pending) do count = count + 1 end
    if count >= 64 then return nil, "too many inventory requests" end
    serial = serial + 1
    local requestId = tostring(lifetime) .. ":" .. tostring(serial)
    pending[requestId] = true
    local ok, sent = pcall(dispatch, { version = 1, generation = generation, requestId = requestId, kind = kind, args = args })
    if not ok or sent == false then pending[requestId] = nil; return nil, "inventory request transport refused" end
    return requestId
  end
  function api.refresh() return request("refresh", {}) end
  function api.lookIn(id) return request("lookIn", { containerId = id }) end
  function api.identify(id) return request("identify", { id = id }) end
  for kind in pairs(INVENTORY_ACTIONS) do
    local action = kind
    api[action] = function(id, argument)
      local args = { id = id }
      if action == "take" or action == "put" then args.containerId = argument
      elseif action == "give" then args.recipient = argument end
      return request(action, args)
    end
  end
  return api, receive, capability, clear
end

function M.new(host, options)
  assert(type(host) == "table", "host adapter is required")
  for _, name in ipairs({ "findPluginByName", "onPluginBroadcast", "broadcastToPlugin", "on", "off" }) do requireHost(host, name) end
  local opts = options or {}
  assert(type(opts.sqlite) == "nil", "SQLite support was removed; use native storage")
  assert(type(opts.spells) == "nil" or type(opts.spells) == "boolean", "spells option must be boolean")
  assert(type(opts.inventory) == "nil" or type(opts.inventory) == "boolean", "inventory option must be boolean")
  local packages = requirements(opts.packages)
  local self = {}
  local spellsStart, spellsStop, spellsReceive
  self.spells, spellsStart, spellsStop, spellsReceive = spellsFor(host, opts.spells == true)
  local active, registered, lifecycle = false, false, 0
  local coreId = nil
  local inventoryReceive, inventoryCapability, inventoryClear
  self.inventory, inventoryReceive, inventoryCapability, inventoryClear = inventoryFor(host, opts.inventory == true, function(data)
    if not active or not coreId then return false end
    return host.broadcastToPlugin(coreId, PREFIX .. "inventory-request", json.encode(data))
  end)
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
    inventoryClear(reason, false)
    notify("session", session)
  end
  local function discover()
    local token = lifecycle
    local found = host.findPluginByName(M.coreName)
    if type(found) ~= "table" or type(found.id) ~= "string" or found.enabled == false then
      unavailable("Core is unavailable")
      return
    end
    coreId = found.id
    snapshots = {}
    session = { available = false, connected = false, negotiated = false, reason = "waiting for Core" }
    inventoryClear("waiting for Core", false)
    if not active or token ~= lifecycle then return end
    notify("session", session)
    if not active or token ~= lifecycle then return end
    host.broadcastToPlugin(coreId, PREFIX .. "register", json.encode({ version = 1, packages = packages, inventory = opts.inventory == true }))
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
    if type(encoded) ~= "string" or #encoded > 8388608 then return end
    local decoded, data = pcall(json.decode, encoded)
    if not decoded or type(data) ~= "table" or data.version ~= 1 then return end
    if string.sub(message, 1, #PREFIX + 10) == PREFIX .. "inventory-" then
      inventoryReceive(string.sub(message, #PREFIX + 1), data)
      return
    end
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
      inventoryCapability(type(data.capabilities) == "table" and data.capabilities.inventory or nil, session)
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
    inventoryClear("disconnected", false)
    notify("session", session)
  end
  function self.start()
    if active then return self.status() end
    active = true
    lifecycle = lifecycle + 1
    local token = lifecycle
    if not registered then host.onPluginBroadcast(receive); registered = true end
    host.on("disconnected", disconnected)
    discover()
    if active and token == lifecycle then spellsStart() end
    return self.status()
  end
  function self.stop()
    spellsStop()
    if not active then self.ui.cleanup(); return end
    active = false
    lifecycle = lifecycle + 1
    if type(coreId) == "string" then host.broadcastToPlugin(coreId, PREFIX .. "unregister") end
    host.off("disconnected", disconnected)
    unavailable("not started")
    if not active then self.ui.cleanup() end
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
