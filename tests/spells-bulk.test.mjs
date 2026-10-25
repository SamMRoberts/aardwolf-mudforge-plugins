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

test('Refresh all accepts the supplied blank damage skill and continues to spells', () => {
  const lines = readFileSync(resolve(root, 'tests/fixtures/skills-combat.txt'), 'utf8').split('\n');
  runLua(fixture + setup + `
    world.action("refresh-all")
    for _, line in ipairs(example_lines()) do world.line(line) end
    assert(world.sends[3] == "spells combat" and not reader.client.spells.status().error)
    world.line("No spells found.")
    assert(world.sends[4] == "spells area")
    world.line("No spells found.")
    assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
    local names = {}; for _, item in ipairs(reader.client.spells.get().entries) do names[item.name] = item end
    assert(names.Hammerswing.level == 51 and names.Hammerswing.percent == 85)
    assert(names.Sap.percent == 86 and panel.bindings.single_bash_name == "Sap")
    assert(world.record("fixture").damage.details.hammerswing.kind == "skill")
    for _, members in pairs(world.record("fixture").damage.members) do assert(not members.hammerswing) end
  `, { example_lines: () => lines });
});

test('blank damage skill and spell continuation rows retain their fields without memberships', () => runLua(fixture + setup + `
  world.query("skill"); world.damageHeader("skill")
  world.line("Level 50 : Sap 86% Bash")
  world.line("           Hammerswing 85%  ")
  world.damageFooter()
  world.query("spell"); world.damageHeader("spell")
  world.line("Level 38 : Fireball 30 85% 45 Fire")
  world.line("           Untyped spell 25 90% 46  ")
  world.damageFooter()
  assert(not reader.client.spells.status().error)
  local names = {}; for _, item in ipairs(reader.client.spells.get().entries) do names[item.name] = item end
  assert(names.Hammerswing.level == 50 and names.Hammerswing.percent == 85)
  assert(names["Untyped spell"].level == 38 and names["Untyped spell"].sn == 46)
  assert(names["Untyped spell"].percent == 90 and world.record("fixture").damage.details["untyped spell"].mana == 25)
  assert(panel.bindings.single_bash_name == "Sap" and panel.bindings.single_fire_name == "Fireball")
  for _, members in pairs(world.record("fixture").damage.members) do
    assert(not members.hammerswing and not members["untyped spell"])
  end
`));

test('blank damage rows preserve duplicate and conflicting row rejection', () => runLua(fixture + setup + `
  world.query("skill"); world.bash()
  for _, rows in ipairs({ { "Level 51 : Hammerswing 85%", "           Hammerswing 85%" },
    { "Level 51 : Hammerswing 85%", "           Hammerswing 86% Bash" },
    { "Level 51 : Hammerswing 86% Bash", "           Hammerswing 85%" } }) do
    world.query("skill"); world.damageHeader("skill")
    for _, row in ipairs(rows) do world.line(row) end
    world.damageFooter()
    assert(reader.client.spells.status().error and panel.bindings.single_bash_name == "Sap")
    assert(not world.record("fixture").damage.details.hammerswing)
  end
`));

test('the supplied combat-format output parses every continuation row and damage type', () => {
  const lines = readFileSync(resolve(root, 'tests/fixtures/spells-damage.txt'), 'utf8').split('\n');
  runLua(fixture + setup + `
    world.query("spell")
    for _, line in ipairs(example_lines()) do world.line(line) end
    assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
    local names = {}; for _, item in ipairs(reader.client.spells.get().entries) do names[item.name] = item end
    assert(names["Cause light"].level == 1 and names["Cause light"].percent == 85 and names["Cause light"].sn == 12)
    assert(names["Earthquake"].level == 29 and world.record("fixture").damage.details.earthquake.mana == 40)
    assert(names["Fire storm"].level == 44 and names["Lightning bolt"].level == 52)
    assert(world.record("fixture").damage.members["spell:disease"]["minor swarm"])
    assert(world.record("fixture").damage.members["spell:special"]["spirit bolt"])
    assert(panel.bindings.single_magic_name == "Cause light" and panel.bindings.single_negative_name == "Soften")
    assert(panel.bindings.single_fire_name == "Not refreshed" and panel.bindings.single_disease_name == "Not refreshed")
    local count = 0; for _, info in pairs(world.record("fixture").damage.details) do if info.kind == "spell" then count = count + 1 end end
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
    assert(panel.bindings.single_bash_name == "Sap" and reader.client.spells.status().error)
    assert(world.record("fixture").damage.members["skill:bash"].sap and not next(world.record("fixture").damage.members["skill:fire"] or {}))
  end
`));

test('old individual refresh actions are ignored and filtered manual commands are not captured', () => runLua(fixture + setup + `
  local before = #world.sends
  for _, action in ipairs({ "refresh:skill:bash", "refresh:spell:fire", "refresh:skill:disease" }) do world.action(action) end
  assert(#world.sends == before and not reader.client.spells.status().refreshing)
  provider.env.onSend(world.id, "skills bash"); world.bash()
  provider.env.onSend(world.id, "spells fire"); world.fire()
  assert(panel.bindings.single_bash_name == "Not refreshed" and panel.bindings.single_fire_name == "Not refreshed")
  world.action("refresh-all"); provider.env.onSend(world.id, "spells fire")
  assert(reader.client.spells.status().error and not reader.client.spells.status().refreshing)
`));

test('Refresh all uses three queries and marks absent damage groups empty', () => runLua(fixture + setup + `
  world.action("refresh-all")
  assert(world.sends[2] == "skills combat")
  world.damageHeader("skill")
  world.line("Level 1 : Kick 100% Bash")
  world.line("          Acid attack 85% Acid")
  world.damageFooter()
  assert(world.sends[3] == "spells combat")
  world.damageHeader("spell")
  world.line("Level 38 : Fireball 30 85% 45 Fire")
  world.line("           Major swarm 30 85% 192 Disease")
  world.line("           Spirit bolt 20 85% 365 Special")
  world.damageFooter()
  assert(world.sends[4] == "spells area")
  world.line("No spells found.")
  assert(#world.sends == 4 and not reader.client.spells.status().refreshing)
  assert(panel.bindings.single_bash_name == "Kick" and panel.bindings.single_acid_name == "Acid attack")
  assert(panel.bindings.single_fire_name == "Fireball" and panel.bindings.single_disease_name == "Major swarm")
  assert(panel.bindings.single_special_name == "Spirit bolt")
  assert(not next(world.record("fixture").damage.members["skill:fire"] or {}))
  assert(not next(world.record("fixture").damage.members["spell:bash"] or {}))
  assert(panel.bindings.single_air_name == "None learned")
  assert(not string.find(panel.content, 'data-mud-action="refresh:', 1, true))
`));

test('legacy manual damage queries still capture complete results', () => runLua(fixture + setup + `
  provider.env.onSend(world.id, "skills damage"); world.bash()
  provider.env.onSend(world.id, "spells damage"); world.damageHeader("spell")
  world.line("Level 38 : Fireball 30 85% 45 Fire"); world.damageFooter()
  assert(panel.bindings.single_bash_name == "Sap" and panel.bindings.single_fire_name == "Fireball")
  assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
`));
