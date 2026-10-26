import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const prepareBaggedWand = `
  local world, context, env, core = inventoryWorld(); world.loaded(); world.open("container:101")
  world.frame("invdata 101", { "301,,a bagged wand,1,3,0,-1,-1" })
  world.save({ heldSlot = 26, rules = {} })
  world.action(301,"zap"); world.submit({ target = "self" }); world.tick(2)
  world.monitor(5,301,101); world.monitor(1,202); world.monitor(2,301,-1,26)
  assert(world.count("zap self") == 1)
`;
const cases = {
  'missing original bag does not block independently safe restoration of previous held equipment': `
    local world = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101", { "301,,a bagged wand,1,3,0,-1,-1" })
    world.save({ heldSlot = 26, rules = {} })
    world.action(301, "zap"); world.submit({ target = "self" }); world.tick(2)
    world.monitor(5,301,101)
    world.monitor(1,202)
    world.monitor(2,301,-1,26)
    assert(world.count("zap self") == 1)
    world.frame("invdata", { "202,,a held staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "301,,a bagged wand,1,3,0,26,-1" }); world.tick(2)
    assert(world.count("remove 301") == 1, "Missing bag prevented safe equipment restoration")
    world.monitor(1,301)
    assert(world.count("hold 202") == 1)
    world.monitor(2,202,-1,26)
    assert(not world.state("manager").busy and world.count("put 301 101") == 0)
    local feedback = string.lower(world.state("manager").feedback)
    assert(string.find(feedback,"bag",1,true) and not string.find(feedback,"original arrangement restored",1,true))
    local d = world.state("manager").diagnostics
    assert(d.workflow.outcome == "incomplete")
    local recovery = table.concat(d.manualRecovery," ")
    assert(string.find(recovery,"bag #101",1,true) and not string.find(recovery,"previous item #202",1,true))
  `,
  'planned removal refuses an item manually moved out of the expected held slot': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ heldSlot = 26, rules = {} })
    world.action(106,"zap"); world.submit({ target = "self" })
    world.line("{invmon}2,202,-1,27")
    world.tick(2)
    assert(world.count("remove 202") == 0, "Removed an item after its expected equipment slot changed")
    assert(world.count("hold 106") == 0 and world.count("zap self") == 0)
  `,
  'already-held item moved externally after use reports interference without claiming restoration': `
    local world = inventoryWorld(); world.loaded(); world.open("equipment")
    world.save({ heldSlot = 26, rules = {} })
    world.action(202,"brandish"); world.submit(); world.tick(2)
    assert(world.count("brandish") == 1)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a held staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "201,,a worn bag,1,11,0,7,-1" }); world.tick(2)
    assert(not world.state("manager").busy and world.count("hold 202") == 0)
    local feedback = string.lower(world.state("manager").feedback)
    assert(not string.find(feedback,"original arrangement restored",1,true), "Reported successful restoration after an external item move")
    assert(string.find(feedback,"changed",1,true) or string.find(feedback,"moved",1,true))
  `,
  'failed previous-held restoration does not block independently safe bag return and is never retried': `
    ${prepareBaggedWand}
    local attempts, previousSend = 0, core.env.onSend
    core.env.onSend = function(sessionId,command)
      if command == "hold 202" then attempts = attempts + 1; return false end
      return previousSend(sessionId,command)
    end
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a held staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "301,,a bagged wand,1,3,0,26,-1" }); world.tick(2)
    assert(world.count("remove 301") == 1)
    world.monitor(1,301)
    assert(attempts == 1 and world.count("hold 202") == 0)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a held staff,1,4,0,-1,-1", "301,,a bagged wand,1,3,0,-1,-1" })
    world.frame("eqdata", {}); world.tick(2)
    assert(world.count("put 301 101") == 1, "A refused held restoration discarded a safe remaining bag return")
    world.monitor(6,301,101); world.tick(20)
    assert(not world.state("manager").busy and attempts == 1)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
    local d = world.state("manager").diagnostics
    assert(d.workflow.outcome == "incomplete")
    local recovery = table.concat(d.manualRecovery," ")
    assert(string.find(recovery,"previous item #202",1,true) and not string.find(recovery,"bag #101",1,true))
  `,
  'manually relocated used equipment is preserved while previous held equipment can still restore': `
    ${prepareBaggedWand}
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a held staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "301,,a bagged wand,1,3,0,27,-1" }); world.tick(2)
    assert(world.count("remove 301") == 0 and world.count("put 301 101") == 0)
    assert(world.count("hold 202") == 1)
    world.monitor(2,202,-1,26)
    assert(not world.state("manager").busy)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'previous held item moved manually into a bag is not retrieved or held again': `
    ${prepareBaggedWand}
    world.line("{invmon}6,202,102,-1")
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "102,,a spare bag,1,11,0,-1,-1" })
    world.frame("eqdata", { "301,,a bagged wand,1,3,0,26,-1" }); world.tick(2)
    assert(world.count("remove 301") == 1)
    world.monitor(1,301)
    assert(world.count("hold 202") == 0 and world.count("get 202 102") == 0)
    assert(world.count("put 301 101") == 1)
    world.monitor(6,301,101)
    assert(not world.state("manager").busy)
    assert(string.find(world.state("manager").feedback,"restoration incomplete",1,true))
  `,
  'restorative Remove checks the equipment slot again immediately before dispatch': `
    ${prepareBaggedWand}
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a held staff,1,4,0,-1,-1" })
    world.line("{eqdata}"); world.line("301,,a bagged wand,1,3,0,26,-1"); world.line("{/eqdata}")
    world.line("{invmon}2,301,-1,27"); world.tick(2)
    assert(world.count("remove 301") == 0, "A restore removed equipment from a newly changed slot")
    assert(world.count("put 301 101") == 0)
  `,
  'summary bag context menu opens the selected bag without relying on a manager selection': `
    local world = inventoryWorld(); world.loaded()
    world.message("summary","menu",{ id = 101 })
    assert(world.widget("manager") == nil)
    world.widget("summary").events.menuselect({ id = "open", sessionId = world.id })
    world.ready("manager")
    assert(world.state("manager").scope == "container:101" and world.count("invdata 101") == 1)
  `,
  'summary context menu revalidates source location and rejects a different world selection': `
    local world = inventoryWorld(); world.loaded()
    world.message("summary","menu",{ id = 101 })
    world.widget("summary").events.menuselect({ id = "open", sessionId = "another-world" })
    assert(world.widget("manager") == nil)
    world.monitor(2,101,-1,7)
    world.widget("summary").events.menuselect({ id = "open", sessionId = world.id })
    assert(world.widget("manager") == nil and world.count("invdata 101") == 0)
  `,
  'manager deselection cannot erase a summary bag menu in progress': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.message("summary","menu",{ id = 101 })
    world.message("manager","deselect")
    world.widget("summary").events.menuselect({ id = "open", sessionId = world.id })
    assert(world.state("manager").scope == "container:101" and world.count("invdata 101") == 1)
  `,
  'only explicit details requests advance the details opening serial': `
    local world = inventoryWorld(); world.loaded(); world.open()
    local serial = world.state("manager").detailsSerial
    world.action(103,"details")
    assert(world.state("manager").detailsSerial == serial + 1)
    world.frame("invdetails", { "{invheader}103|1|Potion|100|2|none||Fixture||-1|||1" })
    world.monitor(2,106,-1,27)
    assert(world.state("manager").detailsSerial == serial + 1)
    world.action(105,"details")
    assert(world.state("manager").detailsSerial == serial + 2)
  `,
  'setup publishes distinct save outcomes for success failure and retry without resetting a failed draft revision': `
    local world, context = inventoryWorld(); world.loaded(); world.setup()
    local revision = world.state("setup").settingsRevision
    world.save()
    local first = world.state("setup").saveResult
    assert(first.ok == true and world.state("setup").settingsRevision == revision + 1)
    context.refuseWrites = true
    local preferences = world.state("setup").preferences; preferences.fontSize = 19
    world.save(nil,preferences)
    local failed = world.state("setup").saveResult
    assert(failed.ok == false and failed.serial > first.serial and world.state("setup").settingsRevision == revision + 1)
    assert(world.state("setup").fontSize == 13 and string.find(failed.message,"Could not save",1,true))
    context.refuseWrites = false; world.save(nil,preferences)
    local retry = world.state("setup").saveResult
    assert(retry.ok == true and retry.serial > failed.serial and world.state("setup").fontSize == 19)
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${source}`));
