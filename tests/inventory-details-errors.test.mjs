import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

// Injected collector/host behavior; not native MudForge or live Aardwolf evidence.
const helpers = `
  local function ready()
    local world = newWorld(); local core = world.core()
    local reader = world.consumer("details-reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    local function line(text)
      return core.env.onLine(world.id, text, text)
    end
    line("{invdata}"); line("101,,a bag,1,11,0,-1,-1"); line("{/invdata}")
    line("{eqdata}"); line("{/eqdata}")
    local inventory, results = reader.client.inventory, {}
    inventory.onResult(function(value) table.insert(results, value) end)
    return world, inventory, results, core, line
  end
  local function refreshed(inventory, results, line)
    local requestId = inventory.refresh()
    line("{invdata}"); line("101,,a bag,1,11,0,-1,-1"); line("{/invdata}")
    line("{eqdata}"); line("{/eqdata}")
    assert(results[#results].requestId == requestId and results[#results].outcome == "complete")
    assert(not inventory.status().collecting and not inventory.status().error)
  end
`;

const cases = {
  'known bagged items are rejected without an invalid details command or hidden move': `
    local world, inventory, results, core, line = ready()
    inventory.lookIn(101)
    line("{invdata 101}"); line("301,,a ruby,1,6,0,-1,-1"); line("{/invdata}")
    local before = #world.commands
    local requestId = inventory.identify(301)
    assert(#world.commands == before and not inventory.status().collecting)
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(results[#results].reason == "Get the item from its container before requesting details")
    assert(inventory.getItem(301).location == "container:101")
  `,
  'queued details recheck item placement after earlier reads finish': `
    local world, inventory, results, core, line = ready()
    inventory.refresh()
    local requestId = inventory.identify(101)
    line("{invdata}"); line("101,,a bag,1,11,0,-1,-1")
    line("{invmon}6,101,201,-1"); line("{/invdata}")
    line("{eqdata}"); line("{/eqdata}")
    assert(not inventory.status().collecting)
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    for _, command in ipairs(world.commands) do assert(command ~= "invdetails 101") end
  `,
  'matching untagged details rejection fails immediately and permits the next refresh': `
    local world, inventory, results, core, line = ready()
    local requestId = inventory.identify(3896588735)
    assert(line("Item 3896588735 not found.") ~= false)
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(results[#results].reason == "Item 3896588735 not found.")
    assert(not inventory.status().collecting and inventory.getItem(101))
    world.tick(10001)
    assert(#results == 1)
    refreshed(inventory, results, line)
  `,
  'a rejected refresh of item details preserves the last complete details': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101)
    line("{invdetails}"); line("{invheader}101|1|Container|10|1|none||Fixture||-1|||1"); line("{/invdetails}")
    local requestId = inventory.identify(101)
    line("  Item 101 not found.  ")
    assert(results[#results].requestId == requestId and results[#results].outcome == "failed")
    assert(inventory.getDetails(101).owner == "Fixture" and not inventory.status().collecting)
  `,
  'a matching late rejection releases an unopened timed-out details reply': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101); world.tick(10001)
    assert(inventory.status().collecting and #results == 1 and results[1].outcome == "failed")
    assert(line("Item 101 not found.") ~= false)
    assert(not inventory.status().collecting and not inventory.status().error and #results == 1)
    refreshed(inventory, results, line)
  `,
  'unrelated errors and item IDs cannot finish an unopened details request': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101)
    for _, text in ipairs({ "Item 102 not found.", "You cannot do that here.", "Item 101 not found. extra", "item 101 not found.", "Item 101 not found" }) do
      assert(line(text) ~= false)
      assert(inventory.status().collecting and #results == 0)
    end
    line("Item 101 not found.")
    assert(not inventory.status().collecting and #results == 1)
  `,
  'not-found output inside an opened frame still requires its closing tag': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101); line("{invdetails}")
    assert(line("Item 101 not found.") ~= false)
    assert(inventory.status().collecting and #results == 1)
    line("Item 101 not found.")
    assert(inventory.status().collecting)
    line("{/invdetails}")
    assert(not inventory.status().collecting)
    inventory.identify(101); line("{invdetails}"); world.tick(10001)
    line("Item 101 not found."); assert(inventory.status().collecting)
    line("{/invdetails}"); assert(not inventory.status().collecting)
  `,
  'idle manual details rejections remain visible and do not block future reads': `
    local world, inventory, results, core, line = ready()
    core.host.send("invdetails 101")
    assert(line("Item 101 not found.") ~= false)
    assert(not inventory.status().collecting and #results == 0)
    refreshed(inventory, results, line)
  `,
  'manual interruption drains an owned details rejection and then its manual frame': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101); core.host.send("eqdata")
    assert(#results == 1 and results[1].outcome == "failed")
    line("Item 101 not found.")
    assert(inventory.status().collecting)
    line("{eqdata}"); line("{/eqdata}")
    assert(not inventory.status().collecting)
    refreshed(inventory, results, line)
  `,
  'manual details rejection cannot satisfy an older scope reply or a different item': `
    local world, inventory, results, core, line = ready()
    inventory.lookIn(101); core.host.send("invdetails 201")
    line("Item 201 not found."); assert(inventory.status().collecting)
    line("{invdata 101}"); line("{/invdata}")
    line("Item 101 not found."); assert(inventory.status().collecting)
    line("Item 201 not found."); assert(not inventory.status().collecting)
    refreshed(inventory, results, line)
  `,
  'opened manually interrupted details reject errors until their footer drains': `
    local world, inventory, results, core, line = ready()
    inventory.identify(101); line("{invdetails}"); core.host.send("invdetails 201")
    line("Item 101 not found."); assert(inventory.status().collecting)
    line("{/invdetails}"); assert(inventory.status().collecting)
    line("Item 201 not found."); assert(not inventory.status().collecting)
    refreshed(inventory, results, line)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(helpers + source));
