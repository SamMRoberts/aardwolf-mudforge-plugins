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
`;

test('the supplied combat-format output parses every continuation row and damage type', () => {
  const lines = readFileSync(resolve(root, 'tests/fixtures/spells-damage.txt'), 'utf8').split('\n');
  runLua(fixture + setup + `
    world.query("spell")
    for _, line in ipairs(example_lines()) do world.line(line) end
    assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
    local names = {}; for _, item in ipairs(reader.client.spells.get().entries) do names[item.name] = item end
    assert(names["Cause light"].level == 1 and names["Cause light"].percent == 85 and names["Cause light"].sn == 12)
    assert(names["Earthquake"].level == 29 and world.databases.fixture.details.earthquake.mana == 40)
    assert(names["Fire storm"].level == 44 and names["Lightning bolt"].level == 52)
    assert(world.databases.fixture.members["spell:disease"]["minor swarm"])
    assert(world.databases.fixture.members["spell:special"]["spirit bolt"])
    assert(panel.bindings.spell_magic_name == "Cause light" and panel.bindings.spell_negative_name == "Soften")
    assert(panel.bindings.spell_fire_name == "None learned" and panel.bindings.spell_disease_name == "None learned")
    local count = 0; for _, info in pairs(world.databases.fixture.details) do if info.kind == "spell" then count = count + 1 end end
    assert(count == expected_count(), tostring(count))
  `, { example_lines: () => lines, expected_count: () => lines.filter(line => /\d+%\s+\d+\s+[A-Za-z]+\s*$/.test(line)).length });
});

test('continuation rows without levels, malformed rows and conflicting duplicates retain committed data', () => runLua(fixture + setup + `
  world.query("skill"); world.bash()
  for _, rows in ipairs({ { "           Kick 100% Bash" },
    { "Level 1 : Kick 100% Bash", "           Broken BAD% Air" },
    { "Level 1 : Kick 100% Bash", "           Kick 85% Fire" },
    { "Level 1 : Kick 100% Bash", "           Kick 100% Bash" } }) do
    world.query("skill"); world.damageHeader("skill")
    for _, row in ipairs(rows) do world.line(row) end
    world.damageFooter()
    assert(panel.bindings.skill_bash_name == "Sap" and reader.client.spells.status().error)
    assert(world.databases.fixture.members["skill:bash"].sap and not world.databases.fixture.members["skill:fire"])
  end
`));

test('old individual refresh actions are ignored and filtered manual commands are not captured', () => runLua(fixture + setup + `
  local before = #world.sends
  for _, action in ipairs({ "refresh:skill:bash", "refresh:spell:fire", "refresh:skill:disease" }) do world.action(action) end
  assert(#world.sends == before and not reader.client.spells.status().refreshing)
  provider.env.onSend(world.id, "skills bash"); world.bash()
  provider.env.onSend(world.id, "spells combat"); world.fire()
  assert(panel.bindings.skill_bash_name == "Not refreshed" and panel.bindings.spell_fire_name == "Not refreshed")
  world.action("refresh-all"); provider.env.onSend(world.id, "spells fire")
  assert(reader.client.spells.status().error and not reader.client.spells.status().refreshing)
`));

test('Refresh all uses exactly two bulk queries and marks absent damage groups empty', () => runLua(fixture + setup + `
  world.action("refresh-all")
  assert(world.sends[2] == "skills damage")
  world.damageHeader("skill")
  world.line("Level 1 : Kick 100% Bash")
  world.line("          Acid attack 85% Acid")
  world.damageFooter()
  assert(world.sends[3] == "spells damage")
  world.damageHeader("spell")
  world.line("Level 38 : Fireball 30 85% 45 Fire")
  world.line("           Major swarm 30 85% 192 Disease")
  world.line("           Spirit bolt 20 85% 365 Special")
  world.damageFooter()
  assert(#world.sends == 3 and not reader.client.spells.status().refreshing)
  assert(panel.bindings.skill_bash_name == "Kick" and panel.bindings.skill_acid_name == "Acid attack")
  assert(panel.bindings.spell_fire_name == "Fireball" and panel.bindings.spell_disease_name == "Major swarm")
  assert(panel.bindings.spell_special_name == "Spirit bolt")
  assert(panel.bindings.skill_fire_name == "None learned" and panel.bindings.spell_bash_name == "None learned")
  assert(not string.find(panel.content, 'data-mud-action="refresh:', 1, true))
`));
