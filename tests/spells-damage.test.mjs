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
const cases = {
  'damage panel parses supplied lists, selects Sap, and excludes 1% spells': `
    assert(panel.config.size.width == 540 and panel.config.size.height == 400)
    assert(panel.bindings.skill_bash_name == "Not refreshed")
    world.query("skill"); assert(reader.client.spells.status().refreshing)
    world.bash()
    assert(panel.bindings.skill_bash_name == "Sap" and panel.bindings.skill_bash_disabled == "false")
    assert(#reader.client.spells.get().entries == 10)
    world.query("spell"); assert(reader.client.spells.status().refreshing)
    world.fire()
    assert(panel.bindings.spell_fire_name == "None learned" and panel.bindings.spell_fire_disabled == "true")
    assert(world.databases.fixture.details.fireball.mana == 30)
    assert(panel.contentWrites == 1)
    assert(string.find(panel.bindings.skill_bash_tip, "level 50, learned 85%; sap", 1, true))
    world.action("use:skill:bash"); assert(world.sends[#world.sends] == "sap")
    local before = #world.sends; world.action("use:spell:fire"); assert(#world.sends == before)
  `,
  'damage selection applies threshold, flags, level, percentage and alphabetical ties': `
    world.query("spell"); world.damageHeader("spell")
    for _, row in ipairs({ "Level 99 : Zero 1 0% 1 Fire", "Level 98 : One 1 1% 2 Fire",
      "Level 44 : Two 0 2% 3 Fire", "Level 44 : Beta 1 100% 4 Fire", "Level 44 : Alpha 1 100% 5 Fire",
      "Level 70 : *Unavailable 1 100% 6 Fire", "Level 300 : Future 1 100% 7 Fire" }) do world.line(row) end
    world.damageFooter()
    assert(panel.bindings.spell_fire_name == "Alpha")
    world.packet("char.status", { level = 43 }); assert(panel.bindings.spell_fire_name == "None learned")
    world.packet("char.status", { level = 44 }); world.action("use:spell:fire")
    assert(world.sends[#world.sends] == "cast 5")
  `,
  'bulk refresh replaces all memberships for its kind and merges canonical values': `
    world.query("skill"); world.bash()
    world.query("spell"); world.damageHeader("spell"); world.line("Level 38 : Fireball 30 85% 45 Fire"); world.damageFooter()
    world.query("skill"); world.damageHeader("skill")
    world.line("Level 1 : Kick 99% Fire"); world.line("          Kick 99% Bash"); world.damageFooter()
    assert(world.databases.fixture.members["skill:bash"].kick and world.databases.fixture.members["skill:fire"].kick)
    world.query("skill"); world.damageHeader("skill"); world.line("Level 1 : Kick 2% Bash"); world.damageFooter()
    assert(panel.bindings.skill_bash_name == "Kick" and panel.bindings.skill_fire_name == "None learned")
    assert(not world.databases.fixture.members["skill:bash"].sap)
    assert(not world.databases.fixture.members["skill:fire"] and panel.bindings.spell_fire_name == "Fireball")
    local saved = reader.client.spells.get(); assert(#saved.entries == 11)
    for _, item in ipairs(saved.entries) do if item.name == "Kick" then assert(item.percent == 2) end end
    world.query("skill"); world.line("No skills found.")
    assert(panel.bindings.skill_bash_name == "None learned" and panel.bindings.skill_fire_name == "None learned")
    assert(#reader.client.spells.get().entries == 11 and panel.bindings.spell_fire_name == "Fireball")
  `,
  'full refresh preserves retained enrichment and prunes removed memberships': `
    world.query("skill"); world.bash()
    world.commands.awspells("refresh"); world.header()
    world.line(" Sap 50 - 1"); world.line(" Dirt kicking 17 - 85"); world.footer()
    assert(panel.bindings.skill_bash_name == "Dirt kicking")
    assert(not world.databases.fixture.details.kick and not world.databases.fixture.members["skill:bash"].kick)
    world.action("use:skill:bash"); assert(world.sends[#world.sends] == "dirt")
    world.commands.awspells('command "Dirt kicking" dirt')
    world.commands.awspells("refresh"); world.sample()
    assert(panel.bindings.skill_bash_name == "None learned")
    assert(world.databases.fixture.commands["dirt kicking"] == "dirt")
  `,
  'refresh all sends two requests in order and continues through empty responses': `
    world.action("refresh-all")
    local count = 1
    for _, kind in ipairs({ "skill", "spell" }) do
      count = count + 1
      assert(#world.sends == count and world.sends[count] == kind .. "s combat")
      assert(reader.client.spells.status().refreshing)
      world.line("No " .. kind .. "s found.")
    end
    assert(#world.sends == 3 and not reader.client.spells.status().refreshing)
    local groups = 0; for _ in pairs(world.databases.fixture.times) do groups = groups + 1 end
    assert(groups == 40)
    assert(panel.bindings.spell_water_name == "None learned" and panel.bindings.skill_acid_name == "None learned")
    assert(panel.bindings.cancelDisabled == "true")
  `,
  'refresh queue stops on cancellation, changed eligibility, overlap and failure': `
    world.action("refresh-all"); world.action("cancel")
    world.line("No skills found."); assert(#world.sends == 2 and not reader.client.spells.status().refreshing)
    world.action("refresh-all"); world.packet("char.status", { state = 8 })
    world.line("No skills found."); assert(#world.sends == 3)
    world.packet("char.status", { state = 3 }); world.action("refresh-all")
    provider.env.onSend(world.id, "skills combat")
    assert(not reader.client.spells.status().refreshing and #world.sends == 4)
    world.action("refresh-all"); world.damageHeader("skill"); world.line("Level 1 : Kick 100% Bogus")
    assert(#world.sends == 5 and reader.client.spells.status().error)
    world.line("No skills found."); assert(#world.sends == 5)
  `,
  'cancel drains sent output before accepting another collection and has a bounded wait': `
    world.query("skill"); world.damageHeader("skill"); world.line("Level 50 : Sap 85% Bash")
    world.action("cancel"); assert(reader.client.spells.status().refreshing)
    local before = #world.sends
    world.query("skill"); assert(#world.sends == before)
    world.damageFooter(); assert(not reader.client.spells.status().refreshing)
    assert(panel.bindings.skill_bash_name == "Not refreshed")
    world.query("skill"); world.action("cancel")
    world.tick(60000); assert(not reader.client.spells.status().refreshing)
    assert(panel.bindings.skill_fire_name == "Not refreshed")
    world.query("skill"); world.bash(); assert(panel.bindings.skill_bash_name == "Sap")
    world.query("skill"); world.action("cancel")
    world.line("[1543/1543hp 1239/1239mn 1562/1562mv 0qt 1987tnl] >")
    assert(not reader.client.spells.status().refreshing)
  `,
  'cancel while preparing a manual query retains ownership until its output ends': `
    world.delay = true
    provider.env.onSend(world.id, "skills combat")
    world.action("cancel"); world.drain()
    assert(reader.client.spells.status().refreshing)
    local before = #world.sends
    world.query("skill"); assert(#world.sends == before)
    world.line("No skills found."); assert(not reader.client.spells.status().refreshing)
    world.delay = false; world.query("skill"); world.bash()
    assert(panel.bindings.skill_bash_name == "Sap")
  `,
  'damage failures retain prior results and never publish partial rows': `
    world.query("skill"); world.bash()
    for _, row in ipairs({ "Level BAD : Broken 85% Bash", "Level 0 : Broken 85% Bash",
      "Level 4 : Broken 101% Bash", "Level 5 : Broken 85% Bogus", "Level 5 : Broken 85%", "Level 5 : Broken BAD% Bash" }) do
      world.query("skill"); world.damageHeader("skill"); world.line(row); world.damageFooter()
      assert(panel.bindings.skill_bash_name == "Sap" and reader.client.spells.status().error)
    end
    world.query("skill"); world.damageHeader("skill")
    world.line("Level 1 : Kick 85% Bash"); world.line("Level 1 : kick 85% Bash"); world.damageFooter()
    assert(panel.bindings.skill_bash_name == "Sap")
    world.query("spell"); world.damageHeader("spell"); world.line("Level 1 : Broken 1 2% 0 Fire"); world.damageFooter()
    assert(panel.bindings.spell_fire_name == "Not refreshed")
    world.query("skill"); world.damageHeader("skill"); world.line("Level 1 : Kick 100% Bash")
    world.tick(60000); assert(panel.bindings.skill_bash_name == "Sap" and not reader.client.spells.status().refreshing)
  `,
  'damage parser preserves chatter, ANSI-clean data, repeated headers and other sessions': `
    world.query("skill")
    world.damageHeader("skill")
    world.line("Level 90 : Fake 100% Bash", "other")
    world.line("A friend tells you:  hello there.")
    world.line("You have 2 abilities forgotten.")
    world.line("Level 1 : Kick 100% Bash", nil, "\\27[31mLevel 1 : Kick 100% Bash\\27[0m")
    world.damageHeader("skill"); world.line("Level 50 : Sap 85% Bash"); world.damageFooter()
    assert(panel.bindings.skill_bash_name == "Sap")
    provider.env.onSend(world.id, "spells combat"); world.fire()
    assert(panel.bindings.spell_fire_name == "None learned")
  `,
  'damage commands validate actions and current state, including combat': `
    world.query("skill"); world.bash()
    local before = #world.sends
    for _, action in ipairs({ "use:skill:poison", "use:skill:bash;quit", "use:spell:bash", "noop:skill:bash" }) do world.action(action) end
    panel.events.action({ action = 1 }); panel.events.action(nil)
    assert(#world.sends == before)
    world.packet("char.status", { state = 8 }); world.action("use:skill:bash")
    assert(world.sends[#world.sends] == "sap" and panel.bindings.refreshDisabled == "true")
    before = #world.sends; world.query("skill"); assert(#world.sends == before)
    world.packet("char.status", { state = 9 }); world.action("use:skill:bash"); assert(#world.sends == before)
    world.packet("char.status", { state = 3 }); world.query("skill")
    before = #world.sends; world.action("use:skill:bash"); assert(#world.sends == before)
    world.bash(); world.disconnect(); world.action("use:skill:bash"); assert(#world.sends == before)
    assert(panel.bindings.skill_bash_name == "Not refreshed" and panel.bindings.skill_bash_disabled == "true")
  `,
  'command overrides are character-scoped, validated, persisted and resettable': `
    world.query("skill"); world.damageHeader("skill"); world.line("Level 17 : Dirt kicking 85% Bash"); world.damageFooter()
    world.action("use:skill:bash"); assert(world.sends[#world.sends] == "dirt")
    world.commands.awspells('command "Dirt kicking" kick')
    assert(world.databases.fixture.commands["dirt kicking"] == "kick")
    assert(world.commands.awspells('command "Dirt kicking"') == "dirt kicking: kick")
    world.action("use:skill:bash"); assert(world.sends[#world.sends] == "kick")
    for _, command in ipairs({ "dirt;quit", "dirt|quit", "dirt\\nquit", "dirt~quit", "", string.rep("x",129) }) do
      world.commands.awspells('command "Dirt kicking" ' .. command)
      assert(world.databases.fixture.commands["dirt kicking"] == "kick")
    end
    world.commands.awspells('command-reset "Dirt kicking"')
    assert(not world.databases.fixture.commands["dirt kicking"])
    world.action("use:skill:bash"); assert(world.sends[#world.sends] == "dirt")
    world.commands.awspells('command "Dirt kicking" kick')
    world.packet("char.base", { name = "Other" }); world.sample()
    assert(world.commands.awspells('command "Dirt kicking"') == "dirt kicking: dirt")
  `,
  'submitted save finishes atomically after cancel and never starts another queued query': `
    world.action("refresh-all"); world.damageHeader("skill"); world.line("Level 1 : Acid attack 85% Acid")
    world.delay = true; world.damageFooter(); world.action("cancel")
    assert(reader.client.spells.status().refreshing)
    assert(panel.bindings.skill_acid_name == "Not refreshed")
    world.action("refresh-all"); assert(#world.sends == 2)
    world.drain(); assert(not reader.client.spells.status().refreshing and #world.sends == 2)
    assert(panel.bindings.skill_acid_name == "Acid attack" and string.find(panel.bindings.status, "cancelled", 1, true))
  `,
  'damage saves rollback and reconcile unknown outcomes including empty lists and overrides': `
    world.query("skill"); world.bash()
    world.rollback = true; world.query("skill"); world.line("No skills found.")
    assert(panel.bindings.skill_bash_name == "Sap")
    world.rollback = false; world.unknown = true
    world.query("skill"); world.line("No skills found.")
    assert(panel.bindings.skill_bash_name == "None learned" and not reader.client.spells.status().error)
    world.query("skill"); world.bash()
    assert(panel.bindings.skill_bash_name == "Sap" and not reader.client.spells.status().error)
    world.commands.awspells('command "Sap" kick')
    assert(world.commands.awspells('command "Sap"') == "sap: kick" and not reader.client.spells.status().error)
    world.commands.awspells('command-reset "Sap"')
    assert(not world.databases.fixture.commands.sap and not reader.client.spells.status().error)
  `,
  'damage results reload, keep widget identity through character changes, and clean up': `
    world.query("skill"); world.bash()
    provider.env.cleanup(); assert(next(provider.widgets) == nil)
    provider.env.init(); panel = world.panel()
    assert(panel.bindings.skill_bash_name == "Sap" and panel.bindings.skill_bash_disabled == "true")
    world.header(); world.line(" Sap 50 - 85"); world.footer()
    assert(panel.bindings.skill_bash_name == "Sap" and panel.bindings.skill_bash_disabled == "false")
    local original = panel
    world.packet("char.base", { name = "Other" }); world.sample()
    assert(world.panel() == original and panel.bindings.skill_bash_name == "Not refreshed" and panel.contentWrites == 1)
    world.commands.awspells("show"); assert(panel.lastShowForced and panel.visible)
    provider.env.cleanup(); provider.env.cleanup(); assert(next(provider.widgets) == nil)
  `,
  'damage loading paginates private metadata and bounds the merged canonical list': `
    world.query("skill"); world.damageHeader("skill")
    for index = 1, 990 do world.line("Level 1 : Ability " .. tostring(index) .. " 85% Bash") end
    world.damageFooter()
    assert(#reader.client.spells.get().entries == 994)
    world.query("skill"); world.line("No skills found.")
    assert(panel.bindings.skill_bash_name == "None learned" and not reader.client.spells.status().error)
    world.query("skill"); world.damageHeader("skill")
    for index = 1, 10 do world.line("Level 1 : New ability " .. tostring(index) .. " 85% Bash") end
    world.damageFooter()
    assert(#reader.client.spells.get().entries == 994 and reader.client.spells.status().error)
  `,
  'Core restart restores saved damage data without another automatic query': `
    world.query("skill"); world.bash()
    local before = #world.sends
    world.unload(world.plugins["imported-core-17"])
    assert(reader.client.spells.get() == nil and panel.bindings.skill_bash_name == "Not refreshed")
    world.core("replacement-core")
    world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3, level = 200 })
    assert(#world.sends == before and panel.bindings.skill_bash_name == "Sap")
    assert(reader.client.spells.get() and panel.bindings.skill_bash_disabled == "false")
  `,
  'damage dependency and send failures remain actionable in the panel': `
    world.helperReady = false; world.action("refresh-all")
    assert(string.find(panel.bindings.status, "File System Access", 1, true))
    assert(not reader.client.spells.status().refreshing)
    world.helperReady = true
    local sendCommand = provider.env.send
    provider.env.send = function() return false end
    world.action("refresh-all")
    assert(string.find(panel.bindings.status, "Could not send skills combat", 1, true))
    assert(not reader.client.spells.status().refreshing)
    provider.env.send = sendCommand
    world.action("refresh-all"); world.bash(); world.line("No spells found.")
    assert(panel.bindings.skill_bash_name == "Sap" and not reader.client.spells.status().error)
  `,
  'damage rejects corrupt private records without replacing the exposed snapshot': `
    world.query("skill"); world.bash()
    world.databases.fixture.times["skill:bash"] = "invalid"
    local before = #world.sends; world.query("skill")
    assert(#world.sends == before and reader.client.spells.status().error)
    assert(panel.bindings.skill_bash_name == "Sap")
    world.databases.fixture.times["skill:bash"] = world.time
    world.databases.fixture.commands.sap = "sap;quit"
    world.query("skill")
    assert(#world.sends == before and panel.bindings.skill_bash_name == "Sap")
  `,
  'damage markup treats external names as text and refuses unsafe fallback commands': `
    world.query("skill"); world.damageHeader("skill")
    world.line("Level 50 : <img src=x onerror=alert(1)> 85% Bash"); world.damageFooter()
    assert(panel.bindings.skill_bash_name == "<img src=x onerror=alert(1)>")
    assert(not string.find(panel.content, "<img", 1, true) and panel.bindings.skill_bash_disabled == "true")
    local before = #world.sends; world.action("use:skill:bash"); assert(#world.sends == before)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + setup + source));

test('empty damage result can be saved and reconciled before any full snapshot', () => runLua(fixture + `
  local world, reader, provider = spellsWorld()
  world.active(); world.action("cancel"); world.footer()
  assert(reader.client.spells.get() == nil and not reader.client.spells.status().refreshing)
  world.unknown = true
  world.query("skill"); world.line("No skills found.")
  assert(reader.client.spells.get() == nil and not reader.client.spells.status().error)
  assert(world.panel().bindings.skill_electric_name == "None learned")
  world.unknown = false; provider.env.cleanup(); provider.env.init()
  assert(world.panel().bindings.skill_electric_name == "None learned")
  world.sample(); assert(reader.client.spells.get() and world.panel().bindings.skill_electric_name == "None learned")
`));

test('oversized damage output retains the last committed abilities and filter state', () => runLua(fixture + setup + `
  world.query("skill"); world.damageHeader("skill")
  for index = 1, 1001 do world.line("Level 1 : Skill " .. tostring(index) .. " 85% Bash") end
  world.damageFooter()
  assert(#reader.client.spells.get().entries == 4 and panel.bindings.skill_bash_name == "Not refreshed")
  assert(not reader.client.spells.status().refreshing and reader.client.spells.status().error)
`));
