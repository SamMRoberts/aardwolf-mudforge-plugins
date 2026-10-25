import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

// Offline collector/consumer evidence; these do not exercise live combat.
const helpers = `
  local inventoryRows = {
    "101,,a bag,1,11,0,-1,-1", "102,,a potion,1,8,0,-1,-1",
    "103,,a drink flask,1,12,0,-1,-1", "104,,a pill,1,19,0,-1,-1",
    "105,,a sword,1,5,0,-1,-1", "106,,a scroll,1,2,0,-1,-1"
  }
  local equipmentRows = { "201,,a worn bag,1,11,0,7,-1", "202,,a wand,1,3,0,26,-1" }
  local function frame(world, name, rows)
    world.line("{" .. name .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(name == "eqdata" and "{/eqdata}" or name == "invdetails" and "{/invdetails}" or "{/invdata}")
    world.tick(1)
  end
  local function ready(initialState)
    local world = newWorld(); local core = world.core()
    local consumer = world.consumer("combat-reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = initialState or 3 }); world.tick(1)
    frame(world, "invdata", inventoryRows); frame(world, "eqdata", equipmentRows)
    local inventory, results = consumer.client.inventory, {}
    inventory.onResult(function(value) table.insert(results, value) end)
    return world, inventory, results, consumer, core
  end
  local function bag(world, inventory)
    assert(inventory.lookIn(101))
    frame(world, "invdata 101", { "301,,a bagged potion,1,8,0,-1,-1", "302,,a bagged pill,1,19,0,-1,-1", "303,,a nested bag,1,11,0,-1,-1" })
  end
  local function refused(world, results, callback)
    local before = #world.commands
    local requestId = callback()
    assert(#world.commands == before)
    if requestId then assert(results[#results].requestId == requestId and results[#results].outcome == "failed") end
  end
  local function sent(world, results, requestId, command)
    assert(type(requestId) == "string" and world.commands[#world.commands] == command)
    assert(results[#results].requestId == requestId and results[#results].outcome == "sent")
  end
`;
const cases = {
  'combat readiness is additive while ordinary active remains state three': `
    local world, inventory = ready()
    assert(inventory.supports("combatPotions") and inventory.status().active and inventory.status().potionReady)
    world.packet("char.status", { state = 8 })
    assert(not inventory.status().active and inventory.status().potionReady)
    world.packet("char.status", { state = 3 })
    assert(inventory.status().active and inventory.status().potionReady)
    world.packet("char.status", { state = 9 })
    assert(not inventory.status().active and not inventory.status().potionReady)
  `,
  'an identified character first observed fighting enables monitoring and serial initial collection once': `
    local world, inventory = ready(8)
    assert(not inventory.status().active and inventory.status().potionReady and not inventory.status().collecting)
    assert(#world.commands == 2 and world.commands[1] == "invdata" and world.commands[2] == "eqdata")
    local enabled = 0
    for _, packet in ipairs(world.sent) do if packet.package == "config invmon on" then enabled = enabled + 1 end end
    assert(enabled == 1)
    local before = #world.commands; world.tick(60000); assert(#world.commands == before)
  `,
  'a pending read completes across three to eight and back without cancellation or retry': `
    local world, inventory, results = ready()
    local requestId = inventory.lookIn(101)
    world.packet("char.status", { state = 8 })
    assert(inventory.status().collecting)
    world.line("{invdata 101}"); world.line("301,,a potion,1,8,0,-1,-1")
    world.packet("char.status", { state = 3 })
    world.line("{/invdata}"); world.tick(1)
    assert(results[#results].requestId == requestId and results[#results].outcome == "complete")
    assert(inventory.getItem(301) and not inventory.status().collecting)
    local count = 0; for _, command in ipairs(world.commands) do if command == "invdata 101" then count = count + 1 end end
    assert(count == 1)
  `,
  'combat reads refresh containers and details through the same serialized collector': `
    local world, inventory, results = ready(8)
    local refreshId = inventory.refresh()
    local bagId = inventory.lookIn(101)
    local detailsId = inventory.identify(102)
    assert(world.commands[#world.commands] == "invdata")
    frame(world, "invdata", inventoryRows); assert(world.commands[#world.commands] == "eqdata")
    frame(world, "eqdata", equipmentRows); assert(world.commands[#world.commands] == "invdata 101")
    frame(world, "invdata 101", {}); assert(world.commands[#world.commands] == "invdetails 102")
    frame(world, "invdetails", { "{invheader}102|1|Potion|1|1|none||Fixture||-1|||0" })
    assert(inventory.getDetails(102) and not inventory.status().collecting)
    assert(results[1].requestId == refreshId and results[1].outcome == "complete")
    assert(results[2].requestId == bagId and results[2].outcome == "complete")
    assert(results[3].requestId == detailsId and results[3].outcome == "complete")
  `,
  'combat permits only observed known potion retrieval quaff and return commands': `
    local world, inventory, results = ready(); bag(world, inventory)
    world.packet("char.status", { state = 8 })
    sent(world, results, inventory.take(301, 101), "get 301 101")
    world.line("{invmon}5,301,101,-1")
    sent(world, results, inventory.use(301, "quaff"), "quaff 301")
    assert(inventory.getItem(301), "dispatch must not assume consumption")
    sent(world, results, inventory.put(301, 101), "put 301 101")
    world.line("{invmon}6,301,101,-1")
    assert(inventory.getItem(301).location == "container:101")
    sent(world, results, inventory.put(102, 201), "put 102 201")
  `,
  'combat rejects ordinary management equipment and non-potion use actions': `
    local world, inventory, results = ready(); bag(world, inventory); world.packet("char.status", { state = 8 })
    for _, action in ipairs({ "wear", "remove", "hold", "drop", "sell", "donate", "sacrifice" }) do
      refused(world, results, function() return inventory[action](105) end)
    end
    refused(world, results, function() return inventory.give(102, "guard") end)
    refused(world, results, function() return inventory.take(302, 101) end)
    refused(world, results, function() return inventory.put(104, 101) end)
    refused(world, results, function() return inventory.put(105, 101) end)
    refused(world, results, function() return inventory.use(104, "eat") end)
    refused(world, results, function() return inventory.use(103, "drink") end)
    refused(world, results, function() return inventory.use(106, "recite") end)
    refused(world, results, function() return inventory.use(202, "zap", { target = "self", heldSlot = 26 }) end)
    refused(world, results, function() return inventory.use(104, "quaff") end)
  `,
  'Core independently refuses non-potion combat commands sent around the consumer guard': `
    local world, inventory, results, consumer, core = ready(); bag(world, inventory)
    world.packet("char.status", { state = 8 })
    local generation, original = nil, core.env.broadcastToPlugin
    core.env.broadcastToPlugin = function(target, message, encoded)
      if target == consumer.id and message == "aardwolf-api:inventory-status" then generation = json.decode(encoded).generation end
      original(target, message, encoded)
    end
    world.packet("char.status", { state = 8 }); assert(generation)
    local before = #world.commands
    for index, request in ipairs({
      { kind = "wear", args = { id = 105 } }, { kind = "remove", args = { id = 202 } },
      { kind = "drop", args = { id = 102 } }, { kind = "give", args = { id = 102, recipient = "guard" } },
      { kind = "use", args = { id = 104, action = "eat" } },
      { kind = "use", args = { id = 202, action = "zap", target = "self", heldSlot = 26 } },
      { kind = "take", args = { id = 302, containerId = 101 } }
    }) do
      request.version, request.generation, request.requestId = 1, generation, "direct-combat-" .. index
      consumer.host.broadcastToPlugin(core.id, "aardwolf-api:inventory-request", json.encode(request))
    end
    assert(#world.commands == before)
  `,
  'combat potion moves require exact source IDs accessible storage bags and fresh scopes': `
    local world, inventory, results = ready(); bag(world, inventory)
    inventory.lookIn(303); frame(world, "invdata 303", { "401,,a nested potion,1,8,0,-1,-1" })
    world.packet("char.status", { state = 8 })
    refused(world, results, function() return inventory.take(301, 201) end)
    refused(world, results, function() return inventory.take(102, 101) end)
    refused(world, results, function() return inventory.put(301, 101) end)
    refused(world, results, function() return inventory.put(102, 103) end)
    refused(world, results, function() return inventory.put(102, 303) end)
    refused(world, results, function() return inventory.take(401, 303) end)
    refused(world, results, function() return inventory.use(301, "quaff") end)
    inventory.lookIn(101); frame(world, "invdata 101", { "malformed" })
    assert(inventory.getContents(101).stale)
    refused(world, results, function() return inventory.take(301, 101) end)
  `,
  'combat actions refuse busy collection immediately and never run afterward': `
    local world, inventory, results = ready(8)
    inventory.lookIn(101)
    refused(world, results, function() return inventory.use(102, "quaff") end)
    refused(world, results, function() return inventory.put(102, 101) end)
    frame(world, "invdata 101", {})
    local before = #world.commands; world.tick(60000); assert(#world.commands == before)
  `,
  'sleep cancels queued combat reads and drains the current reply without resuming old requests': `
    local world, inventory, results = ready(8)
    local first = inventory.lookIn(101); local second = inventory.lookIn(201)
    world.packet("char.status", { state = 9 })
    assert(not inventory.status().potionReady)
    assert(#results == 2 and results[1].outcome == "failed" and results[2].outcome == "failed")
    world.line("{/invdata}"); world.tick(1)
    local before = #world.commands
    world.line("{invitem}501,,a sleeping potion,1,8,0,-1,-1")
    world.packet("char.status", { state = 8 }); world.tick(20)
    assert(#world.commands == before and inventory.getItem(501) ~= nil)
    assert(not inventory.status().collecting and inventory.status().potionReady)
  `,
  'sleep retains live item movements but does not defer reconciliation reads until waking': `
    local world, inventory = ready(8)
    world.packet("char.status", { state = 9 })
    world.line("{invmon}7,102,-1,-1")
    assert(inventory.getItem(102) == nil)
    local before = #world.commands
    world.line("{invmon}malformed")
    assert(inventory.get().scopes.inventory.stale)
    world.packet("char.status", { state = 8 }); world.tick(20)
    assert(#world.commands == before and not inventory.status().collecting)
  `,
  'disconnect and identity changes invalidate potion readiness and pending combat work': `
    local world, inventory, results = ready(8)
    inventory.lookIn(101); world.disconnect()
    assert(not inventory.status().potionReady and not inventory.supports("combatPotions"))
    assert(results[#results].outcome == "failed")
    refused(world, results, function() return inventory.use(102, "quaff") end)
    world.connect(); world.packet("char.base", { name = "Another" })
    assert(not inventory.status().potionReady)
    world.packet("char.status", { state = 8 })
    assert(inventory.status().potionReady and not inventory.status().active and inventory.getItem(102) == nil)
  `,
  'older Core cannot enable combat potions but retains normal-state use support': `
    local world, inventory, results, consumer, core = ready()
    local generation, original = nil, core.env.broadcastToPlugin
    core.env.broadcastToPlugin = function(target, message, encoded)
      if target == consumer.id and message == "aardwolf-api:inventory-status" then generation = json.decode(encoded).generation end
      original(target, message, encoded)
    end
    world.packet("char.status", { state = 3 }); assert(generation)
    core.env.broadcastToPlugin = original
    core.host.broadcastToPlugin(consumer.id, "aardwolf-api:state", json.encode({ version = 1,
      session = { connected = true, negotiated = true }, snapshots = {},
      capabilities = { inventory = 1, inventoryActions = { "hold", "quaff", "eat", "drink", "recite", "zap", "brandish" } } }))
    assert(not inventory.supports("combatPotions") and not inventory.status().potionReady)
    sent(world, results, inventory.use(102, "quaff"), "quaff 102")
    core.host.broadcastToPlugin(consumer.id, "aardwolf-api:inventory-status", json.encode({ version = 1, generation = generation,
      status = { active = false, connected = true, collecting = false, characterName = "Fixture", potionReady = true } }))
    assert(not inventory.status().potionReady)
    local id, reason = inventory.use(102, "quaff")
    assert(not id and string.find(reason, "0.4.0", 1, true))
    id, reason = inventory.take(301, 101)
    assert(not id and string.find(reason, "0.4.0", 1, true))
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${helpers}\n${source}`));
