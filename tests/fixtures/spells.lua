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
        world.databases[key] = world.databases[key] or { rows = {} }
        local stored = world.databases[key]
        local db = { closed = false }
        function db.close() db.closed = true end
        function db.query(sqlText, params, done)
          assert(not db.closed and string.find(sqlText, "LEFT JOIN", 1, true))
          if world.failRead then
            world.complete(done, nil, { code = "helper_unavailable", outcome = "rejected" }); return
          end
          local rows = {}
          for _, item in ipairs(stored.rows) do
            table.insert(rows, { stored.schemaVersion or 1, stored.name, stored.time, #stored.rows,
              item[1], item[2], item[3], item[4], item[5] and 1 or 0, item[6] })
          end
          world.complete(done, { rows = rows })
        end
        function db.transaction(statements, done)
          assert(not db.closed and #statements <= 100)
          if statements[1].sql == "DELETE FROM abilities" then
            if world.rollback then
              world.complete(done, nil, { code = "sqlite_constraint", outcome = "rolled_back" }); return
            end
            local rows = {}
            for index = 2, #statements - 1 do
              local params = statements[index].params
              assert(#params <= 1000)
              for first = 1, #params, 6 do
                table.insert(rows, { params[first], params[first+1], params[first+2], params[first+3], params[first+4], params[first+5] })
              end
            end
            local metadata = statements[#statements].params
            assert(metadata[3] == #rows)
            stored.rows, stored.name, stored.time = rows, metadata[1], metadata[2]
            world.lastBatchSize = #statements
            if world.unknown then
              world.complete(done, nil, { code = "timeout", outcome = "unknown" }); return
            end
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
  return world, reader, context
end
