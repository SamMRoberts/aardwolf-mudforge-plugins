-- Native storage host contract for collector, persistence, import and layout behavior.
function spellsWorld(readerFirst)
  local world = newWorld()
  world.commands, world.sends = {}, {}
  world.core()
  local reader = world.context("reader", "Spells Reader")
  reader.client = freshLibrary().new(reader.host, { spells = true })
  if readerFirst then reader.client.start() end
  local context = world.context("spells-id", "Aardwolf Spells")
  local env = setmetatable({ json = json }, { __index = _G })
  for key, value in pairs(context.host) do env[key] = value end
  context.env = env
  env.io, env.os = {}, {}
  function env.send(command)
    env.onSend(world.id, command)
    table.insert(world.sends, command)
  end
  function env.registerCommand(name, callback) world.commands[name] = callback end
  -- Native persistence is isolated to this plugin/world and copies across the host boundary.
  world.dataWrites, world.dataAttempts = 0, 0
  local function clone(value)
    if type(value) ~= "table" then return value end
    local copied = {}
    for key, item in pairs(value) do copied[key] = clone(item) end
    return copied
  end
  local saveLayout, loadLayout = env.saveTable, env.loadTable
  function world.record(characterKey)
    return context.storage["aardwolf-spells:data:" .. (characterKey or "fixture")]
  end
  function env.loadTable(key, scope)
    assert(scope == nil)
    if string.sub(key, 1, 21) == "aardwolf-spells:data:" then
      if world.failRead then error("native read failed") end
      return clone(context.storage[key])
    end
    return loadLayout(key)
  end
  function env.saveTable(key, value, scope)
    assert(scope == nil)
    if string.sub(key, 1, 21) == "aardwolf-spells:data:" then
      world.dataAttempts = world.dataAttempts + 1
      if world.throwDataWrites then error("native save failed") end
      if world.refuseDataWrites then return false end
      context.storage[key] = clone(value)
      world.dataWrites = world.dataWrites + 1
      return true
    end
    return saveLayout(key, value)
  end
  function env.pickFile(callback, options)
    assert(type(options) == "table" and type(callback) == "function")
    world.pickOptions, world.pickCallback = options, callback
    return true
  end
  function world.pick(value, message, reason)
    local callback = world.pickCallback
    assert(callback, "No file picker pending")
    world.pickCallback = nil
    if type(value) == "table" and type(value.data) == "string" and value.size == nil then value.size = #value.data end
    callback(value, message, reason)
  end
  -- MudForge's table constructor can retain nil fields that Lua tables omit.
  function world.nativeNilPairs()
    world.nilFieldsObserved = 0
    env.pairs = function(value)
      local iterator, state, cursor = pairs(value)
      local extras, exhausted, index = {}, false, 0
      if (value.kind == "skill" or value.kind == "spell") and value.mana == nil then
        table.insert(extras, "mana")
      end
      if type(value.name) == "string" and type(value.level) == "number" then
        if value.area == nil then table.insert(extras, "area") end
        if value.sn == nil then table.insert(extras, "sn") end
        if value.percent == nil then table.insert(extras, "percent") end
      end
      return function()
        if not exhausted then
          local item
          cursor, item = iterator(state, cursor)
          if cursor ~= nil then return cursor, item end
          exhausted = true
        end
        index = index + 1
        if extras[index] then
          world.nilFieldsObserved = world.nilFieldsObserved + 1
          return extras[index], nil
        end
      end
    end
  end
  local lib = freshLibrary()
  env.require = function(name) assert(name == "aardwolf-api"); return lib end
  load_source("spells", env)
  env.init()
  if not readerFirst then reader.client.start() end
  function world.active(name)
    if not world.connected then world.connect() end
    world.packet("char.base", { name = name or "Fixture" })
    world.packet("char.status", { state = 3 })
  end
  function world.line(text, sessionId, raw)
    assert(env.onLine(sessionId or world.id, raw or text, text) == nil)
  end
  function world.header()
    world.line("Skill/Spell name            Level  Sn   % ")
    world.line("——————————————————————————  —————  --- ---")
  end
  function world.footer() world.line("* means that you cannot use the skill/spell.") end
  function world.sample()
    world.header()
    world.line(" Axe                            1    -  85  ")
    world.line(" Ballistic attack               1  101   1  ")
    world.line(" Globe of invulnerability     126  174   -  ")
    world.line(" Incomplete healing           190  106   -  ")
    world.footer()
  end
  function world.panel() return context.widgets["spells-id:damage-abilities"] end
  function world.importPanel() return context.widgets["spells-id:storage-import"] end
  function world.paste(data, sessionId)
    local panel = world.importPanel()
    assert(panel, "No paste import panel")
    panel.events.luamsg({ event = "import", data = data, sessionId = sessionId or world.id })
  end
  function world.action(action) world.panel().events.action({ action = action }) end
  -- An outgoing manual bulk query is captured without the UI's refresh queue.
  function world.query(kind) env.onSend(world.id, kind .. "s combat") end
  function world.damageHeader(kind)
    world.line(kind == "skill" and "           Skill name                 Learned  Damage"
      or "           Spell name                 Mana  Learned  Spell#  Damage")
    world.line("—————————— —————————————————————————— ———— ——————— —————— ————————————————")
  end
  function world.damageFooter()
    world.line("You have 2 abilities forgotten.")
    world.line("To see all skills/spells for your class, use 'allspells <class>'")
    world.line("")
    world.line("[1543/1543hp 1239/1239mn 1562/1562mv 0qt 1987tnl] >")
  end
  function world.bash()
    world.line("> skills combat")
    world.damageHeader("skill")
    for _, row in ipairs({ "Level 1  : Kick                          100%  Bash",
      "Level 11 : Bash                           85%  Bash", "Level 17 : Dirt kicking                   85%  Bash",
      "Level 27 : Stun                           87%  Bash", "Level 39 : Trip                           92%  Bash",
      "Level 50 : Sap                            85%  Bash" }) do
      world.line(row); world.line("————————————————————————————————————————————————————————————————")
    end
    world.damageFooter()
  end
  function world.fire()
    world.line("> spells combat")
    world.damageHeader("spell")
    for _, row in ipairs({ "Level 5  : Soulburn                     10       1%     363  Fire",
      "Level 9  : Burning hands                15       1%       7  Fire",
      "Level 33 : White flame                  18       1%     366  Fire",
      "Level 34 : Control flames               28       1%     107  Fire",
      "Level 38 : Fireball                     30       1%      45  Fire",
      "Level 44 : Fire storm                   25       1%     148  Fire" }) do world.line(row) end
    world.damageFooter()
  end
  return world, reader, context
end
