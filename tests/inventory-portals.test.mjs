import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

// Offline controller/Core integration; not native transport or live travel evidence.
const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local function row(id, kind, slot)
    return tostring(id) .. ",,fixture item " .. tostring(id) .. ",1," .. tostring(kind) .. ",0," .. tostring(slot or -1) .. ",-1"
  end
  local bag = row(101,11)
  local primary = row(203,5,24)
  local function portalWorld(equipment, location)
    local world, context, env, core = inventoryWorld()
    world.active()
    local carried = { bag }
    if location ~= "equipment" and location ~= "bag" then table.insert(carried,row(301,20)) end
    world.frame("invdata",carried)
    local equipped = { primary }
    for _, entry in ipairs(equipment or {}) do table.insert(equipped,entry) end
    world.frame("eqdata",equipped)
    world.open(location == "equipment" and "equipment" or location == "bag" and "container:101" or "inventory")
    if location == "bag" then world.frame("invdata 101", { row(301,20) }) end
    return world, context, env, core
  end
  local function start(world)
    world.action(301,"enter")
    local prompt = world.state("manager").prompt
    assert(prompt and prompt.action == "enter", "Portal Enter preparation was not offered")
    assert(world.count("wearable") == 0 and world.count("enter") == 0, "Selection sent commands before confirmation")
    world.submit(); world.tick(2)
    assert(world.count("wearable") == 1, "Confirmed Enter did not discover wear slots")
    assert(world.count("hold 301") == 0 and world.count("enter") == 0, "Equipment changed before discovery completed")
  end
  local function discover(world,equipment,wish)
    world.line("Num Keyword       Description                     Wear Flag")
    world.line("--- ------------  -----------------------------  ----------")
    world.line(" 22 feet [ Worn on hooves ]: feet")
    world.line(" 23 shield [ Worn as shield ]: shield")
    world.line(" 24 wielded [ Primary Weapon ]: wield")
    world.line(" 25 second [ Off-Hand Weapon ]: wield")
    world.line(" 26 hold [ Held ]: hold")
    world.line(" 30 above [ Floating above ]: above")
    if wish then world.line(" 31 portal [ Portal ]: portal") end
    world.line(" 32 sleeping [ Sleeping ]: sleeping")
    world.line("An arbitrary custom prompt without brackets")
    assert(world.count("hold 301") == 0 and world.count("enter") == 0)
    local equipped = { primary }
    for _, entry in ipairs(equipment or {}) do table.insert(equipped,entry) end
    world.frame("eqdata",equipped); world.tick(2)
  end
  local function settle(world,carried,equipment)
    local entries = { bag }
    for _, entry in ipairs(carried or {}) do table.insert(entries,entry) end
    world.frame("invdata",entries)
    local equipped = { primary }
    for _, entry in ipairs(equipment or {}) do table.insert(equipped,entry) end
    world.frame("eqdata",equipped); world.tick(2)
  end
  local function gameplay(world,expected)
    local actual = {}
    for _, command in ipairs(world.commands) do
      if command ~= "wearable" and command ~= "eqdata" and not string.match(command,"^invdata") then table.insert(actual,command) end
    end
    assert(table.concat(actual,"|") == table.concat(expected,"|"), table.concat(actual,"|"))
    assert(world.count("remove 203") == 0 and world.count("hold 203") == 0 and world.count("dual 203") == 0, "Primary weapon changed")
  end
`;

for (const [name, kind, slot, restore] of [
  ['held item', 4, 26, 'hold'],
  ['shield', 7, 23, 'wear'],
  ['secondary weapon', 5, 25, 'dual'],
]) {
  test(`portal restores a displaced ${name} after each observed step without manual slot setup`, () => runLua(`${fixture}\n${helpers}\n
    local world = portalWorld({ row(202,${kind},${slot}) })
    start(world); discover(world,{ row(202,${kind},${slot}) })
    gameplay(world,{ "remove 202" })
    world.tick(20); assert(world.count("hold 301") == 0)
    world.monitor(1,202)
    gameplay(world,{ "remove 202", "hold 301" })
    world.tick(20); assert(world.count("enter") == 0)
    world.monitor(2,301,-1,26)
    gameplay(world,{ "remove 202", "hold 301", "enter" })
    settle(world,{ row(202,${kind}) },{ row(301,20,26) })
    assert(world.count("remove 301") == 1 and world.count("${restore} 202") == 0)
    world.monitor(1,301)
    assert(world.count("${restore} 202") == 1 and world.state("manager").busy)
    world.monitor(2,202,-1,${slot})
    assert(not world.state("manager").busy)
    gameplay(world,{ "remove 202", "hold 301", "enter", "remove 301", "${restore} 202" })
  `));
}

const cases = {
  'multiple competing off-hand occupants are rejected before changing any equipment': `
    for _, selectedEquipped in ipairs({ false, true }) do
      local equipment = selectedEquipped and { row(301,20,26),row(202,5,25) }
        or { row(202,4,26),row(204,7,23) }
      local world = portalWorld(equipment,selectedEquipped and "equipment" or "inventory")
      start(world); discover(world,equipment); world.tick(20)
      assert(not world.state("manager").busy)
      gameplay(world,{})
      assert(world.state("manager").feedback ~= "")
    end
  `,
  'portal leaves an originally empty off-hand empty and does not repeat Enter': `
    local world = portalWorld()
    start(world); discover(world)
    gameplay(world,{ "hold 301" })
    world.monitor(2,301,-1,26)
    settle(world,{}, { row(301,20,26) })
    world.monitor(1,301)
    assert(not world.state("manager").busy)
    world.tick(60000)
    gameplay(world,{ "hold 301", "enter", "remove 301" })
  `,
  'Portal wish replaces the prior portal and leaves a dual-wielded weapon equipped': `
    local world = portalWorld({ row(202,20,31),row(204,5,25) })
    start(world); discover(world,{ row(202,20,31),row(204,5,25) },true)
    gameplay(world,{ "remove 202" })
    world.monitor(1,202); world.monitor(2,301,-1,31)
    settle(world,{ row(202,20) },{ row(301,20,31),row(204,5,25) })
    world.monitor(1,301); world.monitor(2,202,-1,31)
    assert(not world.state("manager").busy and world.count("remove 204") == 0)
    gameplay(world,{ "remove 202", "hold 301", "enter", "remove 301", "hold 202" })
  `,
  'an already-equipped portal is entered without removal or re-equipping': `
    local world = portalWorld({ row(301,20,26) },"equipment")
    start(world); discover(world,{ row(301,20,26) })
    assert(world.count("enter") == 1)
    settle(world,{}, { row(301,20,26) })
    assert(not world.state("manager").busy)
    gameplay(world,{ "enter" })
  `,
  'bagged portal retrieval and return are observed around secondary-weapon restoration': `
    local world = portalWorld({ row(202,5,25) },"bag")
    start(world); discover(world,{ row(202,5,25) })
    gameplay(world,{ "get 301 101" })
    world.monitor(5,301,101); world.monitor(1,202); world.monitor(2,301,-1,26)
    settle(world,{ row(202,5) },{ row(301,20,26) })
    world.monitor(1,301); world.monitor(2,202,-1,25)
    assert(world.count("put 301 101") == 1 and world.state("manager").busy)
    world.monitor(6,301,101)
    assert(not world.state("manager").busy)
    gameplay(world,{ "get 301 101", "remove 202", "hold 301", "enter", "remove 301", "dual 202", "put 301 101" })
  `,
  'a consumed portal still restores the prior shield without removing a missing item': `
    local world = portalWorld({ row(202,7,23) })
    start(world); discover(world,{ row(202,7,23) })
    world.monitor(1,202); world.monitor(2,301,-1,26)
    world.monitor(7,301)
    settle(world,{ row(202,7) })
    assert(world.count("wear 202") == 1 and world.count("remove 301") == 0)
    world.monitor(2,202,-1,23)
    assert(not world.state("manager").busy)
    gameplay(world,{ "remove 202", "hold 301", "enter", "wear 202" })
  `,
  'cancelling during discovery performs no equipment commands': `
    local world = portalWorld({ row(202,5,25) })
    start(world); world.message("manager","cancel")
    discover(world,{ row(202,5,25) }); world.tick(20)
    assert(not world.state("manager").busy)
    gameplay(world,{})
  `,
  'cancelling after removal restores the secondary weapon without holding or entering the portal': `
    local world = portalWorld({ row(202,5,25) })
    start(world); discover(world,{ row(202,5,25) })
    world.message("manager","cancel"); world.monitor(1,202)
    settle(world,{ row(202,5),row(301,20) })
    assert(world.count("dual 202") == 1)
    world.monitor(2,202,-1,25)
    assert(not world.state("manager").busy)
    gameplay(world,{ "remove 202", "dual 202" })
  `,
  'a previous item moved manually into its bag is not retrieved for restoration': `
    local world = portalWorld({ row(202,5,25) })
    start(world); discover(world,{ row(202,5,25) })
    world.monitor(1,202); world.monitor(2,301,-1,26)
    world.line("{invmon}6,202,101,-1")
    settle(world,{}, { row(301,20,26) })
    world.monitor(1,301)
    assert(not world.state("manager").busy and world.count("dual 202") == 0 and world.count("get 202 101") == 0)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'a missing original bag does not prevent safe shield restoration': `
    local world = portalWorld({ row(202,7,23) },"bag")
    start(world); discover(world,{ row(202,7,23) })
    world.monitor(5,301,101); world.monitor(1,202); world.monitor(2,301,-1,26)
    world.frame("invdata",{ row(202,7) })
    world.frame("eqdata",{ primary,row(301,20,26) }); world.tick(2)
    world.monitor(1,301); world.monitor(2,202,-1,23)
    assert(not world.state("manager").busy and world.count("wear 202") == 1 and world.count("put 301 101") == 0)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'a level decrease during slot discovery prevents all equipment changes': `
    local world = portalWorld({ row(202,5,25) })
    world.packet("char.status",{ level = 10 })
    start(world)
    world.line("{invitem}301,,fixture portal,10,20,0,-1,-1")
    world.packet("char.status",{ level = 1 })
    discover(world,{ row(202,5,25) }); world.tick(20)
    gameplay(world,{})
    assert(not world.state("manager").busy)
  `,
  'disconnect and character change invalidate pending portal preparation': `
    for _, change in ipairs({ "disconnect", "identity" }) do
      local world = portalWorld({ row(202,5,25) })
      start(world); discover(world,{ row(202,5,25) })
      assert(world.count("remove 202") == 1)
      if change == "disconnect" then world.disconnect()
      else world.packet("char.base",{ name = "Other" }); world.packet("char.status",{ state = 3 }) end
      world.tick(30000)
      assert(world.count("hold 301") == 0 and world.count("enter") == 0 and world.count("dual 202") == 0)
      assert(not world.state("manager").busy)
    end
  `,
  'a refused preparation removal is not retried and never enters the portal': `
    local world, context, env, core = portalWorld({ row(202,5,25) })
    local previous, attempts = core.env.onSend, 0
    core.env.onSend = function(sessionId,command)
      if command == "remove 202" then attempts = attempts + 1; return false end
      return previous(sessionId,command)
    end
    start(world); discover(world,{ row(202,5,25) })
    settle(world,{ row(301,20) },{ row(202,5,25) })
    world.tick(100)
    assert(attempts == 1 and not world.state("manager").busy)
    gameplay(world,{})
  `,
  'a portal observed in another equipment slot is never entered or removed there': `
    local world = portalWorld({ row(202,5,25) })
    start(world); discover(world,{ row(202,5,25) })
    world.monitor(1,202); world.monitor(2,301,-1,27)
    assert(world.count("enter") == 0)
    world.tick(10005)
    settle(world,{ row(202,5) },{ row(301,20,27) })
    assert(world.count("remove 301") == 0 and world.count("dual 202") == 1)
    world.monitor(2,202,-1,25)
    assert(not world.state("manager").busy)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'a new off-hand occupant is preserved instead of being overwritten during restoration': `
    local world = portalWorld({ row(202,5,25) })
    start(world); discover(world,{ row(202,5,25) })
    world.monitor(1,202); world.monitor(2,301,-1,26)
    settle(world,{ row(202,5) },{ row(301,20,26) })
    world.line("{invmon}1,301,-1,-1")
    world.line("{invitem}" .. row(205,5))
    world.line("{invmon}2,205,-1,25"); world.tick(2)
    assert(world.count("dual 202") == 0 and world.count("remove 205") == 0)
    settle(world,{ row(202,5),row(301,20) },{ row(205,5,25) })
    assert(not world.state("manager").busy)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'a refused secondary restoration still returns a surviving portal to its bag without retry': `
    local world, context, env, core = portalWorld({ row(202,5,25) },"bag")
    start(world); discover(world,{ row(202,5,25) })
    world.monitor(5,301,101); world.monitor(1,202); world.monitor(2,301,-1,26)
    local previous, attempts = core.env.onSend, 0
    core.env.onSend = function(sessionId,command)
      if command == "dual 202" then attempts = attempts + 1; return false end
      return previous(sessionId,command)
    end
    settle(world,{ row(202,5) },{ row(301,20,26) })
    world.monitor(1,301)
    assert(attempts == 1 and world.count("put 301 101") == 0)
    settle(world,{ row(202,5),row(301,20) })
    assert(world.count("put 301 101") == 1)
    world.monitor(6,301,101); world.tick(100)
    assert(not world.state("manager").busy and attempts == 1)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'a missing previous off-hand item is reported while the surviving portal is removed': `
    local world = portalWorld({ row(202,5,25) })
    start(world); discover(world,{ row(202,5,25) })
    world.monitor(1,202); world.monitor(2,301,-1,26)
    settle(world,{}, { row(301,20,26) })
    world.monitor(1,301)
    assert(not world.state("manager").busy and world.count("dual 202") == 0)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'an older Core disables portal preparation with an upgrade explanation': `
    local world, context, env, core = portalWorld({ row(202,5,25) })
    core.host.broadcastToPlugin(context.id,"aardwolf-api:state",json.encode({ version = 1,
      session = { connected = true, negotiated = true }, snapshots = {},
      capabilities = { inventory = 1, inventoryActions = { "hold", "quaff", "eat", "drink", "recite", "zap", "brandish", "combatPotions" } } }))
    local before = #world.commands
    world.action(301,"enter"); world.tick(20)
    assert(world.state("manager").prompt == nil and not world.state("manager").busy)
    assert(#world.commands == before and string.find(world.state("manager").feedback,"0.5.0",1,true))
    gameplay(world,{})
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${helpers}\n${source}`));
