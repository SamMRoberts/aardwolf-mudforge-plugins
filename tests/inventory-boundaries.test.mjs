import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const helpers = `
  local function frame(world, header, rows)
    world.line("{" .. header .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(header == "eqdata" and "{/eqdata}" or "{/invdata}")
  end
  local function ready()
    local world = newWorld()
    local core = world.core()
    local consumer = world.consumer("reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    frame(world, "invdata", { "101,,a bag,1,11,0,-1,-1", "103,,a dagger,1,5,0,-1,-1" })
    frame(world, "eqdata")
    return world, consumer.client.inventory, consumer, core
  end
  local function nearLimitFrame(world, header)
    local opening = "{" .. header .. "}"
    world.line(opening)
    local bytes, id = #opening, 1000
    if header == "invdetails" then
      local row = "{invheader}101|1|Container|10|1|none||Fixture||-1|||1"
      world.line(row); bytes = bytes + #row + 1
    end
    while bytes < 1048574 do
      local prefix = header == "invdetails" and "{invextra}" or tostring(id) .. ",,"
      local suffix = header == "invdetails" and "" or ",1,10,0,-1,-1"
      local size = math.min(header == "invdetails" and 65000 or 4000,
        1048574 - bytes - #prefix - #suffix - 1)
      assert(size > 0)
      local row = prefix .. string.rep("x", size) .. suffix
      world.line(row); bytes, id = bytes + #row + 1, id + 1
    end
  end
`;

const cases = {
  'an oversized carried inventory footer fails safely and allows a fresh explicit request': `
    local world, inventory = ready()
    local results = {}; inventory.onResult(function(value) table.insert(results, value) end)
    local requestId = inventory.refresh()
    nearLimitFrame(world, "invdata"); world.line("{/invdata}")
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(string.find(results[#results].reason, "1 MiB", 1, true))
    assert(inventory.getItem(101) and inventory.get().scopes.inventory.stale)
    frame(world, "eqdata")
    assert(not inventory.status().collecting, "The already-received footer left a drain barrier")
    inventory.refresh()
    frame(world, "invdata", { "101,,a refreshed bag,1,11,0,-1,-1" }); frame(world, "eqdata")
    assert(not inventory.status().collecting and not inventory.get().scopes.inventory.stale)
    assert(inventory.getItem(101).name == "a refreshed bag")
  `,
  'an oversized equipment footer preserves stale equipment and permits an explicit refresh': `
    local world, inventory = ready()
    frame(world, "eqdata", { "201,,a worn helm,1,7,0,6,-1" })
    inventory.refresh()
    frame(world, "invdata", { "101,,a bag,1,11,0,-1,-1" })
    nearLimitFrame(world, "eqdata"); world.line("{/eqdata}")
    assert(inventory.getItem(201) and inventory.get().scopes.equipment.stale)
    assert(not inventory.status().collecting)
    inventory.refresh(); frame(world, "invdata", { "101,,a bag,1,11,0,-1,-1" })
    frame(world, "eqdata", { "201,,a refreshed helm,1,7,0,6,-1" })
    assert(not inventory.get().scopes.equipment.stale and inventory.getItem(201).name == "a refreshed helm")
  `,
  'an oversized container footer preserves stale contents and permits another explicit read': `
    local world, inventory = ready()
    inventory.lookIn(101); frame(world, "invdata 101", { "301,,a ruby,1,6,0,-1,-1" })
    inventory.lookIn(101); nearLimitFrame(world, "invdata 101"); world.line("{/invdata}")
    assert(inventory.getItem(301) and inventory.getContents(101).stale)
    assert(not inventory.status().collecting)
    inventory.lookIn(101); frame(world, "invdata 101", { "302,,a sapphire,1,6,0,-1,-1" })
    assert(not inventory.getContents(101).stale and inventory.getItem(302) and not inventory.getItem(301))
  `,
  'an oversized details footer preserves prior details and permits another explicit identify': `
    local world, inventory = ready()
    inventory.identify(101)
    world.line("{invdetails}"); world.line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1"); world.line("{/invdetails}")
    inventory.identify(101); nearLimitFrame(world, "invdetails"); world.line("{/invdetails}")
    assert(inventory.getDetails(101).value == 10 and not inventory.status().collecting)
    inventory.identify(101)
    world.line("{invdetails}"); world.line("{invheader}101|1|Container|20|1|none||Fixture||-1|||1"); world.line("{/invdetails}")
    assert(inventory.getDetails(101).value == 20 and not inventory.status().collecting)
  `,
  'a mismatched footer crossing the size limit still waits for the matching footer': `
    local world, inventory = ready()
    inventory.lookIn(101); nearLimitFrame(world, "invdata 101"); world.line("{/eqdata}")
    assert(inventory.status().collecting)
    local before = #world.commands; inventory.refresh()
    assert(#world.commands == before)
    world.line("{/invdata}")
    assert(not inventory.status().collecting)
  `,
  'large object IDs and server flag and color combinations complete both listings': `
    local world, inventory = ready()
    inventory.refresh()
    frame(world, "invdata", {
      "3950000001,NKGH,@GAn example bag@w,200,11,1,-1,-1",
      "3950000002,NC,@G(@WPolished@G)@w a robe,99,7,1,-1,-1"
    })
    frame(world, "eqdata", { "3950000003,NIH,@x250An example weapon@w ,71,5,1,27,-1" })
    assert(not inventory.status().collecting and inventory.status().error == nil)
    assert(inventory.getItem(3950000001).type == 11)
    assert(inventory.getItem(3950000003).wearLocation == 27)
    inventory.lookIn(3950000001)
    assert(world.commands[#world.commands] == "invdata 3950000001")
    frame(world, "invdata 3950000001")
    assert(inventory.getContents(3950000001).known)
  `,
  'whitespace around inventory tags does not hide complete replies or alter item text': `
    local world, inventory = ready()
    inventory.refresh()
    world.line("  {invdata}  ")
    world.line("101,,  a bag  ,1,11,0,-1,-1")
    world.line("  {/invdata}  ")
    world.line("\\t{eqdata}\\r")
    world.line("\\t{/eqdata}\\r")
    assert(not inventory.status().collecting and inventory.status().error == nil)
    assert(inventory.getItem(101).name == "  a bag  ")
    inventory.lookIn(101)
    world.line("  {invdata 101}  "); world.line("  {/invdata}  ")
    assert(inventory.getContents(101).known and not inventory.getContents(101).stale)
    inventory.identify(101)
    world.line("  {invdetails}  ")
    world.line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1")
    world.line("{invextra}   ")
    world.line("  {/invdetails}  ")
    assert(inventory.getDetails(101).tags[1].value == "   ")
  `,
  'whitespace around normalized tags still counts toward the frame size limit': `
    local world, inventory = ready()
    inventory.refresh()
    world.line(string.rep(" ", 1048576) .. "{invdata}")
    world.line("{/invdata}")
    assert(inventory.getItem(101) and inventory.get().scopes.inventory.stale)
    assert(string.find(inventory.status().error, "1 MiB", 1, true))
  `,
  'draining a timed out reply clears obsolete waiting feedback and preserves stale data': `
    local world, inventory = ready()
    inventory.refresh(); world.tick(10001)
    assert(string.find(inventory.status().error, "invdata", 1, true))
    assert(string.find(inventory.status().error, "opening tag", 1, true))
    world.line("  {/eqdata}  ")
    assert(inventory.status().collecting)
    world.line("  {/invdata}  ")
    assert(not inventory.status().collecting and inventory.status().error == nil)
    assert(inventory.getItem(101) and inventory.get().scopes.inventory.stale)
    inventory.refresh(); world.line("{invdata}"); world.tick(10001)
    assert(string.find(inventory.status().error, "closing tag", 1, true))
  `,
  'manual interruption drains both replies before another owned read can complete': `
    local world, inventory, consumer = ready()
    local results = {}; inventory.onResult(function(value) table.insert(results, value) end)
    local interrupted = inventory.refresh()
    consumer.host.send("invdata")
    local before = #world.commands
    frame(world, "invdata", { "999,,old output,1,10,0,-1,-1" })
    local blocked = inventory.refresh()
    assert(blocked and results[#results].requestId == blocked and results[#results].outcome == "failed")
    assert(#world.commands == before and inventory.getItem(999) == nil)
    frame(world, "invdata", { "998,,manual output,1,10,0,-1,-1" })
    assert(not inventory.status().collecting and inventory.getItem(998) == nil)
    local fresh = inventory.refresh()
    frame(world, "invdata", { "501,,new output,1,10,0,-1,-1" }); frame(world, "eqdata")
    assert(inventory.getItem(501) and results[#results].requestId == fresh and results[#results].outcome == "complete")
    for _, value in ipairs(results) do assert(value.requestId ~= interrupted or value.outcome == "failed") end
  `,
  'a different closing tag cannot release an interrupted container reply': `
    local world, inventory = ready()
    inventory.lookIn(101); world.tick(10001)
    world.line("{/eqdata}")
    assert(inventory.status().collecting and not inventory.drop(103))
    world.line("{/invdata}")
    assert(not inventory.status().collecting and inventory.drop(103))
  `,
  'stopping inside registration leaves no ghost inventory consumer': `
    local world = newWorld(); world.core()
    local context = world.context("early-stop", "Early Stop")
    local client = freshLibrary().new(context.host, { inventory = true })
    client.on("session", function(status) if status.available then client.stop() end end)
    client.start()
    assert(not client.status().available and not client.inventory.status().available)
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    assert(#world.commands == 0)
  `,
  'negotiation loss prevents actions inside the session callback': `
    local world, inventory, consumer = ready()
    local attempted = false
    consumer.client.on("session", function(status)
      if status.available and not status.negotiated then
        attempted = true; assert(not inventory.drop(103))
      end
    end)
    world.context("aw-core", "Aardwolf Core")
    world.consumer("group-reader", { "Group" })
    local before = #world.commands
    world.tick(5001)
    assert(attempted and #world.commands == before)
  `,
  'replacement listings purge omitted bag contents even without monitor events': `
    local world, inventory = ready()
    inventory.lookIn(101)
    frame(world, "invdata 101", { "301,,a ruby,1,6,0,-1,-1" })
    -- An unsolicited detail frame seeds the cache; an owned request for a
    -- bagged item is refused before sending invdetails.
    world.line("{invdetails}"); world.line("{invheader}301|1|Treasure|10|1|none|||none|-1|||1"); world.line("{/invdetails}")
    assert(inventory.getDetails(301))
    inventory.refresh(); frame(world, "invdata", { "103,,a dagger,1,5,0,-1,-1" }); frame(world, "eqdata")
    assert(not inventory.getItem(101) and not inventory.getItem(301) and not inventory.getDetails(301))
    local scope = inventory.getContents(101)
    assert(not scope or (not scope.known and #scope.entries == 0))
  `,
  'invalid detail fields fail the request while retaining the prior detail': `
    local world, inventory = ready()
    local results = {}; inventory.onResult(function(value) table.insert(results, value) end)
    inventory.identify(101)
    world.line("{invdetails}"); world.line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1"); world.line("{/invdetails}")
    assert(inventory.getDetails(101).owner == "Fixture")
    local requestId = inventory.identify(101)
    world.line("{invdetails}")
    world.line("{invheader}101|1|Container|10|1|none||" .. string.rep("x", 4097) .. "||-1|||1")
    world.line("{/invdetails}")
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(inventory.getDetails(101).owner == "Fixture")
  `,
  'monitor output contributes to the active frame byte budget': `
    local world, inventory = ready()
    local results = {}; inventory.onResult(function(value) table.insert(results, value) end)
    inventory.refresh(); world.line("{invdata}")
    world.line("{invitem}" .. string.rep("x", 1048576))
    assert(results[#results].outcome == "failed" and string.find(results[#results].reason, "1 MiB", 1, true))
    assert(inventory.getItem(101) and inventory.get().scopes.inventory.stale)
    world.line("{/invdata}")
  `,
  'restarting in a scope subscriber does not publish old data into the new generation': `
    local world, inventory, consumer = ready()
    local restarted = false
    inventory.on(function(value)
      if not restarted and value.items["501"] then
        restarted = true; consumer.client.stop(); consumer.client.start()
      end
    end)
    inventory.refresh(); frame(world, "invdata", { "501,,old generation,1,10,0,-1,-1" })
    assert(restarted and not inventory.getItem(501))
    frame(world, "invdata", { "601,,new generation,1,10,0,-1,-1" }); frame(world, "eqdata")
    assert(inventory.getItem(601) and not inventory.getItem(501) and not inventory.status().collecting)
  `,
  'restarting from a failed-result callback preserves the new collection queue': `
    local world, inventory, consumer = ready()
    local restarted = false
    inventory.onResult(function(result)
      if not restarted and result.outcome == "failed" then
        restarted = true; consumer.client.stop(); consumer.client.start()
      end
    end)
    inventory.refresh(); world.line("{invdata}"); world.line("malformed row")
    assert(restarted)
    frame(world, "invdata", { "601,,new generation,1,10,0,-1,-1" }); frame(world, "eqdata")
    assert(inventory.getItem(601) and not inventory.status().collecting and world.commands[#world.commands] == "eqdata")
  `,
  'restarting from stop cancellation does not lose the new Core registration': `
    local world, inventory, consumer = ready()
    local restarted = false
    inventory.onResult(function(result)
      if not restarted and result.outcome == "failed" then restarted = true; consumer.client.start() end
    end)
    inventory.lookIn(101); consumer.client.stop()
    assert(restarted and consumer.client.status().available and inventory.status().available)
    frame(world, "invdata", { "601,,new generation,1,10,0,-1,-1" }); frame(world, "eqdata")
    assert(inventory.getItem(601) and not inventory.status().collecting)
  `,
  'a canceled timeout cannot terminate the next read job': `
    local world, inventory = ready()
    inventory.refresh()
    local expired
    for _, timer in pairs(world.timers) do if timer.at == world.time + 10000 then expired = timer.callback end end
    assert(expired)
    frame(world, "invdata", { "501,,a fresh item,1,10,0,-1,-1" })
    expired()
    frame(world, "eqdata")
    assert(inventory.getItem(501) and not inventory.status().collecting and not inventory.status().error)
  `,
  'new character waits for its own status before sending initial commands': `
    local world, inventory = ready()
    local before = #world.commands
    world.packet("char.base", { name = "Another" })
    assert(inventory.getItem(101) == nil and not inventory.status().active and #world.commands == before)
    assert(not inventory.drop(103))
    world.packet("char.status", { state = 3 })
    assert(#world.commands == before + 1 and world.commands[#world.commands] == "invdata")
  `,
};

for (const [name, source] of Object.entries(cases)) {
  test(name, () => runLua(helpers + source));
}
