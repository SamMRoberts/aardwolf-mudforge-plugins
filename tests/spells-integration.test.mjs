import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(resolve(root, 'tests/fixtures/spells.lua'), 'utf8');
const records = `
  local function record(name)
    return { schemaVersion = 1, characterKey = string.lower(name or "Fixture"),
      snapshot = { schemaVersion = 1, characterName = name or "Fixture", collectedAt = 12345,
        entries = { { name = "Axe", level = 1, percent = 85, unusable = false },
          { name = "Fireball", level = 38, sn = 45, percent = 85, unusable = false } } },
      damage = { details = { fireball = { kind = "spell", mana = 30 } },
        members = { ["spell:fire"] = { fireball = true } },
        times = { ["spell:fire"] = 12346 }, commands = { axe = "axe" } } }
  end
  local function import(world, value)
    world.commands.awspells("import")
    world.pick({ name = "migration.json", data = json.encode(value), binary = false })
  end
`;

const cases = {
  'native import works disconnected and activates only after verified matching GMCP': `
    local world, reader, provider = spellsWorld()
    local value = record()
    import(world, value)
    assert(world.dataWrites == 1 and world.record("fixture"))
    assert(reader.client.spells.get() == nil and #world.sends == 0)
    local saved = world.record("fixture")
    assert(saved.snapshot.collectedAt == 12345 and saved.snapshot.entries[1].sn == nil)
    assert(saved.damage.times["spell:fire"] == 12346 and saved.damage.details.fireball.mana == 30)
    world.active("Other")
    assert(reader.client.spells.get() == nil)
    world.action("cancel"); world.footer()
    world.packet("char.base", { name = "Fixture" })
    assert(reader.client.spells.get().characterName == "Fixture")
    assert(reader.client.spells.get().entries[2].name == "Fireball")
    assert(world.panel().bindings.spell_fire_name == "Fireball")
  `,
  'native import is idempotent and refuses replacement of different stored data': `
    local world, reader, provider = spellsWorld()
    import(world, record())
    local writes, attempts = world.dataWrites, world.dataAttempts
    local before = json.encode(world.record("fixture"))
    import(world, record())
    assert(world.dataWrites == writes and world.dataAttempts == attempts)
    assert(string.find(provider.errors[#provider.errors], "identical data already saved", 1, true))
    assert(json.encode(world.record("fixture")) == before)
    local conflicting = record(); conflicting.snapshot.entries[1].percent = 50
    import(world, conflicting)
    assert(world.dataWrites == writes and world.dataAttempts == attempts)
    assert(json.encode(world.record("fixture")) == before)
    assert(string.find(provider.errors[#provider.errors], "import refused", 1, true))
  `,
  'native import validates identity, versions, relationships and commands before writing': `
    local world, reader, provider = spellsWorld()
    local invalid = {
      function(value) value.schemaVersion = 2 end,
      function(value) value.characterKey = "other" end,
      function(value) value.snapshot.entries[1].level = 0 end,
      function(value) value.snapshot.entries[2].name = "axe" end,
      function(value) value.damage.members["spell:fire"].missing = true end,
      function(value) value.damage.times["spell:fire"] = -1 end,
      function(value) value.damage.commands.axe = "axe;quit" end,
      function(value) value.damage.details.fireball.kind = "invalid" end,
      function(value) value.damage.members["spell:bogus"] = { fireball = true } end,
    }
    for _, mutate in ipairs(invalid) do
      local value = record(); mutate(value); import(world, value)
      assert(world.dataAttempts == 0 and world.dataWrites == 0 and not world.record("fixture"))
    end
    world.commands.awspells("import"); world.pick({ name = "migration.json", data = "{broken", binary = false })
    assert(world.dataWrites == 0)
  `,
  'native import handles picker cancellation and ignores callbacks after unload or world changes': `
    local world, reader, provider = spellsWorld()
    world.commands.awspells("import"); world.pick(nil, "Cancelled", "cancelled")
    assert(world.dataWrites == 0 and #provider.errors == 0)
    world.commands.awspells("import")
    provider.env.cleanup(); world.pick({ name = "migration.json", data = json.encode(record()), binary = false })
    assert(world.dataWrites == 0)
    provider.env.init(); world.commands.awspells("import")
    world.id = "different-world"
    world.pick({ name = "migration.json", data = json.encode(record()), binary = false })
    assert(world.dataWrites == 0)
    import(world, record())
    assert(world.dataWrites == 1 and world.record("fixture"))
  `,
  'native import recovers when the picker is unavailable or throws': `
    local world, reader, provider = spellsWorld()
    local pickFile = provider.env.pickFile
    provider.env.pickFile = nil
    assert(string.find(world.commands.awspells("import"), "unavailable", 1, true))
    assert(world.pickCallback == nil and world.dataAttempts == 0)
    provider.env.pickFile = function() error("picker failed") end
    assert(string.find(world.commands.awspells("import"), "Could not open", 1, true))
    assert(world.pickCallback == nil and world.dataAttempts == 0)
    provider.env.pickFile = pickFile
    import(world, record())
    assert(world.dataWrites == 1 and world.record("fixture"))
  `,
  'native import reports failed verification without publishing or claiming completion': `
    for _, mode in ipairs({ "throw", "mismatch", "missing" }) do
      local world, reader, provider = spellsWorld()
      world.active(); world.action("cancel"); world.footer()
      assert(reader.client.spells.get() == nil and not reader.client.spells.status().refreshing)
      local loadTable = provider.env.loadTable
      provider.env.loadTable = function(key)
        local value = loadTable(key)
        if world.dataWrites > 0 and value then
          if mode == "throw" then error("readback failed") end
          if mode == "missing" then return nil end
          value.snapshot.collectedAt = value.snapshot.collectedAt + 1
        end
        return value
      end
      import(world, record())
      assert(world.dataWrites == 1 and reader.client.spells.get() == nil)
      assert(world.record("fixture").snapshot.collectedAt == 12345)
      assert(string.find(provider.errors[#provider.errors], "could not be verified", 1, true))
      for _, message in ipairs(provider.errors) do assert(not string.find(message, "imported 2 abilities", 1, true)) end
      provider.env.loadTable = loadTable
      import(world, record())
      assert(world.dataWrites == 1 and string.find(provider.errors[#provider.errors], "identical data already saved", 1, true))
    end
  `,
  'paste import works disconnected without a picker and closes after verified success': `
    local world, reader, provider = spellsWorld()
    provider.env.pickFile = nil
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    assert(panel and panel.visible and panel.config.name == "storage-import")
    assert(string.find(panel.content, "mudforge.send('import'", 1, true))
    local callback = panel.events.luamsg
    world.paste(json.encode(record()))
    assert(world.dataWrites == 1 and world.importPanel() == nil and reader.client.spells.get() == nil)
    assert(world.record("fixture").snapshot.collectedAt == 12345)
    callback({ event = "import", data = json.encode(record("Other")), sessionId = world.id })
    assert(world.dataWrites == 1 and world.record("other") == nil)
  `,
  'paste import ignores unrelated or wrong-session messages and validates submitted data': `
    local world, reader, provider = spellsWorld()
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    for _, event in ipairs({ false, "invalid", {}, { event = "ready" },
      { event = "other", data = json.encode(record()) },
      { event = "import", data = json.encode(record()), sessionId = "different-world" } }) do panel.events.luamsg(event) end
    assert(world.dataAttempts == 0 and #provider.errors == 0)
    for _, data in ipairs({ false, 42, {}, "{invalid", "null", "{}" }) do world.paste(data) end
    local invalid = record(); invalid.damage.commands.axe = "axe;quit"
    world.paste(json.encode(invalid))
    assert(world.dataAttempts == 0 and world.importPanel() == panel and #provider.errors > 0)
    world.paste(json.encode(record()))
    assert(world.dataWrites == 1 and world.importPanel() == nil)
  `,
  'paste import preserves identical and conflicting native records and leaves its panel open': `
    local world, reader, provider = spellsWorld()
    import(world, record())
    local before, attempts = json.encode(world.record("fixture")), world.dataAttempts
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    world.paste(json.encode(record()))
    assert(world.importPanel() == panel and world.dataAttempts == attempts)
    assert(string.find(provider.errors[#provider.errors], "identical data already saved", 1, true))
    local conflict = record(); conflict.snapshot.entries[1].percent = 20
    world.paste(json.encode(conflict))
    assert(world.importPanel() == panel and world.dataAttempts == attempts)
    assert(json.encode(world.record("fixture")) == before)
    assert(string.find(provider.errors[#provider.errors], "import refused", 1, true))
  `,
  'paste import supersedes chooser and panel tickets and ignores callbacks after cleanup': `
    local world, reader, provider = spellsWorld()
    world.commands.awspells("import")
    world.commands.awspells("import-paste")
    local first = world.importPanel()
    assert(first and world.pickCallback)
    world.pick({ name = "migration.json", data = json.encode(record("Chooser")), binary = false })
    assert(world.dataAttempts == 0)
    world.commands.awspells("import-paste")
    local second = world.importPanel()
    assert(second and second ~= first)
    first.events.luamsg({ event = "import", data = json.encode(record("OldPanel")), sessionId = world.id })
    assert(world.dataAttempts == 0)
    world.paste(json.encode(record()))
    assert(world.dataWrites == 1 and not world.record("chooser") and not world.record("oldpanel"))
    world.commands.awspells("import-paste")
    local pending = world.importPanel()
    provider.env.cleanup()
    assert(world.importPanel() == nil)
    pending.events.luamsg({ event = "import", data = json.encode(record("AfterCleanup")), sessionId = world.id })
    assert(world.dataWrites == 1 and not world.record("aftercleanup"))
  `,
  'paste panel is destroyed when verified character identity changes': `
    local world, reader, provider = spellsWorld()
    world.active(); world.action("cancel"); world.footer()
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    world.packet("char.base", { name = "Other" })
    assert(world.importPanel() == nil)
    panel.events.luamsg({ event = "import", data = json.encode(record()), sessionId = world.id })
    assert(world.dataAttempts == 0 and world.record("fixture") == nil)
    assert(reader.client.spells.get() == nil)
  `,
  'paste import rejects collection started while its panel is open and recovers afterward': `
    local world, reader, provider = spellsWorld()
    world.active(); world.action("cancel"); world.footer()
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    world.commands.awspells("refresh")
    assert(reader.client.spells.status().refreshing)
    world.paste(json.encode(record()))
    assert(world.dataAttempts == 0 and world.importPanel() == panel)
    assert(string.find(provider.errors[#provider.errors], "collection is in progress", 1, true))
    world.action("cancel"); world.footer()
    world.paste(json.encode(record()))
    assert(world.dataWrites == 1 and world.importPanel() == nil)
    assert(reader.client.spells.get().entries[2].name == "Fireball")
  `,
  'native import rejects collections in progress and leaves committed data intact on save refusal': `
    local world, reader, provider = spellsWorld()
    world.active(); world.commands.awspells("import")
    assert(world.pickCallback == nil and world.dataWrites == 0)
    world.sample(); world.disconnect()
    local before = world.record("fixture")
    world.refuseDataWrites = true
    import(world, record("Other"))
    assert(not world.record("other") and world.record("fixture").snapshot.entries[1].name == before.snapshot.entries[1].name)
    world.refuseDataWrites = false; world.throwDataWrites = true
    import(world, record("Other"))
    assert(not world.record("other") and world.dataWrites == 1)
  `,
  'native import preserves nullable fields, Unicode and source ordering': `
    local world, reader, provider = spellsWorld()
    local value = record()
    value.snapshot.entries[1].name = "Éclair"
    value.snapshot.entries[1].percent = nil
    value.snapshot.entries[2].unusable = true
    value.damage.commands = {}
    value.damage.details.fireball.mana = nil
    import(world, value)
    assert(world.dataWrites == 1)
    local saved = world.record("fixture")
    assert(saved.snapshot.entries[1].name == "Éclair" and saved.snapshot.entries[1].percent == nil)
    assert(saved.snapshot.entries[1].sn == nil and saved.damage.details.fireball.mana == nil)
    assert(saved.snapshot.entries[2].unusable and saved.snapshot.collectedAt == 12345)
    assert(saved.damage.times["spell:fire"] == 12346)
  `,
  'native explicit nil fields verify imports and preserve duplicate no-op feedback': `
    local world, reader, provider = spellsWorld()
    world.nativeNilPairs()
    local value = record()
    value.snapshot.entries[1].percent = nil
    value.damage.details.fireball.mana = nil
    world.commands.awspells("import-paste")
    world.paste(json.encode(value))
    assert(world.nilFieldsObserved > 0 and world.dataWrites == 1 and world.importPanel() == nil)
    assert(string.find(world.commands.awspells("status"), "imported 2 abilities", 1, true))
    local before, attempts = json.encode(world.record("fixture")), world.dataAttempts
    assert(world.record("fixture").snapshot.entries[1].sn == nil)
    assert(world.record("fixture").snapshot.entries[1].percent == nil)
    assert(world.record("fixture").damage.details.fireball.mana == nil)
    world.commands.awspells("import-paste")
    local panel = world.importPanel()
    world.paste(json.encode(value))
    assert(world.dataAttempts == attempts and world.dataWrites == 1 and world.importPanel() == panel)
    assert(json.encode(world.record("fixture")) == before)
    assert(string.find(world.commands.awspells("status"), "identical data already saved", 1, true))
    assert(string.find(panel.bindings.import_feedback, "identical data already saved", 1, true))
  `,
  'native import enforces the chooser byte limit without modifying saved records': `
    local world, reader, provider = spellsWorld()
    world.commands.awspells("import")
    assert(world.pickOptions.maxBytes == 16 * 1024 * 1024)
    world.pick({ name = "oversized.json", data = string.rep(" ", 16 * 1024 * 1024 + 1), binary = false })
    assert(world.dataAttempts == 0 and not world.record("fixture"))
    assert(string.find(provider.errors[#provider.errors], "16 MiB", 1, true))
  `,
  'native read and write failures retain the last published complete snapshot': `
    local world, reader, provider = spellsWorld()
    world.active(); world.sample()
    for _, failure in ipairs({ "refuseDataWrites", "throwDataWrites" }) do
      world[failure] = true
      world.commands.awspells("refresh"); world.header(); world.line(" Fly 36 48 85"); world.footer()
      assert(world.dataWrites == 1 and #reader.client.spells.get().entries == 4)
      assert(#world.record("fixture").snapshot.entries == 4 and reader.client.spells.status().error)
      world[failure] = false
    end
    world.failRead = true
    local sends = #world.sends
    world.commands.awspells("refresh")
    assert(#world.sends == sends and #reader.client.spells.get().entries == 4)
    assert(reader.client.spells.status().error)
    world.failRead = false
    world.commands.awspells("refresh"); world.header(); world.line(" Fly 36 48 85"); world.footer()
    assert(world.dataWrites == 2 and #reader.client.spells.get().entries == 1)
  `,
  'native storage isolates character records and separate plugin worlds': `
    local world, reader, provider = spellsWorld()
    world.active(); world.sample()
    world.packet("char.base", { name = "Other" }); world.header(); world.line(" Fly 36 48 85"); world.footer()
    assert(world.record("fixture").snapshot.entries[1].name == "Axe")
    assert(world.record("other").snapshot.entries[1].name == "Fly")
    local second, secondReader = spellsWorld()
    assert(second.record("fixture") == nil)
    second.active(); assert(secondReader.client.spells.get() == nil)
    second.sample(); assert(world.record("other").snapshot.characterName == "Other")
    provider.env.cleanup(); provider.env.init()
    assert(reader.client.spells.get().characterName == "Other")
  `,
  'native storage accepts a 1000 ability snapshot in one complete save': `
    local world, reader, provider = spellsWorld()
    world.active(); world.header()
    for index = 1, 1000 do world.line(" Ability " .. tostring(index) .. " 1 - 85") end
    world.footer()
    assert(#reader.client.spells.get().entries == 1000 and world.dataWrites == 1)
    local snapshot = world.record("fixture").snapshot
    assert(#snapshot.entries == 1000 and snapshot.entries[1000].name == "Ability 1000")
    provider.env.cleanup(); provider.env.init()
    assert(#reader.client.spells.get().entries == 1000)
  `,
  'native records retain enrichment beyond the shared GMCP copying limit': `
    local world, reader, provider = spellsWorld()
    local value = record(); value.snapshot.entries = {}
    value.damage = { details = {}, members = {}, times = {}, commands = {} }
    local types = { "acid", "air", "bash", "cold", "disease", "earth", "electric", "energy", "fire", "holy",
      "light", "magic", "mental", "negative", "pierce", "slash", "shadow", "sonic", "special", "water" }
    for index = 1, 450 do
      local name = "Ability " .. tostring(index)
      value.snapshot.entries[index] = { name = name, level = 1, percent = 85, unusable = false }
      value.damage.details[string.lower(name)] = { kind = "skill" }
    end
    for _, damageType in ipairs(types) do
      local members = {}
      for index = 1, 450 do members["ability " .. tostring(index)] = true end
      value.damage.members["skill:" .. damageType] = members
      value.damage.times["skill:" .. damageType] = 12345
      value.damage.times["spell:" .. damageType] = 12345
    end
    import(world, value)
    assert(world.dataWrites == 1)
    provider.env.cleanup(); provider.env.init(); world.active()
    local saved = world.record("fixture")
    local count = 0
    for _, members in pairs(saved.damage.members) do for _ in pairs(members) do count = count + 1 end end
    assert(count == 9000 and #reader.client.spells.get().entries == 450)
    assert(world.panel().bindings.skill_water_name ~= "Not refreshed")
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + records + source));
