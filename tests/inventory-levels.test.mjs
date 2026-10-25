import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

// Injected controller/GMCP behavior, not native rendering or live gameplay.
const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local carried = {
    "101,,a canvas bag,1,11,0,-1,-1", "102,,a spare bag,1,11,0,-1,-1",
    "103,,a red potion high,50,8,0,-1,-1", "104,,a sword,50,5,0,-1,-1",
    "105,,a red potion low,10,8,0,-1,-1", "106,,a wand,50,3,0,-1,-1",
    "107,,a scroll,50,2,0,-1,-1", "108,,a ration,50,14,0,-1,-1",
    "109,,a drink container,50,12,0,-1,-1", "110,,a pill,50,19,0,-1,-1",
    "111,,a staff,50,4,0,-1,-1"
  }
  local equipped = { "201,,a worn bag,1,11,0,7,-1", "202,,a held staff,50,4,0,26,-1" }
  local function ready(level)
    local world, context, env, core = inventoryWorld(); world.loaded()
    if level ~= nil then world.packet("char.base", { level = level }) end
    world.open(); world.message("manager", "refresh")
    world.frame("invdata", carried); world.frame("eqdata", equipped)
    return world, context, env, core
  end
  local function entry(world,id)
    for _, value in ipairs(world.state("manager").entries) do if value.id == id then return value end end
    error("Missing fixture item " .. tostring(id))
  end
  local function action(world,id,name)
    world.message("manager", "select", { id = id })
    for _, value in ipairs(world.state("manager").actions) do if value.id == name then return value end end
    error("Missing action " .. name)
  end
  local function restricted(value)
    assert(value.disabled == true and string.find(string.lower(value.reason or ""), "level", 1, true), "Expected a disabled action with a level explanation")
  end
  local function potions(world,bagId)
    world.save({ rules = {}, quickPotions = { heal = { name = "red", bagId = bagId } } })
  end
`;

const cases = {
  'items above character level are marked while equal and lower-level items remain usable': `
    local world = ready(20)
    assert(world.state("manager").characterLevel == 20)
    assert(entry(world,103).levelRestricted == true)
    assert(string.find(string.lower(entry(world,103).levelReason or ""),"level",1,true))
    assert(not entry(world,105).levelRestricted)
    restricted(action(world,103,"quaff"))
    assert(not action(world,105,"quaff").disabled)
    world.packet("char.status", { level = 50 })
    assert(world.state("manager").characterLevel == 50 and not entry(world,103).levelRestricted)
    assert(not action(world,103,"quaff").disabled)
  `,
  'status level takes precedence and partial packets retain the latest level without inventory reads': `
    local world = ready(20); local before = #world.commands
    world.packet("char.status", { level = 60 })
    world.packet("char.status", { tnl = 123 })
    world.packet("char.base", { level = 5 })
    assert(world.state("manager").characterLevel == 60 and not entry(world,103).levelRestricted)
    assert(not action(world,103,"wear").disabled and #world.commands == before)
  `,
  'tier allowance updates the effective item limit and permits an item exactly at that limit': `
    local world = ready(20); local before = #world.commands
    world.packet("char.base", { tier = 2 })
    assert(world.state("manager").characterLevel == 20 and world.state("manager").itemLevelLimit == 40)
    assert(entry(world,103).levelRestricted and action(world,103,"quaff").disabled)
    world.packet("char.base", { tier = 3 })
    assert(world.state("manager").characterLevel == 20 and world.state("manager").itemLevelLimit == 50)
    assert(not entry(world,103).levelRestricted and not action(world,103,"quaff").disabled)
    world.packet("char.base", { name = "Fixture" })
    assert(world.state("manager").itemLevelLimit == 50 and #world.commands == before)
  `,
  'tier allowance stays capped at level 200 before super-hero level': `
    local world = ready(190); world.packet("char.base", { tier = 7 })
    world.message("manager","refresh")
    world.frame("invdata", { "301,,a level-200 sword,200,5,0,-1,-1", "302,,a level-201 sword,201,5,0,-1,-1" })
    world.frame("eqdata", equipped)
    assert(world.state("manager").itemLevelLimit == 200)
    assert(not entry(world,301).levelRestricted and not action(world,301,"wear").disabled)
    assert(entry(world,302).levelRestricted); restricted(action(world,302,"wear"))
    world.packet("char.status", { level = 200 })
    assert(world.state("manager").itemLevelLimit == 200 and entry(world,302).levelRestricted)
  `,
  'super-hero level unlocks the complete tier allowance above level 200': `
    local world = ready(200); world.packet("char.base", { tier = 7 })
    world.message("manager","refresh")
    world.frame("invdata", { "301,,a tier-seven sword,271,5,0,-1,-1", "302,,a too-high sword,272,5,0,-1,-1" })
    world.frame("eqdata", equipped)
    assert(world.state("manager").itemLevelLimit == 200 and entry(world,301).levelRestricted)
    local before = #world.commands
    world.packet("char.status", { level = 201 })
    assert(world.state("manager").characterLevel == 201 and world.state("manager").itemLevelLimit == 271)
    assert(not entry(world,301).levelRestricted and not action(world,301,"wear").disabled)
    assert(entry(world,302).levelRestricted); restricted(action(world,302,"wear"))
    assert(#world.commands == before)
  `,
  'an unknown character level does not become zero or falsely restrict known items': `
    local world = ready()
    assert(world.state("manager").characterLevel == nil)
    assert(not entry(world,103).levelRestricted and not action(world,103,"quaff").disabled)
    assert(not action(world,104,"wear").disabled)
  `,
  'a character change cannot reuse the previous characters status level or tier allowance': `
    local world = ready(201)
    world.packet("char.base", { tier = 7 })
    world.packet("char.status", { level = 201 })
    assert(world.state("manager").itemLevelLimit == 271)
    world.packet("char.base", { name = "Another", level = 20, tier = 0 })
    world.packet("char.status", { state = 3 })
    world.frame("invdata", carried); world.frame("eqdata", equipped)
    assert(world.state("manager").characterLevel == 20 and world.state("manager").itemLevelLimit == 20)
    assert(entry(world,103).levelRestricted)
    restricted(action(world,103,"quaff"))
  `,
  'a newly identified character has no inherited level allowance before its own level arrives': `
    local world = ready(201)
    world.packet("char.base", { tier = 7 }); world.packet("char.status", { level = 201 })
    world.packet("char.base", { name = "Another" }); world.packet("char.status", { state = 3 })
    world.frame("invdata", carried); world.frame("eqdata", equipped)
    assert(world.state("manager").characterLevel == nil and world.state("manager").itemLevelLimit == nil)
    world.packet("char.status", { level = 20 })
    assert(world.state("manager").itemLevelLimit == 20 and entry(world,103).levelRestricted)
  `,
  'all use and equipment actions reject too-high items before sending or opening preparation': `
    local world = ready(20); world.save({ heldSlot = 26, rules = {} })
    local cases = { {103,"quaff"}, {104,"wear"}, {104,"hold"}, {106,"zap"},
      {107,"recite"}, {108,"eat"}, {109,"drink"}, {110,"eat"}, {111,"brandish"} }
    local before = #world.commands
    for _, testCase in ipairs(cases) do
      restricted(action(world,testCase[1],testCase[2]))
      world.action(testCase[1],testCase[2]); world.tick(2)
      assert(#world.commands == before and not world.state("manager").prompt and not world.state("manager").busy)
    end
    world.open("equipment")
    restricted(action(world,202,"brandish"))
    world.action(202,"brandish"); world.tick(2)
    assert(#world.commands == before)
  `,
  'details moving and disposal remain available for items above character level': `
    local world = ready(20)
    for _, name in ipairs({ "details", "put", "give", "drop", "sell", "donate" }) do assert(not action(world,104,name).disabled,name) end
    world.open("equipment"); assert(not action(world,202,"remove").disabled)
    world.open("container:101"); world.frame("invdata 101", { "301,,a red potion,50,8,0,-1,-1" })
    assert(entry(world,301).levelRestricted)
    assert(not action(world,301,"details").disabled and not action(world,301,"take").disabled)
    restricted(action(world,301,"quaff"))
  `,
  'stale native menu callbacks recheck level before dispatching wear': `
    local world = ready(50)
    world.message("manager","menu",{ id = 104 })
    world.packet("char.status", { level = 20 })
    world.widget("manager").events.menuselect({ id = "wear", sessionId = world.id })
    world.tick(2)
    assert(world.count("wear 104") == 0)
    assert(string.find(string.lower(world.state("manager").feedback),"level",1,true))
  `,
  'prepared-use confirmation rechecks a level decrease before changing equipment': `
    local world = ready(50); world.save({ heldSlot = 26, rules = {} })
    world.action(106,"zap"); assert(world.state("manager").prompt)
    world.packet("char.status", { level = 20 })
    world.submit({ target = "self" }); world.tick(2)
    assert(world.count("remove 202") == 0 and world.count("hold 106") == 0 and world.count("zap self") == 0)
    assert(string.find(string.lower(world.state("manager").feedback),"level",1,true))
  `,
  'a level decrease before scheduled bag retrieval cannot dispatch preparation commands': `
    local world = ready(50)
    world.open("container:101"); world.frame("invdata 101", { "301,,a red potion,50,8,0,-1,-1" })
    world.action(301,"quaff"); world.submit()
    world.packet("char.status", { level = 20 }); world.tick(2)
    assert(world.count("get 301 101") == 0 and world.count("quaff 301") == 0)
  `,
  'a level decrease while retrieval is in flight cannot dispatch quaff after arrival': `
    local world = ready(50)
    world.open("container:101"); world.frame("invdata 101", { "301,,a red potion,50,8,0,-1,-1" })
    world.action(301,"quaff"); world.submit(); world.tick(2)
    assert(world.count("get 301 101") == 1)
    world.packet("char.status", { level = 20 }); world.monitor(5,301,101)
    assert(world.count("quaff 301") == 0)
  `,
  'a level decrease after equipment removal cannot dispatch the prepared hold': `
    local world = ready(50); world.save({ heldSlot = 26, rules = {} })
    world.action(106,"zap"); world.submit({ target = "self" }); world.tick(2)
    assert(world.count("remove 202") == 1)
    world.packet("char.status", { level = 20 }); world.monitor(1,202)
    assert(world.count("hold 106") == 0 and world.count("zap self") == 0)
  `,
  'a level decrease after holding the item cannot dispatch its use command': `
    local world = ready(50); world.save({ heldSlot = 26, rules = {} })
    world.action(106,"zap"); world.submit({ target = "self" }); world.tick(2)
    world.monitor(1,202); assert(world.count("hold 106") == 1)
    world.line("{invmon}2,106,-1,26")
    world.packet("char.status", { level = 20 }); world.tick(2)
    assert(world.count("zap self") == 0)
  `,
  'restoration cannot re-hold previous equipment above a decreased level allowance': `
    local world = ready(50); world.save({ heldSlot = 26, rules = {} })
    world.action(106,"zap"); world.submit({ target = "self" }); world.tick(2)
    world.monitor(1,202); world.monitor(2,106,-1,26)
    assert(world.count("zap self") == 1)
    world.packet("char.status", { level = 20 })
    world.frame("invdata", { carried[1], "202,,a held staff,50,4,0,-1,-1" })
    world.frame("eqdata", { "106,,a wand,50,3,0,26,-1" }); world.tick(2)
    assert(world.count("remove 106") == 1)
    world.monitor(1,106)
    assert(world.count("hold 202") == 0)
    world.frame("invdata", { carried[1], "202,,a held staff,50,4,0,-1,-1", "106,,a wand,50,3,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(not world.state("manager").busy and world.count("hold 202") == 0)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'quick potions skip higher-level matches and choose the first usable matching potion': `
    local world = ready(20); potions(world)
    assert(not world.state().quickPotions.heal.disabled)
    world.message("summary","quick-potion",{slot="heal"}); world.tick(2)
    assert(world.count("quaff 103") == 0 and world.count("quaff 105") == 1)
  `,
  'quick potions disable when every matching known potion is above character level': `
    local world = ready(5); potions(world)
    assert(world.state().quickPotions.heal.disabled)
    assert(string.find(string.lower(world.state().quickPotions.heal.reason or ""),"level",1,true))
    local before = #world.commands
    world.message("summary","quick-potion",{slot="heal"}); world.tick(2)
    assert(#world.commands == before and not world.state().busy)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + helpers + source));
