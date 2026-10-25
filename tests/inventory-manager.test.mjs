import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const cases = {
  'opening a bag queues its explicit read behind an existing inventory refresh': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.message("manager", "refresh")
    world.open("container:101")
    assert(world.count("invdata 101") == 0)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1" })
    world.frame("eqdata", {})
    assert(world.count("invdata 101") == 1)
    world.frame("invdata 101", {})
    assert(world.state("manager").scopeState == "empty")
  `,
  'summary counts direct inventory and discovers carried and worn bags without scanning': `
    local world = inventoryWorld()
    assert(world.state().count == nil and world.state().countState == "unknown")
    world.loaded()
    assert(world.state().count == 6 and world.state().countState == "fresh" and #world.state().bags == 3)
    assert(#world.commands == 2 and world.count("invdata") == 1 and world.count("eqdata") == 1)
  `,
  'opening a bag reuses one manager and distinguishes unknown loading empty and fresh contents': `
    local world = inventoryWorld(); world.loaded(); world.open("container:101")
    assert(world.state("manager").scope == "container:101" and world.state("manager").scopeState == "loading")
    world.frame("invdata 101", {})
    assert(world.state("manager").scopeState == "empty")
    local widget = world.widget("manager")
    world.open("container:102"); world.frame("invdata 102", { "301,,a map,1,10,0,-1,-1" })
    assert(world.widget("manager") == widget and world.state("manager").scopeState == "fresh")
    assert(world.state("manager").entries[1].id == 301 and world.state().count == 6)
    assert(widget.contentWrites == 1)
  `,
  'settings preserve display preferences and per-character profile across reload with verified native saves': `
    local world, context, env = inventoryWorld(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences
    preferences.fontSize, preferences.showWorn, preferences.bagOrder, preferences.hiddenBags = 17, false, { 102, 101 }, { 101 }
    world.save({ heldSlot = 26, rules = { { enabled = true, type = 8, name = "red", bagId = 102 } } }, preferences)
    assert(world.state("setup").feedback == "Settings saved" and world.state().fontSize == 17)
    assert(#world.state().bags == 1 and world.state().bags[1].id == 102)
    env.cleanup(); env.init(); world.ready(); world.setup()
    assert(world.state("setup").profile.heldSlot == 26 and world.state().fontSize == 17)
    assert(world.state("setup").profile.rules[1].bagId == 102)
  `,
  'refused settings saves preserve previous preferences and report failure': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences; preferences.fontSize = 18
    context.refuseWrites = true; world.save(nil, preferences)
    assert(world.state().fontSize == 13 and string.find(world.state("setup").status, "Could not save", 1, true))
  `,
  'malformed cross-session settings and item actions cannot send commands': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.setup()
    local before = #world.commands
    world.message("manager", "action", { id = 103, action = "drop" }, "another-session")
    world.message("manager", "action", { id = "103;quit", action = "drop" })
    world.message("manager", "action", { id = 103, action = "quit" })
    local preferences = world.state("setup").preferences; preferences.fontSize = 99
    world.save(nil, preferences)
    assert(#world.commands == before and world.state().fontSize == 13)
  `,
  'disposal requires confirmation and kept items never lose protection automatically': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "drop")
    assert(world.state("manager").prompt.kind == "confirm" and world.count("drop 103") == 0)
    world.submit(); assert(world.count("drop 103") == 1)
    world.action(104, "sell")
    assert(world.count("sell 104") == 0 and string.find(world.state("manager").feedback, "kept", 1, true))
  `,
  'organize previews first matching enabled type and literal name rule without moving bags': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ rules = {
      { enabled = false, type = 8, name = "", bagId = 101 },
      { enabled = true, type = 8, name = "RED", bagId = 102 },
      { enabled = true, type = 8, name = "", bagId = 101 },
      { enabled = true, type = 11, name = "", bagId = 102 }
    } })
    local before = #world.commands; world.message("manager", "organize")
    local preview = world.state("manager").preview
    assert(#preview == 2 and preview[1].id == 103 and preview[1].bagId == 102 and preview[2].id == 105 and preview[2].bagId == 101)
    assert(#world.commands == before)
  `,
  'organize validates missing destinations before dispatch': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ rules = { { enabled = true, type = 8, name = "", bagId = 999 } } })
    world.message("manager", "organize")
    assert(world.state("manager").preview[1].unavailable)
    local before = #world.commands; world.message("manager", "start-organize"); world.tick(20)
    assert(#world.commands == before and not world.state("manager").busy)
  `,
  'organize waits for each observed move and completes into a previously unopened bag': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ rules = { { enabled = true, type = 8, name = "", bagId = 101 } } })
    world.message("manager", "organize"); world.message("manager", "start-organize"); world.tick(2)
    assert(world.count("put 103 101") == 1 and world.count("put 105 101") == 0)
    world.monitor(6, 103, 101)
    assert(world.count("put 105 101") == 1)
    world.monitor(6, 105, 101)
    assert(not world.state("manager").busy and string.find(world.state("manager").feedback, "Organize complete", 1, true))
  `,
  'unobserved organize move times out without retrying or dispatching another item': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ rules = { { enabled = true, type = 8, name = "", bagId = 101 } } })
    world.message("manager", "organize"); world.message("manager", "start-organize"); world.tick(10005)
    assert(world.count("put 103 101") == 1 and world.count("put 105 101") == 0 and not world.state("manager").busy)
  `,
  'prepared loose potion use sends once and finishes only after observed refreshed inventory': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "quaff"); assert(world.count("quaff 103") == 0)
    world.submit(); world.tick(2)
    assert(world.count("quaff 103") == 1 and world.state("manager").busy)
    world.monitor(7, 103)
    world.frame("invdata", { "101,,a bag,1,11,0,-1,-1" }); world.frame("eqdata", {})
    world.tick(2)
    assert(not world.state("manager").busy and world.count("quaff 103") == 1)
  `,
  'prepared wand use removes prior held equipment and restores it after use': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.save({ heldSlot = 26, rules = {} })
    world.action(106, "zap"); world.submit({ target = "self" }); world.tick(2)
    assert(world.count("remove 202") == 1 and world.count("hold 106") == 0)
    world.monitor(1, 202)
    assert(world.count("hold 106") == 1 and world.count("zap self") == 0)
    world.monitor(2, 106, -1, 26)
    assert(world.count("zap self") == 1)
    world.frame("invdata", { "101,,a bag,1,11,0,-1,-1", "202,,a staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "106,,a wand,1,3,0,26,-1" }); world.tick(2)
    assert(world.count("remove 106") == 1)
    world.monitor(1, 106)
    assert(world.count("hold 202") == 1)
    world.monitor(2, 202, -1, 26)
    assert(not world.state("manager").busy and world.count("zap self") == 1)
  `,
  'cancel before scheduled preparation and disconnect cannot dispatch later gameplay commands': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "quaff"); world.submit(); world.message("manager", "cancel")
    assert(world.count("quaff 103") == 0)
    world.disconnect(); local before = #world.commands; world.tick(30000)
    assert(#world.commands == before and not world.state("manager").busy)
  `,
  'prepared use returns a surviving bagged item to its original bag after refresh': `
    local world = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101", { "301,,a bagged potion,1,8,0,-1,-1" })
    world.action(301, "quaff"); world.submit(); world.tick(2)
    assert(world.count("get 301 101") == 1 and world.count("quaff 301") == 0)
    world.monitor(5, 301, 101)
    assert(world.count("quaff 301") == 1)
    world.frame("invdata", { "101,,a bag,1,11,0,-1,-1", "301,,a surviving potion,1,8,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(world.count("put 301 101") == 1 and world.state("manager").busy)
    world.monitor(6, 301, 101)
    assert(not world.state("manager").busy and world.count("quaff 301") == 1)
  `,
  'cancel during preparation waits for the current move and restores prior held equipment without using': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.save({ heldSlot = 26, rules = {} })
    world.action(106, "zap"); world.submit({ target = "self" }); world.tick(2)
    assert(world.count("remove 202") == 1)
    world.message("manager", "cancel"); world.monitor(1, 202)
    assert(world.count("hold 106") == 0 and world.count("zap self") == 0)
    world.frame("invdata", { "101,,a bag,1,11,0,-1,-1", "106,,a wand,1,3,0,-1,-1", "202,,a staff,1,4,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(world.count("hold 202") == 1)
    world.monitor(2, 202, -1, 26)
    assert(not world.state("manager").busy and world.count("zap self") == 0)
  `,
  'unconfigured held slot prevents prepared wand use before any equipment commands': `
    local world = inventoryWorld(); world.loaded(); world.open()
    local before = #world.commands; world.action(106, "zap"); world.tick(5)
    assert(#world.commands == before and world.state("manager").prompt == nil)
    assert(string.find(world.state("manager").feedback, "Setup", 1, true))
  `,
  'confirmation revalidates item location after a live equipment change': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "drop")
    local original = world.state("manager").prompt
    world.monitor(2, 103, -1, 30)
    world.message("manager", "submit", { kind = original.kind, itemId = original.itemId })
    assert(world.count("drop 103") == 0 and world.state("manager").prompt == nil)
  `,
  'character change cancels preparation and cannot restore items onto the new character': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.save({ heldSlot = 26, rules = {} })
    world.action(106, "zap"); world.submit({ target = "self" }); world.tick(2)
    assert(world.count("remove 202") == 1)
    world.packet("char.base", { name = "Another" }); world.packet("char.status", { state = 3 })
    local before = #world.commands; world.tick(50)
    assert(world.count("hold 106") == 0 and world.count("hold 202") == 0 and world.count("zap self") == 0)
    assert(not world.state("manager").busy and world.state("manager").profile.heldSlot == nil)
  `,
  'invalid prepared-use targets are rejected before retrieving or changing equipment': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.save({ heldSlot = 26, rules = {} })
    world.action(106, "zap")
    local before = #world.commands; world.submit({ target = "guard;quit" }); world.tick(5)
    assert(#world.commands == before and not world.state("manager").busy)
    assert(string.find(world.state("manager").feedback, "target", 1, true))
  `,
  'a timed-out preparation verifies state and does not retry an unobserved equipment removal': `
    local world = inventoryWorld(); world.loaded(); world.open(); world.save({ heldSlot = 26, rules = {} })
    world.action(106, "zap"); world.submit({ target = "self" }); world.tick(10005)
    assert(world.count("remove 202") == 1 and world.count("hold 106") == 0 and world.count("zap self") == 0)
    world.frame("invdata", { "101,,a bag,1,11,0,-1,-1", "106,,a wand,1,3,0,-1,-1" })
    world.frame("eqdata", { "202,,a staff,1,4,0,26,-1" }); world.tick(2)
    assert(not world.state("manager").busy and world.count("remove 202") == 1 and world.count("zap self") == 0)
  `,
  'manager cleanup removes owned widgets and timers and preserves unrelated widgets': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open(); world.setup()
    local other = world.context("other", "Other"); local widget = other.host.createWidget({ name = "other", type = "html" })
    world.action(103, "quaff"); world.submit()
    env.cleanup(); world.tick(100)
    assert(next(context.widgets) == nil and other.widgets[widget] and world.count("quaff 103") == 0)
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${source}`));
