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
  world.query("skill"); world.line("No skills found.")
  local function combat(rows)
    world.query("spell"); world.damageHeader("spell")
    for _, row in ipairs(rows) do world.line(row) end
    world.damageFooter()
  end
  local function areas(names)
    provider.env.onSend(world.id, "spells area")
    if #names == 0 then world.line("No spells found."); return end
    world.line("Spell name Mana Learned Spell#")
    for _, name in ipairs(names) do world.line("Level 1 : " .. name .. " 1 1% 1") end
    world.damageFooter()
  end
  local function ready()
    panel = world.panel()
    panel.events.luamsg({ event = "ready", data = {} })
  end
  local function change(value)
    local state = json.decode(panel.panelLayout)
    value.generation, value.revision = state.generation, state.revision
    panel.events.luamsg({ event = "layout-change", data = value })
  end
`;
const cases = {
  'Area displays classified spells separately and casts their spell number': `
    combat({ "Level 38 : Fireball 30 85% 45 Fire", "Level 44 : Fire storm 25 85% 148 Fire" })
    areas({ "Fire storm" })
    assert(not reader.client.spells.status().error)
    assert(panel.bindings.single_fire_name == "Fireball" and panel.bindings.area_fire_name == "Fire storm")
    assert(panel.bindings.single_fire_disabled == "false" and panel.bindings.area_fire_disabled == "false")
    assert(string.find(panel.content, '<span>Single</span><span>Area</span>', 1, true))
    assert(string.find(panel.content, 'data-mud-action="use:area:fire"', 1, true))
    world.action("use:area:fire"); assert(world.sends[#world.sends] == "cast 148")
    world.action("use:single:fire"); assert(world.sends[#world.sends] == "cast 45")
    assert(panel.contentWrites == 1)
  `,
  'a damage type containing only area spells never falls back to one in Single': `
    combat({ "Level 44 : Fire storm 25 85% 148 Fire" })
    areas({ "Fire storm" })
    assert(panel.bindings.single_fire_name == "None learned" and panel.bindings.single_fire_disabled == "true")
    assert(panel.bindings.area_fire_name == "Fire storm")
    local before = #world.sends
    world.action("use:single:fire"); assert(#world.sends == before)
    world.action("use:area:fire"); assert(#world.sends == before + 1 and world.sends[#world.sends] == "cast 148")
    world.packet("char.status", { level = 43 })
    assert(panel.bindings.area_fire_name == "None learned" and panel.bindings.single_fire_name == "None learned")
    world.action("use:area:fire"); assert(#world.sends == before + 1)
  `,
  'Area selection applies practice, star, level, percentage and alphabetical rules independently': `
    combat({ "Level 38 : Fireball 30 85% 45 Fire", "Level 44 : Alpha 1 90% 101 Fire",
      "Level 44 : Beta 1 90% 102 Fire", "Level 44 : Lower practice 1 85% 103 Fire",
      "Level 90 : One percent 1 1% 104 Fire", "Level 80 : *Unusable 1 100% 105 Fire",
      "Level 300 : Future 1 100% 106 Fire", "Level 40 : Cold area 1 85% 107 Cold" })
    areas({ "Alpha", "Beta", "Lower practice", "One percent", "Unusable", "Future", "Cold area" })
    assert(panel.bindings.area_fire_name == "Alpha" and panel.bindings.single_fire_name == "Fireball")
    assert(panel.bindings.area_cold_name == "Cold area" and panel.bindings.single_cold_name == "None learned")
    world.packet("char.status", { level = 43 })
    assert(panel.bindings.area_fire_name == "None learned" and panel.bindings.single_fire_name == "Fireball")
    world.packet("char.status", { level = 300 })
    assert(panel.bindings.area_fire_name == "Future" and panel.bindings.single_fire_name == "Fireball")
  `,
  'completed area classifications update both columns while incomplete or failed results retain them': `
    combat({ "Level 38 : Fireball 30 85% 45 Fire", "Level 44 : Fire storm 25 85% 148 Fire" })
    areas({ "Fire storm" })
    provider.env.onSend(world.id, "spells area"); world.line("Spell name Mana Learned Spell#")
    world.line("Level 38 : Fireball 30 1% 45")
    assert(panel.bindings.area_fire_name == "Fire storm" and panel.bindings.single_fire_name == "Fireball")
    world.damageFooter()
    assert(panel.bindings.area_fire_name == "Fireball" and panel.bindings.single_fire_name == "Fire storm")
    world.refuseDataWrites = true; areas({ "Fire storm" }); world.refuseDataWrites = false
    assert(panel.bindings.area_fire_name == "Fireball" and panel.bindings.single_fire_name == "Fire storm")
    areas({})
    assert(panel.bindings.area_fire_name == "None learned" and panel.bindings.area_fire_disabled == "true")
    assert(panel.bindings.single_fire_name == "Fire storm")
    assert(world.record("fixture").damage.areaCollectedAt ~= nil)
  `,
  'Area actions obey edit, visibility, busy, active/combat and connection guards': `
    combat({ "Level 44 : Fire storm 25 85% 148 Fire" }); areas({ "Fire storm" }); ready()
    local before = #world.sends
    change({ operation = "edit" }); world.action("use:area:fire")
    assert(#world.sends == before and panel.bindings.area_fire_disabled == "true")
    change({ operation = "slot", damageType = "fire", kind = "area", visible = false })
    change({ operation = "edit" }); world.action("use:area:fire"); assert(#world.sends == before)
    change({ operation = "edit" })
    change({ operation = "slot", damageType = "fire", kind = "area", visible = true })
    change({ operation = "type", damageType = "fire", visible = false })
    change({ operation = "edit" }); world.action("use:area:fire"); assert(#world.sends == before)
    change({ operation = "edit" }); change({ operation = "type", damageType = "fire", visible = true })
    change({ operation = "edit" }); world.packet("char.status", { state = 8 })
    world.action("use:area:fire"); assert(#world.sends == before + 1 and world.sends[#world.sends] == "cast 148")
    world.packet("char.status", { state = 4 }); world.action("use:area:fire"); assert(#world.sends == before + 1)
    world.packet("char.status", { state = 3 }); world.commands.awspells("refresh")
    local busySends = #world.sends
    world.action("use:area:fire"); assert(#world.sends == busySends)
    world.action("cancel"); world.footer(); world.disconnect()
    world.action("use:area:fire"); assert(#world.sends == busySends and panel.bindings.area_fire_disabled == "true")
  `,
  'saved area flags reload into Area even in records predating the area collection timestamp': `
    combat({ "Level 44 : Fire storm 25 85% 148 Fire" }); areas({ "Fire storm" })
    world.record("fixture").damage.areaCollectedAt = nil
    provider.env.cleanup(); provider.env.init(); panel = world.panel()
    assert(not reader.client.spells.status().error, json.encode(reader.client.spells.status()))
    assert(panel.bindings.area_fire_name == "Fire storm" and panel.bindings.single_fire_name == "None learned", json.encode(panel.bindings))
    world.action("cancel"); world.footer()
    world.action("use:area:fire"); assert(world.sends[#world.sends] == "cast 148")
  `,
  'Area distinguishes unrefreshed discovery from a completed empty result and rejects invalid timestamp storage': `
    combat({ "Level 38 : Fireball 30 85% 45 Fire" })
    assert(panel.bindings.area_fire_name == "Not refreshed")
    areas({}); assert(panel.bindings.area_fire_name == "None learned")
    provider.env.cleanup(); provider.env.init(); panel = world.panel()
    assert(panel.bindings.area_fire_name == "None learned")
    local saved = world.record("fixture")
    for _, invalid in ipairs({ "saved", -1, {} }) do
      saved.damage.areaCollectedAt = invalid
      provider.env.cleanup(); provider.env.init(); panel = world.panel()
      assert(reader.client.spells.status().error)
      assert(panel.bindings.area_fire_name == "Not refreshed")
    end
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + setup + source));
