plugin = {
  id = "aardwolf-api-core", name = "Aardwolf API Core", version = "0.4.2",
  author = "Sam Roberts", description = "Shared Aardwolf session and inventory state with exclusive GMCP negotiation."
}

local api, inventory = nil, nil
local PREFIX = "aardwolf-api:"
local initialized, registered = false, false
local connected, negotiated, bootstrapped = false, false, false
local reason = "disconnected"
local consumers, snapshots, registrations = {}, {}, {}
local registrationSerial = 0
local inventoryCharacter, inventoryStateReady = nil, false
local bootstrapTimer, negotiationTimer = nil, nil
local lastSupports = nil
local lastNegotiation = -5000
local reattaching = false
local BASELINE = { Core = true, Char = true, Room = true, Comm = true }

local function cancelTimers()
  if type(bootstrapTimer) == "string" and bootstrapTimer ~= "" then removeTimer(bootstrapTimer) end
  if type(negotiationTimer) == "string" and negotiationTimer ~= "" then removeTimer(negotiationTimer) end
  bootstrapTimer, negotiationTimer = nil, nil
end

local function sessionState()
  return { connected = connected, negotiated = negotiated, reason = reason }
end

local function deliver(id, message, data)
  broadcastToPlugin(id, PREFIX .. message, json.encode(data))
end

local function syncInventory()
  if not inventory then return end
  local base, status = snapshots["char.base"] or {}, snapshots["char.status"] or {}
  local characterName = type(base.name) == "string" and string.match(base.name, "^%s*(.-)%s*$") or nil
  if characterName and (characterName == "" or #characterName > 128 or string.find(characterName, "%c")) then characterName = nil end
  inventory.sync({ connected = connected, negotiated = negotiated,
    characterName = characterName, state = inventoryStateReady and status.state or nil })
end

local function sendState(id)
  deliver(id, "state", { version = 1, session = sessionState(), snapshots = snapshots, capabilities = { inventory = 1, inventoryActions = api.protocol.inventoryActions } })
end

local function publishState()
  syncInventory()
  for id in pairs(consumers) do sendState(id) end
end

local function loaded()
  local plugins = {}
  local list = getLoadedPlugins()
  if type(list) ~= "table" then return plugins end
  for _, item in pairs(list) do
    if type(item) == "table" and type(item.id) == "string" and item.enabled == true then plugins[item.id] = item end
  end
  return plugins
end

local function competingCore(plugins)
  local ownId = getPluginId()
  for id, item in pairs(plugins) do
    if id ~= ownId and (id == "aw-core" or id == "aardwolf-core"
      or item.name == "Aardwolf Core" or item.name == plugin.name) then return true end
  end
  return false
end

local function supportSet(plugins)
  local union = api.protocol.copy(BASELINE)
  for id, packages in pairs(consumers) do
    if type(plugins[id]) ~= "table" then consumers[id] = nil; registrations[id] = nil; inventory.unsubscribe(id)
    else for _, name in ipairs(packages) do union[name] = true end end
  end
  local names = {}
  for name in pairs(union) do table.insert(names, '"' .. name .. ' 1"') end
  table.sort(names)
  -- Explicit JSON text avoids array-index differences at the host boundary.
  return "[" .. table.concat(names, ",") .. "]"
end

local function negotiate()
  negotiationTimer = nil
  if not initialized or not connected or not bootstrapped then return end
  local plugins = loaded()
  if competingCore(plugins) then
    negotiated, reason = false, "another Aardwolf Core is enabled"
    publishState()
    return
  end
  local supports = supportSet(plugins)
  if supports == lastSupports and negotiated then return end
  local now = getCurrentTime()
  local remaining = 5000 - (now - lastNegotiation)
  if remaining > 0 then
    negotiationTimer = addTimer(remaining, negotiate, false)
    if negotiationTimer == "" then reason = "negotiation timer refused"; publishState() end
    return
  end
  lastNegotiation = now
  if sendGMCP("Core.Supports.Set", supports) == true then
    lastSupports, negotiated, reason = supports, true, nil
  else
    negotiated, reason = false, "transport refused GMCP negotiation"
  end
  publishState()
end

local function queueNegotiation()
  if not initialized or not connected or not bootstrapped then return end
  if type(negotiationTimer) == "string" and negotiationTimer ~= "" then return end
  negotiationTimer = addTimer(100, negotiate, false)
  if negotiationTimer == "" then reason = "negotiation timer refused"; publishState() end
end

local function bootstrap()
  if not initialized or not connected or bootstrapped then return end
  bootstrapped = true
  if type(bootstrapTimer) == "string" and bootstrapTimer ~= "" then removeTimer(bootstrapTimer) end
  bootstrapTimer = nil
  negotiate()
end

local function handlePacket(packageName, payload)
  if not initialized or not connected then return end
  local data, invalid = api.protocol.normalize(packageName, payload)
  if type(data) ~= "table" then return end
  local isState = false
  for _, name in ipairs(api.protocol.statePackages) do if name == packageName then isState = true end end
  if isState then
    if string.sub(packageName, 1, 5) == "char." then
      local merged = api.protocol.copy(snapshots[packageName] or {})
      for key in pairs(invalid) do merged[key] = nil end
      for key, value in pairs(data) do merged[key] = value end
      local bounded = pcall(api.protocol.copy, merged)
      if not bounded then return end
      snapshots[packageName] = merged
    else snapshots[packageName] = data end
    data = snapshots[packageName]
  end
  if packageName == "char.base" then
    local name = type(data.name) == "string" and string.lower(data.name) or nil
    if name ~= inventoryCharacter then inventoryCharacter, inventoryStateReady = name, false end
    if not reattaching then bootstrap() end
  elseif packageName == "char.status" then inventoryStateReady = true end
  if packageName == "char.base" or packageName == "char.status" then syncInventory() end
  for id in pairs(consumers) do
    deliver(id, "update", { version = 1, package = packageName, payload = data })
  end
end

local function receive(sender, message, encoded)
  if not initialized or type(sender) ~= "string" or sender == getPluginId() then return end
  if message == PREFIX .. "unregister" then
    consumers[sender], registrations[sender] = nil, nil
    inventory.unsubscribe(sender)
    queueNegotiation()
    return
  end
  if message == PREFIX .. "inventory-request" then
    if type(loaded()[sender]) ~= "table" or not consumers[sender]
      or type(encoded) ~= "string" or #encoded > 4096 then return end
    local ok, data = pcall(json.decode, encoded)
    if ok and type(data) == "table" and data.version == 1 then inventory.request(sender, data) end
    return
  end
  if message ~= PREFIX .. "register" or type(encoded) ~= "string" or #encoded > 4096 then return end
  local ok, data = pcall(json.decode, encoded)
  if not ok or type(data) ~= "table" or data.version ~= 1 then return end
  local valid, packages = pcall(api.protocol.requirements, data.packages)
  if not valid or (type(data.inventory) ~= "nil" and type(data.inventory) ~= "boolean") then return end
  -- The callback's sender identity, rather than a supplied owner field, keys
  -- registrations. Re-registering replaces that consumer's requirements.
  if type(loaded()[sender]) ~= "table" then return end
  consumers[sender] = packages
  registrationSerial = registrationSerial + 1
  local token = registrationSerial
  registrations[sender] = token
  sendState(sender)
  -- State delivery can synchronously stop or re-register this consumer.
  if registrations[sender] ~= token then return end
  if data.inventory == true then inventory.subscribe(sender) else inventory.unsubscribe(sender) end
  syncInventory()
  queueNegotiation()
end

local function beginConnection()
  cancelTimers()
  connected, negotiated, bootstrapped = true, false, false
  lastSupports, snapshots = nil, {}
  inventoryCharacter, inventoryStateReady = nil, false
  lastNegotiation, reason = -5000, "waiting for GMCP bootstrap"
  inventory.reset("waiting for login")
  publishState()
  -- Char.Base normally arrives after the client's own negotiation. This
  -- one-shot fallback also supports enabling Core in an existing connection.
  bootstrapTimer = addTimer(1000, bootstrap, false)
  if bootstrapTimer == "" then reason = "bootstrap timer refused"; publishState() end
end

local function reattached()
  if not initialized then return end
  beginConnection()
  reattaching = true
  -- Character scalars are useful on screen reattachment. Room and Group are
  -- not restored from the client's merged cache: deleted entries may linger.
  for _, packageName in ipairs(api.protocol.statePackages) do
    if string.sub(packageName, 1, 5) == "char." then handlePacket(packageName, getGMCPData(packageName)) end
  end
  reattaching = false
end

function init()
  if initialized then return end
  api = require("aardwolf-api")
  inventory = api.protocol.inventoryCollector({ getCurrentTime = getCurrentTime, addTimer = addTimer,
    removeTimer = removeTimer, send = send, sendGMCP = sendGMCP, deliver = deliver })
  initialized = true
  if not registered then
    onPluginBroadcast(receive)
    for _, packageName in ipairs(api.protocol.statePackages) do
      local name = packageName
      onGMCPUpdate(name, function(data) handlePacket(name, data) end)
    end
    for _, packageName in ipairs(api.protocol.eventPackages) do
      local name = packageName
      onGMCPUpdate(name, function(data) handlePacket(name, data) end)
    end
    registered = true
  end
  on("reattached", reattached)
  local session = getSession()
  if type(session) == "table" and session.connected == true then beginConnection() end
  broadcastPlugin(PREFIX .. "ready")
end

function onLine(sessionId, rawLine, cleanLine)
  if initialized and sessionId == getSessionId() then return inventory.line(rawLine, cleanLine) end
end

function onSend(sessionId, command)
  if initialized and sessionId == getSessionId() then inventory.sent(command) end
end

function onConnect(sessionId)
  if not initialized or sessionId ~= getSessionId() then return end
  if not connected then beginConnection() end
end

function onDisconnect(sessionId)
  if not initialized or sessionId ~= getSessionId() then return end
  cancelTimers()
  connected, negotiated, bootstrapped = false, false, false
  lastSupports, snapshots, reason = nil, {}, "disconnected"
  inventoryCharacter, inventoryStateReady = nil, false
  inventory.reset("disconnected")
  publishState()
end

function cleanup()
  if not initialized then return end
  initialized = false
  inventory.stop()
  cancelTimers()
  off("reattached", reattached)
  broadcastPlugin(PREFIX .. "stopped")
  connected, negotiated, bootstrapped = false, false, false
  consumers, snapshots, registrations, lastSupports, reason = {}, {}, {}, nil, "Core stopped"
  inventoryCharacter, inventoryStateReady = nil, false
end
