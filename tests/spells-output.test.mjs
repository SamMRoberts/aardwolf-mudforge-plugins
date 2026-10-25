import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/spells.lua', import.meta.url), 'utf8');
const helpers = `
  local function ready()
    local world, reader, provider = spellsWorld()
    local function line(text, hidden, sessionId, raw)
      local result = provider.env.onLine(sessionId or world.id, raw or text, text)
      assert((result == false) == hidden, "Unexpected visibility: " .. text)
    end
    local function catalog(hidden)
      line("Skill/Spell name            Level  Sn   %", hidden)
      line("——————————————————————————  —————  --- ---", hidden)
      line(" Earthquake 29 39 85", hidden, nil, "ANSI row")
      line(" Fireball 38 45 90", hidden)
      line("* means that you cannot use the skill/spell.", hidden)
    end
    world.active()
    return world, reader, provider, line, catalog
  end
  local footer = "To see all skills/spells for your class, use 'allspells <class>'"
`;
const cases = {
  'automatic and explicit catalog refreshes hide tables after parsing': `
    local world, reader, provider, line, catalog = ready()
    line("> allspells", false); line("[100/100hp] >", false)
    line("Skill/Spell name            Level  Sn   %", false, "other-session")
    catalog(true)
    assert(reader.client.spells.get().entries[1].name == "Earthquake" and world.dataWrites == 1)
    line("[100/100hp] >", false)
    world.commands.awspells("refresh"); catalog(true)
    assert(world.dataWrites == 2 and #reader.client.spells.get().entries == 2)
    line(" Earthquake 29 39 85", false)
  `,
  'Refresh all hides skills spells area continuation rows summaries and empty results': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    world.action("refresh-all")
    assert(world.sends[2] == "skills combat")
    line("Skill name                 Learned  Damage", true)
    line("—————————————————————————— ———————  —————————————————", true)
    line("Level 1 : Kick 100% Bash", true)
    line("          Punch 85% Bash", true)
    line("Skill name                 Learned  Damage", true)
    line("You have 2 abilities forgotten.", true); line(footer, true)
    assert(world.sends[3] == "spells combat")
    line("Spell name                 Mana  Learned  Spell#  Damage", true)
    line("Level 29 : Earthquake 40 85% 39 Earth", true)
    line("           Fireball 30 90% 45 Fire", true); line(footer, true)
    assert(world.sends[4] == "spells area")
    line("Spell name                 Mana  Learned  Spell#", true)
    line("Level 29 : Earthquake 40 1% 39", true); line(footer, true)
    assert(reader.client.spells.get().entries[1].area == true and not reader.client.spells.status().refreshing)
    assert(world.record().damage.members["skill:bash"].kick)
    world.action("refresh-all")
    line("No skills found.", true); line("No spells found.", true); line("No spells found.", true)
    assert(not reader.client.spells.status().refreshing and not reader.client.spells.status().error)
    line("[100/100hp] >", false)
  `,
  'manual catalog combat area and legacy damage queries remain visible and parse': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    provider.env.onSend(world.id, "allspells"); catalog(false)
    for _, command in ipairs({ "skills combat", "skills damage" }) do
      provider.env.onSend(world.id, command)
      line("Skill name                 Learned  Damage", false)
      line("Level 1 : Kick 100% Bash", false); line(footer, false)
    end
    for _, command in ipairs({ "spells combat", "spells damage" }) do
      provider.env.onSend(world.id, command)
      line("Spell name                 Mana  Learned  Spell#  Damage", false)
      line("Level 29 : Earthquake 40 85% 39 Earth", false); line(footer, false)
    end
    provider.env.onSend(world.id, "spells area")
    line("Spell name                 Mana  Learned  Spell#", false)
    line("Level 29 : Earthquake 40 1% 39", false); line(footer, false)
    assert(reader.client.spells.get().entries[1].area == true)
  `,
  'pager prompts chatter errors and malformed rows remain visible': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    world.commands.awspells("refresh")
    line("Skill/Spell name            Level  Sn   %", true)
    line("A friend tells you hello.", false); line("[Hit Return to continue]", false)
    line(">", false); line("***", false); line("", false)
    line("Skill/Spell name            Level  Sn   %", true)
    line(" Earthquake 29 39 85", true)
    line(" Broken row    BAD 39 85", false)
    line(" Fireball 38 45 90", false)
    assert(reader.client.spells.status().error and world.dataWrites == 1)
    world.action("refresh-all"); line("You cannot do that here.", false)
    line("Skill name                 Learned  Damage", true)
    line("Level 1 : Kick BAD% Bash", false)
    assert(reader.client.spells.status().error and world.dataWrites == 1)
  `,
  'cancelled owned captures hide their remaining table without committing or advancing': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    world.commands.awspells("refresh")
    line("Skill/Spell name            Level  Sn   %", true)
    world.action("cancel")
    line(" Fireball 38 45 90", true); line("[Hit Return to continue]", false)
    line("* means that you cannot use the skill/spell.", true)
    assert(world.dataWrites == 1 and not reader.client.spells.status().refreshing)
    world.action("refresh-all"); world.action("cancel")
    local sent = #world.sends
    line("Skill name                 Learned  Damage", true)
    line("Level 1 : Kick 100% Bash", true); line("          Punch 85% Bash", true)
    line("You have 2 abilities forgotten.", true); line(footer, true)
    assert(world.dataWrites == 1 and #world.sends == sent and not reader.client.spells.status().refreshing)
    world.action("refresh-all"); world.action("cancel"); line("No skills found.", true)
    assert(not reader.client.spells.status().refreshing)
  `,
  'timeout interruption disconnect identity change and cleanup release suppression': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    world.commands.awspells("refresh"); line("Skill/Spell name            Level  Sn   %", true)
    world.tick(60000); line(" Fireball 38 45 90", false)
    world.action("refresh-all"); line("Skill name                 Learned  Damage", true)
    provider.env.onSend(world.id, "spells fire"); line("Level 1 : Kick 100% Bash", false)
    world.commands.awspells("refresh"); line("Skill/Spell name            Level  Sn   %", true)
    world.disconnect(); line(" Fireball 38 45 90", false)
    world.active(); world.commands.awspells("refresh"); line("Skill/Spell name            Level  Sn   %", true)
    world.packet("char.base", { name = "Different" }); line(" Fireball 38 45 90", false)
    provider.env.cleanup(); line("Skill/Spell name            Level  Sn   %", false)
  `,
  'manual cancellation stays visible and owned cancellation releases on a prompt': `
    local world, reader, provider, line, catalog = ready(); catalog(true)
    provider.env.onSend(world.id, "allspells"); world.action("cancel"); catalog(false)
    assert(world.dataWrites == 1 and not reader.client.spells.status().refreshing)
    world.action("refresh-all"); line("Skill name                 Learned  Damage", true)
    world.action("cancel"); line("[100/100hp] >", false)
    line("Level 1 : Kick 100% Bash", false)
    assert(world.dataWrites == 1 and not reader.client.spells.status().refreshing)
  `,
};
for (const [name, source] of Object.entries(cases)) {
  test(name, () => runLua(fixture + helpers + source));
}
