import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(resolve(root, 'tests/fixtures/spells.lua'), 'utf8');
const cases = {
  'spells API validates optional area flags and keeps defensive consumer snapshots': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local original = reader.client.spells.get()
    local validate = freshLibrary().protocol.spellsSnapshot
    assert(validate(original).entries[1].area == nil)
    for _, flag in ipairs({ true, false }) do
      local value = reader.client.spells.get()
      value.entries[1].area = flag
      local normalized = validate(value)
      assert(normalized.entries[1].area == flag)
      value.entries[1].area = not flag
      assert(normalized.entries[1].area == flag)
      provider.host.broadcastToPlugin("reader", "aardwolf-spells:state", json.encode({
        version = 1, status = { connected = true, refreshing = false, characterName = "Fixture" }, snapshot = normalized
      }))
      local saved = reader.client.spells.get()
      assert(saved.entries[1].area == flag)
      saved.entries[1].area = not flag
      assert(reader.client.spells.get().entries[1].area == flag)
    end
    for _, flag in ipairs({ 0, 1, "true", "false", {} }) do
      local value = reader.client.spells.get()
      value.entries[1].area = flag
      assert(not pcall(validate, value))
      provider.host.broadcastToPlugin("reader", "aardwolf-spells:state", json.encode({
        version = 1, status = { connected = true, refreshing = false, characterName = "Fixture" }, snapshot = value
      }))
      assert(reader.client.spells.get().entries[1].area == false)
    end
  `,
  'spells reports an older loaded library before registering or sending commands': `
    local world, reader, provider = spellsWorld()
    provider.env.cleanup()
    provider.env.require = function() return { protocol = {} } end
    provider.env.init()
    assert(string.find(provider.errors[#provider.errors], "aardwolf-api 0.5.0", 1, true))
    world.active()
    assert(#world.sends == 0 and reader.client.spells.get() == nil)
  `,
  'spells refuses older validators that silently drop area flags': `
    local world, reader, provider = spellsWorld()
    provider.env.cleanup()
    local api = freshLibrary()
    local validate = api.protocol.spellsSnapshot
    api.protocol.spellsSnapshot = function(value)
      local result = validate(value)
      for _, item in ipairs(result.entries) do item.area = nil end
      return result
    end
    provider.env.require = function() return api end
    provider.env.init(); world.active()
    assert(string.find(provider.errors[#provider.errors], "aardwolf-api 0.5.0", 1, true))
    assert(#world.sends == 0 and reader.client.spells.get() == nil)
  `,
  'spells captures the supplied column format while hiding owned tables and preserving prompts': `
    local world, reader = spellsWorld()
    assert(#world.sends == 0)
    world.active()
    assert(#world.sends == 1 and world.sends[1] == "allspells")
    world.line("> allspells")
    world.sample()
    world.line("[1277/1277hp 789/1057mn 1395/1395mv 0qt 1136tnl] >")
    assert(not world.output[1].hidden and not world.output[#world.output].hidden)
    for index = 2, #world.output - 1 do assert(world.output[index].hidden) end
    local saved = reader.client.spells.get()
    assert(saved.characterName == "Fixture" and #saved.entries == 4)
    assert(saved.entries[1].name == "Axe" and saved.entries[1].sn == nil and saved.entries[1].percent == 85)
    assert(saved.entries[2].sn == 101 and saved.entries[2].percent == 1)
    assert(saved.entries[3].name == "Globe of invulnerability" and saved.entries[3].percent == nil)
    assert(not saved.entries[3].unusable and saved.entries[4].level == 190)
    assert(string.find(world.commands.awspells("status"), "4 entries", 1, true))
    assert(string.find(world.commands.awspells("other"), "Usage: awspells refresh", 1, true))
  `,
  'spells handles stars, repeated page headers, ANSI-clean lines and chatter': `
    local world, reader = spellsWorld(true); world.active()
    world.header()
    world.line(" *Magic missile                 1   62   0 ", nil, "\\27[31m *Magic missile                 1   62   0 \\27[0m")
    world.line("A friend tells you hello.")
    world.line("Auction: bid rises to 1 12 85")
    world.line("Someone tells you:  hello there friend")
    world.line("")
    world.header()
    world.line(" Word of recall*               17   82 100 ")
    world.line(" Bow                            1    -   - ")
    world.footer()
    local saved = reader.client.spells.get()
    assert(#saved.entries == 3 and saved.entries[1].unusable and saved.entries[1].percent == 0)
    assert(saved.entries[2].unusable and saved.entries[2].name == "Word of recall")
    assert(not saved.entries[3].unusable and saved.entries[3].sn == nil)
  `,
  'spells waits for login and does not query repeatedly or change pager settings': `
    local world, reader = spellsWorld()
    world.connect()
    world.packet("char.status", { state = 1 })
    world.packet("char.base", { name = "Fixture" })
    world.packet("char.status", { state = 2 })
    assert(#world.sends == 0)
    world.packet("char.status", { state = 3 })
    assert(#world.sends == 1)
    assert(string.find(world.commands.awspells("refresh"), "already", 1, true))
    world.sample()
    for i = 1, 5 do world.packet("char.status", { state = 3 }); world.packet("char.base", { name = "Fixture" }) end
    assert(#world.sends == 1)
    world.packet("char.status", { state = 7 })
    assert(string.find(world.commands.awspells("refresh"), "active", 1, true))
    world.packet("char.status", { state = 3 })
    assert(#world.sends == 1)
    world.commands.awspells("refresh"); world.sample()
    assert(#world.sends == 2)
    world.disconnect(); assert(reader.client.spells.get() == nil)
    world.active(); assert(#world.sends == 3)
  `,
  'spells loads when enabled in an already active session': `
    local world, reader, provider = spellsWorld()
    world.active(); world.sample()
    provider.env.cleanup(); provider.env.init()
    assert(#world.sends == 2)
    assert(#reader.client.spells.get().entries == 4)
    world.sample()
    provider.env.init(); assert(#world.sends == 2)
  `,
  'spells native storage readiness fails once and allows explicit recovery': `
    local world, reader, provider = spellsWorld()
    provider.storageState = "starting"; world.active()
    assert(#world.sends == 0 and #provider.errors == 1)
    assert(string.find(world.commands.awspells("status"), "starting", 1, true))
    for i = 1, 5 do world.packet("char.status", { state = 3 }) end
    assert(#provider.errors == 1)
    provider.storageState = "ready"
    world.commands.awspells("refresh"); world.sample()
    assert(#reader.client.spells.get().entries == 4)
  `,
  'spells rejects malformed rows, duplicates, empty output, limits and missing footer': `
    local world, reader = spellsWorld(); world.active(); world.sample()
    for _, row in ipairs({
      " Bad ability                    1   62 101 ",
      " Bad ability                    0   62  85 ",
      " Bad ability                    1   --  85 ",
      " Bad ability                    1   62 ",
      " Bad ability                  BAD   62  85 ",
      " Bad ability                    1   XX  85 "
    }) do
      world.commands.awspells("refresh"); world.header(); world.line(row); world.footer()
      assert(#reader.client.spells.get().entries == 4 and reader.client.spells.status().error)
    end
    world.commands.awspells("refresh"); world.header(); world.line(" Axe    1  - 85"); world.line(" axe    1  - 85"); world.footer()
    assert(#reader.client.spells.get().entries == 4)
    world.commands.awspells("refresh"); world.header(); world.footer()
    assert(#reader.client.spells.get().entries == 4)
    world.commands.awspells("refresh"); world.header(); world.line(" Axe    1  - 85")
    world.tick(60000); world.footer()
    assert(#reader.client.spells.get().entries == 4 and not reader.client.spells.status().refreshing)
    world.commands.awspells("refresh"); world.header()
    for i = 1, 1001 do world.line(" Ability " .. tostring(i) .. "    1 - 85") end
    world.footer(); assert(#reader.client.spells.get().entries == 4)
  `,
  'spells ignores other sessions and filtered lists and rejects overlapping commands': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    assert(provider.env.onSend("other", "allspells") == nil)
    assert(provider.env.onSend(world.id, "allspells spellup") == nil)
    world.header(); world.line(" Fly     36 48 85"); world.footer()
    assert(#reader.client.spells.get().entries == 4)
    provider.env.onSend(world.id, "allspells")
    world.line("Skill/Spell name            Level  Sn   % ", "other")
    world.line(" Fly     36 48 85"); world.footer()
    assert(reader.client.spells.status().refreshing)
    world.header(); provider.env.onSend(world.id, "allspells")
    assert(not reader.client.spells.status().refreshing)
    world.commands.awspells("refresh"); world.header()
    provider.env.onSend(world.id, "allspells all")
    world.line(" Fly     36 48 85"); world.footer()
    assert(#reader.client.spells.get().entries == 4)
    provider.env.onSend(world.id, "allspells")
    world.header(); world.line(" Fly     36 48 85"); world.footer()
    assert(#reader.client.spells.get().entries == 1)
  `,
  'spells saves a complete native record in one write and retains failed replacements': `
    local world, reader = spellsWorld(); world.active()
    world.header()
    for i = 1, 250 do world.line(" Ability " .. tostring(i) .. "    1 - 85") end
    world.footer()
    assert(#reader.client.spells.get().entries == 250 and world.dataWrites == 1)
    world.refuseDataWrites = true; world.commands.awspells("refresh"); world.sample()
    assert(#reader.client.spells.get().entries == 250)
    world.refuseDataWrites = false; world.commands.awspells("refresh"); world.sample()
    assert(#reader.client.spells.get().entries == 4)
  `,
  'spells validates restored native records and refuses future schema versions': `
    local world, reader = spellsWorld(); world.active(); world.sample()
    local stored = world.record("fixture")
    stored.snapshot.entries[1].level = 0
    local sends = #world.sends
    world.commands.awspells("refresh")
    assert(#world.sends == sends and #reader.client.spells.get().entries == 4)
    assert(reader.client.spells.status().error)
    stored.snapshot.entries[1].level = 1
    stored.schemaVersion = 2
    world.commands.awspells("refresh")
    assert(#world.sends == sends and #reader.client.spells.get().entries == 4)
    stored.schemaVersion = 1
    world.commands.awspells("refresh"); world.sample()
    assert(#reader.client.spells.get().entries == 4)
  `,
  'spells rejects refused timeouts and gates commands on active state': `
    local world, reader = spellsWorld(); world.active(); world.sample()
    world.refuseTimers = true
    local sends = #world.sends
    world.commands.awspells("refresh")
    assert(#world.sends == sends and #reader.client.spells.get().entries == 4)
    world.refuseTimers = false
    world.packet("char.status", { state = 8 }); world.commands.awspells("refresh")
    assert(#world.sends == sends and not reader.client.spells.status().refreshing)
  `,
  'spells clears active identities while preserving independent character records': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    world.commands.awspells("refresh")
    world.header(); world.line(" Fly     36 48 85"); world.footer()
    world.disconnect()
    assert(reader.client.spells.get() == nil)
    world.active("Other")
    world.sample()
    assert(reader.client.spells.get().characterName == "Other")
    assert(world.record("fixture") and world.record("other"))
    world.commands.awspells("refresh")
    provider.env.cleanup()
    assert(reader.client.spells.get() == nil and not reader.client.spells.status().available)
    provider.env.cleanup()
  `,
  'spells API is opt-in, defensive, validated, and supports provider reload': `
    local world, reader, provider = spellsWorld(true); world.active(); world.sample()
    local plain = world.consumer("plain")
    assert(plain.client.spells.get() == nil and plain.client.spells.status().reason == "not enabled")
    local count = 0
    local unsubscribe = reader.client.spells.on(function(value, status)
      count = count + 1
      if value then value.entries[1].name = "mutated" end
      status.connected = false
    end)
    local value = reader.client.spells.get(); value.entries[1].name = "changed"
    assert(reader.client.spells.get().entries[1].name == "Axe")
    world.commands.awspells("refresh"); world.sample()
    assert(count > 0 and reader.client.spells.get().entries[1].name == "Axe")
    unsubscribe(); local before = count
    local valid = { version = 1, status = { connected = true, refreshing = false, characterName = "Fixture" }, snapshot = reader.client.spells.get() }
    valid.snapshot.entries[1].percent = 101
    provider.host.broadcastToPlugin("reader", "aardwolf-spells:state", json.encode(valid))
    assert(reader.client.spells.get().entries[1].percent == 85)
    valid.snapshot.entries[1].percent = 1
    plain.host.broadcastToPlugin("reader", "aardwolf-spells:state", json.encode(valid))
    assert(reader.client.spells.get().entries[1].percent == 85)
    provider.env.cleanup()
    assert(not reader.client.spells.status().available and reader.client.spells.get() == nil)
    provider.env.init(); world.sample()
    assert(reader.client.spells.status().available and #reader.client.spells.get().entries == 4 and count == before)
    reader.client.stop(); assert(reader.client.spells.get() == nil)
    reader.client.start(); assert(#reader.client.spells.get().entries == 4)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + source));
