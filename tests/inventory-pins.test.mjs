import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

// Offline UI/controller and native-storage adapter contracts, not disk/UI evidence.
const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local function pins(world) return world.state().pins or {} end
  local function action(world,id)
    world.message("manager","select",{ id = id })
    for _, entry in ipairs(world.state("manager").actions) do
      if entry.id == "pin" or entry.id == "unpin" then return entry end
    end
  end
  local function choose(world,role,id)
    world.widget(role).events.menuselect({ id = id, sessionId = world.id })
  end
  local function stored(context,name)
    return context.storage["aardwolf-api:inventory:settings"].value.profiles[name or "fixture"].pins
  end
  local function changeCharacter(world,name)
    world.packet("char.base",{ name = name }); world.packet("char.status",{ state = 3 }); world.tick(1)
    world.frame("invdata",{ "103,,a red potion,1,8,0,-1,-1", "105,,a blue potion,1,8,0,-1,-1" })
    world.frame("eqdata",{}); world.open()
  end
`;

const cases = {
  'Pin to Inventory saves ordered object IDs without sending gameplay or resetting Setup drafts': `
    local world, context = inventoryWorld(); world.loaded(); world.open(); world.setup()
    local revision, before = world.state("setup").settingsRevision, #world.commands
    assert(action(world,103).id == "pin" and action(world,103).text == "Pin to Inventory")
    world.action(103,"pin"); world.action(106,"pin"); world.action(105,"pin")
    assert(#pins(world) == 3 and pins(world)[1].id == 103 and pins(world)[2].id == 106 and pins(world)[3].id == 105)
    assert(pins(world)[1].name == "a red potion" and pins(world)[1].plainName == "a red potion")
    assert(pins(world)[1].available == true and pins(world)[1].location == "inventory")
    assert(#world.commands == before and world.state("setup").settingsRevision == revision)
    assert(#stored(context) == 3 and stored(context)[2].id == 106)
    assert(action(world,103).id == "unpin" and action(world,103).text == "Unpin from Inventory")
  `,
  'pinning the same object twice is idempotent and unpinning preserves remaining order': `
    local world, context = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"pin"); world.action(106,"pin"); world.action(105,"pin")
    local writes = context.writes
    world.action(103,"pin")
    assert(#pins(world) == 3 and context.writes == writes)
    world.action(106,"unpin")
    assert(#pins(world) == 2 and pins(world)[1].id == 103 and pins(world)[2].id == 105)
    assert(#stored(context) == 2 and stored(context)[2].id == 105)
  `,
  'pins survive plugin reload and remain specific to their character': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"pin")
    env.cleanup(); env.init(); world.ready()
    assert(#pins(world) == 1 and pins(world)[1].id == 103)
    changeCharacter(world,"Another")
    assert(#pins(world) == 0)
    world.action(105,"pin")
    assert(#pins(world) == 1 and pins(world)[1].id == 105)
    changeCharacter(world,"Fixture")
    assert(#pins(world) == 1 and pins(world)[1].id == 103)
    assert(stored(context,"another")[1].id == 105 and stored(context)[1].id == 103)
  `,
  'legacy profiles without pins load as an empty list without rewriting settings': `
    local world, context = inventoryWorld({ schemaVersion = 1, value = {
      preferences = { fontSize = 17, showWorn = true, confirmDisposal = true, bagOrder = {}, hiddenBags = {} },
      profiles = { fixture = { heldSlot = 26, rules = {} } }
    } })
    world.loaded(); world.setup()
    assert(#pins(world) == 0 and #world.state("setup").profile.pins == 0)
    assert(world.state().fontSize == 17 and world.state("setup").profile.heldSlot == 26 and context.writes == 0)
  `,
  'saving a stale or omitted Setup pin field preserves the current ordered pins': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.setup()
    local oldProfile = world.state("setup").profile
    world.action(103,"pin")
    local revision = world.state("setup").settingsRevision
    local preferences = world.state("setup").preferences; preferences.fontSize = 18
    world.save(oldProfile,preferences)
    assert(world.state().fontSize == 18 and #pins(world) == 1 and pins(world)[1].id == 103)
    assert(world.state("setup").settingsRevision == revision + 1)
    world.save({ heldSlot = 26, rules = {}, pins = { { id = 105, name = "injected" } } })
    assert(#pins(world) == 1 and pins(world)[1].id == 103)
    world.save({ heldSlot = 26, rules = {} })
    assert(#pins(world) == 1 and pins(world)[1].id == 103)
  `,
  'a missing pinned item keeps its cached name and offers only Unpin in the summary': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"pin"); world.monitor(7,103)
    assert(#pins(world) == 1 and pins(world)[1].id == 103 and pins(world)[1].name == "a red potion")
    assert(pins(world)[1].available == false)
    env.cleanup(); env.init(); world.ready()
    assert(world.widget("manager") == nil)
    local before = #world.commands
    world.message("summary","menu",{ id = 103 })
    local actions = world.state().actions
    assert(#actions == 1 and actions[1].id == "unpin" and not actions[1].disabled)
    assert(world.widget("manager") == nil and #world.commands == before)
    choose(world,"summary","unpin")
    assert(#pins(world) == 0 and #stored(context) == 0 and #world.commands == before)
  `,
  'summary pins offer the existing actions for bagged and equipped items': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101",{ "301,,a bagged portal,1,20,0,-1,-1" })
    world.action(301,"pin"); world.open("equipment"); world.action(202,"pin")
    assert(#pins(world) == 2 and pins(world)[1].location == "container:101" and pins(world)[2].location == "equipment")
    local before = #world.commands
    world.message("summary","menu",{ id = 301 })
    local take, enter, unpin = false, false, false
    for _, entry in ipairs(world.state().actions) do
      if entry.id == "take" then take = true end
      if entry.id == "enter" then enter = true end
      if entry.id == "unpin" then unpin = true end
    end
    assert(take and enter and unpin and #world.commands == before)
    choose(world,"summary","take")
    assert(world.count("get 301 101") == 1)
    world.message("summary","menu",{ id = 202 })
    local remove = false
    for _, entry in ipairs(world.state().actions) do if entry.id == "remove" then remove = true end end
    assert(remove)
  `,
  'a known summary pin opens its native menu without creating the manager': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"pin")
    env.cleanup(); env.init(); world.ready()
    world.frame("invdata",{ "103,,a red potion,1,8,0,-1,-1" }); world.frame("eqdata",{})
    assert(world.widget("manager") == nil)
    local before = #world.commands
    world.message("summary","menu",{ id = 103 })
    assert(world.widget("manager") == nil and #world.commands == before)
    local quaff = false
    for _, entry in ipairs(world.state().actions) do if entry.id == "quaff" then quaff = true end end
    assert(quaff)
  `,
  'summary menu gameplay actions revalidate the pinned item location': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"pin")
    world.message("summary","menu",{ id = 103 })
    world.monitor(2,103,-1,30)
    local before = #world.commands
    choose(world,"summary","drop")
    assert(#world.commands == before and world.state("manager").prompt == nil)
    assert(pins(world)[1].location == "equipment")
  `,
  'a pin save refusal preserves active pins and reports failure': `
    local world, context = inventoryWorld(); world.loaded(); world.open(); world.setup()
    world.action(103,"pin")
    local revision, writes = world.state("setup").settingsRevision, context.writes
    context.refuseWrites = true; world.action(105,"pin")
    assert(#pins(world) == 1 and pins(world)[1].id == 103 and #stored(context) == 1)
    assert(context.writes == writes and world.state("setup").settingsRevision == revision)
    assert(string.find(string.lower(world.state().feedback .. world.state().status),"save",1,true))
    context.refuseWrites = false; world.action(105,"pin")
    assert(#pins(world) == 2 and stored(context)[2].id == 105)
  `,
  'a pin read-back mismatch leaves the previous active pin list unchanged': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open(); world.action(103,"pin")
    env.cleanup()
    local original = env.saveTable
    env.saveTable = function(name,value)
      local accepted = original(name,value)
      if name == "aardwolf-api:inventory:settings" then value.value.profiles.fixture.pins[2].name = "changed by storage" end
      return accepted
    end
    env.init(); world.ready()
    world.frame("invdata",{ "103,,a red potion,1,8,0,-1,-1", "105,,a blue potion,1,8,0,-1,-1" })
    world.frame("eqdata",{}); world.open()
    world.action(105,"pin")
    assert(#pins(world) == 1 and pins(world)[1].id == 103)
    assert(string.find(string.lower(world.state().feedback .. world.state().status),"read-back",1,true))
  `,
  'pin actions reject malformed IDs messages from another world and running workflows': `
    local world, context = inventoryWorld(); world.loaded(); world.open()
    world.message("manager","select",{ id = 103 })
    local before, writes = #world.commands, context.writes
    world.message("manager","action",{ id = 103, action = "pin" },"another-world")
    for _, id in ipairs({ "103", "103;quit", -1, 0, 1.5 }) do
      world.message("manager","action",{ id = id, action = "pin" })
    end
    assert(#pins(world) == 0 and #world.commands == before and context.writes == writes)
    world.action(103,"quaff"); world.submit()
    world.action(105,"pin")
    assert(world.state("manager").busy and #pins(world) == 0 and context.writes == writes)
  `,
  'pin limit rejects a thirty-third item without losing the existing order': `
    local world, context = inventoryWorld(); world.active()
    local rows = {}
    for id = 1, 33 do table.insert(rows,tostring(id) .. ",,potion " .. tostring(id) .. ",1,8,0,-1,-1") end
    world.frame("invdata",rows); world.frame("eqdata",{}); world.open()
    local before = #world.commands
    for id = 1, 32 do world.action(id,"pin") end
    assert(#pins(world) == 32)
    local writes = context.writes
    world.action(33,"pin")
    assert(#pins(world) == 32 and context.writes == writes and #world.commands == before)
    for id = 1, 32 do assert(pins(world)[id].id == id) end
    assert(string.find(world.state().feedback,"32",1,true))
  `,
  'cached pin labels remove color codes and bound long item names': `
    local world, context = inventoryWorld(); world.loaded(); world.open()
    world.line("{invitem}301,,@Ra red portal@w,1,20,0,-1,-1")
    world.line("{invitem}302,," .. string.rep("x",300) .. ",1,20,0,-1,-1")
    world.action(301,"pin"); world.action(302,"pin")
    assert(#pins(world) == 2 and pins(world)[1].plainName == "a red portal" and stored(context)[1].name == "a red portal")
    assert(#stored(context)[2].name <= 256 and #stored(context)[2].name > 0)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${helpers}\n${source}`));
