import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/inventory-manager.lua', import.meta.url), 'utf8');
const helpers = `
  local function reader()
    local world = newWorld()
    local core = world.core()
    local consumer = world.consumer("reader", { "Char" }, { inventory = true })
    return world, consumer.client.inventory, consumer, core
  end
  local function sendStatus(core, consumer, generation, value)
    core.host.broadcastToPlugin(consumer.id, "aardwolf-api:inventory-status", json.encode({ version = 1, generation = generation, status = value }))
  end
  local function noEffects(world, context, env, read)
    local broadcasts, properties = 0, 0
    local send, set = context.host.broadcastToPlugin, env.setWidgetProperty
    context.host.broadcastToPlugin = function(...) broadcasts = broadcasts + 1; return send(...) end
    env.setWidgetProperty = function(...) properties = properties + 1; return set(...) end
    local before = { commands = #world.commands, gmcp = #world.sent, timers = world.nextTimer, writes = context.writes }
    for _ = 1, 3 do read() end
    assert(#world.commands == before.commands and #world.sent == before.gmcp and world.nextTimer == before.timers)
    assert(context.writes == before.writes and broadcasts == 0 and properties == 0)
    context.host.broadcastToPlugin, env.setWidgetProperty = send, set
  end
`;
const cases = {
  'diagnostics distinguish unavailable, waiting, reading, empty and unknown scopes without reading the server': `
    local world, inventory = reader()
    assert(inventory.diagnostics().readiness == "disconnected")
    assert(inventory.diagnostics().scopes[1].freshness == "unknown")
    world.connect(); world.packet("char.base", { name = "PRIVATE_CHARACTER" })
    assert(inventory.diagnostics().readiness == "waiting")
    world.packet("char.status", { state = 3 })
    local d = inventory.diagnostics("container:101")
    assert(d.libraryVersion == "0.10.0" and d.provider.coreVersion == "0.6.0" and d.provider.libraryVersion == "0.10.0")
    assert(d.capabilities.inventoryDiagnostics and d.collector.queuedReads == 1)
    assert(d.collector.phase == "reading" and d.collector.operation.kind == "inventory")
    assert(d.collector.operation.waitingFor == "opening-tag" and d.scopes[3].freshness == "unknown")
    world.line("{invdata}")
    assert(inventory.diagnostics().collector.operation.waitingFor == "closing-tag")
    world.line("{/invdata}"); world.line("{eqdata}"); world.line("{/eqdata}")
    d = inventory.diagnostics()
    assert(d.collector.phase == "idle" and d.collector.queuedReads == 0)
    assert(d.scopes[1].freshness == "empty" and d.scopes[1].count == 0)
    assert(not string.find(json.encode(d), "PRIVATE_CHARACTER", 1, true))
    d.provider.coreVersion = "mutated"; d.collector.phase = "bad"; d.scopes[1].freshness = "bad"
    assert(inventory.diagnostics().provider.coreVersion == "0.6.0" and inventory.diagnostics().collector.phase == "idle")
  `,
  'status and details snapshots have no side effects while reading, capturing, queued or draining': `
    local world, context, env = inventoryWorld(); world.active()
    local function check()
      noEffects(world, context, env, function()
        local output = world.pluginCommands.awinventory("status")
        assert(string.find(output, "queued reads:", 1, true))
      end)
    end
    check(); world.line("{invdata}"); check()
    world.tick(10001); check()
    local output = world.pluginCommands.awinventory("status")
    assert(string.find(output, "Drain: closing-tag", 1, true))
    local before = #world.commands
    for _ = 1, 5 do world.pluginCommands.awinventory("status") end
    assert(#world.commands == before)
    world.line("{/invdata}")
    output = world.pluginCommands.awinventory("status")
    assert(string.find(output, "last collection failure: timeout", 1, true))
    assert(string.find(output, "Drain: none", 1, true))
  `,
  'nested and manual interrupted replies remain blocked when diagnostics are read': `
    for _, mode in ipairs({ "nested", "manual" }) do
      local world, context, env, core = inventoryWorld(); world.active()
      if mode == "nested" then world.line("{invdata}"); world.line("{eqdata}")
      else core.host.send("invdata 101") end
      local before = #world.commands
      local output = world.pluginCommands.awinventory("status")
      assert(string.find(output, "last collection failure: interrupted", 1, true))
      if mode == "nested" then
        assert(string.find(output, "Drain: reconnect", 1, true))
        world.line("{/invdata}"); world.line("{/eqdata}")
        assert(string.find(world.pluginCommands.awinventory("status"), "Drain: reconnect", 1, true))
      end
      noEffects(world, context, env, function() world.pluginCommands.awinventory("status") end)
      assert(#world.commands == before)
    end
  `,
  'fresh, partial, stale, empty and bounded requested scopes retain distinct meanings': `
    local world, context, env, core = inventoryWorld(); world.loaded(); world.open("container:101")
    assert(world.state("manager").diagnostics.scopes[3].freshness == "unknown")
    world.frame("invdata 101", {})
    assert(world.state("manager").diagnostics.scopes[3].freshness == "empty")
    world.message("manager", "refresh"); world.tick(10001)
    assert(world.state("manager").diagnostics.scopes[3].freshness == "stale")
    local consumer = world.consumer("late-reader", { "Char" }, { inventory = true })
    local d = consumer.client.inventory.diagnostics("container:101")
    assert(#d.scopes == 3 and #consumer.client.inventory.diagnostics("private scope").scopes == 2)
    world.disconnect()
    assert(consumer.client.inventory.diagnostics().collector == nil)
    assert(consumer.client.inventory.diagnostics().scopes[1].freshness == "unknown")
  `,
  'old Core and malformed diagnostic fields report unknown collector details instead of false idle': `
    local world, inventory, consumer, core = reader()
    local function state(capabilities, provider)
      core.host.broadcastToPlugin(consumer.id, "aardwolf-api:state", json.encode({ version = 1,
        session = { connected = true, negotiated = true }, snapshots = {}, capabilities = capabilities, provider = provider }))
    end
    state({ inventory = 1 })
    assert(inventory.diagnostics().collector == nil and not inventory.diagnostics().capabilities.inventoryDiagnostics)
    state({})
    assert(inventory.diagnostics().readiness == "unavailable")
    state({ inventory = 1, inventoryDiagnostics = 1 }, { coreVersion = "PRIVATE_EXCEPTION", libraryVersion = string.rep("1",100) })
    assert(next(inventory.diagnostics().provider) == nil)
    local base = { connected = true, collecting = false, active = true }
    for _, invalid in ipairs({ { version = 2 }, { version = 1, phase = "PRIVATE_TEXT", queuedReads = 0 },
      { version = 1, phase = "idle", drain = "none", queuedReads = 65, monitoring = true },
      { version = 1, phase = "idle", drain = "none", queuedReads = 0, monitoring = true, lastFailure = "PRIVATE_EXCEPTION" } }) do
      base.diagnostics = invalid; sendStatus(core, consumer, 2, base)
      assert(inventory.diagnostics().collector == nil)
    end
    base.diagnostics = { version = 1, phase = "idle", drain = "none", queuedReads = 0, monitoring = true, raw = "PRIVATE_RAW" }
    sendStatus(core, consumer, 2, base)
    assert(inventory.diagnostics().collector.phase == "idle")
    assert(not string.find(json.encode(inventory.diagnostics()), "PRIVATE", 1, true))
  `,
  'failures retain sanitized history through draining and clear with identity changes and consumer stop': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open()
    world.action(103,"details")
    world.line("Item 103 not found.")
    assert(string.find(world.pluginCommands.awinventory("status"), "request-failed", 1, true))
    world.message("manager","refresh"); world.frame("invdata", {}); world.frame("eqdata", {})
    assert(string.find(world.pluginCommands.awinventory("status"), "request-failed", 1, true))
    world.packet("char.base", { name = "PRIVATE_NEW_CHARACTER" })
    assert(not string.find(world.pluginCommands.awinventory("status"), "request-failed", 1, true))
    assert(not string.find(world.pluginCommands.awinventory("status"), "PRIVATE", 1, true))
    env.cleanup()
  `,
  'prepared use exposes phase and cancellation, then retains only remaining recovery instructions': `
    local world, context, env = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101", { "301,,PRIVATE_WAND,1,3,0,-1,-1" })
    world.save({ heldSlot = 26, rules = {} }); world.action(301,"zap"); world.submit({ target = "PRIVATETARGET" }); world.tick(2)
    assert(world.state("manager").diagnostics.workflow.phase == "prepare")
    world.monitor(5,301,101); world.monitor(1,202)
    local text = world.pluginCommands.awinventory("status")
    assert(string.find(text,"previous item #202",1,true) and string.find(text,"bag #101",1,true))
    assert(not string.find(text,"PRIVATE",1,true) and not string.find(text,"Fixture",1,true))
    world.message("manager","cancel")
    assert(world.state("manager").diagnostics.workflow.cancelRequested)
    world.disconnect()
    text = world.pluginCommands.awinventory("status")
    assert(not string.find(text,"#202",1,true) and not string.find(text,"#301",1,true))
    assert(string.find(text,"previous character",1,true))
    local before = #world.commands; world.connect(); world.tick(1000)
    assert(world.count("zap PRIVATETARGET") == 0 and #world.commands == before)
  `,
  'successful restoration clears outstanding steps, and consumed bagged items need no recovery': `
    local world = inventoryWorld(); world.loaded(); world.open("container:101")
    world.frame("invdata 101", { "301,,a potion,1,8,0,-1,-1" })
    world.action(301,"quaff"); world.submit(); world.tick(2); world.monitor(5,301,101)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1" }); world.frame("eqdata", {})
    world.tick(2)
    local d = world.state("manager").diagnostics
    assert(d.workflow.phase == "idle" and d.workflow.outcome == "complete")
    assert(next(d.manualRecovery) == nil)
  `,
  'request rejection updates last failure immediately without exposing transport exception text': `
    local world, inventory, consumer, core = reader()
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    world.tick(10001); world.line("{/invdata}")
    assert(inventory.diagnostics().collector.lastFailure == "timeout")
    inventory.hold(999)
    assert(inventory.diagnostics().collector.lastFailure == "request-failed")
    core.env.onSend = function() error("PRIVATE_TRANSPORT_EXCEPTION") end
    inventory.refresh()
    assert(inventory.diagnostics().collector.lastFailure == "transport-refused")
    assert(not string.find(json.encode(inventory.diagnostics()), "PRIVATE", 1, true))
  `,
  'a completed restoration never turns a later manual placement into outstanding recovery': `
    local world = inventoryWorld(); world.loaded(); world.open()
    world.save({ heldSlot = 26, rules = {} }); world.action(106,"zap"); world.submit({ target = "self" }); world.tick(2)
    world.monitor(1,202); world.monitor(2,106,-1,26)
    world.frame("invdata", { "101,,a canvas bag,1,11,0,-1,-1", "202,,a staff,1,4,0,-1,-1" })
    world.frame("eqdata", { "106,,a wand,1,3,0,26,-1" }); world.tick(2)
    world.monitor(1,106); world.monitor(2,202,-1,26)
    assert(world.state("manager").diagnostics.workflow.outcome == "complete")
    world.monitor(1,202)
    assert(next(world.state("manager").diagnostics.manualRecovery) == nil)
    world.disconnect()
    assert(next(world.state("manager").diagnostics.manualRecovery) == nil)
  `,
  'partial cache entries and old-generation diagnostics cannot masquerade as a fresh empty listing': `
    local world, inventory, consumer, core = reader()
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    world.line("{invitem}101,,PRIVATE_BAG,1,11,0,-1,-1")
    assert(inventory.diagnostics().scopes[1].freshness == "partial")
    world.disconnect(); world.connect(); world.packet("char.base", { name = "Other" }); world.packet("char.status", { state = 3 })
    local before = json.encode(inventory.diagnostics())
    sendStatus(core, consumer, 1, { connected = true, collecting = false, active = true,
      diagnostics = { version = 1, phase = "idle", drain = "none", queuedReads = 0, monitoring = true } })
    assert(json.encode(inventory.diagnostics()) == before)
    consumer.client.stop()
    assert(inventory.diagnostics().collector == nil and not inventory.diagnostics().available)
  `,
  'reentrant stop during a capability reset cannot resurrect provider diagnostics': `
    local world, inventory, consumer, core = reader()
    local armed = true
    inventory.on(function() if armed then armed = false; consumer.client.stop() end end)
    core.host.broadcastToPlugin(consumer.id,"aardwolf-api:state",json.encode({ version = 1, session = { connected = false }, snapshots = {},
      capabilities = { inventory = 1, inventoryDiagnostics = 1 }, provider = { coreVersion = "0.6.0" } }))
    local d = inventory.diagnostics()
    assert(not d.available and next(d.provider) == nil and not d.capabilities.inventoryDiagnostics)
  `,
};
for (const [name, source] of Object.entries(cases)) test(name, () => runLua(`${fixture}\n${helpers}\n${source}`));
