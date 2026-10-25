import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(resolve(root, 'tests/fixtures/spells.lua'), 'utf8');
const setup = `
  local world, reader, provider = spellsWorld()
  world.active(); world.sample(); world.packet("char.status", { level = 200 })
  local panel = world.panel()
  local storageKey = "aardwolf-api:spells-panel-layouts"
  local function ready()
    panel = world.panel()
    panel.events.luamsg({ event = "ready", data = {} })
    return json.decode(panel.panelLayout)
  end
  local function state() return json.decode(panel.panelLayout) end
  local function change(value)
    local current = state()
    value.generation, value.revision = current.generation, current.revision
    panel.events.luamsg({ event = "layout-change", data = value })
    return state()
  end
  local function legacyLayout(value)
    local result = json.decode(json.encode(value))
    result.slots.skill = json.decode(json.encode(value.slots.single))
    result.slots.spell = json.decode(json.encode(value.slots.single))
    result.slots.single = nil
    return result
  end
  ready()
`;

const cases = {
  'layout defaults are alphabetical, visible, ready-gated and independent of collection': `
    assert(not state().editing and state().canEdit and state().layout.order[1] == "acid")
    assert(state().layout.order[20] == "water" and provider.writes == 0)
    local before = #world.sends
    for _, damageType in ipairs(state().layout.order) do
      assert(state().layout.types[damageType])
      assert(state().layout.slots.single[damageType] and state().layout.slots.area[damageType])
    end
    world.action("refresh-all")
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    assert(state().editing and not state().layout.slots.single.fire and provider.writes == 1)
    assert(#world.sends == before + 1 and reader.client.spells.status().refreshing)
    world.action("cancel"); assert(state().editing)
    world.line("No skills found."); assert(not reader.client.spells.status().refreshing)
    provider.env.cleanup(); provider.env.init()
    panel = world.panel(); assert(panel.panelLayout == nil)
    ready(); assert(not state().editing and not state().layout.slots.single.fire)
    assert(panel.contentWrites == 1)
  `,
  'type and slot visibility save immediately and survive winner changes': `
    world.query("skill"); world.bash()
    local entries = #reader.client.spells.get().entries
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "bash", kind = "single", visible = false })
    change({ operation = "type", damageType = "bash", visible = false })
    change({ operation = "type", damageType = "bash", visible = true })
    assert(not state().layout.slots.single.bash and state().layout.slots.area.bash)
    assert(provider.storage[storageKey].value.fixture.types.bash)
    assert(not provider.storage[storageKey].value.fixture.slots.single.bash and provider.writes == 3)
    change({ operation = "edit" })
    local before = #world.sends
    world.action("use:single:bash"); assert(#world.sends == before)
    world.packet("char.status", { level = 17 })
    assert(panel.bindings.single_bash_name == "Dirt kicking" and not state().layout.slots.single.bash)
    assert(#reader.client.spells.get().entries == entries)
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "bash", kind = "single", visible = true })
    change({ operation = "edit" })
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "dirt")
  `,
  'editing blocks use actions and bindings without changing refresh or cancel': `
    world.query("skill"); world.bash()
    assert(panel.bindings.single_bash_disabled == "false")
    change({ operation = "edit" })
    assert(panel.bindings.single_bash_disabled == "true")
    local before = #world.sends
    world.action("use:single:bash"); assert(#world.sends == before)
    world.action("refresh-all"); assert(#world.sends == before + 1)
    world.action("cancel"); world.line("No skills found.")
    assert(state().editing and not reader.client.spells.status().refreshing)
    change({ operation = "edit" })
    assert(panel.bindings.single_bash_disabled == "false")
  `,
  'removed Skill and Spell action kinds cannot bypass Single visibility': `
    world.query("skill"); world.bash()
    world.query("spell"); world.damageHeader("spell")
    world.line("Level 38 : Fireball 30 85% 45 Fire"); world.damageFooter()
    local before = #world.sends
    world.action("use:skill:bash"); world.action("use:spell:fire")
    assert(#world.sends == before)
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "sap")
    world.action("use:single:fire"); assert(world.sends[#world.sends] == "cast 45")
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "bash", kind = "single", visible = false })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    change({ operation = "edit" })
    before = #world.sends
    for _, action in ipairs({ "use:skill:bash", "use:spell:fire", "use:single:bash", "use:single:fire" }) do world.action(action) end
    assert(#world.sends == before)
  `,
  'reordering saves a complete permutation and persists across reload': `
    change({ operation = "edit" })
    change({ operation = "move", damageType = "water", target = "acid", after = false })
    assert(state().layout.order[1] == "water" and state().layout.order[2] == "acid")
    change({ operation = "move", damageType = "water", target = "air", after = true })
    assert(state().layout.order[1] == "acid" and state().layout.order[3] == "water")
    assert(#state().layout.order == 20 and provider.writes == 2)
    local before = #world.sends
    change({ operation = "move", damageType = "water", target = "water", after = true })
    change({ operation = "move", damageType = "water", target = "air", after = true })
    assert(provider.writes == 2 and #world.sends == before)
    provider.env.cleanup(); provider.env.init(); ready()
    assert(state().layout.order[3] == "water" and not state().editing and provider.writes == 2)
  `,
  'save failures restore the prior configuration with actionable feedback': `
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    provider.refuseWrites = true
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    assert(state().layout.order[1] == "acid" and not state().layout.slots.single.fire)
    assert(string.find(state().feedback, "storage refused the write", 1, true) and provider.writes == 1)
    provider.refuseWrites = false; provider.storageState = "starting"
    change({ operation = "type", damageType = "fire", visible = false })
    assert(state().layout.types.fire and string.find(state().feedback, "starting", 1, true))
    provider.storageState = "ready"
    change({ operation = "type", damageType = "fire", visible = false })
    assert(not state().layout.types.fire and state().feedback == "" and provider.writes == 2)
  `,
  'layout changes reject invalid messages, non-edit actions and stale revisions': `
    change({ operation = "type", damageType = "acid", visible = false })
    assert(state().layout.types.acid and provider.writes == 0)
    change({ operation = "edit" })
    local before = json.encode(state().layout)
    for _, value in ipairs({ {}, { operation = "unknown" }, { operation = "type", damageType = "bogus", visible = false },
      { operation = "type", damageType = "acid", visible = "false" },
      { operation = "slot", damageType = "acid", kind = "both", visible = false },
      { operation = "slot", damageType = "acid", kind = "skill", visible = false },
      { operation = "slot", damageType = "acid", kind = "spell", visible = false },
      { operation = "move", damageType = "acid", target = "bogus", after = false },
      { operation = "move", damageType = "acid", target = "air", after = 1 } }) do change(value) end
    assert(json.encode(state().layout) == before and provider.writes == 0)
    local previous = state()
    change({ operation = "type", damageType = "acid", visible = false })
    panel.events.luamsg({ event = "layout-change", data = { operation = "slot", damageType = "acid", kind = "single",
      visible = false, generation = previous.generation, revision = previous.revision } })
    panel.events.luamsg({ event = "layout-change", data = "invalid" })
    assert(state().layout.slots.single.acid and provider.writes == 1)
    assert(panel.contentWrites == 1)
  `,
  'character changes restore independent layouts and reject the previous character events': `
    change({ operation = "edit" })
    change({ operation = "type", damageType = "bash", visible = false })
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    local previous, widgetId = state(), world.panel()
    world.packet("char.base", { name = "Other" })
    assert(world.panel() == widgetId and not state().editing and state().layout.types.bash)
    assert(state().layout.order[1] == "acid")
    panel.events.luamsg({ event = "layout-change", data = { operation = "edit", generation = previous.generation, revision = previous.revision } })
    assert(not state().editing)
    world.line("No skills found.")
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    world.packet("char.base", { name = "Fixture" })
    assert(not state().editing and not state().layout.types.bash and state().layout.order[1] == "fire")
    assert(state().layout.slots.single.fire and not provider.storage[storageKey].value.other.slots.single.fire)
    world.disconnect()
    assert(not state().canEdit and not state().editing and state().layout.types.bash)
    change({ operation = "edit" }); assert(not state().editing)
  `,
  'malformed and future saved layouts fall back without automatic writes': `
    change({ operation = "edit" })
    change({ operation = "type", damageType = "bash", visible = false })
    local valid = provider.storage[storageKey].value.fixture
    local function reload(envelope)
      provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
      assert(not state().editing and state().layout.types.bash and state().layout.order[1] == "acid")
      assert(state().feedback ~= "" and provider.writes == 1 and provider.storage[storageKey] == envelope)
    end
    reload({ schemaVersion = 99, value = {} })
    reload({ schemaVersion = 1, value = false })
    reload({ schemaVersion = 1, value = { fixture = {} } })
    local duplicate = json.decode(json.encode(valid)); duplicate.order[2] = duplicate.order[1]
    reload({ schemaVersion = 1, value = { fixture = duplicate } })
    local hole = json.decode(json.encode(valid)); hole.order[20] = nil
    reload({ schemaVersion = 1, value = { fixture = hole } })
    local invalid = json.decode(json.encode(valid)); invalid.slots.single.bash = "false"
    reload({ schemaVersion = 1, value = { fixture = invalid } })
    local extra = json.decode(json.encode(valid)); extra.types.bogus = true
    reload({ schemaVersion = 1, value = { fixture = extra } })
  `,
  'layout order normalizes native numeric string indices on load and edits': `
    change({ operation = "edit" })
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    local saved = provider.storage[storageKey].value.fixture
    local stringOrder = {}
    for index, damageType in ipairs(saved.order) do stringOrder[tostring(index)] = damageType end
    saved.order = stringOrder
    provider.env.cleanup(); provider.env.init(); ready()
    assert(state().layout.order[1] == "fire" and state().feedback == "")
    provider.env.pairs = function(value)
      local iterator, context, key = pairs(value)
      return function()
        local item
        key, item = iterator(context, key)
        if key ~= nil then return tostring(key), item end
      end
    end
    change({ operation = "edit" })
    change({ operation = "move", damageType = "fire", target = "acid", after = true })
    assert(state().layout.order[1] == "acid" and state().layout.order[2] == "fire" and provider.writes == 2)
    change({ operation = "move", damageType = "fire", target = "acid", after = true })
    assert(provider.writes == 2)
    provider.env.cleanup(); provider.env.init(); ready()
    assert(state().layout.order[2] == "fire" and state().feedback == "")
  `,
  'Area slot visibility saves independently and survives reload and type visibility changes': `
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "area", visible = false })
    assert(not state().layout.slots.area.fire and state().layout.slots.single.fire)
    assert(not provider.storage[storageKey].value.fixture.slots.area.fire and provider.writes == 1)
    change({ operation = "type", damageType = "fire", visible = false })
    change({ operation = "type", damageType = "fire", visible = true })
    assert(not state().layout.slots.area.fire and state().layout.slots.single.fire)
    provider.env.cleanup(); provider.env.init(); ready()
    assert(not state().editing and not state().layout.slots.area.fire and state().layout.slots.single.fire)
    provider.refuseWrites = true
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "area", visible = true })
    assert(not state().layout.slots.area.fire and state().feedback ~= "" and provider.writes == 3)
  `,
  'legacy Skill and Spell visibility migrate with OR and persist only after an edit': `
    local original = state().layout
    local combinations = {
      { skill = true, spell = true }, { skill = true, spell = false },
      { skill = false, spell = true }, { skill = false, spell = false }
    }
    for _, visible in ipairs(combinations) do
      local legacy = legacyLayout(original)
      legacy.slots.skill.fire, legacy.slots.spell.fire = visible.skill, visible.spell
      legacy.slots.area.fire, legacy.types.bash = false, false
      legacy.order[1], legacy.order[9] = legacy.order[9], legacy.order[1]
      local envelope = { schemaVersion = 1, value = { fixture = legacy } }
      local encoded, writes = json.encode(envelope), provider.writes
      provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
      assert(state().feedback == "" and not state().editing)
      assert(state().layout.slots.single.fire == (visible.skill or visible.spell))
      assert(state().layout.slots.skill == nil and state().layout.slots.spell == nil)
      assert(not state().layout.slots.area.fire and not state().layout.types.bash and state().layout.order[1] == "fire")
      assert(provider.writes == writes and provider.storage[storageKey] == envelope and json.encode(envelope) == encoded)
      change({ operation = "edit" })
      assert(provider.writes == writes and json.encode(envelope) == encoded)
      provider.refuseWrites = true
      change({ operation = "type", damageType = "water", visible = false })
      assert(state().layout.types.water and state().feedback ~= "" and provider.writes == writes)
      assert(provider.storage[storageKey] == envelope and json.encode(envelope) == encoded)
      provider.refuseWrites = false
      change({ operation = "type", damageType = "water", visible = false })
      local saved = provider.storage[storageKey].value.fixture
      assert(provider.writes == writes + 1 and saved.slots.single.fire == (visible.skill or visible.spell))
      assert(saved.slots.skill == nil and saved.slots.spell == nil and not saved.slots.area.fire)
      provider.env.cleanup(); provider.env.init(); ready()
      assert(provider.writes == writes + 1 and state().feedback == "" and not state().layout.types.water)
      assert(state().layout.slots.single.fire == (visible.skill or visible.spell) and not state().layout.slots.area.fire)
    end
  `,
  'malformed Single and legacy Skill or Spell maps fall back without rewriting data': `
    local original = state().layout
    for _, kind in ipairs({ "single", "skill", "spell" }) do
      for _, invalid in ipairs({ false, {}, { fire = true }, "visible" }) do
        local saved = kind == "single" and json.decode(json.encode(original)) or legacyLayout(original)
        saved.slots[kind] = invalid
        local envelope = { schemaVersion = 1, value = { fixture = saved } }
        local encoded = json.encode(envelope)
        provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
        assert(state().feedback ~= "" and state().layout.slots.single.fire and provider.writes == 0)
        assert(provider.storage[storageKey] == envelope and json.encode(envelope) == encoded)
      end
      local saved = kind == "single" and json.decode(json.encode(original)) or legacyLayout(original)
      saved.slots[kind].fire = "false"
      local envelope = { schemaVersion = 1, value = { fixture = saved } }
      provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
      assert(state().feedback ~= "" and state().layout.slots.single.fire and provider.writes == 0)
      assert(provider.storage[storageKey] == envelope)
      saved = kind == "single" and json.decode(json.encode(original)) or legacyLayout(original)
      saved.slots[kind] = nil
      envelope = { schemaVersion = 1, value = { fixture = saved } }
      provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
      assert(state().feedback ~= "" and state().layout.slots.single.fire and provider.writes == 0)
      assert(provider.storage[storageKey] == envelope)
    end
  `,
  'layouts without Area migrate visibly without writing or resetting existing preferences': `
    change({ operation = "edit" })
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    change({ operation = "type", damageType = "bash", visible = false })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    local legacy = legacyLayout(provider.storage[storageKey].value.fixture)
    provider.storage[storageKey].value.fixture = legacy
    legacy.slots.area = nil
    provider.env.cleanup(); provider.env.init(); ready()
    assert(state().feedback == "" and provider.writes == 3 and legacy.slots.area == nil)
    assert(state().layout.order[1] == "fire" and not state().layout.types.bash and not state().layout.slots.single.fire)
    for _, damageType in ipairs(state().layout.order) do assert(state().layout.slots.area[damageType]) end
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "area", visible = false })
    assert(not provider.storage[storageKey].value.fixture.slots.area.fire and provider.writes == 4)
    assert(not state().layout.slots.single.fire and state().layout.order[1] == "fire")
  `,
  'malformed Area visibility falls back without rewriting saved layout data': `
    change({ operation = "edit" })
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    local valid = json.decode(json.encode(provider.storage[storageKey].value.fixture))
    for _, invalid in ipairs({ false, {}, { fire = true }, "visible" }) do
      local saved = json.decode(json.encode(valid)); saved.slots.area = invalid
      local envelope = { schemaVersion = 1, value = { fixture = saved } }
      provider.env.cleanup(); provider.storage[storageKey] = envelope; provider.env.init(); ready()
      assert(state().feedback ~= "" and state().layout.order[1] == "acid" and state().layout.slots.area.fire)
      assert(provider.writes == 1 and provider.storage[storageKey] == envelope)
    end
    local saved = json.decode(json.encode(valid)); saved.slots.area.fire = "false"
    provider.env.cleanup(); provider.storage[storageKey] = { schemaVersion = 1, value = { fixture = saved } }
    provider.env.init(); ready()
    assert(state().feedback ~= "" and state().layout.slots.area.fire and provider.writes == 1)
  `,
  'legacy layouts preserve order and visibility while appending the new damage types': `
    change({ operation = "edit" })
    change({ operation = "move", damageType = "fire", target = "acid", after = false })
    change({ operation = "type", damageType = "bash", visible = false })
    change({ operation = "slot", damageType = "fire", kind = "single", visible = false })
    local legacy = legacyLayout(provider.storage[storageKey].value.fixture)
    provider.storage[storageKey].value.fixture = legacy
    for _, damageType in ipairs({ "disease", "special" }) do
      legacy.types[damageType], legacy.slots.skill[damageType], legacy.slots.spell[damageType] = nil, nil, nil
      for index, value in ipairs(legacy.order) do
        if value == damageType then table.remove(legacy.order, index); break end
      end
    end
    legacy.slots.area = nil
    assert(#legacy.order == 18)
    provider.env.cleanup(); provider.env.init(); ready()
    assert(state().feedback == "" and not state().editing and provider.writes == 3)
    assert(state().layout.order[1] == "fire" and state().layout.order[19] == "disease" and state().layout.order[20] == "special")
    assert(not state().layout.types.bash and not state().layout.slots.single.fire)
    assert(state().layout.types.disease and state().layout.slots.single.special and state().layout.slots.area.special)
    change({ operation = "edit" })
    change({ operation = "type", damageType = "special", visible = false })
    assert(#provider.storage[storageKey].value.fixture.order == 20 and not state().layout.types.bash)
    assert(not state().layout.types.special and provider.writes == 4)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + setup + source));
