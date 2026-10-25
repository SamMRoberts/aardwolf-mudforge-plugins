import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const cases = {
  'unrecognized widget fields are discarded rather than recursively persisted': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local state = world.state("setup")
    local cyclic = {}; cyclic.self = cyclic
    state.preferences.extra = cyclic; state.profile.extra = cyclic
    world.save(state.profile, state.preferences)
    assert(world.state("setup").feedback == "Settings saved")
    local saved = context.storage["aardwolf-api:inventory:settings"].value
    assert(saved.preferences.extra == nil and saved.profiles.fixture.extra == nil)
  `,
  'settings reject invalid scalars IDs rule text and sparse or oversized lists without writes': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local revision, writes = world.state("setup").settingsRevision, context.writes
    for _, invalid in ipairs({ 7, 25, 12.5, "13", false, math.huge, 0/0 }) do
      local preferences = world.state("setup").preferences
      preferences.fontSize = invalid; world.save(nil, preferences)
    end
    for _, profile in ipairs({
      { heldSlot = -1, rules = {} }, { heldSlot = 256, rules = {} },
      { heldSlot = "26", rules = {} }, { heldSlot = 2.5, rules = {} },
      { rules = { { enabled = true, type = 28, name = "", bagId = 101 } } },
      { rules = { { enabled = true, type = 8, name = "red\\nquit", bagId = 101 } } },
      { rules = { { enabled = true, type = 8, name = string.rep("x",129), bagId = 101 } } },
      { rules = { { enabled = true, type = 8, name = "", bagId = "101" } } },
      { rules = { { enabled = true, type = 8, name = "", bagId = 0 } } },
      { rules = { [2] = { enabled = true, type = 8, name = "", bagId = 101 } } }
    }) do world.save(profile) end
    local tooMany = {}; for index = 1,65 do tooMany[index] = { enabled = true, type = 8, name = "", bagId = 101 } end
    world.save({ rules = tooMany })
    local preferences = world.state("setup").preferences; preferences.bagOrder = { [2] = 101 }; world.save(nil, preferences)
    preferences = world.state("setup").preferences; preferences.hiddenBags = { 9007199254740992 }; world.save(nil, preferences)
    assert(context.writes == writes and world.state("setup").settingsRevision == revision and world.state().fontSize == 13)
  `,
  'settings accept inclusive bounds unresolved bag rules and literal matching text': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences; preferences.fontSize = 8
    world.save({ heldSlot = 0, rules = { { enabled = true, type = 0, name = "[red].*%", bagId = 999 } } }, preferences)
    assert(world.state("setup").profile.heldSlot == 0 and world.state().fontSize == 8)
    preferences.fontSize = 24
    local rules = {}; for index = 1,64 do rules[index] = { enabled = true, type = 27, name = string.rep("x",128), bagId = 999 } end
    world.save({ heldSlot = 255, rules = rules }, preferences)
    assert(world.state("setup").profile.heldSlot == 255 and #world.state("setup").profile.rules == 64)
    assert(world.state().fontSize == 24 and context.writes == 2)
  `,
  'display preferences remain world-wide while held slots and rules follow character identity': `
    local world = inventoryWorld(); world.loaded(); world.setup()
    local original = world.state("setup").identity
    local preferences = world.state("setup").preferences; preferences.fontSize = 18
    world.save({ heldSlot = 26, rules = { { enabled = true, type = 8, name = "red", bagId = 101 } } }, preferences)
    world.packet("char.base", { name = "Second" }); world.packet("char.status", { state = 3 })
    assert(world.state("setup").identity ~= original and world.state("setup").profile.heldSlot == nil)
    assert(#world.state("setup").profile.rules == 0 and world.state().fontSize == 18)
    world.save({ heldSlot = 27, rules = {} })
    world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    assert(world.state("setup").profile.heldSlot == 26 and world.state("setup").profile.rules[1].bagId == 101)
  `,
  'stale identity setup forms and messages from another world cannot write settings': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local data = world.state("setup")
    local writes = context.writes
    world.message("setup", "save", { identity = data.identity, preferences = data.preferences, profile = data.profile }, "another-world")
    world.packet("char.base", { name = "Second" }); world.packet("char.status", { state = 3 })
    world.message("setup", "save", { identity = data.identity, preferences = data.preferences, profile = data.profile })
    assert(context.writes == writes and world.state("setup").profile.heldSlot == nil)
  `,
  'unsupported saved settings schemas remain visible without silently overwriting stored data': `
    local saved = { schemaVersion = 99, value = { preferences = {} } }
    local world, context = inventoryWorld(saved)
    assert(context.storage["aardwolf-api:inventory:settings"] == saved and context.writes == 0)
    assert(world.state().fontSize == 13 and string.find(world.state().status, "settings", 1, true))
  `,
  'invalid stored profile data uses defaults without writing until an explicit valid save': `
    local world, context = inventoryWorld({ schemaVersion = 1, value = {
      preferences = { fontSize = 18, showWorn = true, confirmDisposal = true, bagOrder = {}, hiddenBags = {} },
      profiles = { fixture = { heldSlot = 999, rules = {} } }
    } })
    assert(world.state().fontSize == 13 and context.writes == 0)
    world.loaded(); world.setup(); world.save({ heldSlot = 26, rules = {} })
    assert(context.writes == 1 and world.state("setup").status == "" and world.state("setup").profile.heldSlot == 26)
  `,
  'storage readiness failure retains current settings and a later successful save clears the error': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences; preferences.fontSize = 20
    context.storageState, context.storageReason = "failed", "fixture storage unavailable"
    world.save(nil, preferences)
    assert(world.state().fontSize == 13 and context.writes == 0)
    assert(string.find(world.state("setup").status, "fixture storage unavailable", 1, true))
    context.storageState = "ready"; world.save(nil, preferences)
    assert(world.state().fontSize == 20 and world.state("setup").status == "" and world.state("setup").feedback == "Settings saved")
  `,
  'saved settings read-back mismatch does not publish success or replace active settings': `
    local world, context, env = inventoryWorld(); world.loaded(); env.cleanup()
    local original = env.saveTable
    env.saveTable = function(name, value)
      local accepted = original(name, value)
      if name == "aardwolf-api:inventory:settings" then value.value.preferences.fontSize = 19 end
      return accepted
    end
    env.init(); world.ready(); world.setup()
    local preferences = world.state("setup").preferences; preferences.fontSize = 20
    local revision = world.state("setup").settingsRevision
    world.save(nil, preferences)
    assert(world.state().fontSize == 13 and world.state("setup").settingsRevision == revision)
    assert(string.find(world.state("setup").status, "read-back", 1, true))
  `,
  'host numeric string iteration keys do not break valid settings or bag ordering': `
    local world, context, env = inventoryWorld(); world.loaded(); env.cleanup()
    local nativePairs = pairs
    env.pairs = function(value)
      local iterator, state, first = nativePairs(value)
      return function(subject, previous)
        local actual = previous
        if type(previous) == "string" and tonumber(previous) and subject[previous] == nil then actual = tonumber(previous) end
        local index, entry = iterator(subject, actual)
        return type(index) == "number" and tostring(index) or index, entry
      end, state, first
    end
    env.init(); world.ready(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences; preferences.bagOrder = { 102, 101 }; preferences.hiddenBags = { 201 }
    world.save({ heldSlot = 26, rules = { { enabled = true, type = 8, name = "", bagId = 101 } } }, preferences)
    assert(world.state("setup").feedback == "Settings saved", world.state("setup").feedback .. "; " .. world.state("setup").status)
    assert(world.state().bags[1].id == 102)
  `,
  'summary bag visibility settings never hide manager navigation destinations': `
    local world = inventoryWorld(); world.loaded(); world.setup()
    local preferences = world.state("setup").preferences
    preferences.hiddenBags, preferences.showWorn = { 101 }, false
    world.save(nil, preferences); world.open()
    assert(#world.state().bags == 1 and #world.state("manager").bags == 3 and #world.state("setup").bags == 3)
  `,
  'confirmation from a replaced dialog cannot confirm a different disposal action': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "drop")
    local old = world.state("manager").prompt
    world.action(103, "donate")
    world.message("manager", "submit", old)
    assert(world.count("drop 103") == 0 and world.count("donate 103") == 0)
  `,
  'confirmation rechecks item location before dispatching a disposal command': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.action(103, "drop")
    local old = world.state("manager").prompt
    world.monitor(6,103,101)
    world.message("manager", "submit", old)
    assert(world.count("drop 103") == 0)
  `,
  'native retained nil-valued optional profile fields do not break saving or read-back': `
    local world, context, env = inventoryWorld(); world.loaded(); env.cleanup()
    local nativePairs = pairs
    env.pairs = function(value)
      local iterator, state, first = nativePairs(value)
      local extra = type(value.rules) == "table" and value.heldSlot == nil
      local yielded = false
      return function(subject, previous)
        if yielded then return nil end
        local index, entry = iterator(subject, previous)
        if index == nil and extra then yielded = true; return "heldSlot", nil end
        return index, entry
      end, state, first
    end
    env.init(); world.ready(); world.setup()
    world.save({ rules = {} })
    assert(world.state("setup").feedback == "Settings saved" and world.state("setup").profile.heldSlot == nil)
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${source}`));
