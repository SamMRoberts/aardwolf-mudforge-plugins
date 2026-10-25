import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

// Offline collector/consumer contracts; not native or live Aardwolf evidence.
const helpers = `
  local function frame(world, name, rows)
    world.line("{" .. name .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(name == "eqdata" and "{/eqdata}" or "{/invdata}")
    world.tick(1)
  end
  local function ready()
    local world = newWorld(); local core = world.core()
    local consumer = world.consumer("use-reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 }); world.tick(1)
    frame(world, "invdata", {
      "101,,a bag,1,11,0,-1,-1", "102,,a potion,1,8,0,-1,-1",
      "103,,a ration,1,14,0,-1,-1", "104,,a pill,1,19,0,-1,-1",
      "105,,a drink container,1,12,0,-1,-1", "106,,a scroll,1,2,0,-1,-1",
      "107,,a spare wand,1,3,0,-1,-1"
    })
    frame(world, "eqdata", { "201,,a wand,1,3,0,26,-1", "202,,a staff,1,4,0,27,-1" })
    local inventory, results = consumer.client.inventory, {}
    inventory.onResult(function(value) table.insert(results, value) end)
    return world, inventory, results, consumer, core
  end
  local function sent(world, results, requestId, command)
    assert(type(requestId) == "string")
    assert(world.commands[#world.commands] == command, tostring(world.commands[#world.commands]))
    assert(results[#results].requestId == requestId and results[#results].outcome == "sent")
  end
  local function refused(world, results, callback)
    local before = #world.commands
    local requestId = callback()
    assert(#world.commands == before)
    if requestId then assert(results[#results].requestId == requestId and results[#results].outcome == "failed") end
  end
`;

const cases = {
  'item use advertises additive capability and sends the exact type-specific commands': `
    local world, inventory, results = ready()
    for _, action in ipairs({ "drop", "hold", "quaff", "eat", "drink", "recite", "zap", "brandish", "use" }) do
      assert(inventory.supports(action), action)
    end
    assert(not inventory.supports("quit") and not inventory.supports({}) and not inventory.supports(0 / 0))
    sent(world, results, inventory.hold(107), "hold 107")
    sent(world, results, inventory.use(102, "quaff"), "quaff 102")
    sent(world, results, inventory.use(103, "eat"), "eat 103")
    sent(world, results, inventory.use(104, "eat"), "eat 104")
    sent(world, results, inventory.use(105, "drink"), "drink 105")
    sent(world, results, inventory.use(106, "recite"), "recite 106")
    sent(world, results, inventory.use(106, "recite", { target = "2.guard" }), "recite 106 2.guard")
    sent(world, results, inventory.use(106, "recite", { target = 107 }), "recite 106 107")
    sent(world, results, inventory.use(201, "zap", { target = "self", heldSlot = 26 }), "zap self")
    sent(world, results, inventory.use(202, "brandish", { heldSlot = "27" }), "brandish")
    assert(inventory.getItem(102) and inventory.getItem(201))
  `,
  'item use rejects malformed actions selectors options IDs and held slots without sending': `
    local world, inventory, results = ready()
    for _, action in ipairs({ "quit", "quaff;quit", "", false, {} }) do
      refused(world, results, function() return inventory.use(102, action) end)
    end
    for _, target in ipairs({ "all", "all.guard", "0.guard", "a b", "guard;quit", "guard\\nquit", "", {}, false }) do
      refused(world, results, function() return inventory.use(201, "zap", { target = target, heldSlot = 26 }) end)
    end
    for _, slot in ipairs({ -1, 1.5, "", "26;quit", {}, math.huge }) do
      refused(world, results, function() return inventory.use(201, "zap", { target = "self", heldSlot = slot }) end)
    end
    refused(world, results, function() return inventory.use(102, "quaff", "invalid") end)
    refused(world, results, function() return inventory.use(102, "quaff", { target = "self" }) end)
    refused(world, results, function() return inventory.use(201, "zap", { heldSlot = 26 }) end)
    refused(world, results, function() return inventory.use(202, "brandish", { heldSlot = 27, target = "guard" }) end)
    refused(world, results, function() return inventory.use("all", "quaff") end)
  `,
  'Core rechecks item type location freshness and selected held item before use': `
    local world, inventory, results = ready()
    refused(world, results, function() return inventory.use(102, "eat") end)
    refused(world, results, function() return inventory.use(107, "zap", { target = "guard", heldSlot = 26 }) end)
    refused(world, results, function() return inventory.use(201, "zap", { target = "guard", heldSlot = 27 }) end)
    refused(world, results, function() return inventory.use(202, "zap", { target = "guard", heldSlot = 27 }) end)
    refused(world, results, function() return inventory.use(999, "quaff") end)
    refused(world, results, function() return inventory.hold(201) end)
    inventory.lookIn(101); frame(world, "invdata 101", { "301,,a bagged potion,1,8,0,-1,-1" })
    refused(world, results, function() return inventory.use(301, "quaff") end)
    inventory.refresh(); world.line("{invdata}"); world.line("malformed"); world.line("{/invdata}"); world.tick(1)
    if world.commands[#world.commands] == "eqdata" then frame(world, "eqdata", {}) end
    assert(inventory.get().scopes.inventory.stale)
    refused(world, results, function() return inventory.use(102, "quaff") end)
  `,
  'ambiguous equipped held-slot data cannot use a different item by accident': `
    local world, inventory, results = ready()
    inventory.refresh(); frame(world, "invdata", { "101,,a bag,1,11,0,-1,-1" })
    frame(world, "eqdata", { "201,,a wand,1,3,0,26,-1", "202,,another wand,1,3,0,26,-1" })
    refused(world, results, function() return inventory.use(201, "zap", { target = "self", heldSlot = 26 }) end)
  `,
  'older inventory Core keeps basic actions and refuses extensions with an upgrade explanation': `
    local world, inventory, results, consumer, core = ready()
    core.host.broadcastToPlugin(consumer.id, "aardwolf-api:state", json.encode({ version = 1,
      session = { connected = true, negotiated = true }, snapshots = {}, capabilities = { inventory = 1 } }))
    assert(inventory.supports("drop") and not inventory.supports("hold") and not inventory.supports("quaff"))
    local requestId, reason = inventory.use(102, "quaff")
    assert(not requestId and string.find(reason, "0.3.0", 1, true))
    requestId, reason = inventory.hold(107)
    assert(not requestId and string.find(reason, "0.3.0", 1, true))
    sent(world, results, inventory.drop(102), "drop 102")
  `,
  'busy inactive disconnected and refused use commands never run later': `
    local world, inventory, results = ready()
    inventory.lookIn(101); world.tick(1)
    refused(world, results, function() return inventory.use(102, "quaff") end)
    frame(world, "invdata 101", {})
    world.packet("char.status", { state = 8 })
    refused(world, results, function() return inventory.use(102, "quaff") end)
    world.packet("char.status", { state = 3 })
    world.refuseCommands = true
    refused(world, results, function() return inventory.use(102, "quaff") end)
    world.refuseCommands = false
    local before = #world.commands; world.tick(60000); assert(#world.commands == before)
    world.disconnect()
    assert(not inventory.supports("hold"))
    refused(world, results, function() return inventory.use(102, "quaff") end)
  `,
  'synchronous result subscribers can stop the consumer without restoring old capability or state': `
    local world, inventory, results, consumer = ready()
    inventory.onResult(function(value) if value.outcome == "sent" then consumer.client.stop() end end)
    local requestId = inventory.use(102, "quaff")
    assert(type(requestId) == "string")
    assert(not inventory.status().available and not inventory.supports("quaff") and inventory.getItem(102) == nil)
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${helpers}\n${source}`));
