import test from 'node:test';
import { runLua } from './lua-runtime.mjs';

const cases = {
  'library loads without host globals or registrations': `
    local lib = freshLibrary()
    assert(lib.version == "0.9.0" and type(lib.new) == "function")
    assert(not pcall(lib.new, {}))
  `,
  'removed SQLite options fail clearly without invoking host APIs': `
    local world = newWorld()
    local context = world.context("legacy", "Legacy SQL Consumer")
    for _, value in ipairs({ {}, false, "legacy" }) do
      local ok, issue = pcall(freshLibrary().new, context.host, { sqlite = value })
      assert(not ok and string.find(issue, "SQLite support was removed; use native storage", 1, true))
    end
    local client = freshLibrary().new(context.host)
    assert(client.sqlite == nil and type(client.storage.get) == "function")
    assert(#context.broadcasts == 0 and next(context.events) == nil and context.writes == 0)
  `,
  'spells snapshots retain bounded list normalization after SQL removal': `
    local validate = freshLibrary().protocol.spellsSnapshot
    for _, entries in ipairs({
      { { name = "Fireball", level = 10, unusable = false } },
      { ["0"] = { name = "Fireball", level = 10, unusable = false } },
      { ["1"] = { name = "Fireball", level = 10, unusable = false } }
    }) do
      local snapshot = validate({ schemaVersion = 1, characterName = "Fixture", collectedAt = 1, entries = entries })
      assert(#snapshot.entries == 1 and snapshot.entries[1].name == "Fireball")
    end
    local entries = {}
    for index = 1, 1000 do entries[index] = { name = "Ability " .. tostring(index), level = 1, unusable = false } end
    assert(#validate({ schemaVersion = 1, characterName = "Fixture", collectedAt = 1, entries = entries }).entries == 1000)
    entries[1001] = { name = "Overflow", level = 1, unusable = false }
    assert(not pcall(validate, { schemaVersion = 1, characterName = "Fixture", collectedAt = 1, entries = entries }))
    assert(not pcall(validate, { schemaVersion = 1, characterName = "Fixture", collectedAt = 1,
      entries = { [1] = entries[1], [3] = entries[3] } }))
  `,
  'package requirements accept numeric string keys from the JavaScript runtime': `
    local lib = freshLibrary()
    for _, input in ipairs({
      { "Char", "Group", "Char", "Comm", "Room", "Core" },
      { ["1"] = "Char", ["2"] = "Group", ["3"] = "Char", ["4"] = "Comm", ["5"] = "Room", ["6"] = "Core" },
      { ["0"] = "Char", ["1"] = "Group", ["2"] = "Char", ["3"] = "Comm", ["4"] = "Room", ["5"] = "Core" }
    }) do
      local names = lib.protocol.requirements(input)
      assert(#names == 5 and table.concat(names, ",") == "Char,Comm,Core,Group,Room")
    end
  `,
  'package requirements still reject named keys and unsupported values': `
    local lib = freshLibrary()
    assert(#lib.protocol.requirements(nil) == 0 and #lib.protocol.requirements({}) == 0)
    for _, input in ipairs({
      "Char", { Char = "Char" }, { [""] = "Char" }, { [" "] = "Char" },
      { ["1x"] = "Char" }, { ["1"] = "char" }, { ["0"] = "Unknown" },
      { ["1"] = true }, { ["1"] = {} }, { "Char", named = "Group" }
    }) do
      assert(not pcall(lib.protocol.requirements, input))
    end
  `,
  'vitals consumers load and register with string keys from pairs': `
    local original = libraryEnvironment
    function libraryEnvironment()
      local env = original()
      env.pairs = function(value)
        local iterator, state, key = pairs(value)
        return function()
          local item
          key, item = iterator(state, key)
          if key ~= nil then return tostring(key), item end
        end
      end
      return env
    end
    for _, source in ipairs({ "vitals", "example" }) do
      local world = newWorld()
      local panel = world.loadPlugin(source, "panel", "Fixture Vitals")
      assert(panel.widgets["panel:vitals"] and #panel.errors == 0)
      local core = world.core()
      world.connect(); world.packet("char.base", { name = "Fixture" })
      world.packet("char.vitals", { hp = 50, mana = 20, moves = 10 })
      world.packet("char.maxstats", { maxhp = 100, maxmana = 100, maxmoves = 100 })
      assert(panel.widgets["panel:vitals"].bindings.status == "Live vitals")
      assert(#core.errors == 0 and has(world.supports(), "Char 1"))
      world.unload(panel)
      assert(panel.widgets["panel:vitals"] == nil)
      panel.enabled = true; panel.env.init()
      assert(panel.widgets["panel:vitals"].bindings.status == "Live vitals")
    end
  `,
  'Core-first and consumer-first startup discover installed IDs': `
    for _, order in ipairs({ "core-first", "consumer-first" }) do
      local world = newWorld()
      local core, consumer
      if order == "core-first" then core = world.core(); consumer = world.consumer()
      else consumer = world.consumer(); assert(not consumer.client.status().available); core = world.core() end
      assert(consumer.client.status().available)
      world.connect(); world.packet("char.base", { level = 42 })
      assert(consumer.client.status().negotiated)
      assert(core.id == "imported-core-17" and consumer.client.get("char.base").level == 42)
    end
  `,
  'availability waits for a Core reply when broadcasts are deferred': `
    local world = newWorld(); world.core()
    local consumer = world.context("delayed", "Deferred Consumer")
    local original = consumer.host.broadcastToPlugin
    local pending = nil
    consumer.host.broadcastToPlugin = function(target, message, data) pending = { target, message, data } end
    local client = freshLibrary().new(consumer.host)
    local initial = client.start()
    assert(not initial.available and initial.reason == "waiting for Core")
    original(pending[1], pending[2], pending[3])
    assert(client.status().available)
  `,
  'duplicate initialization and stop/restart retain one host registration': `
    local world, consumer, core = runningWorld()
    core.env.init(); consumer.client.start(); consumer.client.start()
    assert(#core.gmcp["char.vitals"] == 1 and #consumer.broadcasts == 1)
    local calls = 0
    local unsubscribe = consumer.client.on("char.vitals", function() calls = calls + 1 end)
    consumer.client.stop(); consumer.client.start()
    calls = 0
    world.packet("char.vitals", { hp = 100 })
    assert(calls == 1 and #consumer.events.disconnected == 1)
    unsubscribe(); world.packet("char.vitals", { hp = 99 }); assert(calls == 1)
  `,
  'character changes clear old character snapshots while same-name partial updates retain them': `
    local world, consumer = runningWorld()
    world.packet("char.base", { level = 201, tier = 7 })
    world.packet("char.status", { level = 201, state = 3 })
    world.packet("char.vitals", { hp = 99 })
    world.packet("char.base", { name = "FIXTURE" })
    assert(consumer.client.get("char.base").tier == 7 and consumer.client.get("char.vitals").hp == 99)
    world.packet("char.base", { name = "Other", level = 20 })
    assert(consumer.client.get("char.base").level == 20 and consumer.client.get("char.base").tier == nil)
    assert(consumer.client.get("char.status") == nil and consumer.client.get("char.vitals") == nil)
    world.packet("char.status", { state = 3 })
    assert(consumer.client.get("char.status").level == nil)
    local late = world.consumer("late", { "Char" })
    assert(late.client.get("char.base").name == "Other" and late.client.get("char.status").level == nil)
    assert(late.client.get("char.vitals") == nil)
    world.packet("char.status", { level = 201 })
    world.packet("char.base", { name = false })
    world.packet("char.base", { name = "Third", level = 10 })
    world.packet("char.status", { state = 3 })
    assert(consumer.client.get("char.base").level == 10 and consumer.client.get("char.status").level == nil)
  `,
  'character updates merge, invalid numeric fields become unknown': `
    local world, consumer = runningWorld()
    world.packet("char.vitals", { hp = "100", mana = 50, extension = { server = "test" } })
    world.packet("char.vitals", { hp = 90 })
    local value = consumer.client.get("char.vitals")
    assert(value.hp == 90 and value.mana == 50 and value.extension.server == "test")
    world.packet("char.vitals", { hp = {}, mana = "invalid" })
    value = consumer.client.get("char.vitals")
    assert(value.hp == nil and value.mana == nil)
    world.packet("char.vitals", "bad"); assert(consumer.client.get("char.vitals").extension.server == "test")
  `,
  'blank metrics remain unknown with MudForge-style numeric conversion': `
    local env = libraryEnvironment()
    env.tonumber = function(value)
      if value == "" or value == " " then return 0 end
      return tonumber(value)
    end
    local lib = load_source("aardwolf-api", env)
    assert(lib.percent("", 100) == nil and lib.percent(" ", 100) == nil)
    local value, invalid = lib.protocol.normalize("char.vitals", { hp = "", mana = " " })
    assert(value.hp == nil and value.mana == nil and invalid.hp and invalid.mana)
  `,
  'all documented character packages and Comm event topics are available': `
    local world, consumer = runningWorld()
    world.packet("char.stats", { dex = "123", align = -1000 })
    world.packet("char.maxstats", { maxhp = "200" })
    world.packet("char.status", { state = "8", enemy = "Fixture Mob", pos = false })
    world.packet("char.worth", { qp = "1000", gold = "9000000" })
    assert(consumer.client.get("char.stats").dex == 123)
    assert(consumer.client.get("char.maxstats").maxhp == 200)
    assert(consumer.client.get("char.status").state == 8 and consumer.client.get("char.status").pos == nil)
    assert(consumer.client.get("char.worth").gold == 9000000)
    local seen = {}
    for _, topic in ipairs({ "comm.quest", "comm.tick", "comm.repop" }) do
      local name = topic
      consumer.client.on(name, function(data) seen[name] = data end)
    end
    world.packet("comm.quest", { action = "start", timer = "52", targ = "Fixture Mob" })
    world.packet("comm.quest", { action = "comp", wait = "30" })
    world.packet("comm.tick", {})
    world.packet("comm.repop", { zone = "fixture" })
    assert(seen["comm.quest"].targ == nil and seen["comm.quest"].wait == 30)
    assert(type(seen["comm.tick"]) == "table" and seen["comm.repop"].zone == "fixture")
  `,
  'room exits and group membership replace, with zero-based member support': `
    local world, consumer = runningWorld({ "Group" })
    world.packet("room.info", { num = "2", exits = { n = "3", s = 1 }, coord = { x = "4", y = "bad" } })
    world.packet("room.info", { num = -1, exits = {} })
    local room = consumer.client.get("room.info")
    assert(room.num == -1 and room.exits.n == nil and room.coord == nil)
    world.packet("group", { members = { [0] = { name = "A", info = { hp = "10" } }, [1] = { name = "B" } } })
    local group = consumer.client.get("group")
    assert(#group.members == 2 and group.members[1].name == "A" and group.members[1].info.hp == 10)
    world.packet("group", { count = 1, members = { { name = "B" } } })
    group = consumer.client.get("group"); assert(#group.members == 1 and group.members[1].name == "B")
  `,
  'snapshots and subscriber payloads are isolated defensive copies': `
    local world, consumer = runningWorld()
    world.packet("room.info", { num = 1, exits = { n = 2 } })
    local first = consumer.client.get("room.info"); first.exits.n = 900
    assert(consumer.client.get("room.info").exits.n == 2)
    consumer.client.on("room.info", function(data) data.exits.n = 800 end)
    consumer.client.on("room.info", function(data) assert(data.exits.n == 3) end)
    world.packet("room.info", { num = 2, exits = { n = 3 } })
    assert(consumer.client.get("room.info").exits.n == 3 and #consumer.errors == 0)
  `,
  'Comm is transient, ANSI is retained and subscriber failures are isolated': `
    local world, consumer = runningWorld()
    local received = 0
    consumer.client.on("comm.channel", function() error("private payload must not be logged") end)
    consumer.client.on("comm.channel", function(data)
      assert(data.msg == string.char(27) .. "[31mFixture"); received = received + 1
    end)
    world.packet("comm.channel", { chan = "gossip", msg = string.char(27) .. "[31mFixture", player = "Fixture" })
    assert(received == 1 and #consumer.errors == 1)
    assert(not string.find(consumer.errors[1], "private payload", 1, true))
    assert(not pcall(consumer.client.get, "comm.channel"))
    local late = world.consumer("late"); late.client.on("comm.channel", function() error("replayed") end)
    late.client.stop(); late.client.start(); assert(#late.errors == 0)
    world.packet("comm.channel", { msg = "bad\0message" }); assert(received == 1)
  `,
  'cyclic, excessive-depth and non-finite data are rejected without changing state': `
    local world, consumer = runningWorld()
    world.packet("char.vitals", { hp = 10 })
    local cycle = {}; cycle.self = cycle
    world.packet("char.vitals", cycle)
    world.packet("char.vitals", { hp = math.huge })
    assert(consumer.client.get("char.vitals").hp == 10)
    local root, current = {}, nil; current = root
    for i = 1, 14 do current.child = {}; current = current.child end
    world.packet("char.vitals", root); assert(consumer.client.get("char.vitals").hp == 10)
  `,
  'disconnect, reconnect and two worlds never reuse session snapshots': `
    local a, ca = runningWorld(nil, "session-a")
    local b, cb = runningWorld(nil, "session-b")
    a.packet("char.vitals", { hp = 11 }); b.packet("char.vitals", { hp = 22 })
    a.disconnect()
    assert(ca.client.get("char.vitals") == nil and not ca.client.status().connected)
    assert(cb.client.get("char.vitals").hp == 22)
    a.connect(); assert(ca.client.get("char.vitals") == nil and not ca.client.status().negotiated)
    a.packet("char.base", { name = "Other" }); a.packet("char.vitals", { hp = 33 })
    assert(ca.client.get("char.vitals").hp == 33 and cb.client.get("char.vitals").hp == 22)
  `,
  'Core unload and reload invalidate consumers and restore their requirements': `
    local world, consumer, core = runningWorld({ "Group" })
    world.packet("char.vitals", { hp = 10 })
    world.unload(core)
    assert(not consumer.client.status().available and consumer.client.get("char.vitals") == nil)
    local reloaded = world.core("new-file-import-id")
    assert(consumer.client.status().available)
    world.tick(1000)
    assert(consumer.client.status().negotiated and has(world.supports(), "Group 1"))
    world.packet("char.vitals", { hp = 20 }); assert(consumer.client.get("char.vitals").hp == 20)
    assert(#consumer.broadcasts == 1 and #reloaded.gmcp["char.vitals"] == 1)
  `,
  'package unions retain baseline and remove withdrawn consumer requirements': `
    local world, consumer = runningWorld({ "Group" })
    assert(has(world.supports(), "Group 1"))
    consumer.client.stop(); world.tick(5000)
    local supports = world.supports()
    assert(not has(supports, "Group 1"))
    for _, name in ipairs({ "Core 1", "Char 1", "Room 1", "Comm 1" }) do assert(has(supports, name)) end
  `,
  'consumer unload removes Group and silent stale declarations are pruned on rebuild': `
    local world, consumer = runningWorld({ "Group" })
    world.unload(consumer); world.tick(5000)
    assert(not has(world.supports(), "Group 1"))
    local stale = world.consumer("stale", { "Group" }); world.tick(5000)
    assert(has(world.supports(), "Group 1"))
    stale.enabled = false
    world.consumer("replacement"); world.tick(5000)
    assert(not has(world.supports(), "Group 1"))
  `,
  'known competing Core blocks negotiation and explicit requests': `
    local world = newWorld()
    world.context("generated-legacy-id", "Aardwolf Core")
    world.core(); local consumer = world.consumer()
    world.connect(); world.packet("char.base", { name = "Fixture" })
    assert(#world.sent == 0 and not consumer.client.status().negotiated)
    local sent, reason = consumer.client.request("char")
    assert(not sent and reason == "another Aardwolf Core is enabled")
  `,
  'bootstrap fallback and repeated Char.Base cannot form a feedback loop': `
    local world = newWorld(); world.core(); local consumer = world.consumer()
    world.connect(); world.tick(1000)
    assert(#world.sent == 1 and consumer.client.status().negotiated)
    for i = 1, 20 do world.packet("char.base", { level = i }) end
    world.tick(5000); assert(#world.sent == 1)
    world.disconnect(); assert(next(world.timers) == nil)
  `,
  'timer and transport failures produce deliberate unavailable negotiation status': `
    local world = newWorld(); world.refuseTimers = true
    world.core(); local consumer = world.consumer(); world.connect()
    assert(consumer.client.status().reason == "bootstrap timer refused")
    world.refuseTransport = true; world.packet("char.base", { name = "Fixture" })
    assert(not consumer.client.status().negotiated and consumer.client.status().reason == "transport refused GMCP negotiation")
    assert(not consumer.client.request("char"))
  `,
  'reattachment restores only character cache without replaying Comm or merged membership': `
    local world, consumer = runningWorld({ "Group" })
    world.packet("char.vitals", { hp = 10 })
    world.packet("room.info", { num = 1, exits = { n = 2 } })
    world.packet("group", { members = { { name = "Fixture" } } })
    world.cache["comm.channel"] = { msg = "private cached text" }
    local events = 0; consumer.client.on("comm.channel", function() events = events + 1 end)
    world.event("reattached"); world.tick(1000)
    assert(consumer.client.get("char.vitals").hp == 10)
    assert(consumer.client.get("room.info") == nil and consumer.client.get("group") == nil and events == 0)
    assert(#world.sent == 2 and world.sent[2].package == "Core.Supports.Set")
  `,
  'explicit requests validate state, kind and transport acceptance': `
    local world, consumer = runningWorld()
    for _, kind in ipairs({ "char", "room", "area", "quest" }) do
      assert(consumer.client.request(kind))
      assert(world.sent[#world.sent].package == "request " .. kind)
    end
    assert(not consumer.client.request("debug"))
    world.refuseTransport = true; assert(not consumer.client.request("room"))
    world.disconnect(); assert(not consumer.client.request("room"))
  `,
  'storage preserves typed values, scopes owners and reports refused writes': `
    local world, consumer = runningWorld()
    local other = world.consumer("other")
    for _, value in ipairs({ 123, false, "text", { size = 14, nested = { true } } }) do
      assert(consumer.client.storage.set("prefs", value))
      local saved = consumer.client.storage.get("prefs")
      assert(type(saved) == type(value))
      if type(saved) == "table" then saved.nested[1] = false; assert(consumer.client.storage.get("prefs").nested[1]) end
    end
    assert(other.client.storage.get("prefs") == nil)
    consumer.refuseWrites = true; assert(not consumer.client.storage.set("prefs", {}))
    consumer.refuseWrites = false; consumer.storageState = "starting"
    assert(not consumer.client.storage.set("prefs", 10))
    consumer.storageState = "failed"; consumer.storageReason = "fixture failure"
    local ok, reason = consumer.client.storage.set("prefs", 10); assert(not ok and reason == "fixture failure")
    consumer.storage["aardwolf-api:prefs"] = { schemaVersion = 9, value = true }
    local value, problem = consumer.client.storage.get("prefs"); assert(value == nil and problem == "unsupported storage schema")
    consumer.storage["aardwolf-api:prefs"] = { schemaVersion = 1 }
    value, problem = consumer.client.storage.get("prefs"); assert(value == nil and problem == "invalid stored value")
    assert(not consumer.client.storage.set("nil", nil))
    assert(not consumer.client.storage.set("function", function() end))
  `,
  'native preference storage retains its bounded copy limit': `
    local world, consumer = runningWorld()
    local value = {}
    for index = 1, 8192 do value[index] = index end
    assert(consumer.client.storage.set("bounded", value))
    value[8193] = 8193
    assert(not consumer.client.storage.set("bounded", value))
    assert(#consumer.client.storage.get("bounded") == 8192 and consumer.writes == 1)
    consumer.storage["aardwolf-api:oversized"] = { schemaVersion = 1, value = value }
    local saved, issue = consumer.client.storage.get("oversized")
    assert(saved == nil and issue == "invalid stored value")
  `,
  'UI helpers bind text without rebuilding and only clean owned widgets': `
    local world, consumer = runningWorld()
    local ui = consumer.client.ui
    local widget = ui.create({ name = "test", type = "html", position = { x = 1, y = 2 } })
    assert(ui.create({ name = "test", type = "html" }) == widget)
    ui.content(widget, "<span data-mud-bind='label'></span>")
    for i = 1, 5 do ui.bind(widget, "label", "<script>untrusted</script>") end
    assert(consumer.widgets[widget].contentWrites == 1)
    assert(consumer.widgets[widget].bindings.label == "<script>untrusted</script>")
    assert(not pcall(ui.bind, "terminal", "label", "bad"))
    local canvas = ui.create({ name = "canvas", type = "canvas" })
    ui.draw(canvas, function() assert(world.activeWidget == canvas) end)
    assert(not pcall(ui.bind, canvas, "label", "bad"))
    consumer.widgets.foreign = { bindings = {} }
    consumer.client.stop()
    assert(consumer.widgets[widget] == nil and consumer.widgets[canvas] == nil and consumer.widgets.foreign ~= nil)
  `,
  'percentages and typography handle unknowns and reject CSS injection': `
    local world, consumer = runningWorld(); local lib = consumer.lib
    assert(lib.percent(5, 10) == 50 and lib.percent(20, 10) == 100 and lib.percent(-10, 10) == 0)
    assert(lib.percent(nil, 10) == nil and lib.percent(5, 0) == nil and lib.percent({}, 10) == nil)
    assert(lib.escape([[<>&"']]) == "&lt;&gt;&amp;&quot;&#39;")
    assert(string.find(consumer.client.ui.typography({ size = 14 }), "font-size:14px", 1, true))
    assert(not pcall(consumer.client.ui.typography, { family = "x';color:red" }))
    assert(not pcall(consumer.client.ui.typography, { size = 200 }))
  `,
  'vitals example uses reactive updates, saves preferences and tears down': `
    local world = newWorld(); world.core()
    local example = world.loadPlugin("example", "example-file-id", "Aardwolf API Vitals Example")
    world.connect(); world.packet("char.base", { name = "Fixture" })
    world.packet("char.vitals", { hp = 10, mana = 20, moves = 30 })
    world.packet("char.maxstats", { maxhp = 20, maxmana = 40, maxmoves = 60 })
    local widget = example.widgets["example-file-id:vitals"]
    assert(widget.bindings.hp == "10 / 20" and widget.bindings.hpWidth == "50%" and widget.contentWrites == 1)
    assert(widget.bindings.status == "Live vitals")
    widget.events.submit({ formData = { fontSize = "16" } })
    assert(example.writes == 1 and widget.contentWrites == 2)
    widget.events.action({ action = "refresh" })
    assert(world.sent[#world.sent].package == "request char")
    world.disconnect(); assert(widget.bindings.hp == "Unknown")
    world.unload(example); assert(next(example.widgets) == nil)
  `,
  'example tolerates future and malformed stored preferences and failed saves': `
    local world = newWorld(); world.core()
    local example = world.loadPlugin("example", "example-file-id", "Aardwolf API Vitals Example")
    example.env.cleanup()
    example.storage["aardwolf-api:typography"] = { schemaVersion = 99, value = {} }
    example.env.init()
    local widget = example.widgets["example-file-id:vitals"]
    assert(widget and string.find(widget.content, "font-family:system-ui", 1, true))
    example.refuseWrites = true
    widget.events.submit({ formData = { fontSize = "16" } })
    assert(example.writes == 0 and widget.contentWrites == 1 and widget.bindings.status == "storage refused the write")
    widget.events.submit({ formData = { fontSize = {} } })
    assert(widget.contentWrites == 1)
    example.env.cleanup()
    example.storage["aardwolf-api:typography"] = { schemaVersion = 1, value = { size = 99, family = "x';color:red" } }
    example.env.init(); assert(example.widgets["example-file-id:vitals"])
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(source));
