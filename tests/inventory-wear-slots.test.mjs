import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

// User-supplied wearable rows; offline contracts, not native/live acceptance.
const captured = `
Num Keyword       Description                     Wear Flag
--- ————————————  —————————————————————————————  ——————————
  0        light  [ Used as light       ]:            light
  1         head  [ Worn on head        ]:             head
  2         eyes  [ Worn on eyes        ]:             eyes
  3         lear  [ Worn on left ear    ]:              ear
  4         rear  [ Worn on right ear   ]:              ear
  5        neck1  [ Worn around neck    ]:             neck
  6        neck2  [ Worn around neck    ]:             neck
  7         back  [ Worn on back        ]:             back
  8       medal1  [ Pinned to chest1    ]:            medal
  9       medal2  [ Pinned to chest2    ]:            medal
 10       medal3  [ Pinned to chest3    ]:            medal
 11       medal4  [ Pinned to chest4    ]:            medal
 12        torso  [ Worn on torso       ]:            torso
 13         body  [ Worn around body    ]:             body
 14        waist  [ Worn about waist    ]:            waist
 15         arms  [ Worn on arms        ]:             arms
 16       lwrist  [ Worn on left wrist  ]:            wrist
 17       rwrist  [ Worn on right wrist ]:            wrist
 18        hands  [ Worn on hands       ]:            hands
 19      lfinger  [ Worn on left finger ]:           finger
 20      rfinger  [ Worn on right finger]:           finger
 21         legs  [ Worn on legs        ]:             legs
 22         feet  [ Worn on hooves      ]:             feet
 23       shield  [ Worn as shield      ]:           shield
 24      wielded  [ Primary Weapon      ]:            wield
 25       second  [ Off-Hand Weapon     ]:            wield
 26         hold  [ Held                ]:             hold
 27        float  [ Floating nearby     ]:            float
 30        above  [ Floating above      ]:            above
 32     sleeping  [ Sleeping            ]:         sleeping
`;
const helpers = `
  local function frame(world, name, rows)
    world.line("{" .. name .. "}")
    for _, row in ipairs(rows or {}) do world.line(row) end
    world.line(name == "eqdata" and "{/eqdata}" or "{/invdata}")
    world.tick(1)
  end
  local function ready()
    local world = newWorld(); local core = world.core()
    local reader = world.consumer("slot-reader", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 }); world.tick(1)
    frame(world, "invdata", { "101,,a portal,1,20,0,-1,-1", "102,,a weapon,1,5,0,-1,-1", "103,,a potion,1,8,0,-1,-1" })
    frame(world, "eqdata", {})
    local results = {}; reader.client.inventory.onResult(function(value) table.insert(results, value) end)
    return world, reader.client.inventory, results, core, reader
  end
  local function wearable(world, rows, equipment)
    world.line("Num Keyword       Description                     Wear Flag")
    world.line("--- ---------------- ----------------------- ----------")
    for _, row in ipairs(rows or { "23 shield [ Worn as shield ]: shield", "25 second [ Off-Hand Weapon ]: wield", "26 hold [ Held ]: hold" }) do world.line(row) end
    world.line("My customized prompt: hp=10 >")
    frame(world, "eqdata", equipment)
  end
  local function refusal(world, results, callback)
    local before = #world.commands; local id = callback()
    assert(#world.commands == before)
    if id then assert(results[#results].outcome == "failed") end
  end
`;
const cases = {
  'wearable discovery uses two ordered commands and commits actual nonconsecutive rows after eqdata': `
    local world, inventory, results = ready()
    local id = inventory.refreshWearSlots()
    assert(inventory.supports("wearSlots") and inventory.supports("enter") and inventory.supports("dual"))
    assert(world.commands[#world.commands-1] == "wearable" and world.commands[#world.commands] == "eqdata")
    for line in string.gmatch(captured, "[^\\n]+") do world.line(line) end
    assert(not inventory.getWearSlots().known and #results == 0)
    world.line("[3785/3785hp 2554/2759mn 3044/3044mv 0qt 1597tnl] >")
    frame(world, "eqdata", {})
    local slots = inventory.getWearSlots()
    assert(slots.known and not slots.stale and #slots.entries == 30)
    assert(slots.entries[23].description == "Worn on hooves" and slots.entries[30].id == 32)
    assert(results[#results].requestId == id and results[#results].outcome == "complete")
    slots.entries[1].keyword = "changed"; slots.entries[1] = nil
    assert(inventory.getWearSlots().entries[1].keyword == "light")
  `,
  'alternate slot numbers and Portal wish are discovered by keyword': `
    local world, inventory, results = ready(); inventory.refreshWearSlots()
    wearable(world, { "2 hold [ Held ]: hold", "15 second [ Off-Hand Weapon ]: wield", "27 portal [ Portal ]: portal" }, { "101,,a portal,1,20,0,27,-1" })
    assert(inventory.getWearSlots().entries[3].id == 27)
    local request = inventory.use(101,"enter",{heldSlot=27})
    assert(request and world.commands[#world.commands] == "enter" and results[#results].outcome == "sent")
    refusal(world,results,function() return inventory.use(101,"enter",{heldSlot=2}) end)
  `,
  'enter requires discovered effective slot correct portal type and unambiguous fresh equipment': `
    local world, inventory, results = ready()
    refusal(world,results,function() return inventory.use(101,"enter",{heldSlot=26}) end)
    inventory.refreshWearSlots(); wearable(world,nil,{ "101,,a portal,1,20,0,26,-1" })
    inventory.use(101,"enter",{heldSlot=26}); assert(world.commands[#world.commands] == "enter")
    refusal(world,results,function() return inventory.use(101,"enter",{heldSlot=26,target="guard"}) end)
    refusal(world,results,function() return inventory.use(101,"enter",{}) end)
    refusal(world,results,function() return inventory.use(103,"enter",{heldSlot=26}) end)
    inventory.refresh(); frame(world,"invdata",{}); frame(world,"eqdata",{ "101,,a portal,1,20,0,26,-1", "102,,another item,1,5,0,26,-1" })
    refusal(world,results,function() return inventory.use(101,"enter",{heldSlot=26}) end)
  `,
  'dual restores a carried weapon only into empty discovered off-hand slots': `
    local world, inventory, results = ready()
    refusal(world,results,function() return inventory.dual(102) end)
    inventory.refreshWearSlots(); wearable(world,nil,{ "201,,a primary weapon,1,5,0,24,-1" })
    local id = inventory.dual(102); assert(id and world.commands[#world.commands] == "dual 102" and results[#results].outcome == "sent")
    refusal(world,results,function() return inventory.dual(103) end)
    for _, slot in ipairs({23,25,26}) do
      inventory.refreshWearSlots(); wearable(world,nil,{ "201,,an offhand item,1,5,0,"..slot..",-1" })
      refusal(world,results,function() return inventory.dual(102) end)
    end
  `,
  'malformed duplicate missing-header and incomplete discovery cannot replace a known snapshot': `
    local world, inventory, results = ready(); inventory.refreshWearSlots(); wearable(world)
    for _, rows in ipairs({ {"26 hold [ Held ]: hold", "26 shield [ Shield ]: shield"},
      {"26 hold [ Held ]: hold", "27 hold [ Another ]: hold"}, {"26 hold malformed"}, {} }) do
      inventory.refreshWearSlots(); wearable(world,rows)
      assert(results[#results].outcome == "failed")
      assert(inventory.getWearSlots().known and inventory.getWearSlots().stale and #inventory.getWearSlots().entries == 3)
    end
    inventory.refreshWearSlots(); world.line("26 hold [ Held ]: hold"); frame(world,"eqdata",{})
    assert(results[#results].outcome == "failed" and inventory.getWearSlots().stale)
  `,
  'discovery timeout drains its equipment footer without retrying or accepting late slots': `
    local world, inventory, results = ready(); inventory.refreshWearSlots()
    world.line("Num Keyword Description Wear Flag"); world.line("26 hold [ Held ]: hold")
    local before = #world.commands; world.tick(10001)
    assert(results[#results].outcome == "failed" and not inventory.getWearSlots().known)
    frame(world,"eqdata",{}); world.tick(30000)
    assert(#world.commands == before and not inventory.status().collecting and not inventory.getWearSlots().known)
  `,
  'manual inventory interruption drains both replies and leaves discovery unknown': `
    local world, inventory, results, core = ready(); inventory.refreshWearSlots()
    core.env.onSend(world.id,"invdata")
    wearable(world); frame(world,"invdata",{})
    assert(results[#results].outcome == "failed" and not inventory.getWearSlots().known and not inventory.status().collecting)
  `,
  'discovery is transient across disconnect identity changes and reload consumers': `
    local world, inventory, results = ready(); inventory.refreshWearSlots(); wearable(world)
    local reader = world.consumer("second-slot-reader", { "Char" }, {inventory=true})
    assert(reader.client.inventory.getWearSlots().known)
    world.packet("char.base",{name="Different"}); assert(not inventory.getWearSlots().known)
    world.disconnect(); assert(not inventory.getWearSlots().known and not inventory.supports("enter"))
  `,
  'owned discovery hides recognized rows but preserves prompts errors malformed and manual lines': `
    local world, inventory, results, core = ready()
    local function line(value,hidden)
      assert((core.env.onLine(world.id,value,value) == false) == hidden,value)
    end
    line("26 hold [ Held ]: hold",false)
    inventory.refreshWearSlots()
    line("Num Keyword Description Wear Flag",true)
    line("--- ————————————  —————————————————————————————  ——————————",true)
    line("--- ------------ -------------------- ----------",true)
    line("26 hold [ Held ]: hold",true)
    line("You cannot do that.",false); line("Custom prompt >",false)
    line("27 second malformed",false)
    line("{eqdata}",true); line("{/eqdata}",true)
    assert(results[#results].outcome == "failed")
  `,
  'refused equipment boundary blocks later discovery rather than misattributing late wearable output': `
    local world, inventory, results, core = ready()
    local original = core.env.onSend
    core.env.onSend = function(sessionId,command) if command == "eqdata" then return false end; return original(sessionId,command) end
    local id = inventory.refreshWearSlots()
    assert(id and results[#results].outcome == "failed" and inventory.status().collecting)
    core.env.onSend = original
    local before = #world.commands
    local retry = inventory.refreshWearSlots()
    assert(retry and results[#results].outcome == "failed" and #world.commands == before)
    wearable(world)
    assert(not inventory.getWearSlots().known and inventory.status().collecting)
  `,
  'stopping from a discovery stale-state callback cannot send the old discovery command': `
    local world, inventory, results, core, reader = ready()
    inventory.refreshWearSlots(); wearable(world)
    local before = #world.commands
    inventory.on(function() if inventory.getWearSlots().stale then reader.client.stop() end end)
    inventory.refreshWearSlots()
    assert(#world.commands == before and not inventory.status().available)
  `,
  'oversized discovery and missing equipment footer fail without partial slots': `
    local world, inventory, results = ready()
    inventory.refreshWearSlots()
    world.line("Num Keyword Description Wear Flag")
    world.line(string.rep("x",65537))
    assert(results[#results].outcome == "failed" and not inventory.getWearSlots().known)
    frame(world,"eqdata",{})
    inventory.refreshWearSlots()
    world.line("Num Keyword Description Wear Flag"); world.line("26 hold [ Held ]: hold")
    world.line("{eqdata}"); world.tick(10001)
    assert(results[#results].outcome == "failed" and not inventory.getWearSlots().known)
  `,
  'old providers retain original use aggregate and explain portal upgrade': `
    local world, inventory, results, core, reader = ready()
    core.host.broadcastToPlugin(reader.id,"aardwolf-api:state",json.encode({version=1,
      session={connected=true,negotiated=true},snapshots={},capabilities={inventory=1,
      inventoryActions={"hold","quaff","eat","drink","recite","zap","brandish"}}}))
    assert(inventory.supports("use") and not inventory.supports("enter") and not inventory.supports("dual") and not inventory.supports("wearSlots"))
    for _, callback in ipairs({function() return inventory.refreshWearSlots() end,function() return inventory.dual(102) end,
      function() return inventory.use(101,"enter",{heldSlot=26}) end}) do
      local id,reason=callback(); assert(not id and string.find(reason,"0.5.0",1,true))
    end
  `,
};
for (const [name, source] of Object.entries(cases)) {
  test(name, () => runLua(`local captured = [==[${captured}]==]\n${helpers}\n${source}`));
}
