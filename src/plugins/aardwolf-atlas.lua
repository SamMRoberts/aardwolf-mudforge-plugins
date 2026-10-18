plugin = {
  id = "aardwolf-atlas", name = "Aardwolf Atlas", version = "0.2.2", author = "Sam Roberts",
  description = "Read-only native map explorer with terrain artwork, overhead and orbitable 3D views, room details and route previews."
}

-- Build-time assembly keeps the renderer and its local assets out of this adapter.
local HTML = [====[__ATLAS_HTML__]====]
local SETTINGS_HTML = [====[__ATLAS_SETTINGS_HTML__]====]
local DETAILS_HTML = [====[__ATLAS_DETAILS_HTML__]====]
local surfaces = { settings = { ready = false }, details = { ready = false } }
local detailSnapshot = nil
local detailGeneration, invalidatedDetailGeneration = -1, -1
local detailEpoch, closedDetailEpoch = -1, -1
local panelVisible = true
local alive, panelReady, mapReady = false, false, false
local widget, companion, stream = nil, nil, nil
local revision, lifetime = 0, 0
local generations = { area = -1, inspect = -1, route = -1 }
local preferences = nil
local flagDefinitions = {}
local CHUNK_SIZE, CHUNK_BYTES = 128, 131072

local function finite(value)
  if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then return nil end
  return value
end

local function integer(value, minimum)
  local number = finite(value)
  if number and number >= minimum and number <= 9007199254740991 and number == math.floor(number) then return number end
  return nil
end

local function text(value, limit)
  if type(value) ~= "string" then return nil end
  return string.sub(value, 1, limit or 16384)
end

local function details(value)
  if type(value) == "string" then return text(value) end
  if type(value) ~= "table" then return nil end
  -- Imported/native details may be structured even though mapper write helpers
  -- accept strings. Encode as inert JSON text with a bounded display size.
  local ok, encoded = pcall(json.encode, value)
  if not ok or type(encoded) ~= "string" then return "[Details could not be serialized]" end
  if #encoded > 16384 then return "[Details exceed the 16 KiB display limit]" end
  return encoded
end

local function refreshFlags()
  local definitions = getMapFlags()
  flagDefinitions = type(definitions) == "table" and definitions or {}
end

local function defaults()
  return { view = "overhead", follow = true, exploded = false, collapsed = false, showVnums = true, northUp = false, floatingDetails = false }
end

local function validatePreferences(value)
  if type(value) ~= "table" then return nil end
  if value.view ~= "overhead" and value.view ~= "perspective" then return nil end
  for _, key in ipairs({ "follow", "exploded", "collapsed" }) do
    if type(value[key]) ~= "boolean" then return nil end
  end
  local result = { view = value.view, follow = value.follow, exploded = value.exploded, collapsed = value.collapsed }
  for _, key in ipairs({ "showVnums", "northUp", "floatingDetails" }) do
    if value[key] ~= nil and type(value[key]) ~= "boolean" then return nil end
    if value[key] == nil then result[key] = key == "showVnums" else result[key] = value[key] end
  end
  return result
end

local function readable()
  return alive and mapReady and isMapReady()
end

local function publish(payload)
  if not alive or not panelReady or not widget then return end
  payload.v = 1
  payload.revision = revision
  sendWidgetMessage(widget, payload)
end

local function failure(message, generation, action)
  local payload = { type = "error", error = message }
  if integer(generation, 0) then payload.generation = generation end
  if type(action) == "string" then payload.requestAction = action end
  publish(payload)
end

-- Native mapper arrays are zero-indexed JS arrays. MudForge's ipairs is their
-- supported iterator; copying them creates ordinary Lua arrays for transport.
local function nativeList(value, converter)
  local result = {}
  if type(value) == "table" then
    for _, entry in ipairs(value) do
      local item = entry
      if converter then item = converter(entry) end
      if item ~= nil then table.insert(result, item) end
    end
  end
  return result
end

local function destinations(value, excluded)
  local result = {}
  if type(value) == "table" then
    for direction, target in pairs(value) do
      local id = integer(target, 1)
      if type(direction) == "string" and #direction <= 2048 and id
        and (not excluded or excluded[direction] == nil) then result[direction] = id end
    end
  end
  return result
end

local function roomRecord(id, detailed)
  local room = getMapRoom(id)
  if type(room) ~= "table" or room.hidden == true or getRoomHidden(id) then return nil end
  local area = text(room.area or room.zone, 4096) or ""
  -- Native getMapRoom includes custom commands in exits; keep each edge once.
  local specialExits = destinations(getSpecialExits(id))
  local record = { id = id, name = text(room.name) or ("Room " .. tostring(id)), areaId = area,
    x = finite(room.x), y = finite(room.y), z = finite(room.z), terrain = room.terrain,
    exits = destinations(room.exits, specialExits), specialExits = specialExits,
    color = text(getRoomColor(id), 256), flags = nativeList(getRoomFlags(id)),
    doors = getDoors(id), locked = roomLocked(id), weight = finite(getRoomWeight(id)) }
  if type(record.terrain) ~= "string" and type(record.terrain) ~= "number" then record.terrain = nil end
  if type(record.terrain) == "string" then record.terrain = text(record.terrain, 256) end
  local symbol = getRoomSymbol(id)
  if type(symbol) == "table" then record.symbol, record.symbolColor = text(symbol.symbol, 16), text(symbol.color, 256) end
  -- Match the native renderer: each visual uses the first defining flag in the
  -- room's own flag order; explicit room color/symbol remain higher priority.
  for _, name in ipairs(record.flags) do
    local definition = type(name) == "string" and flagDefinitions[name] or nil
    if type(definition) == "table" then
      if not record.flagColor and type(definition.color) == "string" and definition.color ~= "" then
        record.flagColor = text(definition.color, 256)
      end
      if not record.flagSymbol and type(definition.symbol) == "string" and definition.symbol ~= "" then
        record.flagSymbol = text(definition.symbol, 16)
        record.flagSymbolColor = text(definition.symbolColor, 256)
      end
    end
  end
  -- Exit locks are needed for map markers as well as selected-room inspection.
  record.exitLocks = {}
  for direction, _ in pairs(record.exits) do record.exitLocks[direction] = hasExitLock(id, direction) == true end
  for direction, _ in pairs(record.specialExits) do record.exitLocks[direction] = hasExitLock(id, direction) == true end
  if detailed then
    record.notes, record.details = text(room.notes), details(room.details)
    record.userData = getAllRoomUserData(id)
  end
  return record
end

local function areas()
  local result = {}
  local available = getAreaList()
  if type(available) == "table" then
    for area, count in pairs(available) do
      if type(area) == "string" and #area <= 4096 then
        table.insert(result, { id = area, name = area == "" and "Unassigned" or area, count = finite(count) or 0 })
      end
    end
  end
  table.sort(result, function(left, right) return left.name < right.name end)
  return result
end

local function bootstrap(kind, invalidate)
  local payload = { type = kind, mapReady = readable(), preferences = preferences, invalidate = invalidate == true,
    visible = widget and getWidgetProperty(widget, "visible") ~= false }
  if payload.mapReady then
    payload.areas = areas()
    payload.playerRoomId = integer(getPlayerRoom(), 1)
    if payload.playerRoomId then
      local room = getMapRoom(payload.playerRoomId)
      if type(room) == "table" then
        payload.playerAreaId = text(room.area or room.zone, 4096) or ""
        payload.playerZ = finite(room.z)
      end
    end
  end
  publish(payload)
end

local function areaRequest(data)
  local generation = integer(data.generation, 0)
  local offset = data.offset == nil and 0 or integer(data.offset, 0)
  if not generation or not offset or type(data.areaId) ~= "string" or #data.areaId > 4096 then return end
  if generation < generations.area then return end
  if offset == 0 then
    if generation == generations.area then return end
    local available = getAreaList()
    if type(available) ~= "table" or available[data.areaId] == nil then
      failure("This area is no longer available.", generation, "area"); return
    end
    generations.area = generation
    stream = { areaId = data.areaId, generation = generation, revision = revision, offset = 0,
      ids = nativeList(getAreaRooms(data.areaId), function(value) return integer(value, 1) end) }
  end
  if not stream or stream.generation ~= generation or stream.areaId ~= data.areaId
    or stream.revision ~= revision or stream.offset ~= offset then return end
  local rows, cursor, bytes, visited = {}, offset, 0, 0
  local total = #stream.ids
  while cursor < total and visited < CHUNK_SIZE do
    local row = roomRecord(stream.ids[cursor + 1], false)
    local size = row and #json.encode(row) or 0
    if size > CHUNK_BYTES then
      stream = nil
      failure("A room has too much metadata to display safely. Open the native map companion.", generation, "area")
      return
    end
    if bytes + size > CHUNK_BYTES and #rows > 0 then break end
    cursor, visited = cursor + 1, visited + 1
    if row then table.insert(rows, row); bytes = bytes + size end
  end
  stream.offset = cursor
  publish({ type = "area", areaId = stream.areaId, generation = generation, rooms = rows,
    offset = offset, nextOffset = cursor, total = total, done = cursor >= total })
end

local function inspectRequest(data)
  local id, generation = integer(data.roomId, 1), integer(data.generation, 0)
  if not id or not generation or generation < generations.inspect then return end
  generations.inspect = generation
  local room = roomRecord(id, true)
  if not room then failure("This room is unavailable or hidden.", generation, "inspect"); return end
  if #json.encode(room) > CHUNK_BYTES then
    failure("This room has too much metadata to inspect safely. Open the native map companion.", generation, "inspect")
    return
  end
  publish({ type = "room", room = room, generation = generation })
end

local function routeRequest(data)
  local id, generation = integer(data.roomId, 1), integer(data.generation, 0)
  if not id or not generation or generation < generations.route then return end
  generations.route = generation
  local origin = integer(getPlayerRoom(), 1)
  if not origin or not getMapRoom(origin) then failure("Your current room is not mapped.", generation, "route"); return end
  if not roomRecord(id, false) then failure("This destination is unavailable or hidden.", generation, "route"); return end
  -- Never ignore locks, change routing settings, highlight native rooms, or walk.
  local path = findPath(origin, id)
  if type(path) ~= "table" or not path.found then
    publish({ type = "route", found = false, steps = {}, stepCount = 0, generation = generation,
      error = type(path) == "table" and text(path.error) or "No route found." }); return
  end
  local ids = nativeList(path.vnums, function(value) return integer(value, 1) end)
  local directions = nativeList(path.directions)
  local steps, bytes = {}, 0
  for index, roomId in ipairs(ids) do
    local room = getMapRoom(roomId)
    local hidden = getRoomHidden(roomId)
    local step = { roomId = roomId, direction = text(directions[index], 2048), hidden = hidden == true,
      areaId = type(room) == "table" and text(room.area or room.zone, 4096) or nil,
      z = type(room) == "table" and finite(room.z) or nil,
      name = not hidden and type(room) == "table" and text(room.name) or "Hidden room" }
    bytes = bytes + #json.encode(step) + 1
    -- Leave headroom for the envelope; never present a truncated route as whole.
    if bytes > CHUNK_BYTES - 1024 then
      failure("This route is too large to display safely. Open the native map companion.", generation, "route")
      return
    end
    table.insert(steps, step)
  end
  publish({ type = "route", found = true, fromRoomId = origin, toRoomId = id, steps = steps,
    cost = finite(path.distance), stepCount = #ids, generation = generation })
end

local function fallback()
  if companion then showWidget(companion, true); return end
  companion = createMapperWidget("atlas-native", { title = "Atlas - native map", x = 80, y = 100,
    width = 640, height = 480, interactive = false })
  if not companion then failure("The native map companion could not be opened.") end
end

local function surfacePublish(role, payload)
  local surface = surfaces[role]
  if not alive or not surface.id or not surface.ready then return end
  payload.v = 1
  sendWidgetMessage(surface.id, payload)
end

local function syncSurfaces()
  surfacePublish("settings", { type = "preferences", preferences = preferences })
  surfacePublish("details", { type = "details", snapshot = detailSnapshot })
end

local syncDetailsVisibility

local function savePreferences(nextPreferences)
  if saveTable("atlas-preferences", nextPreferences) == false then
    failure("Atlas preferences could not be saved.", nil, "preferences")
    surfacePublish("settings", { type = "error", error = "Atlas preferences could not be saved." })
    surfacePublish("details", { type = "error", error = "Atlas preferences could not be saved." })
    publish({ type = "preferences", preferences = preferences, error = "Atlas preferences could not be saved." })
    syncSurfaces()
    return false
  end
  preferences = nextPreferences
  publish({ type = "preferences", preferences = preferences })
  syncSurfaces()
  syncDetailsVisibility()
  return true
end

local function surfaceMessage(role, event)
  if not alive or type(event) ~= "table" or (event.sessionId and event.sessionId ~= getSessionId()) then return end
  local data = event.data
  if event.event ~= "atlas" or type(data) ~= "table" or data.v ~= 1 then return end
  if data.action == "ready" then
    surfaces[role].ready = true
    syncSurfaces()
  elseif not surfaces[role].ready then return
  elseif role == "settings" and data.action == "setting" then
    if data.key ~= "showVnums" and data.key ~= "northUp" and data.key ~= "floatingDetails" then return end
    if type(data.value) ~= "boolean" then return end
    local nextPreferences = validatePreferences(preferences)
    nextPreferences[data.key] = data.value
    savePreferences(nextPreferences)
  elseif role == "details" and data.action == "navigate" then
    local index = integer(data.index, 0)
    if not detailSnapshot or data.generation ~= detailSnapshot.generation or not index then return end
    local step = detailSnapshot.steps[index + 1]
    if type(step) == "table" and step.hidden ~= true then
      publish({ type = "navigate", index = index, generation = data.generation })
    end
  elseif role == "details" and data.action == "dock" then
    local nextPreferences = validatePreferences(preferences)
    nextPreferences.floatingDetails = false
    savePreferences(nextPreferences)
  end
end

local function openSurface(role)
  local surface = surfaces[role]
  if surface.id then
    showWidget(surface.id, true)
    if role == "settings" then setWidgetZOrder(surface.id, 49) end
    return true
  end
  local isSettings = role == "settings"
  surface.id = createWidget({ type = "html", name = "atlas-" .. role,
    title = isSettings and "Atlas Settings" or "Atlas Room Details",
    position = { x = isSettings and 120 or 360, y = isSettings and 140 or 160 },
    size = { width = isSettings and 340 or 320, height = isSettings and 240 or 520 }, resizable = true })
  if not surface.id or surface.id == "" then
    surface.id = nil; failure("Atlas could not open its " .. role .. " window."); return false
  end
  local currentLifetime = lifetime
  registerWidgetEvent(surface.id, "luamsg", function(event)
    if alive and lifetime == currentLifetime then surfaceMessage(role, event) end
  end)
  registerWidgetEvent(surface.id, "close", function(event)
    if not alive or lifetime ~= currentLifetime or (event.sessionId and event.sessionId ~= getSessionId()) then return end
    if role == "details" then
      invalidatedDetailGeneration = detailGeneration
      closedDetailEpoch = detailEpoch
      detailSnapshot = nil
      publish({ type = "deselect", selectionEpoch = detailEpoch })
      syncSurfaces()
    end
  end)
  setWidgetProperty(surface.id, "content", isSettings and SETTINGS_HTML or DETAILS_HTML)
  showWidget(surface.id, true)
  if role == "settings" then setWidgetZOrder(surface.id, 49) end
  return true
end

syncDetailsVisibility = function()
  local surface = surfaces.details
  if panelVisible and preferences.floatingDetails and detailSnapshot and detailSnapshot.selected then
    -- Only reopen on a new selection or explicit mode change, not every route update.
    if not surface.id or getWidgetProperty(surface.id, "visible") == false then openSurface("details") end
  elseif surface.id then hideWidget(surface.id) end
end

local function setPanelVisible(visible)
  panelVisible = visible
  if not visible then
    for _, surface in pairs(surfaces) do if surface.id then hideWidget(surface.id) end end
  else syncDetailsVisibility() end
end

local function widgetMessage(event)
  if not alive or type(event) ~= "table" or (event.sessionId and event.sessionId ~= getSessionId()) then return end
  local data = event.data
  if event.event ~= "atlas" or type(data) ~= "table" or data.v ~= 1 or type(data.action) ~= "string" then return end
  if data.action == "ready" then
    panelReady, stream = true, nil
    generations = { area = -1, inspect = -1, route = -1 }
    detailSnapshot = nil
    detailGeneration, invalidatedDetailGeneration = -1, -1
    detailEpoch, closedDetailEpoch = -1, -1
    syncSurfaces()
    syncDetailsVisibility()
    bootstrap("init", false)
  elseif not panelReady then return
  elseif data.action == "preferences" then
    local nextPreferences = nil
    if data.patch ~= nil then
      if type(data.patch) ~= "table" then return end
      nextPreferences = validatePreferences(preferences)
      for key, value in pairs(data.patch) do
        if type(key) ~= "string" or nextPreferences[key] == nil then return end
        nextPreferences[key] = value
      end
      nextPreferences = validatePreferences(nextPreferences)
    else nextPreferences = validatePreferences(data.preferences) end
    if not nextPreferences then failure("Invalid Atlas preferences.", data.generation, "preferences"); return end
    savePreferences(nextPreferences)
  elseif data.action == "settings" then openSurface("settings")
  elseif data.action == "details" then
    local snapshot = data.snapshot
    if type(snapshot) ~= "table" or not integer(snapshot.generation, 0) then return end
    if snapshot.selected ~= nil and not integer(snapshot.selected, 1) then return end
    if type(snapshot.steps) ~= "table" or type(snapshot.summary) ~= "string" then return end
    if snapshot.room ~= nil and (type(snapshot.room) ~= "table" or snapshot.room.id ~= snapshot.selected) then return end
    if #json.encode(snapshot) > CHUNK_BYTES * 3 then return end
    if data.revision ~= revision or snapshot.generation < detailGeneration then return end
    -- Older renderer snapshots use generation as their selection identity.
    local epoch = snapshot.selectionEpoch == nil and snapshot.generation or integer(snapshot.selectionEpoch, 0)
    if not epoch then return end
    if snapshot.selected and (snapshot.generation <= invalidatedDetailGeneration or epoch <= closedDetailEpoch) then return end
    detailEpoch = epoch
    detailGeneration = snapshot.generation
    snapshot.steps = nativeList(snapshot.steps)
    detailSnapshot = snapshot.selected and snapshot or nil
    syncSurfaces()
    syncDetailsVisibility()
  elseif data.action == "fallback" then fallback()
  elseif not readable() then failure("Waiting for the native map to finish loading.", data.generation, data.action)
  elseif data.revision ~= nil and data.revision ~= revision then return
  elseif data.action == "area" then areaRequest(data)
  elseif data.action == "inspect" then inspectRequest(data)
  elseif data.action == "route" then routeRequest(data)
  end
end

local function command(args)
  if not alive or not widget then return end
  if args == "hide" then
    setPanelVisible(false)
    publish({ type = "visibility", visible = false }); hideWidget(widget, true)
  elseif args == "native" then fallback()
  elseif args == "" or args == "show" then
    showWidget(widget, true)
    setPanelVisible(true)
    if readable() then refreshFlags() end
    bootstrap("update", true)
    publish({ type = "visibility", visible = true })
  else echo("Atlas: awatlas [show|hide|native]") end
end

function init()
  if alive then return end
  alive = true
  lifetime = lifetime + 1
  local currentLifetime = lifetime
  preferences = validatePreferences(loadTable("atlas-preferences")) or defaults()
  widget = createWidget({ type = "html", name = "atlas", title = "Aardwolf Atlas",
    position = { x = 60, y = 90 }, size = { width = 900, height = 640 }, resizable = true, resizeEvents = true })
  if not widget or widget == "" then alive = false; widget = nil; echo("Atlas: could not create the map panel."); return end
  registerWidgetEvent(widget, "luamsg", function(event)
    if alive and lifetime == currentLifetime then widgetMessage(event) end
  end)
  registerWidgetEvent(widget, "close", function(event)
    if alive and lifetime == currentLifetime and (not event.sessionId or event.sessionId == getSessionId()) then
      setPanelVisible(false)
      publish({ type = "visibility", visible = false })
    end
  end)
  registerWidgetEvent(widget, "resize", function(event)
    if alive and lifetime == currentLifetime and (not event.sessionId or event.sessionId == getSessionId()) then
      publish({ type = "resize", width = finite(event.width), height = finite(event.height) })
    end
  end)
  panelVisible = getWidgetProperty(widget, "visible") ~= false
  setWidgetProperty(widget, "content", HTML)
  registerCommand("awatlas", command, "Open Atlas, hide its panel, or open its read-only native companion.")
  onMapReady(function()
    if not alive or lifetime ~= currentLifetime then return end
    mapReady = true; refreshFlags(); bootstrap("update", true)
  end)
  onRoomChange(function()
    if alive and lifetime == currentLifetime and readable() then
      if detailSnapshot then
        invalidatedDetailGeneration = detailGeneration
        detailSnapshot.steps = {}
        detailSnapshot.summary = "Finding a native route..."
        syncSurfaces()
      end
      bootstrap("update", false)
    end
  end)
  onMapUpdate(function()
    if not alive or lifetime ~= currentLifetime then return end
    revision = revision + 1; stream = nil
    detailSnapshot = nil
    syncSurfaces()
    syncDetailsVisibility()
    if readable() then refreshFlags() else flagDefinitions = {} end
    bootstrap("update", true)
  end)
end

function cleanup()
  alive, panelReady, mapReady = false, false, false
  lifetime = lifetime + 1
  stream, flagDefinitions = nil, {}
  if widget then destroyWidget(widget) end
  if companion then destroyWidget(companion) end
  for _, surface in pairs(surfaces) do
    if surface.id then destroyWidget(surface.id) end
    surface.id, surface.ready = nil, false
  end
  detailSnapshot = nil
  detailGeneration, invalidatedDetailGeneration = -1, -1
  detailEpoch, closedDetailEpoch = -1, -1
  widget, companion = nil, nil
  generations = { area = -1, inspect = -1, route = -1 }
end
