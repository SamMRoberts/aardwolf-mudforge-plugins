-- Host-contract fixture: native arrays deliberately start at zero. This models
-- MudForge's documented ipairs bridge, not a native rendering acceptance test.
function atlasWorld(options)
  local opts = options or {}
  local world = { readyState = false, reads = 0, messages = {}, deliveries = {}, widgets = {}, creations = {}, commands = {},
    events = { ready = {}, room = {}, update = {} }, storage = opts.storage or {}, writes = 0, pathCalls = 0,
    player = 1, id = opts.id or "atlas-world", rooms = {}, metadata = {}, areaNames = { Alpha = 0, Beta = 0 } }
  world.flagReads = 0
  world.flagDefinitions = {
    shop = { color = "#aabbcc", symbol = "F", symbolColor = "#123456" },
    quest = { color = "#778899", symbol = "Q", symbolColor = "#fedcba" }
  }
  local env = setmetatable({}, { __index = _G })
  local function native(values)
    local result = { __native = true }
    for index, value in ipairs(values) do result[index - 1] = value end
    return result
  end
  world.native = native
  function env.ipairs(value)
    if not value.__native then return ipairs(value) end
    return function(items, index)
      index = index + 1
      if items[index - 1] ~= nil then return index, items[index - 1] end
    end, value, 0
  end
  local function read()
    assert(world.readyState, "native data read before onMapReady")
    world.reads = world.reads + 1
  end
  function world.add(id, fields)
    world.rooms[id] = fields or { num = id, name = "Room " .. id, area = "Alpha", x = id, y = 0, z = 0,
      terrain = "city", exits = {} }
  end
  world.add(1); world.add(2); world.add(3, { num = 3, name = "Beta entry", zone = "Beta", x = 0, y = 0, z = 2, terrain = 7, exits = {} })
  world.rooms[1].exits = { e = 2 }
  world.rooms[2].exits = { u = 3, ["enter portal"] = 3 }
  world.rooms[2].notes = "<script>literal notes</script>"
  world.rooms[2].details = "Map details"
  world.metadata[2] = { flags = { "shop", "quest" }, specialExits = { ["enter portal"] = 3 },
    doors = { u = 2 }, color = "#abcdef", symbol = { symbol = "S", color = "#fff" }, userData = { owner = "user" }, weight = 7 }
  function env.getSessionId() return world.id end
  function env.isMapReady() return world.readyState end
  function env.onMapReady(callback) table.insert(world.events.ready, callback) end
  function env.onRoomChange(callback) table.insert(world.events.room, callback) end
  function env.onMapUpdate(callback) table.insert(world.events.update, callback) end
  function env.getMapRoom(id) read(); return world.rooms[id] end
  function env.getPlayerRoom() read(); return world.player end
  function env.getAreaList()
    read()
    local result = {}
    for area, _ in pairs(world.areaNames) do result[area] = 0 end
    for _, room in pairs(world.rooms) do local area = room.area or room.zone or ""; result[area] = (result[area] or 0) + 1 end
    return result
  end
  function env.getAreaRooms(area)
    read()
    local result = {}
    for id, room in pairs(world.rooms) do if (room.area or room.zone or "") == area then table.insert(result, id) end end
    table.sort(result)
    return native(result)
  end
  for _, specification in ipairs({
    { "getRoomHidden", "hidden", false }, { "getRoomColor", "color" }, { "getRoomSymbol", "symbol" },
    { "getDoors", "doors", {} }, { "getSpecialExits", "specialExits", {} },
    { "getAllRoomUserData", "userData", {} }, { "getRoomWeight", "weight", 1 }, { "roomLocked", "locked", false }
  }) do
    env[specification[1]] = function(id)
      read()
      local value = world.metadata[id] and world.metadata[id][specification[2]]
      if value == nil then return specification[3] end
      return value
    end
  end
  function env.getMapFlags()
    read(); world.flagReads = world.flagReads + 1
    return json.decode(json.encode(world.flagDefinitions))
  end
  function env.getRoomFlags(id) read(); return native(world.metadata[id] and world.metadata[id].flags or {}) end
  function env.hasExitLock(id, direction) read(); return direction == "enter portal" end
  function env.findPath(from, target, options)
    read(); assert(options == nil, "Atlas must honor native locks and weights")
    world.pathCalls = world.pathCalls + 1
    assert(from == world.player)
    if world.metadata[target] and world.metadata[target].locked then return { found = false, error = "Destination locked" } end
    if target == from then return { found = true, distance = 0, vnums = native({}), directions = native({}) } end
    return { found = true, distance = 8, vnums = native({ 2, 3 }), directions = native({ "e", "enter portal" }) }
  end
  function env.createWidget(config)
    local id = "atlas:" .. config.name
    world.creations[id] = (world.creations[id] or 0) + 1
    world.widgets[id] = { config = config, events = {}, visible = opts.visible ~= false }
    return id
  end
  function env.setWidgetProperty(id, key, value) world.widgets[id][key] = value end
  function env.getWidgetProperty(id, key) return world.widgets[id][key] end
  function env.registerWidgetEvent(id, name, callback) world.widgets[id].events[name] = callback end
  function env.sendWidgetMessage(id, payload)
    assert(world.widgets[id], "message after destroy")
    local copy = json.decode(json.encode(payload))
    table.insert(world.messages, copy)
    table.insert(world.deliveries, { id = id, payload = copy })
  end
  function env.setWidgetZOrder(id, order) world.widgets[id].zOrder = order end
  function env.destroyWidget(id) world.widgets[id] = nil end
  function env.showWidget(id, force) assert(force == true); world.widgets[id].visible = true end
  function env.hideWidget(id, remember) assert(remember == nil or remember == true); world.widgets[id].visible = false end
  function env.createMapperWidget(name, config)
    assert(config.interactive == false)
    world.companionConfig = config
    return env.createWidget({ name = name })
  end
  function env.registerCommand(name, callback) world.commands[name] = callback end
  function env.echo(message) world.echo = message end
  function env.loadTable(name, scope) assert(scope == nil); return world.storage[name] end
  function env.saveTable(name, value, scope)
    assert(scope == nil, "preferences must be world-local")
    world.writes = world.writes + 1
    if world.refuseWrites then return false end
    world.storage[name] = json.decode(json.encode(value)); return true
  end
  for _, name in ipairs({ "send", "sendRaw", "walkTo", "setPlayerRoom", "updateMapRoom", "addMapRoom",
    "setMapExit", "setRoomColor", "setRoomHidden", "highlightPath", "addTimer", "importMapJson", "setMapZoom" }) do
    env[name] = function() error("unexpected write/movement/timer: " .. name) end
  end
  function world.surface(role) return world.widgets["atlas:atlas" .. (role and "-" .. role or "")] end
  function world.panel() return world.surface() end
  function world.surfaceMessage(role, data, sessionId)
    world.surface(role).events.luamsg({ event = "atlas", data = data, sessionId = sessionId or world.id })
  end
  function world.surfaceRequest(role, action, fields, sessionId)
    fields = fields or {}; fields.v, fields.action = 1, action
    world.surfaceMessage(role, fields, sessionId)
  end
  function world.surfaceHandshake(role) world.surfaceRequest(role, "ready") end
  function world.lastFor(role)
    local id = "atlas:atlas" .. (role and "-" .. role or "")
    for index = #world.deliveries, 1, -1 do
      if world.deliveries[index].id == id then return world.deliveries[index].payload end
    end
  end
  function world.close(role, sessionId)
    local surface = world.surface(role)
    surface.visible = false
    surface.events.close({ sessionId = sessionId or world.id })
  end
  function world.message(data, sessionId)
    world.panel().events.luamsg({ event = "atlas", data = data, sessionId = sessionId or world.id })
  end
  function world.handshake() world.message({ v = 1, action = "ready" }) end
  function world.emit(kind)
    for _, callback in ipairs(world.events[kind]) do callback({ kind = "changed" }) end
  end
  function world.ready() world.readyState = true; world.emit("ready") end
  function world.last() return world.messages[#world.messages] end
  function world.request(action, fields)
    fields = fields or {}; fields.v, fields.action = 1, action; world.message(fields)
  end
  assert(load(atlas_source(), "atlas", "t", env))()
  env.init()
  return world, env
end
