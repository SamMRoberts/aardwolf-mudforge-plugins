-- Injected host contracts only; the ANSI stub does not model MudForge rendering.
function roomWorld(existing)
  local world = existing or newWorld()
  if not existing then world.core() end
  local context = world.context("room-details-id", "Aardwolf Room Details")
  local env = setmetatable({ json = json }, { __index = _G })
  for key, value in pairs(context.host) do env[key] = value end
  context.env = env
  world.sends, world.output = {}, {}
  local lib = freshLibrary()
  function env.require(name) assert(name == "aardwolf-api"); return lib end
  function env.getTerminalFont() return world.font or { family = "Menlo, monospace", size = 13 } end
  function env.getWidgetFont(id) assert(id == "terminal"); return { weight = "normal" } end
  function env.getWidgetProperty(id, key)
    if key == "visible" then return context.widgets[id].visible ~= false end
    return context.widgets[id][key]
  end
  function env.parseAnsiText(text)
    return { { text = string.gsub(text, "\27%[[%d;]*m", ""), color = "#c0c0c0" } }
  end
  function env.registerCommand(name, callback) world.commands = world.commands or {}; world.commands[name] = callback end
  function env.send(text)
    if world.refuseSend == text then return false end
    env.onSend(world.id, text)
    table.insert(world.sends, text)
    return true
  end
  function world.panel() return context.widgets["room-details-id:room-details"] end
  function world.state() return json.decode(world.panel().roomDetails) end
  function world.message(event, data, sessionId)
    world.panel().events.luamsg({ event = event, data = data, sessionId = sessionId or world.id })
  end
  function world.ready() world.message("ready", {}) end
  function world.line(clean, raw, sessionId, provisional)
    local current = sessionId or world.id
    local discarded = env.onLine(current, raw or clean, clean) == false
    if not discarded then
      table.insert(world.output, raw or clean)
      for _, callback in ipairs(context.events.line or {}) do
        callback({ sessionId = current, clean = clean, text = raw or clean, provisional = provisional })
      end
    end
    return discarded
  end
  function world.block(kind, lines)
    world.line("{room" .. kind .. "}")
    for _, line in ipairs(lines) do world.line(line) end
    world.line("{/room" .. kind .. "}")
  end
  function world.prompt(provisional) world.line("[100/100hp 10/10mn 10/10mv 0qt 100tnl] >", nil, nil, provisional) end
  function world.active()
    world.connect()
    world.packet("char.base", { name = "Fixture" })
    world.packet("char.status", { state = 3 })
  end
  function world.spellsBusy(busy)
    local provider = world.plugins["test-spells"]
    if not provider then
      provider = world.context("test-spells", "Aardwolf Spells")
      function provider.reply()
        provider.host.broadcastToPlugin(context.id, "aardwolf-spells:state", json.encode({ version = 1,
          status = { connected = true, refreshing = provider.busy == true, characterName = "Fixture" } }))
      end
      provider.host.onPluginBroadcast(function(sender, message)
        if message == "aardwolf-spells:subscribe" then provider.reply() end
      end)
    end
    provider.busy = busy
    -- Discovery is normally driven by the API's provider lifecycle broadcast.
    provider.host.broadcastPlugin("aardwolf-spells:ready", "")
    provider.reply()
  end
  load_source("room-details", env)
  env.init()
  return world, context, env
end
