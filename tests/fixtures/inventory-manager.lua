-- Offline UI/controller host fixture; not a native MudForge runtime.
function inventoryWorld(saved)
  local world = newWorld()
  local core = world.core()
  local context = world.context("inventory-manager-id", "Aardwolf Inventory Management")
  local env = setmetatable({ json = json }, { __index = _G })
  for name, value in pairs(context.host) do env[name] = value end
  context.env = env
  local libraryApi = freshLibrary()
  function env.require(name) assert(name == "aardwolf-api"); return libraryApi end
  world.pluginCommands = {}
  function env.registerCommand(name, callback) world.pluginCommands[name] = callback end
  if saved then context.storage["aardwolf-api:inventory:settings"] = saved end
  function world.widget(role) return context.widgets[context.id .. ":inventory-" .. (role or "summary")] end
  function world.message(role, event, data, sessionId)
    assert(world.widget(role), role .. " widget missing")
    world.widget(role).events.luamsg({ event = event, data = data or {}, sessionId = sessionId or world.id })
  end
  function world.ready(role) world.message(role or "summary", "ready", {}) end
  function world.state(role)
    local widget = world.widget(role)
    assert(widget and widget.inventory, "widget has not published")
    return json.decode(widget.inventory)
  end
  function world.frame(name, rows)
    world.line("{" .. name .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(name == "eqdata" and "{/eqdata}" or name == "invdetails" and "{/invdetails}" or "{/invdata}")
    world.tick(1)
  end
  function world.active()
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 }); world.tick(1)
  end
  function world.loaded()
    world.active()
    world.frame("invdata", {
      "101,,a canvas bag,1,11,0,-1,-1", "102,,a spare bag,1,11,0,-1,-1",
      "103,,a red potion,1,8,0,-1,-1", "104,K,a kept sword,1,5,0,-1,-1",
      "105,,a blue potion,1,8,0,-1,-1", "106,,a loose wand,1,3,0,-1,-1"
    })
    world.frame("eqdata", { "201,,a worn bag,1,11,0,7,-1", "202,,a held staff,1,4,0,26,-1" })
  end
  function world.open(target)
    world.message("summary", "open", { scope = target or "inventory" })
    world.ready("manager")
  end
  function world.setup()
    world.message("summary", "setup")
    world.ready("setup")
  end
  function world.save(profile, preferences)
    if not world.widget("setup") then world.setup() end
    local state = world.state("setup")
    world.message("setup", "save", { identity = state.identity, preferences = preferences or state.preferences, profile = profile or state.profile })
  end
  function world.action(id, action)
    world.message("manager", "select", { id = id })
    world.message("manager", "action", { id = id, action = action })
  end
  function world.submit(extra)
    local prompt = world.state("manager").prompt
    assert(prompt)
    local data = { kind = prompt.kind, itemId = prompt.itemId, token = prompt.token }
    for name, value in pairs(extra or {}) do data[name] = value end
    world.message("manager", "submit", data)
  end
  function world.monitor(action, id, bagId, slot)
    world.line("{invmon}" .. tostring(action) .. "," .. tostring(id) .. "," .. tostring(bagId or -1) .. "," .. tostring(slot or -1))
    world.tick(2)
  end
  function world.count(command)
    local count = 0
    for _, value in ipairs(world.commands) do if value == command then count = count + 1 end end
    return count
  end
  load_source("inventory", env)
  env.init(); world.ready("summary")
  return world, context, env, core
end
