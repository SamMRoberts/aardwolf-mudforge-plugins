import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory.txt', import.meta.url), 'utf8').trim().split('\n');

// These are offline protocol and messaging checks, not native transport evidence.
const helpers = `
  local function frame(world, kind, rows)
    world.line("{" .. kind .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(kind == "eqdata" and "{/eqdata}" or kind == "invdetails" and "{/invdetails}" or "{/invdata}")
    world.tick(1)
  end
  local function startInventory(sessionId)
    local world = newWorld(sessionId)
    local core = world.core()
    local consumer = world.consumer("inventory-reader", { "Char" }, { inventory = true })
    world.connect()
    world.packet("char.base", { name = "Fixture", level = 42 })
    world.packet("char.status", { state = 3 })
    world.tick(1)
    return world, consumer.client.inventory, consumer, core
  end
  local function loadedInventory(sessionId)
    local world, inventory, consumer, core = startInventory(sessionId)
    for _, line in ipairs(inventoryFixture()) do world.line(line); world.tick(1) end
    return world, inventory, consumer, core
  end
  local function countCommand(world, command)
    local count = 0
    for _, value in ipairs(world.commands) do if value == command then count = count + 1 end end
    return count
  end
`;

const cases = {
  'inventory stays opted out and construction has no host side effects': `
    local world = newWorld(); world.core()
    local context = world.context("unused", "Unused")
    local client = freshLibrary().new(context.host, { inventory = true })
    assert(#context.broadcasts == 0 and next(context.events) == nil)
    assert(not client.inventory.status().available)
    local consumer = world.consumer()
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    world.tick(1000)
    assert(#world.commands == 0)
    assert(not consumer.client.inventory.refresh())
    assert(not pcall(freshLibrary().new, context.host, { inventory = "yes" }))
  `,
  'initial collection is shared and preserves typed records and comma-containing names': `
    local world, inventory = loadedInventory()
    assert(inventory.status().available and inventory.status().connected)
    assert(not inventory.status().collecting)
    assert(countCommand(world, "invdata") == 1 and countCommand(world, "eqdata") == 1)
    local enabled = 0
    for _, message in ipairs(world.sent) do if message.package == "config invmon on" then enabled = enabled + 1 end end
    assert(enabled == 1)
    local bag = inventory.getItem(101)
    assert(bag.id == 101 and bag.name == "@GCanvas, travel bag@w" and bag.type == 11)
    assert(bag.flags == "KG" and bag.level == 50 and not bag.unique and bag.wearLocation == -1 and bag.timer == -1)
    assert(bag.location == "inventory")
    assert(inventory.getItem(103).unique and inventory.getItem(103).timer == 600)
    assert(inventory.getItem(201).location == "equipment")
    assert(#inventory.getContainers() == 2)
    assert(inventory.getContents(101) == nil)
    local snapshot = inventory.get()
    assert(snapshot.scopes.inventory.known and not snapshot.scopes.inventory.stale)
    assert(snapshot.scopes.equipment.known and #snapshot.scopes.equipment.entries == 2)
    local before = #world.commands
    local second = world.consumer("second-reader", { "Char" }, { inventory = true }).client.inventory
    assert(second.getItem(101).name == bag.name and #world.commands == before)
  `,
  'container requests distinguish unknown and complete empty contents without hidden reads': `
    local world, inventory = loadedInventory()
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    local before = #world.commands
    assert(inventory.getContents(101) == nil and #world.commands == before)
    local requestId = inventory.lookIn(101)
    assert(type(requestId) == "string")
    world.tick(1); assert(world.commands[#world.commands] == "invdata 101")
    frame(world, "invdata 101", { "301,,a folded map,1,10,0,-1,-1" })
    local contents = inventory.getContents(101)
    assert(contents.known and not contents.stale and #contents.entries == 1)
    assert(inventory.getItem(301).location == "container:101")
    assert(results[#results].requestId == requestId and results[#results].outcome == "complete")
    assert(inventory.lookIn(101)); world.tick(1); frame(world, "invdata 101")
    contents = inventory.getContents(101)
    assert(contents.known and #contents.entries == 0 and inventory.getItem(301) == nil)
  `,
  'item detail requests use invdetails and preserve bounded type tags': `
    local world, inventory = loadedInventory()
    assert(inventory.getDetails(101) == nil)
    local requestId = inventory.identify(101)
    assert(type(requestId) == "string"); world.tick(1)
    assert(world.commands[#world.commands] == "invdetails 101")
    frame(world, "invdetails", {
      "{invheader}101|50|Container|100|2|none|kept|Fixture|wolf|-1|||99",
      "{invcontainer}100|20|2|0|100"
    })
    local details = inventory.getDetails(101)
    assert(details.id == 101 and details.level == 50 and details.itemType == "Container")
    assert(details.value == 100 and details.weight == 2 and details.owner == "Fixture")
    assert(details.itemScore == 99 and #details.tags == 1)
    assert(details.tags[1].tag == "invcontainer" and details.tags[1].value == "100|20|2|0|100")
    for _, command in ipairs(world.commands) do assert(command ~= "identify 101") end
  `,
  'single-item actions send exact fixed commands and report dispatch rather than game success': `
    local world, inventory = loadedInventory()
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    local actions = {
      { "take", { 103, 101 }, "get 103 101" }, { "put", { 103, 101 }, "put 103 101" },
      { "wear", { 103 }, "wear 103" }, { "remove", { 202 }, "remove 202" },
      { "drop", { 103 }, "drop 103" }, { "give", { 103, "2.guard" }, "give 103 2.guard" },
      { "sell", { 103 }, "sell 103" }, { "donate", { 103 }, "donate 103" },
      { "sacrifice", { 103 }, "sacrifice 103" }
    }
    for _, action in ipairs(actions) do
      local before = #world.commands
      local requestId = inventory[action[1]](table.unpack(action[2]))
      assert(type(requestId) == "string" and #world.commands == before + 1)
      assert(world.commands[#world.commands] == action[3])
      assert(results[#results].requestId == requestId and results[#results].outcome == "sent")
    end
    assert(inventory.getItem(103) ~= nil)
    local before = #world.commands; world.tick(60000); assert(#world.commands == before)
  `,
  'actions reject injection bulk selectors invalid IDs and self-container puts': `
    local world, inventory = loadedInventory()
    local before = #world.commands
    for _, id in ipairs({ 0, -1, 1.5, "all", "103;drop all", "", false, {}, math.huge }) do
      assert(not inventory.drop(id))
    end
    for _, recipient in ipairs({ "all", "all.guard", "0.guard", "-1.guard", "2.3.guard", "guard smith", "guard;quit", "guard" .. string.char(10) .. "quit", "" }) do
      assert(not inventory.give(103, recipient))
    end
    assert(not inventory.put(101, 101))
    assert(not inventory.take(103, "all"))
    assert(#world.commands == before)
  `,
  'busy and inactive actions fail without deferred execution': `
    local world, inventory = loadedInventory()
    assert(inventory.lookIn(101)); world.tick(1)
    local before = #world.commands
    local requestId = inventory.drop(103)
    if requestId then assert(#world.commands == before) end
    frame(world, "invdata 101")
    world.packet("char.status", { state = 8 })
    before = #world.commands; assert(not inventory.drop(103))
    world.packet("char.status", { state = 3 }); world.tick(1000)
    assert(countCommand(world, "drop 103") == 0)
  `,
  'monitor events update equipment transfers gains and losses': `
    local world, inventory = loadedInventory()
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101")
    world.line("{invmon}2,103,-1,4")
    assert(inventory.getItem(103).location == "equipment" and inventory.getItem(103).wearLocation == 4)
    world.line("{invmon}1,103,-1,-1")
    assert(inventory.getItem(103).location == "inventory")
    world.line("{invmon}6,103,101,-1")
    assert(inventory.getItem(103).location == "container:101")
    world.line("{invmon}5,103,101,-1")
    assert(inventory.getItem(103).location == "inventory")
    world.line("{invitem}401,M,@Ra ruby@w,20,6,0,-1,-1")
    world.line("{invmon}4,401,-1,-1")
    assert(inventory.getItem(401).name == "@Ra ruby@w")
    world.line("{invmon}3,401,-1,-1")
    assert(inventory.getItem(401) == nil)
    world.line("{invmon}7,103,-1,-1")
    assert(inventory.getItem(103) == nil)
  `,
  'monitor changes during a listing cannot resurrect a removed item': `
    local world, inventory = loadedInventory()
    assert(inventory.refresh()); world.tick(1)
    world.line("{invdata}")
    world.line("101,KG,@GCanvas, travel bag@w,50,11,0,-1,-1")
    world.line("103,M,a silver dagger,40,5,1,-1,600")
    world.line("{invmon}3,103,-1,-1")
    world.line("{/invdata}"); world.tick(1)
    assert(inventory.getItem(103) == nil)
    frame(world, "eqdata", { "201,K,a worn satchel,30,11,0,12,-1" })
    assert(inventory.getItem(103) == nil)
  `,
  'malformed replacements retain stale last-good data and never partially commit': `
    local world, inventory = loadedInventory()
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    assert(inventory.refresh()); world.tick(1)
    world.line("{invdata}")
    world.line("999,,a new object,1,10,0,-1,-1")
    world.line("a malformed record")
    world.line("{/invdata}"); world.tick(1)
    assert(inventory.getItem(101) and inventory.getItem(999) == nil)
    assert(inventory.get().scopes.inventory.stale)
    local failed = false
    for _, result in ipairs(results) do if result.outcome == "failed" then failed = true end end
    assert(failed)
  `,
  'timed-out requests preserve cached contents and do not retry in a loop': `
    local world, inventory = loadedInventory()
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101", { "301,,a map,1,10,0,-1,-1" })
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    local requestId = inventory.lookIn(101); world.tick(1)
    local before = countCommand(world, "invdata 101")
    world.tick(60001)
    assert(inventory.getItem(301) and inventory.getContents(101).stale)
    assert(countCommand(world, "invdata 101") == before)
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(not inventory.drop(103))
    world.line("{/invdata}"); world.tick(1)
    assert(not inventory.status().collecting)
  `,
  'oversized names reject the complete replacement instead of truncating records': `
    local world, inventory = loadedInventory()
    inventory.lookIn(101); world.tick(1)
    frame(world, "invdata 101", { "301,," .. string.rep("x", 4097) .. ",1,10,0,-1,-1" })
    assert(inventory.getContents(101) == nil or inventory.getContents(101).stale)
    assert(inventory.getItem(301) == nil)
  `,
  'frames over one MiB retain the prior scope without a partial replacement': `
    local world, inventory = loadedInventory()
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101", { "301,,a saved map,1,10,0,-1,-1" })
    inventory.lookIn(101); world.tick(1)
    world.line("{invdata 101}")
    local name = string.rep("x", 4090)
    for id = 1001, 1260 do world.line(tostring(id) .. ",," .. name .. ",1,10,0,-1,-1") end
    world.line("{/invdata}"); world.tick(1)
    assert(inventory.getContents(101).stale and #inventory.getContents(101).entries == 1)
    assert(inventory.getItem(301).name == "a saved map" and inventory.getItem(1001) == nil)
  `,
  'manual tagged commands cannot complete the owned request': `
    local world, inventory, consumer = loadedInventory()
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    local requestId = inventory.lookIn(101); world.tick(1)
    consumer.host.send("invdata 201")
    frame(world, "invdata 201", { "501,,another map,1,10,0,-1,-1" })
    for _, result in ipairs(results) do
      assert(result.requestId ~= requestId or result.outcome ~= "complete")
    end
  `,
  'refused transport and timers produce failures without action retries': `
    local world, inventory = loadedInventory()
    local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
    world.refuseCommands = true
    local before = #world.commands
    local requestId = inventory.wear(103)
    assert(not requestId or results[#results].outcome == "failed")
    assert(#world.commands == before)
    world.refuseCommands = false; world.refuseTimers = true
    inventory.lookIn(101); world.tick(1)
    assert(not inventory.status().collecting)
    world.refuseTimers = false; world.tick(60000)
    assert(countCommand(world, "wear 103") == 0)
  `,
  'snapshots result payloads and subscribers are isolated defensive copies': `
    local world, inventory = loadedInventory()
    local snapshot = inventory.get(); snapshot.items["101"].name = "changed"
    snapshot.scopes.inventory.entries[1].name = "also changed"
    assert(inventory.getItem(101).name == "@GCanvas, travel bag@w")
    local calls = 0
    inventory.on(function(value) value.items["101"].name = "subscriber changed"; error("subscriber failure") end)
    local unsubscribe = inventory.on(function(value) calls = calls + 1; assert(value.items["101"].name == "@GCanvas, travel bag@w") end)
    world.line("{invitem}401,,a ruby,1,6,0,-1,-1")
    assert(calls > 0 and inventory.getItem(101).name == "@GCanvas, travel bag@w")
    unsubscribe(); unsubscribe(); local before = calls
    world.line("{invitem}402,,a sapphire,1,6,0,-1,-1")
    assert(calls == before)
  `,
  'disconnect identity change and last unsubscribe clear caches and pending work': `
    local world, inventory, consumer = loadedInventory()
    world.packet("char.base", { name = "Other" })
    assert(inventory.getItem(101) == nil and inventory.getContents(101) == nil)
    world.disconnect()
    assert(not inventory.status().connected and inventory.getItem(201) == nil)
    local before = #world.commands
    consumer.client.stop(); consumer.client.stop(); world.tick(60000)
    assert(#world.commands == before and not inventory.status().available)
    for _, message in ipairs(world.sent) do assert(message.package ~= "config invmon off") end
  `,
  'separate sessions never share inventory records': `
    local first, inventoryA = loadedInventory("session-a")
    local second, inventoryB = startInventory("session-b")
    frame(second, "invdata", { "700,,a different bag,1,11,0,-1,-1" }); frame(second, "eqdata")
    assert(inventoryA.getItem(101) and inventoryA.getItem(700) == nil)
    assert(inventoryB.getItem(700) and inventoryB.getItem(101) == nil)
    first.disconnect(); assert(inventoryB.status().connected and inventoryB.getItem(700))
  `,
  'valid inventories larger than the generic copy entry budget remain complete': `
    local world, inventory = startInventory()
    world.line("{invdata}")
    for id = 1, 1000 do world.line(tostring(id) .. ",,item " .. tostring(id) .. ",1,10,0,-1,-1") end
    world.line("{/invdata}"); world.tick(1); frame(world, "eqdata")
    local snapshot = inventory.get()
    assert(#snapshot.scopes.inventory.entries == 1000)
    assert(snapshot.items["1000"].name == "item 1000")
    snapshot.items["1000"].name = "changed"
    assert(inventory.getItem(1000).name == "item 1000")
  `,
  'stale generation replies cannot restore a previous connection inventory': `
    local world, inventory, consumer, core = loadedInventory()
    local prior
    local original = core.env.broadcastToPlugin
    core.env.broadcastToPlugin = function(target, message, data)
      if target == consumer.id and message == "aardwolf-api:inventory-scope" then prior = data end
      original(target, message, data)
    end
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101", { "301,,an old map,1,10,0,-1,-1" })
    assert(prior)
    world.disconnect(); world.connect()
    world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    for _, callback in ipairs(consumer.broadcasts) do callback(core.id, "aardwolf-api:inventory-scope", prior) end
    assert(inventory.getItem(301) == nil and inventory.getContents(101) == nil)
  `,
  'inventory messages require the discovered provider and a valid record schema': `
    local world, inventory, consumer, core = loadedInventory()
    local prior
    local original = core.env.broadcastToPlugin
    core.env.broadcastToPlugin = function(target, message, data)
      if target == consumer.id and message == "aardwolf-api:inventory-scope" then prior = data end
      original(target, message, data)
    end
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101", { "301,,a valid map,1,10,0,-1,-1" })
    local packet = json.decode(prior)
    packet.scope.entries[1].name = "forged map"
    local outsider = world.context("outsider", "Unrelated Plugin")
    outsider.host.broadcastToPlugin(consumer.id, "aardwolf-api:inventory-scope", json.encode(packet))
    assert(inventory.getItem(301).name == "a valid map")
    packet.scope.entries[1].id = -1
    original(consumer.id, "aardwolf-api:inventory-scope", json.encode(packet))
    assert(inventory.getItem(301).name == "a valid map")
  `,
  'losing a scanned bag removes descendants and cached details': `
    local world, inventory = loadedInventory()
    inventory.lookIn(101); world.tick(1)
    frame(world, "invdata 101", { "301,,a small pouch,1,11,0,-1,-1", "302,,a map,1,10,0,-1,-1" })
    inventory.lookIn(301); world.tick(1); frame(world, "invdata 301", { "401,,a ruby,1,6,0,-1,-1" })
    -- Seed unsolicited details to exercise descendant-cache invalidation.
    -- Owned details requests correctly refuse items still inside a bag.
    frame(world, "invdetails", { "{invheader}301|1|Container|100|2|none||Fixture||-1|||1" })
    frame(world, "invdetails", { "{invheader}401|1|Treasure|100|2|none||Fixture||-1|||1" })
    assert(inventory.getDetails(301) and inventory.getDetails(401))
    world.line("{invmon}3,101,-1,-1")
    for _, id in ipairs({ 101, 301, 302, 401 }) do assert(inventory.getItem(id) == nil and inventory.getDetails(id) == nil) end
    for _, id in ipairs({ 101, 301 }) do
      local contents = inventory.getContents(id)
      assert(contents == nil or (not contents.known and #contents.entries == 0))
    end
    assert(inventory.getItem(201) and inventory.getItem(202))
  `,
  'late invitem cannot resurrect a lost item but new gain and fresh listing can': `
    local world, inventory = loadedInventory()
    world.line("{invmon}3,103,-1,-1")
    world.line("{invitem}103,M,a silver dagger,40,5,1,-1,600")
    assert(inventory.getItem(103) == nil, "late invitem resurrected lost item")
    world.line("{invmon}4,103,-1,-1")
    world.line("{invitem}103,M,a silver dagger,40,5,1,-1,600")
    assert(inventory.getItem(103) and inventory.getItem(103).location == "inventory", "new gain did not restore item")
    -- Unknown gains can reconcile equipment and inventory in either order.
    for index = 1, 2 do
      if world.commands[#world.commands] == "invdata" then
        frame(world, "invdata", { "101,KG,@GCanvas, travel bag@w,50,11,0,-1,-1", "103,M,a silver dagger,40,5,1,-1,600" })
      else frame(world, "eqdata", { "201,K,a worn satchel,30,11,0,12,-1", "202,G,a golden helm,40,7,0,6,-1" }) end
    end
    world.line("{invmon}3,103,-1,-1")
    assert(inventory.refresh(), "fresh listing request rejected"); world.tick(1)
    frame(world, "invdata", { "103,M,a silver dagger,40,5,1,-1,600" }); frame(world, "eqdata")
    assert(inventory.getItem(103) and inventory.getItem(103).name == "a silver dagger", "fresh listing did not restore item")
  `,
  'duplicate action request messages dispatch the object command exactly once': `
    local world, inventory, consumer, core = loadedInventory()
    local encoded
    local original = consumer.host.broadcastToPlugin
    consumer.host.broadcastToPlugin = function(target, message, data)
      if message == "aardwolf-api:inventory-request" then encoded = data end
      return original(target, message, data)
    end
    local requestId = inventory.drop(103)
    assert(requestId and encoded and countCommand(world, "drop 103") == 1)
    original(core.id, "aardwolf-api:inventory-request", encoded)
    original(core.id, "aardwolf-api:inventory-request", encoded)
    assert(countCommand(world, "drop 103") == 1)
  `,
  'stopping or disconnecting a pending read delivers one failed result': `
    for _, boundary in ipairs({ "stop", "disconnect" }) do
      local world, inventory, consumer = loadedInventory()
      local results = {}; inventory.onResult(function(result) table.insert(results, result) end)
      local requestId = inventory.lookIn(101); world.tick(1)
      if boundary == "stop" then consumer.client.stop() else world.disconnect() end
      local failures = 0
      for _, result in ipairs(results) do
        if result.requestId == requestId then assert(result.outcome == "failed"); failures = failures + 1 end
      end
      assert(failures == 1)
      local before = #world.commands
      world.tick(60000); world.line("{invdata 101}"); world.line("301,,an obsolete map,1,10,0,-1,-1"); world.line("{/invdata}")
      assert(#world.commands == before and inventory.getItem(301) == nil)
    end
  `,
  'consumer-before-Core startup discovers inventory and reattachment discards old scopes': `
    local world = newWorld()
    local consumer = world.consumer("early-reader", { "Char" }, { inventory = true })
    local inventory = consumer.client.inventory
    assert(not inventory.status().available)
    world.core(); world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    for _, line in ipairs(inventoryFixture()) do world.line(line); world.tick(1) end
    assert(inventory.status().available and inventory.getItem(101))
    inventory.lookIn(101); world.tick(1); frame(world, "invdata 101", { "301,,a map,1,10,0,-1,-1" })
    world.event("reattached")
    assert(inventory.getItem(101) == nil and inventory.getItem(301) == nil and inventory.getContents(101) == nil)
  `,
  'stopping from an inventory reset subscriber cannot resurrect availability': `
    local world, inventory, consumer = loadedInventory()
    local armed = true
    inventory.on(function()
      if armed then armed = false; consumer.client.stop() end
    end)
    world.packet("char.base", { name = "Other" })
    assert(not inventory.status().available and not inventory.status().connected)
    assert(inventory.getItem(101) == nil and not inventory.refresh())
  `,
  'older Core replies report inventory unavailable without attempting commands': `
    local world = newWorld()
    local old = world.context("old-core", "Aardwolf API Core")
    old.host.onPluginBroadcast(function(sender, message)
      if message == "aardwolf-api:register" then
        old.host.broadcastToPlugin(sender, "aardwolf-api:state", json.encode({ version = 1,
          session = { connected = true, negotiated = true }, snapshots = {} }))
      end
    end)
    local consumer = world.consumer("reader", { "Char" }, { inventory = true })
    assert(consumer.client.status().available and not consumer.client.inventory.status().available)
    assert(not consumer.client.inventory.refresh() and #world.commands == 0)
  `,
};

for (const [name, source] of Object.entries(cases)) {
  test(name, () => runLua(`${helpers}\n${source}`, { inventoryFixture: () => fixture }));
}
