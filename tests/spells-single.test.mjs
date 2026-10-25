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
  local function combat(kind, rows)
    world.query(kind); world.damageHeader(kind)
    for _, row in ipairs(rows) do world.line(row) end
    world.damageFooter()
  end
`;

const cases = {
  'Single ranks skills and non-area spells together and dispatches the winning kind': `
    provider.env.formatTime = function(timestamp) return tostring(timestamp) end
    world.tick(100)
    combat("skill", { "Level 50 : Sap 85% Bash" })
    assert(panel.bindings.single_bash_name == "Sap")
    assert(string.find(panel.bindings.single_bash_tip, "Sap (skill):", 1, true))
    assert(string.find(panel.bindings.single_bash_tip, "last refreshed 100.", 1, true))
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "sap")
    world.tick(100)
    combat("spell", { "Level 60 : Force bolt 20 80% 321 Bash" })
    assert(panel.bindings.single_bash_name == "Force bolt")
    assert(string.find(panel.bindings.single_bash_tip, "Force bolt (spell):", 1, true))
    assert(string.find(panel.bindings.single_bash_tip, "last refreshed 200.", 1, true))
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "cast 321")
    world.packet("char.status", { level = 55 })
    assert(panel.bindings.single_bash_name == "Sap")
    assert(string.find(panel.bindings.single_bash_tip, "last refreshed 100.", 1, true))
    world.commands.awspells('command "Sap" kick')
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "kick")
    local before = #world.sends
    world.action("use:skill:bash"); world.action("use:spell:bash")
    assert(#world.sends == before)
  `,
  'Single shows available winners immediately and waits for both lists before declaring empty': `
    assert(panel.bindings.single_fire_name == "Not refreshed")
    combat("skill", { "Level 1 : Kick 85% Bash" })
    assert(panel.bindings.single_bash_name == "Kick" and panel.bindings.single_fire_name == "Not refreshed")
    combat("spell", { "Level 38 : Fireball 30 85% 45 Fire" })
    assert(panel.bindings.single_fire_name == "Fireball" and panel.bindings.single_acid_name == "None learned")
    combat("skill", {})
    assert(panel.bindings.single_bash_name == "None learned" and panel.bindings.single_fire_name == "Fireball")
  `,
  'Single also displays spell-only discovery without implying uncollected skills are empty': `
    combat("spell", { "Level 38 : Fireball 30 85% 45 Fire" })
    assert(panel.bindings.single_fire_name == "Fireball" and panel.bindings.single_bash_name == "Not refreshed")
    combat("skill", {})
    assert(panel.bindings.single_bash_name == "None learned" and panel.bindings.single_fire_name == "Fireball")
  `,
  'Single applies percentage and alphabetical ties across kinds': `
    combat("skill", { "Level 50 : Alpha 80% Bash" })
    combat("spell", { "Level 50 : Beta 20 90% 321 Bash" })
    assert(panel.bindings.single_bash_name == "Beta")
    combat("skill", { "Level 50 : Alpha 90% Bash" })
    assert(panel.bindings.single_bash_name == "Alpha")
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "alpha")
    combat("spell", { "Level 99 : One percent 1 1% 322 Bash", "Level 98 : *Unusable 1 100% 323 Bash",
      "Level 300 : Future 1 100% 324 Bash", "Level 50 : Aardvark 1 90% 325 Bash" })
    assert(panel.bindings.single_bash_name == "Aardvark")
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "cast 325")
  `,
  'Single excludes area spells while retaining an eligible skill fallback': `
    combat("skill", { "Level 17 : Dirt kicking 85% Bash" })
    combat("spell", { "Level 60 : Force storm 20 90% 321 Bash" })
    assert(panel.bindings.single_bash_name == "Force storm")
    provider.env.onSend(world.id, "spells area"); world.line("Spell name Mana Learned Spell#")
    world.line("Level 60 : Force storm 20 90% 321"); world.damageFooter()
    assert(panel.bindings.single_bash_name == "Dirt kicking" and panel.bindings.area_bash_name == "Force storm")
    world.action("use:single:bash"); assert(world.sends[#world.sends] == "dirt")
    world.action("use:area:bash"); assert(world.sends[#world.sends] == "cast 321")
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + setup + source));
