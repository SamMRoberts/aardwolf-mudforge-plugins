import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local carried = {
    "101,,a canvas bag,1,11,0,-1,-1", "102,,a spare bag,1,11,0,-1,-1",
    "103,,a red potion,1,8,0,-1,-1", "104,K,a kept sword,1,5,0,-1,-1",
    "105,,a blue potion,1,8,0,-1,-1", "106,,a loose wand,1,3,0,-1,-1"
  }
  local equipped = { "201,,a worn bag,1,11,0,7,-1", "202,,a held staff,1,4,0,26,-1" }
  local function configure(world, heal, mana)
    world.save({ rules = {}, quickPotions = { heal = heal or { name = "red" }, mana = mana or { name = "blue" } } })
  end
  local function click(world, slot)
    world.message("summary", "quick-potion", { slot = slot or "heal" }); world.tick(2)
  end
  local function listing(world, rows, equipment)
    world.frame("invdata", rows or carried); world.frame("eqdata", equipment or equipped); world.tick(2)
  end
  local function scoutBag(world, bagId, rows)
    local scout = world.plugins["quick-scout"] or world.consumer("quick-scout", { "Char" }, { inventory = true })
    assert(scout.client.inventory.lookIn(bagId)); world.frame("invdata " .. bagId, rows or {})
    return scout.client.inventory
  end
`;
const cases = {
  'summary Heal click quaffs one carried potion without opening the manager': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    assert(not world.widget("manager") and not world.state().quickPotions.heal.disabled)
    click(world)
    assert(world.count("quaff 103") == 1 and world.state().busy and not world.widget("manager"))
    world.monitor(7, 103)
    listing(world, { carried[1], carried[2], carried[4], carried[5], carried[6] })
    assert(not world.state().busy and world.state().quickPotions.heal.disabled and not world.widget("manager"))
  `,
  'Heal and Mana resolve their separately configured inventory potions': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    click(world, "mana"); assert(world.count("quaff 105") == 1 and world.count("quaff 103") == 0)
    world.monitor(7, 105); listing(world, { carried[1], carried[2], carried[3], carried[4], carried[6] })
    click(world, "heal"); assert(world.count("quaff 103") == 1)
  `,
  'carried matches take precedence over a configured bag and preserve listing order': `
    local world = inventoryWorld(); world.loaded()
    local scout = scoutBag(world, 101, { "301,,a red potion,1,8,0,-1,-1" })
    assert(scout.refresh())
    listing(world, { carried[1], "503,,a red potion first,1,8,0,-1,-1", "103,,a red potion second,1,8,0,-1,-1" })
    configure(world, { name = "red", bagId = 101 })
    local before = world.count("invdata 101"); click(world)
    assert(world.count("quaff 503") == 1 and world.count("quaff 103") == 0 and world.count("get 301 101") == 0)
    assert(world.count("invdata 101") == before)
  `,
  'next click resolves a newly stocked object ID instead of reusing the consumed ID': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    click(world); world.monitor(7, 103)
    listing(world, { carried[1], "503,,a replacement red potion,1,8,0,-1,-1", carried[5] })
    assert(world.count("quaff 503") == 0)
    click(world)
    assert(world.count("quaff 103") == 1 and world.count("quaff 503") == 1)
  `,
  'matching strips color codes and decodes escaped at signs before literal substring matching': `
    local world = inventoryWorld(); world.loaded()
    world.message("summary", "refresh")
    listing(world, { carried[1], "503,,@GRed @@ @x123potion@w,1,8,0,-1,-1" })
    configure(world, { name = "RED @ POTION" })
    assert(not world.state().quickPotions.heal.disabled)
    click(world); assert(world.count("quaff 503") == 1)
  `,
  'unknown fallback bag is read once before retrieving and quaffing one potion': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "bagged", bagId = 101 })
    click(world)
    assert(world.count("invdata 101") == 1 and not world.widget("manager") and world.count("get 301 101") == 0)
    world.frame("invdata 101", { "301,,a bagged potion,1,8,0,-1,-1" }); world.tick(2)
    assert(world.count("get 301 101") == 1 and world.count("quaff 301") == 0)
    world.monitor(5, 301, 101); assert(world.count("quaff 301") == 1)
  `,
  'stale fallback contents are refreshed rather than trusting their previous matching ID': `
    local world = inventoryWorld(); world.loaded()
    local scout = scoutBag(world, 101, { "301,,an old bagged potion,1,8,0,-1,-1" })
    assert(scout.lookIn(101)); world.frame("invdata 101", { "malformed" })
    configure(world, { name = "bagged", bagId = 101 }); click(world)
    assert(world.count("invdata 101") == 3 and world.count("get 301 101") == 0)
    world.frame("invdata 101", { "401,,a new bagged potion,1,8,0,-1,-1" }); world.tick(2)
    assert(world.count("get 401 101") == 1 and world.count("get 301 101") == 0)
  `,
  'inventory-only shortcut never scans unrelated bags when no potion matches': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "missing" })
    local before = #world.commands; click(world)
    assert(world.state().quickPotions.heal.disabled and #world.commands == before and not world.state().busy)
    assert(world.count("invdata 101") == 0 and world.count("invdata 102") == 0)
  `,
  'matching names on pills armor and drink containers are never treated as potions': `
    local world = inventoryWorld(); world.loaded(); world.message("summary", "refresh")
    listing(world, { carried[1], "301,,red pill,1,19,0,-1,-1", "302,,red armor,1,7,0,-1,-1", "303,,red flask,1,12,0,-1,-1" })
    configure(world)
    local before = #world.commands; click(world)
    assert(#world.commands == before and world.state().quickPotions.heal.disabled)
  `,
  'repeated Heal and Mana clicks during a workflow never queue another potion': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    click(world); click(world); click(world, "mana"); click(world)
    assert(world.count("quaff 103") == 1 and world.count("quaff 105") == 0)
    world.monitor(7, 103); listing(world, { carried[1], carried[5] }); world.tick(500)
    assert(not world.state().busy and world.count("quaff 105") == 0 and world.count("quaff 103") == 1)
  `,
  'surviving potion retrieved from a bag is returned after the sent quaff is verified': `
    local world = inventoryWorld(); world.loaded(); scoutBag(world, 101, { "301,,a bagged potion,1,8,0,-1,-1" })
    configure(world, { name = "bagged", bagId = 101 }); click(world)
    world.monitor(5, 301, 101); assert(world.count("quaff 301") == 1)
    listing(world, { carried[1], "301,,a surviving bagged potion,1,8,0,-1,-1" })
    assert(world.count("put 301 101") == 1)
    world.monitor(6, 301, 101)
    assert(not world.state().busy and world.count("quaff 301") == 1)
  `,
  'refused quaff restores a retrieved potion without retrying the use command': `
    local world, context, env, core = inventoryWorld(); world.loaded()
    scoutBag(world, 101, { "301,,a bagged potion,1,8,0,-1,-1" }); configure(world, { name = "bagged", bagId = 101 })
    local blocker = world.context("quaff-refusal", "Quaff Refusal Fixture")
    blocker.env = { onSend = function(sessionId, command) if command == "quaff 301" then return false end end }
    click(world); world.monitor(5, 301, 101)
    assert(world.count("quaff 301") == 0)
    listing(world, { carried[1], "301,,a bagged potion,1,8,0,-1,-1" })
    assert(world.count("put 301 101") == 1)
    world.monitor(6, 301, 101); assert(not world.state().busy and world.count("quaff 301") == 0)
  `,
  'combat supports lookup retrieval quaff and surviving-potion return across state changes': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "bagged", bagId = 101 })
    world.message("summary", "quick-potion", { slot = "heal" })
    world.packet("char.status", { state = 8 }); world.tick(2)
    assert(world.count("invdata 101") == 1)
    world.frame("invdata 101", { "301,,a bagged potion,1,8,0,-1,-1" }); world.tick(2)
    assert(world.count("get 301 101") == 1)
    world.packet("char.status", { state = 3 }); world.packet("char.status", { state = 8 })
    world.monitor(5, 301, 101); assert(world.count("quaff 301") == 1)
    listing(world, { carried[1], "301,,a surviving bagged potion,1,8,0,-1,-1" })
    assert(world.count("put 301 101") == 1)
    world.monitor(6, 301, 101)
    assert(not world.state().busy and not world.state().active)
  `,
  'sleep cancels a resolver read and never resumes it after returning to combat': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "bagged", bagId = 101 })
    click(world); assert(world.count("invdata 101") == 1)
    world.packet("char.status", { state = 9 })
    assert(not world.state().busy and world.state().quickPotions.heal.disabled)
    world.line("{/invdata}"); world.packet("char.status", { state = 8 }); world.tick(50)
    assert(world.count("get 301 101") == 0 and world.count("quaff 301") == 0 and not world.state().busy)
  `,
  'sleep after a get command preserves the later observed item and does not use or return it automatically': `
    local world = inventoryWorld(); world.loaded(); scoutBag(world, 101, { "301,,a bagged potion,1,8,0,-1,-1" })
    configure(world, { name = "bagged", bagId = 101 }); click(world)
    assert(world.count("get 301 101") == 1)
    world.packet("char.status", { state = 9 }); world.monitor(5, 301, 101)
    world.packet("char.status", { state = 8 }); world.tick(50)
    assert(world.count("quaff 301") == 0 and world.count("put 301 101") == 0 and not world.state().busy)
  `,
  'disconnect cancels lookup and reconnect cannot replay the old quick-potion request': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "bagged", bagId = 101 })
    click(world); world.disconnect(); assert(not world.state().busy)
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 8 })
    listing(world); world.tick(50)
    assert(world.count("get 301 101") == 0 and world.count("quaff 301") == 0 and not world.state().busy)
  `,
  'profiles without quick-potion fields remain valid and gain disabled empty defaults': `
    local world = inventoryWorld({ schemaVersion = 1, value = {
      preferences = { fontSize = 13, showWorn = true, confirmDisposal = true, bagOrder = {}, hiddenBags = {} },
      profiles = { fixture = { heldSlot = 26, rules = {} } }
    } })
    world.loaded()
    assert(world.state().profile.heldSlot == 26)
    assert(not world.state().quickPotions.heal.configured and not world.state().quickPotions.mana.configured)
    local before = #world.commands; click(world); assert(#world.commands == before)
  `,
  'invalid quick configurations cannot replace valid saved shortcuts or send commands': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    local before = #world.commands
    for _, invalid in ipairs({
      { name = string.rep("r",129) }, { name = "red" .. string.char(10) .. "quit" },
      { name = "red", bagId = 0 }, { name = "red", bagId = "101" }, { name = false }
    }) do
      world.save({ rules = {}, quickPotions = { heal = invalid } })
      assert(world.state().profile.quickPotions.heal.name == "red")
      assert(not world.state().busy and #world.commands == before)
    end
    world.message("summary", "quick-potion", { slot = "quaff;quit" }); world.tick(2)
    assert(#world.commands == before)
    world.save({ rules = {}, quickPotions = { heal = { name = "   " }, mana = { name = "blue" } } })
    assert(not world.state().quickPotions.heal.configured and world.state().quickPotions.heal.disabled)
  `,
  'stale main inventory refreshes before choosing a matching potion ID': `
    local world = inventoryWorld(); world.loaded(); configure(world)
    world.message("summary", "refresh"); world.frame("invdata", { "malformed" })
    assert(world.state().countState == "stale")
    click(world); assert(world.count("quaff 103") == 0)
    world.frame("invdata", { carried[1], "503,,a newly verified red potion,1,8,0,-1,-1" })
    assert(world.count("quaff 503") == 0)
    world.frame("eqdata", equipped); world.tick(2)
    assert(world.count("quaff 503") == 1 and world.count("quaff 103") == 0)
  `,
  'missing configured fallback bags report unavailable without scanning any other bag': `
    local world = inventoryWorld(); world.loaded(); configure(world, { name = "bagged", bagId = 999 })
    assert(world.state().quickPotions.heal.disabled)
    local before = #world.commands; click(world)
    assert(#world.commands == before and string.find(world.state().feedback, "unavailable", 1, true))
  `,
  'older Core leaves normal shortcut use available but explains missing combat support': `
    local world, context, env, core = inventoryWorld(); world.loaded(); configure(world)
    local generation, original = nil, core.env.broadcastToPlugin
    core.env.broadcastToPlugin = function(target, message, encoded)
      if target == context.id and message == "aardwolf-api:inventory-status" then generation = json.decode(encoded).generation end
      original(target, message, encoded)
    end
    world.packet("char.status", { state = 3 }); assert(generation)
    core.env.broadcastToPlugin = original
    core.host.broadcastToPlugin(context.id, "aardwolf-api:state", json.encode({ version = 1,
      session = { connected = true, negotiated = true }, snapshots = {},
      capabilities = { inventory = 1, inventoryActions = { "hold", "quaff", "eat", "drink", "recite", "zap", "brandish" } } }))
    core.host.broadcastToPlugin(context.id, "aardwolf-api:inventory-status", json.encode({ version = 1, generation = generation,
      status = { active = true, connected = true, collecting = false, characterName = "Fixture" } }))
    assert(not world.state().quickPotions.heal.disabled)
    core.host.broadcastToPlugin(context.id, "aardwolf-api:inventory-status", json.encode({ version = 1, generation = generation,
      status = { active = false, connected = true, collecting = false, characterName = "Fixture" } }))
    local before = #world.commands; click(world)
    assert(#world.commands == before and world.state().quickPotions.heal.disabled)
    assert(string.find(world.state().feedback, "0.4.0", 1, true))
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${helpers}\n${source}`));
