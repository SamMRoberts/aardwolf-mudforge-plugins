import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(resolve(root, 'tests/fixtures/spells.lua'), 'utf8');
const setup = `
  local world, reader, provider = spellsWorld()
  world.active(); world.header()
  world.line(" Earthquake 29 39 85")
  world.line(" Ice storm 59 150 85")
  world.line(" Ultrablast 73 136 85")
  world.line(" Ice cloud 92 85 85")
  world.line(" Death field 99 109 85")
  world.line(" Fire breath 107 84 85")
  world.line(" Fireball 38 45 85")
  world.footer()
  local function entry(name)
    for _, item in ipairs(reader.client.spells.get().entries) do if item.name == name then return item end end
  end
  local function areaQuery()
    provider.env.onSend(world.id, "spells area")
  end
  local function areaHeader()
    world.line("           Spell name                 Mana  Learned  Spell#")
    world.line("—————————— —————————————————————————— ————  ———————  ——————")
  end
  local function areaSample()
    areaQuery(); areaHeader()
    world.line("Level 29 : Earthquake 40 1% 39")
    world.damageFooter()
  end
`;

test('supplied area output marks existing names without replacing catalog fields or adding entries', () => {
  const lines = readFileSync(resolve(root, 'tests/fixtures/spells-area.txt'), 'utf8').split('\n');
  runLua(fixture + setup + `
    areaQuery()
    for _, line in ipairs(example_lines()) do world.line(line) end
    assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
    local saved = reader.client.spells.get()
    assert(#saved.entries == 7 and world.dataWrites == 2)
    for index = 1, 6 do assert(saved.entries[index].area == true and saved.entries[index].percent == 85) end
    assert(entry("Earthquake").sn == 39 and entry("Earthquake").level == 29)
    assert(entry("Fireball").area == nil)
    assert(world.record("fixture").snapshot.entries[1].area == true)
    assert(not next(world.record("fixture").damage.details))
    provider.env.cleanup(); provider.env.init()
    assert(entry("Earthquake").area == true and #reader.client.spells.get().entries == 7)
  `, { example_lines: () => lines });
});

test('Refresh all discovers area spells after the two combat lists and retains damage metadata', () => runLua(fixture + setup + `
  world.action("refresh-all")
  assert(world.sends[2] == "skills combat")
  world.line("No skills found.")
  assert(world.sends[3] == "spells combat")
  world.damageHeader("spell")
  world.line("Level 29 : Earthquake 40 85% 39 Earth")
  world.line("Level 38 : Fireball 30 85% 45 Fire")
  world.damageFooter()
  assert(world.sends[4] == "spells area" and reader.client.spells.status().refreshing)
  areaHeader(); world.line("Level 29 : Earthquake 40 1% 39")
  assert(entry("Earthquake").area == nil)
  world.damageFooter()
  assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
  assert(entry("Earthquake").area == true and entry("Earthquake").percent == 85)
  assert(entry("Fireball").area == nil)
  assert(world.record("fixture").damage.details.earthquake.mana == 40)
  assert(world.record("fixture").damage.members["spell:earth"].earthquake)
`));

test('area matching ignores case and stars, inherits levels, accepts pages, and skips unknown names', () => runLua(fixture + setup + `
  areaQuery(); areaHeader()
  world.line("Level 29 : *EARTHQUAKE 40 1% 39")
  world.line("           Ice storm* 60 1% 150")
  areaHeader()
  world.line("           Missing spell 1 1% 999")
  world.line("You have 10 abilities forgotten."); world.damageFooter()
  assert(entry("Earthquake").area == true and entry("Ice storm").area == true)
  assert(not entry("Earthquake").unusable and entry("Ice storm").level == 59)
  assert(#reader.client.spells.get().entries == 7 and not entry("Missing spell"))
`));

test('full and combat refreshes preserve area flags; the next area result removes stale flags', () => runLua(fixture + setup + `
  areaSample()
  world.commands.awspells("refresh"); world.header()
  world.line(" Earthquake 29 39 90"); world.line(" Fireball 38 45 90"); world.footer()
  assert(entry("Earthquake").area == true and entry("Earthquake").percent == 90)
  world.query("spell"); world.damageHeader("spell")
  world.line("Level 29 : Earthquake 40 85% 39 Earth"); world.damageFooter()
  assert(entry("Earthquake").area == true)
  areaQuery(); areaHeader(); world.line("Level 38 : Fireball 30 1% 45"); world.damageFooter()
  assert(entry("Earthquake").area == nil and entry("Fireball").area == true)
  areaQuery(); world.line("No spells found.")
  assert(entry("Fireball").area == nil and #reader.client.spells.get().entries == 2)
  assert(world.record("fixture").damage.members["spell:earth"].earthquake)
`));

test('malformed, duplicate, conflicting and oversized area results retain the prior flags', () => runLua(fixture + setup + `
  areaSample()
  local before, writes = json.encode(world.record("fixture")), world.dataWrites
  for _, rows in ipairs({ { "Level BAD : Broken 40 1% 39" },
    { "           Earthquake 40 1% 39" }, { "Level 29 : Earthquake 40 101% 39" },
    { "Level 29 : Earthquake BAD 1% 39" }, { "Level 29 : Earthquake 40 1% 39 Earth" },
    { "Level 29 : Earthquake 40 1% 39", "Level 29 : earthquake 40 1% 39" } }) do
    areaQuery(); areaHeader()
    for _, row in ipairs(rows) do world.line(row) end
    world.damageFooter()
    assert(reader.client.spells.status().error and not reader.client.spells.status().refreshing)
    assert(json.encode(world.record("fixture")) == before and world.dataWrites == writes)
  end
  areaQuery(); areaHeader()
  for index = 1, 1001 do world.line("Level 1 : Ability " .. tostring(index) .. " 1 1% " .. tostring(index)) end
  world.damageFooter()
  assert(reader.client.spells.status().error and world.dataWrites == writes and entry("Earthquake").area == true)
`));

test('incomplete, cancelled, interrupted and refused area saves retain the prior snapshot', () => runLua(fixture + setup + `
  areaSample()
  local writes = world.dataWrites
  areaQuery(); areaHeader(); world.line("Level 38 : Fireball 30 1% 45")
  world.tick(60000)
  assert(reader.client.spells.status().error and entry("Earthquake").area == true)
  areaQuery(); areaHeader(); world.line("Level 38 : Fireball 30 1% 45")
  world.action("cancel"); world.damageFooter()
  assert(not reader.client.spells.status().refreshing and entry("Earthquake").area == true)
  areaQuery(); provider.env.onSend(world.id, "spells fire"); world.damageFooter()
  assert(reader.client.spells.status().error and entry("Earthquake").area == true)
  for _, mode in ipairs({ "refuseDataWrites", "throwDataWrites" }) do
    world[mode] = true
    areaQuery(); world.line("No spells found.")
    assert(reader.client.spells.status().error and entry("Earthquake").area == true)
    world[mode] = false
  end
  assert(world.dataWrites == writes and entry("Fireball").area == nil)
`));

test('area collection is isolated across sessions, disconnects and character changes', () => runLua(fixture + setup + `
  areaSample()
  areaQuery(); areaHeader()
  world.line("Level 38 : Fireball 30 1% 45", "different-session")
  world.damageFooter()
  assert(entry("Fireball").area == nil and entry("Earthquake").area == nil)
  areaSample(); areaQuery(); areaHeader()
  world.disconnect(); world.damageFooter()
  assert(reader.client.spells.get() == nil and world.record("fixture").snapshot.entries[1].area == true)
  world.active("Other"); world.sample()
  assert(entry("Axe").area == nil)
  assert(world.record("fixture").snapshot.entries[1].area == true)
`));

test('area collection without a canonical list fails without adding filtered rows', () => runLua(fixture + `
  local world, reader, provider = spellsWorld()
  world.active(); world.action("cancel"); world.footer()
  provider.env.onSend(world.id, "spells area")
  world.line("Spell name Mana Learned Spell#")
  world.line("Level 29 : Earthquake 40 1% 39"); world.damageFooter()
  assert(reader.client.spells.status().error and reader.client.spells.get() == nil and world.dataWrites == 0)
`));
