import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const fixture = readFileSync(new URL('./fixtures/spells.lua', import.meta.url), 'utf8');
const helpers = `
  local function publish(provider, reader)
    provider.host.broadcastToPlugin("reader", "aardwolf-spells:state", json.encode({
      version = 1, status = { connected = true, refreshing = false, characterName = "Fixture" },
      snapshot = reader.client.spells.get()
    }))
  end
`;

const cases = {
  'Spells dispatch respects a later subscription canceled in the same callback turn': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local unsubscribe, calls = nil, 0
    reader.client.spells.on(function(value) if value then unsubscribe() end end)
    unsubscribe = reader.client.spells.on(function(value) if value then calls = calls + 1 end end)
    publish(provider, reader)
    assert(calls == 0)
  `,
  'stopping from a Spells subscriber cannot deliver its old snapshot afterward': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local stopped, stale = false, 0
    reader.client.spells.on(function(value)
      if value and not stopped then stopped = true; reader.client.stop() end
    end)
    reader.client.spells.on(function(value) if stopped and value then stale = stale + 1 end end)
    publish(provider, reader)
    assert(stopped and not reader.client.status().available)
    assert(reader.client.spells.get() == nil and stale == 0)
  `,
  'disconnecting during Spells notification cannot deliver the old connected snapshot afterward': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local disconnected, stale = false, 0
    reader.client.spells.on(function(value)
      if value and not disconnected then disconnected = true; world.disconnect() end
    end)
    reader.client.spells.on(function(value) if disconnected and value then stale = stale + 1 end end)
    publish(provider, reader)
    assert(disconnected and not reader.client.spells.status().connected)
    assert(reader.client.spells.get() == nil and stale == 0)
  `,
  'stopping during Spells discovery does not subscribe after cleanup': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local subscribeCount, stopped = 0, false
    local broadcast = reader.host.broadcastToPlugin
    reader.host.broadcastToPlugin = function(target, message, data)
      if message == "aardwolf-spells:subscribe" then subscribeCount = subscribeCount + 1 end
      return broadcast(target, message, data)
    end
    reader.client.spells.on(function(_, status)
      if status.reason == "waiting for Spells provider" and not stopped then
        stopped = true; reader.client.stop()
      end
    end)
    provider.host.broadcastPlugin("aardwolf-spells:ready")
    assert(stopped and subscribeCount == 0 and not reader.client.status().available)
    assert(reader.client.spells.status().reason == "not started")
  `,
  'Spells shutdown attempts every cleanup operation despite host exceptions': `
    local world, reader = spellsWorld(); world.active(); world.sample()
    local broadcast, remove = reader.host.broadcastToPlugin, reader.host.off
    local disconnectedRemoved, connectedRemoved, unsubscribed = 0, 0, false
    reader.host.off = function(event, callback)
      remove(event, callback)
      if event == "connected" then connectedRemoved = connectedRemoved + 1; error("private-host-detail") end
      if event == "disconnected" then disconnectedRemoved = disconnectedRemoved + 1 end
    end
    reader.host.broadcastToPlugin = function(target, message, data)
      if message == "aardwolf-spells:unsubscribe" then unsubscribed = true; error("private-host-detail") end
      return broadcast(target, message, data)
    end
    assert(pcall(reader.client.stop))
    assert(connectedRemoved == 1 and disconnectedRemoved == 2 and unsubscribed)
    assert(#reader.events.connected == 0 and #reader.events.disconnected == 0)
    assert(not reader.client.spells.status().available and reader.client.spells.get() == nil)
    assert(#reader.errors > 0)
    for _, message in ipairs(reader.errors) do assert(not string.find(message, "private-host-detail", 1, true)) end
  `,
  'a later stop retries a Spells listener whose removal failed before or after its effect': `
    for _, afterRemoval in ipairs({ false, true }) do
      local world, reader = spellsWorld(); world.active(); world.sample()
      local remove, fail, attempts = reader.host.off, true, 0
      reader.host.off = function(event, callback)
        if event == "connected" then
          attempts = attempts + 1
          if fail then
            fail = false
            if afterRemoval then remove(event, callback) end
            error("private-host-detail")
          end
        end
        return remove(event, callback)
      end
      assert(pcall(reader.client.stop))
      assert(not reader.client.spells.status().available)
      assert(#reader.events.connected == (afterRemoval and 0 or 1))
      assert(pcall(reader.client.stop))
      assert(attempts == 2 and #reader.events.connected == 0 and #reader.events.disconnected == 0)
      reader.client.start()
      assert(#reader.events.connected == 1 and #reader.events.disconnected == 2)
      reader.client.stop()
      assert(#reader.events.connected == 0 and #reader.events.disconnected == 0)
    end
  `,
  'restarting after a failed Spells listener removal replaces the residual hook without duplicates': `
    for _, afterRemoval in ipairs({ false, true }) do
      local world, reader = spellsWorld(); world.active(); world.sample()
      local remove, fail = reader.host.off, true
      reader.host.off = function(event, callback)
        if event == "connected" and fail then
          fail = false
          if afterRemoval then remove(event, callback) end
          error("private-host-detail")
        end
        return remove(event, callback)
      end
      reader.client.stop()
      assert(reader.client.start().available)
      assert(#reader.events.connected == 1 and #reader.events.disconnected == 2)
      reader.client.stop()
      assert(#reader.events.connected == 0 and #reader.events.disconnected == 0)
    end
  `,
  'a later stop retries a failed Spells unsubscribe and removes the provider registration': `
    local world, reader, provider = spellsWorld(); world.active(); world.sample()
    local broadcast, fail, attempts = reader.host.broadcastToPlugin, true, 0
    reader.host.broadcastToPlugin = function(target, message, data)
      if message == "aardwolf-spells:unsubscribe" then
        attempts = attempts + 1
        if fail then fail = false; error("private-host-detail") end
      end
      return broadcast(target, message, data)
    end
    local deliveries, deliver = 0, provider.env.broadcastToPlugin
    provider.env.broadcastToPlugin = function(target, message, data)
      if target == "reader" and message == "aardwolf-spells:state" then deliveries = deliveries + 1 end
      return deliver(target, message, data)
    end
    assert(pcall(reader.client.stop) and attempts == 1)
    world.commands.awspells("refresh"); world.sample()
    assert(deliveries > 0, "The fault did not preserve the provider registration")
    assert(pcall(reader.client.stop) and attempts == 2)
    deliveries = 0
    world.commands.awspells("refresh"); world.sample()
    assert(deliveries == 0, "The explicit cleanup retry left a provider subscription behind")
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(fixture + helpers + source));
