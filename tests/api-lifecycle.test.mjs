import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

// Fault-injected host and callback checks; these do not execute MudForge's bridge.
const cases = {
  'a partially registered broadcast hook cannot duplicate delivery after startup retries': `
    for _, afterRegistration in ipairs({ false, true }) do
      local world = newWorld(); world.core()
      local context = world.context("broadcast-retry", "Broadcast Retry")
      local register, fail = context.host.onPluginBroadcast, true
      context.host.onPluginBroadcast = function(callback)
        if fail then
          fail = false
          if afterRegistration then register(callback) end
          error("private-host-detail")
        end
        register(callback)
      end
      local client = freshLibrary().new(context.host)
      assert(not client.start().available)
      assert(client.start().available)
      world.connect(); world.packet("char.base", { name = "Fixture" })
      local calls = 0
      client.on("char.vitals", function(value) if value then calls = calls + 1 end end)
      world.packet("char.vitals", { hp = 77 })
      assert(calls == 1 and client.get("char.vitals").hp == 77)
      client.stop()
    end
  `,
  'inventory subscriber delivery stops when an earlier subscriber stops the consumer': `
    local world = newWorld(); world.core()
    local context = world.consumer("inventory-dispatch", { "Char" }, { inventory = true })
    world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
    local stopped, stale = false, 0
    context.client.inventory.on(function(snapshot)
      if snapshot.items["101"] and not stopped then
        stopped = true; context.client.stop()
      end
    end)
    context.client.inventory.on(function(snapshot)
      if stopped and snapshot.items["101"] then stale = stale + 1 end
    end)
    world.line("{invdata}"); world.line("101,,a bag,1,11,0,-1,-1"); world.line("{/invdata}")
    assert(stopped and stale == 0 and not context.client.status().available)
    assert(not context.client.inventory.getItem(101))
  `,
  'a failed Core withdrawal can be retried without leaving a stopped inventory owner': `
    for _, retry in ipairs({ "stop", "start" }) do
      local world = newWorld(); world.core()
      local context = world.consumer("withdrawal-retry", { "Char" }, { inventory = true })
      world.connect(); world.packet("char.base", { name = "Fixture" }); world.packet("char.status", { state = 3 })
      world.line("{invdata}"); world.line("{/invdata}"); world.line("{eqdata}"); world.line("{/eqdata}")
      local broadcast, attempts = context.host.broadcastToPlugin, 0
      context.host.broadcastToPlugin = function(target, message, data)
        if message == "aardwolf-api:unregister" then
          attempts = attempts + 1
          if attempts == 1 then error("private-host-detail") end
        end
        return broadcast(target, message, data)
      end
      context.client.stop()
      assert(not context.client.status().available)
      context.client[retry]()
      assert(attempts == 2)
      if retry == "stop" then
        local before = #world.commands
        world.line("{invmon}malformed")
        assert(#world.commands == before, "Core retained the stopped inventory consumer")
      else
        assert(context.client.status().available)
        context.client.stop()
      end
    end
  `,
  'startup removes a listener even when registration throws after adding it': `
    local world = newWorld(); world.core()
    local context = world.context("partial-listener", "Partial Listener")
    local register, fail = context.host.on, true
    context.host.on = function(event, callback)
      register(event, callback)
      if fail then fail = false; error("private-host-detail") end
    end
    local client = freshLibrary().new(context.host)
    assert(not client.start().available)
    assert(#context.events.disconnected == 0)
    assert(client.start().available and #context.events.disconnected == 1)
  `,
  'stop finishes other cleanup and retries only owned widgets whose destruction failed': `
    local world = newWorld(); world.core()
    local context = world.consumer("widget-cleanup-retry")
    local first = context.client.ui.create({ name = "first", type = "html" })
    local second = context.client.ui.create({ name = "second", type = "canvas" })
    local foreign = context.host.createWidget({ name = "foreign", type = "html" })
    local destroy, fail = context.host.destroyWidget, true
    context.host.destroyWidget = function(id)
      if id == first and fail then fail = false; error("private-host-detail") end
      destroy(id)
    end
    context.client.stop()
    assert(not context.client.status().available and #context.events.disconnected == 0)
    assert(context.widgets[first] and not context.widgets[second] and context.widgets[foreign])
    context.client.stop()
    assert(not context.widgets[first] and context.widgets[foreign])
    for _, issue in ipairs(context.errors) do assert(not string.find(issue, "private-host-detail", 1, true)) end
  `,
  'a listener removal exception cannot leave duplicate hooks on the next start': `
    for _, afterRemoval in ipairs({ false, true }) do
      local world = newWorld(); world.core()
      local context = world.consumer("listener-cleanup-retry")
      local remove, fail = context.host.off, true
      context.host.off = function(event, callback)
        if fail then
          fail = false
          if afterRemoval then remove(event, callback) end
          error("private-host-detail")
        end
        remove(event, callback)
      end
      context.client.stop()
      assert(not context.client.status().available)
      assert(context.client.start().available)
      assert(#context.events.disconnected == 1)
      context.client.stop()
      assert(#context.events.disconnected == 0)
    end
  `,
  'failed Core discovery rolls back startup and permits a clean retry': `
    local world = newWorld(); world.core()
    local context = world.context("lookup-retry", "Lookup Retry")
    local attempts, lookup = 0, context.host.findPluginByName
    context.host.findPluginByName = function(name)
      attempts = attempts + 1
      if attempts == 1 then error("private-host-detail") end
      return lookup(name)
    end
    local client = freshLibrary().new(context.host)
    local ok, status = pcall(client.start)
    assert(ok, "A host lookup exception escaped startup")
    assert(not status.available and not client.status().available)
    assert(#(context.events.disconnected or {}) == 0, "Failed startup leaked its listener")
    assert(#context.errors > 0 and not string.find(context.errors[#context.errors], "private-host-detail", 1, true))
    assert(client.start().available and attempts == 2)
    assert(#context.broadcasts == 1 and #context.events.disconnected == 1)
    client.start()
    assert(attempts == 2 and #context.events.disconnected == 1)
  `,
  'an unregister exception cannot prevent stop from clearing status listeners and owned widgets': `
    local world = newWorld(); world.core()
    local context = world.consumer("stop-with-host-failure")
    local first = context.client.ui.create({ name = "first", type = "html" })
    local second = context.client.ui.create({ name = "second", type = "canvas" })
    local broadcast = context.host.broadcastToPlugin
    context.host.broadcastToPlugin = function(target, message, data)
      if message == "aardwolf-api:unregister" then error("private-host-detail") end
      return broadcast(target, message, data)
    end
    assert(pcall(context.client.stop), "An unregister exception escaped cleanup")
    assert(not context.client.status().available and context.client.status().reason == "not started")
    assert(#context.events.disconnected == 0)
    assert(context.widgets[first] == nil and context.widgets[second] == nil)
    assert(#context.errors > 0 and not string.find(context.errors[#context.errors], "private-host-detail", 1, true))
    assert(pcall(context.client.stop))
    assert(not context.client.status().available and #context.events.disconnected == 0)
  `,
  'stopping in a subscriber prevents later subscribers from receiving the obsolete update': `
    local world, context = runningWorld()
    local stopped, stale = false, 0
    context.client.on("char.vitals", function(value)
      if value and value.hp == 77 then context.client.stop(); stopped = true end
    end)
    context.client.on("char.vitals", function(value)
      if stopped and value then stale = stale + 1 end
    end)
    world.packet("char.vitals", { hp = 77 })
    assert(stopped and not context.client.status().available)
    assert(context.client.get("char.vitals") == nil and stale == 0)
  `,
  'unsubscribing a later subscriber suppresses it in the same dispatch': `
    local world, context = runningWorld()
    local unsubscribe, calls = nil, 0
    context.client.on("char.vitals", function() unsubscribe() end)
    unsubscribe = context.client.on("char.vitals", function() calls = calls + 1 end)
    world.packet("char.vitals", { hp = 77 })
    world.packet("char.vitals", { hp = 76 })
    assert(calls == 0)
  `,
  'disconnecting in a subscriber cannot deliver its old connected payload afterward': `
    local world, context = runningWorld()
    local disconnected, stale = false, 0
    context.client.on("char.vitals", function(value)
      if value and value.hp == 77 then world.disconnect(); disconnected = true end
    end)
    context.client.on("char.vitals", function(value)
      if disconnected and value then stale = stale + 1 end
    end)
    world.packet("char.vitals", { hp = 77 })
    assert(disconnected and not context.client.status().connected)
    assert(context.client.get("char.vitals") == nil and stale == 0)
  `,
  'restarting in a subscriber permits fresh state replay without duplicate old delivery': `
    local world, context = runningWorld()
    local restarted, calls = false, 0
    context.client.on("char.vitals", function(value)
      if value and value.hp == 77 and not restarted then
        restarted = true; context.client.stop(); context.client.start()
      end
    end)
    context.client.on("char.vitals", function(value)
      if value and value.hp == 77 then calls = calls + 1 end
    end)
    world.packet("char.vitals", { hp = 77 })
    assert(restarted and context.client.status().available)
    assert(context.client.get("char.vitals").hp == 77 and calls == 1)
  `,
  'stopping from the session callback aborts the remaining initial state replay': `
    local world = newWorld(); world.core(); world.connect()
    world.packet("char.base", { name = "Fixture" }); world.packet("char.vitals", { hp = 77 })
    local context = world.context("stop-state-replay", "Stop State Replay")
    local client = freshLibrary().new(context.host)
    local stopped, calls = false, 0
    client.on("session", function(state)
      if state.available and not stopped then stopped = true; client.stop() end
    end)
    client.on("char.vitals", function() calls = calls + 1 end)
    client.start()
    assert(stopped and not client.status().available and calls == 0)
  `,
  'an optional Spells startup exception rolls back the entire consumer before retry': `
    local world = newWorld(); world.core()
    local context = world.context("spells-start-retry", "Spells Start Retry")
    local fail, register = true, context.host.on
    context.host.on = function(event, callback)
      if event == "connected" and fail then fail = false; error("private-host-detail") end
      return register(event, callback)
    end
    local client = freshLibrary().new(context.host, { spells = true })
    local ok, status = pcall(client.start)
    assert(ok, "An optional Spells startup exception escaped")
    assert(not status.available and not client.status().available)
    assert(#(context.events.connected or {}) == 0 and #(context.events.disconnected or {}) == 0)
    assert(#context.errors > 0 and not string.find(context.errors[#context.errors], "private-host-detail", 1, true))
    assert(client.start().available)
    assert(#context.events.connected == 1 and #context.events.disconnected == 2)
    assert(#context.broadcasts == 1)
    client.stop()
    assert(#context.events.connected == 0 and #context.events.disconnected == 0)
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(source));
