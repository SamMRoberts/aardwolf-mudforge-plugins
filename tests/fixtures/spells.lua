-- The fake SQL boundary checks collector behavior. Real SQL is tested separately.
function spellsWorld(readerFirst)
  local world = newWorld()
  world.databases, world.commands, world.sends, world.delayed = {}, {}, {}, {}
  world.helperReady = true
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
  function world.complete(callback, value, issue)
    if world.delay then table.insert(world.delayed, function() callback(value, issue) end)
    else callback(value, issue) end
  end
  function world.drain()
    local steps = 0
    while #world.delayed > 0 do
      steps = steps + 1; assert(steps < 100)
      local callback = table.remove(world.delayed, 1)
      callback()
    end
  end
  local lib = freshLibrary()
  env.require = function(name)
    assert(name == "aardwolf-api")
    return { protocol = lib.protocol, new = function(host, options)
      local key = options.sqlite and options.sqlite.characterKey
      local consumer = lib.new(host, { packages = options.packages })
      local sql = { null = { sqliteType = "null" } }
      function sql.status()
        return { available = key ~= nil and world.helperReady and world.connected,
          reason = not key and "unconfigured" or not world.connected and "disconnected" or "helper_unavailable" }
      end
      function sql.open(name, callback)
        assert(name == "spells" and key)
        world.databases[key] = world.databases[key] or { rows = {}, details = {}, members = {}, times = {}, commands = {} }
        local stored = world.databases[key]
        local db = { closed = false }
        function db.close() db.closed = true end
        function db.query(sqlText, params, done)
          assert(not db.closed)
          if world.failRead then
            world.complete(done, nil, { code = "helper_unavailable", outcome = "rejected" }); return
          end
          local rows = {}
          if string.find(sqlText, "LEFT JOIN", 1, true) then
            for _, item in ipairs(stored.rows) do
              table.insert(rows, { stored.schemaVersion or 1, stored.name, stored.time, #stored.rows,
                item[1], item[2], item[3], item[4], item[5] and 1 or 0, item[6] })
            end
          else
            assert(string.find(sqlText, "FROM ability_details", 1, true))
            local allRows = {}
            for name, info in pairs(stored.details) do table.insert(allRows, { "detail", name, info.kind, info.mana }) end
            for key, members in pairs(stored.members) do
              local kind, damageType = string.match(key, "^(%a+):(%a+)$")
              for name in pairs(members) do table.insert(allRows, { "member", kind, damageType, name }) end
            end
            for key, time in pairs(stored.times) do
              local kind, damageType = string.match(key, "^(%a+):(%a+)$")
              table.insert(allRows, { "time", kind, damageType, time })
            end
            for name, command in pairs(stored.commands) do table.insert(allRows, { "command", name, command }) end
            table.sort(allRows, function(left, right)
              for index = 1, 4 do
                if left[index] ~= right[index] then return tostring(left[index]) < tostring(right[index]) end
              end
              return false
            end)
            for index = params[1]+1, math.min(params[1]+500, #allRows) do table.insert(rows, allRows[index]) end
          end
          world.complete(done, { rows = rows })
        end
        function db.transaction(statements, done)
          assert(not db.closed and #statements <= 100)
          if string.find(statements[1].sql, "CREATE TABLE", 1, true) then world.complete(done, {}); return end
          if world.rollback then
            world.complete(done, nil, { code = "sqlite_constraint", outcome = "rolled_back" }); return
          end
          local rows, metadata = nil, nil
          if statements[1].sql == "DELETE FROM abilities" then rows = {} end
          local function cell(value)
            if type(value) == "table" and value.sqliteType == "null" then return nil end
            return value
          end
          for _, statement in ipairs(statements) do
            local sqlText, params = statement.sql, statement.params or {}
            assert(#params <= 1000)
            if string.find(sqlText, "INSERT INTO abilities ", 1, true) then
              for first = 1, #params, 6 do
                table.insert(rows, { params[first], params[first+1], params[first+2], params[first+3], params[first+4], params[first+5] })
              end
            elseif string.find(sqlText, "INSERT INTO metadata ", 1, true) then metadata = params
            elseif string.find(sqlText, "INSERT INTO ability_details ", 1, true) then
              for first = 1, #params, 3 do stored.details[params[first]] = { kind = params[first+1], mana = cell(params[first+2]) } end
            elseif string.find(sqlText, "INSERT INTO damage_memberships ", 1, true) then
              for first = 1, #params, 3 do
                local key = params[first] .. ":" .. params[first+1]
                stored.members[key] = stored.members[key] or {}
                stored.members[key][params[first+2]] = true
              end
            elseif string.find(sqlText, "INSERT INTO damage_refreshes ", 1, true) then
              for first = 1, #params, 3 do stored.times[params[first] .. ":" .. params[first+1]] = params[first+2] end
            elseif sqlText == "DELETE FROM damage_memberships WHERE kind=?" then
              for key in pairs(stored.members) do
                if string.sub(key, 1, #params[1]+1) == params[1] .. ":" then stored.members[key] = nil end
              end
            elseif sqlText == "DELETE FROM ability_details WHERE kind=?" then
              for name, info in pairs(stored.details) do if info.kind == params[1] then stored.details[name] = nil end end
            elseif string.find(sqlText, "INSERT INTO skill_commands ", 1, true) then stored.commands[params[1]] = params[2]
            elseif sqlText == "DELETE FROM skill_commands WHERE name=?" then stored.commands[params[1]] = nil
            elseif string.find(sqlText, "WHERE name NOT IN", 1, true) then
              local names = {}
              for _, item in ipairs(rows) do names[string.lower(item[1])] = true end
              if string.find(sqlText, "ability_details", 1, true) then
                for name in pairs(stored.details) do if not names[name] then stored.details[name] = nil end end
              else
                for _, members in pairs(stored.members) do
                  for name in pairs(members) do if not names[name] then members[name] = nil end end
                end
              end
            else assert(sqlText == "DELETE FROM abilities", sqlText) end
          end
          if rows then stored.rows = rows end
          if metadata then
            assert(metadata[3] == #rows)
            stored.name, stored.time = metadata[1], metadata[2]
          end
          world.lastBatchSize = #statements
          if world.unknown then
            world.complete(done, nil, { code = "timeout", outcome = "unknown" }); return
          end
          world.complete(done, {})
        end
        world.complete(callback, db)
      end
      consumer.sqlite = sql
      return consumer
    end }
  end
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
  function world.action(action) world.panel().events.action({ action = action }) end
  -- An outgoing manual bulk query is captured without the UI's two-query queue.
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
