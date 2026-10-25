-- Offline host contracts, not a MudForge transpiler/transport implementation.
local function libraryEnvironment()
  local env = { json = json }
  for _, name in ipairs({ "type", "tostring", "tonumber", "pairs", "ipairs", "error", "assert", "pcall", "math", "string", "table" }) do env[name] = _G[name] end
  return env
end

function freshLibrary()
  return load_source("aardwolf-api", libraryEnvironment())
end

function newWorld(sessionId)
  local world = { id = sessionId or "session-a", connected = false, time = 0, plugins = {}, sent = {}, commands = {}, timers = {}, cache = {}, nextTimer = 0, nextWidget = 0 }
  function world.context(id, name)
    local context = { id = id, name = name, enabled = true, broadcasts = {}, events = {}, gmcp = {}, widgets = {}, storage = {}, errors = {}, storageState = "ready", writes = 0 }
    world.plugins[id] = context
    local host = {}
    function host.getPluginId() return id end
    function host.getSessionId() return world.id end
    function host.getSession() return { id = world.id, connected = world.connected } end
    function host.getCurrentTime() return world.time end
    function host.getLoadedPlugins()
      local list = {}
      for _, item in pairs(world.plugins) do table.insert(list, { id = item.id, name = item.name, enabled = item.enabled }) end
      return list
    end
    function host.findPluginByName(targetName)
      for _, item in pairs(world.plugins) do
        if item.enabled and item.name == targetName then return { id = item.id, name = item.name } end
      end
    end
    function host.onPluginBroadcast(callback) table.insert(context.broadcasts, callback) end
    function host.broadcastToPlugin(target, message, data)
      local item = world.plugins[target]
      if item and item.enabled then
        for _, callback in ipairs(item.broadcasts) do callback(id, message, data) end
      end
    end
    function host.broadcastPlugin(message, data)
      for target in pairs(world.plugins) do if target ~= id then host.broadcastToPlugin(target, message, data) end end
    end
    function host.on(event, callback)
      context.events[event] = context.events[event] or {}
      table.insert(context.events[event], callback)
    end
    function host.off(event, callback)
      local kept = {}
      for _, current in ipairs(context.events[event] or {}) do if current ~= callback then table.insert(kept, current) end end
      context.events[event] = kept
    end
    function host.onGMCPUpdate(package, callback)
      context.gmcp[package] = context.gmcp[package] or {}
      table.insert(context.gmcp[package], callback)
    end
    function host.getGMCPData(package) return world.cache[package] end
    function host.sendGMCP(package, data)
      if not world.connected or world.refuseTransport then return false end
      table.insert(world.sent, { package = package, data = data })
      return true
    end
    function host.send(command)
      if not world.connected or world.refuseCommands then return false end
      for _, item in pairs(world.plugins) do
        if item.enabled and item.env and item.env.onSend then
          if item.env.onSend(world.id, command) == false then return false end
        end
      end
      table.insert(world.commands, command)
      return true
    end
    function host.addTimer(delay, callback)
      if not world.connected or world.refuseTimers then return "" end
      world.nextTimer = world.nextTimer + 1
      local timer = "timer-" .. world.nextTimer
      world.timers[timer] = { at = world.time + delay, callback = callback, owner = id }
      return timer
    end
    function host.removeTimer(timer) world.timers[timer] = nil end
    function host.loadTable(key) return context.storage[key] end
    function host.saveTable(key, data)
      if context.refuseWrites then return false end
      context.storage[key] = data
      context.writes = context.writes + 1
      return true
    end
    function host.storageStatus() return context.storageState, context.storageReason end
    function host.createWidget(config)
      if context.failWidgetName == config.name then return "" end
      world.nextWidget = world.nextWidget + 1
      local widget = id .. ":" .. config.name
      context.widgets[widget] = context.widgets[widget] or { config = config, bindings = {}, events = {}, contentWrites = 0 }
      return widget
    end
    function host.showWidget(widget, force)
      local current = context.widgets[widget]
      current.showCalls = (current.showCalls or 0) + 1
      current.lastShowForced = force
      if not current.userClosed or force then current.visible = true; current.userClosed = false end
    end
    function host.hideWidget(widget, force)
      local current = context.widgets[widget]
      current.visible = false
      if force then current.userClosed = true end
    end
    function context.closeWidget(widget)
      host.hideWidget(widget, true)
      local callback = context.widgets[widget].events.close
      if callback then callback({}) end
    end
    function host.destroyWidget(widget) context.widgets[widget] = nil end
    function host.setWidgetProperty(widget, property, value)
      context.widgets[widget][property] = value
      if property == "content" then context.widgets[widget].contentWrites = context.widgets[widget].contentWrites + 1 end
    end
    function host.setBoundValue(widget, key, value) context.widgets[widget].bindings[key] = value end
    function host.registerWidgetEvent(widget, event, callback) context.widgets[widget].events[event] = callback end
    function host.setActiveWidget(widget) world.activeWidget = widget end
    function host.reportError(message) table.insert(context.errors, message) end
    host.echo = host.reportError
    context.host = host
    return context
  end
  function world.loadPlugin(source, id, name)
    local context = world.context(id, name)
    local env = setmetatable({ json = json }, { __index = _G })
    for key, value in pairs(context.host) do env[key] = value end
    local libs = {}
    function env.require(name)
      assert(name == "aardwolf-api")
      if not libs[name] then libs[name] = freshLibrary() end
      return libs[name]
    end
    context.env = env
    load_source(source, env)
    env.init()
    return context
  end
  function world.core(id) return world.loadPlugin("core", id or "imported-core-17", "Aardwolf API Core") end
  function world.consumer(id, packages, options)
    local context = world.context(id or "consumer", "Test Consumer")
    context.lib = freshLibrary()
    local opts = options or {}
    opts.packages = packages or { "Char" }
    context.client = context.lib.new(context.host, opts)
    context.client.start()
    return context
  end
  function world.event(event)
    for _, context in pairs(world.plugins) do
      if context.enabled then for _, callback in ipairs(context.events[event] or {}) do callback({ sessionId = world.id }) end end
    end
  end
  function world.line(rawLine, cleanLine)
    for _, context in pairs(world.plugins) do
      if context.enabled and context.env and context.env.onLine then
        context.env.onLine(world.id, rawLine, cleanLine or rawLine)
      end
    end
  end
  function world.packet(package, payload)
    world.cache[package] = payload
    for _, context in pairs(world.plugins) do
      if context.enabled then for _, callback in ipairs(context.gmcp[package] or {}) do callback(payload) end end
    end
  end
  function world.connect()
    world.connected = true
    for _, context in pairs(world.plugins) do
      if context.enabled and context.env and context.env.onConnect then context.env.onConnect(world.id) end
    end
    world.event("connected")
  end
  function world.disconnect()
    world.connected = false
    for _, context in pairs(world.plugins) do
      if context.enabled and context.env and context.env.onDisconnect then context.env.onDisconnect(world.id) end
    end
    world.event("disconnected")
  end
  function world.tick(milliseconds)
    local target = world.time + milliseconds
    local iterations = 0
    while true do
      local key, nextTimer = nil, nil
      for id, timer in pairs(world.timers) do
        if timer.at <= target and (not nextTimer or timer.at < nextTimer.at) then key, nextTimer = id, timer end
      end
      if not nextTimer then break end
      iterations = iterations + 1
      assert(iterations < 100, "fixture timer loop")
      world.time = nextTimer.at
      world.timers[key] = nil
      if world.connected and world.plugins[nextTimer.owner].enabled then nextTimer.callback() end
    end
    world.time = target
  end
  function world.unload(context)
    if context.env and context.env.cleanup then context.env.cleanup() end
    if context.client then context.client.stop() end
    context.enabled = false
    context.broadcasts, context.events, context.gmcp = {}, {}, {}
    for id, timer in pairs(world.timers) do if timer.owner == context.id then world.timers[id] = nil end end
  end
  function world.supports()
    for index = #world.sent, 1, -1 do
      if world.sent[index].package == "Core.Supports.Set" then return json.decode(world.sent[index].data) end
    end
  end
  return world
end

function has(list, value)
  for _, item in ipairs(list or {}) do if item == value then return true end end
  return false
end

function runningWorld(packages, sessionId)
  local world = newWorld(sessionId)
  local core = world.core()
  local consumer = world.consumer("consumer", packages)
  world.connect()
  world.packet("char.base", { name = "Fixture", level = 42 })
  return world, consumer, core
end
