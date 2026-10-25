import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local function bagged()
    local world, context, env, core = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101", { "3896588735,,a ruby,1,6,0,-1,-1" })
    return world, context, env, core
  end
  local function begin(world)
    world.action(3896588735, "details")
    local prompt = world.state("manager").prompt
    assert(prompt and prompt.kind == "details", "Bagged details must explain retrieval before sending")
    assert(#prompt.steps == 3 and world.count("invdetails 3896588735") == 0)
    world.submit(); world.tick(2)
    assert(world.count("get 3896588735 101") == 1 and world.count("invdetails 3896588735") == 0)
  end
`;

const cases = {
  'reported potion details reach the manager and complete bag restoration': `
    local world = bagged(); begin(world); world.monitor(5, "3896588735", 101)
    world.frame("invdetails", { "{invheader}3896588735|105|Potion|1680|13||unique, glow, hum, magic, burn-proof, v3, searchable||Boot Lyceum|||||0" })
    local details = world.state("manager").details
    assert(details and details.id == 3896588735 and details.itemType == "Potion")
    assert(details.fromClanName == "Boot Lyceum" and details.timer == nil and details.itemScore == 0)
    assert(world.count("put 3896588735 101") == 1)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").busy and world.state("manager").details.id == 3896588735)
    assert(string.find(world.state("manager").feedback, "Item details refreshed", 1, true))
  `,
  'bagged details wait for retrieval, read once and return to the original bag': `
    local world = bagged(); begin(world)
    world.monitor(5, "3896588735", 101)
    assert(world.count("invdetails 3896588735") == 1 and world.state("manager").busy)
    world.frame("invdetails", { "{invheader}3896588735|1|Treasure|10|1|none||Fixture||-1|||1" })
    assert(world.state("manager").details.id == 3896588735 and world.count("put 3896588735 101") == 1)
    assert(world.state("manager").busy)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").busy and world.state("manager").scope == "container:101")
    assert(world.state("manager").details.id == 3896588735)
    assert(world.state("manager").selected == 3896588735)
    assert(string.find(world.state("manager").feedback, "Item details refreshed", 1, true))
    assert(world.count("invdetails 3896588735") == 1 and world.count("get 3896588735 101") == 1)
    world.monitor(5, "3896588735", 101)
    assert(not world.state("manager").details)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").details, "Moving back must not resurrect old details")
  `,
  'dismissing bagged details sends no retrieval or details commands': `
    local world = bagged(); local before = #world.commands
    world.action(3896588735, "details"); world.message("manager", "dismiss"); world.tick(10001)
    assert(#world.commands == before and not world.state("manager").busy)
  `,
  'details confirmation rechecks item location and never retrieves a moved item': `
    local world = bagged(); world.action(3896588735, "details")
    local prompt = world.state("manager").prompt
    world.monitor(5, "3896588735", 101)
    world.message("manager", "submit", { kind = prompt.kind, itemId = prompt.itemId, token = prompt.token })
    world.tick(5)
    assert(world.count("get 3896588735 101") == 0 and world.count("invdetails 3896588735") == 0)
  `,
  'cancelling after retrieval restores the bagged item without reading details': `
    local world = bagged(); begin(world)
    world.message("manager", "cancel"); world.monitor(5, "3896588735", 101)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "3896588735,,a ruby,1,6,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(world.count("put 3896588735 101") == 1 and world.count("invdetails 3896588735") == 0)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").busy and string.find(world.state("manager").feedback, "Cancelled", 1, true))
  `,
  'failed retrieval never sends details and does not retry the get': `
    local world = bagged(); begin(world); world.tick(10005)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1" }); world.frame("eqdata", {}); world.tick(2)
    assert(not world.state("manager").busy)
    assert(world.count("get 3896588735 101") == 1 and world.count("invdetails 3896588735") == 0)
    assert(world.count("put 3896588735 101") == 0)
  `,
  'cancelling an in-flight details read still returns the item after its response': `
    local world = bagged(); begin(world); world.monitor(5, "3896588735", 101)
    world.message("manager", "cancel")
    assert(world.count("put 3896588735 101") == 0)
    world.frame("invdetails", { "{invheader}3896588735|1|Treasure|10|1|none||Fixture||-1|||1" })
    assert(world.count("put 3896588735 101") == 1)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").busy and world.state("manager").details.id == 3896588735)
    assert(string.find(world.state("manager").feedback, "Cancelled", 1, true))
  `,
  'nested bag details require an accessible containing bag before any retrieval': `
    local world = bagged()
    world.frame("invdata 101", { "301,,a nested bag,1,11,0,-1,-1" })
    world.open("container:301"); world.frame("invdata 301", { "401,,a ruby,1,6,0,-1,-1" })
    local before = #world.commands; world.action(401, "details"); world.tick(2)
    assert(#world.commands == before and not world.state("manager").prompt)
    assert(string.find(world.state("manager").feedback, "containing bag", 1, true))
  `,
  'a matching not-found reply fails details and verifies the item before restoration': `
    local world = bagged(); begin(world); world.monitor(5, "3896588735", 101)
    world.line("Item 3896588735 not found.")
    world.tick(2)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "3896588735,,a ruby,1,6,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(world.count("put 3896588735 101") == 1 and world.count("invdetails 3896588735") == 1)
    world.monitor(6, "3896588735", 101)
    assert(not world.state("manager").busy and not world.state("manager").details)
  `,
  'a malformed opened reply stops with manual restoration feedback until its footer drains': `
    local world = bagged(); begin(world); world.monitor(5, "3896588735", 101)
    world.line("{invdetails}"); world.line("{invheader}malformed")
    world.tick(2)
    assert(not world.state("manager").busy and world.count("put 3896588735 101") == 0)
    assert(string.find(world.state("manager").feedback, "Restore the arrangement manually", 1, true))
    world.line("{/invdetails}")
    world.open(); world.action(3896588735, "put")
    world.submit({ containerId = 101 })
    assert(world.count("put 3896588735 101") == 1)
  `,
  'disconnect after retrieval stops details and restoration commands': `
    local world = bagged(); begin(world); world.disconnect(); world.tick(10005)
    assert(not world.state("manager").busy and world.count("invdetails 3896588735") == 0)
    assert(world.count("put 3896588735 101") == 0)
  `,
  'carried and equipped details remain direct reads without moving equipment': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "details")
    assert(not world.state("manager").prompt and world.count("invdetails 103") == 1)
    world.frame("invdetails", { "{invheader}103|1|Potion|10|1|none||Fixture||-1|||1" })
    world.open("equipment"); world.action(202, "details")
    assert(not world.state("manager").prompt and world.count("invdetails 202") == 1 and world.count("remove 202") == 0)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + helpers + source));
