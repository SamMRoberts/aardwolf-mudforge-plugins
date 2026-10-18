import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runLua } from './lua-runtime.mjs';
import { root } from '../tools/build-repository.mjs';
import { parseMudForgeLua } from '../tools/lua-compatibility.mjs';

const source = readFileSync(resolve(root, 'src/plugins/aardwolf-atlas.lua'), 'utf8');
const fixture = readFileSync(resolve(root, 'tests/fixtures/atlas.lua'), 'utf8');
const setup = 'local world, env = atlasWorld(); world.handshake(); world.ready()';
const cases = {
  'waits for both readiness barriers and preserves remembered closure': `
    local world, env = atlasWorld({ visible = false })
    assert(world.reads == 0 and #world.messages == 0)
    world.handshake(); assert(world.last().type == "init" and world.last().mapReady == false and world.reads == 0)
    world.request("area", { areaId = "Alpha", generation = 0 }); assert(world.last().type == "error" and world.reads == 0)
    world.ready(); assert(world.last().mapReady and not world.last().visible)
    assert(world.last().playerRoomId == 1 and world.last().playerAreaId == "Alpha" and world.last().playerZ == 0)
    assert(world.panel().config.size.width == 900 and world.panel().config.size.height == 640)
    world.commands.awatlas("show"); assert(world.panel().visible and world.last().visible)
  `,
  'native zero-indexed arrays retain first and last rooms and overlapping coordinates': `
    ${setup}
    world.rooms[2].x = 1
    world.request("area", { areaId = "Alpha", generation = 0, offset = 0 })
    local response = world.last()
    assert(response.type == "area" and #response.rooms == 2 and response.rooms[1].id == 1 and response.rooms[2].id == 2)
    assert(response.rooms[1].x == response.rooms[2].x and response.done and response.nextOffset == 2)
    assert(response.rooms[2].specialExits["enter portal"] == 3 and response.rooms[2].doors.u == 2)
    assert(response.rooms[2].exits["enter portal"] == nil and response.rooms[2].exits.u == 3)
    assert(response.rooms[2].flags[1] == "shop" and response.rooms[2].flags[2] == "quest")
  `,
  'chunks a large area with sequential pulls and invalidates stale streams': `
    ${setup}
    for id = 4, 400 do world.add(id) end
    world.request("area", { areaId = "Alpha", generation = 1, offset = 0 })
    assert(#world.last().rooms == 128 and world.last().nextOffset == 128 and not world.last().done)
    local count = #world.messages
    world.request("area", { areaId = "Alpha", generation = 1, offset = 300 }); assert(#world.messages == count)
    world.request("area", { areaId = "Beta", generation = 2, offset = 0 }); assert(world.last().rooms[1].id == 3)
    count = #world.messages
    world.request("area", { areaId = "Alpha", generation = 1, offset = 128 }); assert(#world.messages == count)
    world.emit("update"); assert(world.last().invalidate and world.last().revision == 1)
    count = #world.messages
    world.request("area", { areaId = "Beta", generation = 2, offset = 1 }); assert(#world.messages == count)
    world.request("area", { areaId = "Alpha", generation = 3, offset = 0, revision = 0 }); assert(#world.messages == count)
    world.request("area", { areaId = "Beta", generation = 2, offset = 0 }); assert(#world.messages == count)
    world.request("area", { areaId = "Alpha", generation = 3, offset = 0, revision = 1 }); assert(world.last().revision == 1)
  `,
  'hidden-only chunks still advance and world state stays isolated': `
    ${setup}
    for id = 1, 130 do world.add(id); world.metadata[id] = { hidden = true } end
    world.request("area", { areaId = "Alpha", generation = 0 })
    assert(next(world.last().rooms) == nil and world.last().nextOffset == 128 and not world.last().done)
    world.request("area", { areaId = "Alpha", generation = 0, offset = 128 })
    assert(next(world.last().rooms) == nil and world.last().nextOffset == 130 and world.last().done)
    local other, otherEnv = atlasWorld({ id = "second-world" }); other.handshake(); other.ready()
    local count = #other.messages
    world.request("preferences", { preferences = { view = "perspective", follow = false, exploded = true, collapsed = true } })
    world.emit("update")
    assert(#other.messages == count and other.writes == 0 and other.last().preferences.view == "overhead")
    other.request("area", { areaId = "Alpha", generation = 0 }); assert(#other.last().rooms == 2)
  `,
  'oversized room data fails explicitly instead of exceeding chunk limits': `
    ${setup}
    world.metadata[2].flags = { string.rep("x", 140000) }
    world.request("area", { areaId = "Alpha", generation = 0 })
    assert(world.last().type == "error" and world.last().requestAction == "area")
  `,
  'hidden and missing-coordinate records never invent topology': `
    ${setup}
    world.metadata[2].hidden = true; world.rooms[1].x = nil
    world.request("area", { areaId = "Alpha", generation = 0, offset = 0 })
    assert(#world.last().rooms == 1 and world.last().rooms[1].x == nil and world.last().nextOffset == 2)
    assert(world.last().rooms[1].exits.e == 2)
    world.request("inspect", { roomId = 2, generation = 0 }); assert(world.last().type == "error")
  `,
  'inspection preserves inert text and native metadata, and rejects stale selection': `
    ${setup}
    world.request("inspect", { roomId = 2, generation = 4 })
    local room = world.last().room
    assert(room.notes == "<script>literal notes</script>" and room.details == "Map details")
    assert(room.userData.owner == "user" and room.exitLocks["enter portal"] and room.color == "#abcdef")
    assert(room.symbol == "S" and room.weight == 7)
    local count = #world.messages
    world.request("inspect", { roomId = 1, generation = 3 }); assert(#world.messages == count)
  `,
  'flag visuals use native order with independent room overrides and cached definitions': `
    ${setup}
    assert(world.flagReads == 1)
    world.request("inspect", { roomId = 2, generation = 0 })
    local room = world.last().room
    assert(room.color == "#abcdef" and room.symbol == "S")
    assert(room.flagColor == "#aabbcc" and room.flagSymbol == "F" and room.flagSymbolColor == "#123456")
    world.metadata[2].color, world.metadata[2].symbol = nil, nil
    world.metadata[2].flags = { "unknown", "quest", "shop" }
    world.request("inspect", { roomId = 2, generation = 1 })
    room = world.last().room
    assert(room.color == nil and room.symbol == nil and room.flagColor == "#778899" and room.flagSymbol == "Q")
    assert(world.flagReads == 1)
    world.flagDefinitions.quest = { color = "", symbol = "", symbolColor = "#fff" }
    world.emit("update"); assert(world.flagReads == 2)
    world.request("inspect", { roomId = 2, generation = 2 })
    room = world.last().room
    assert(room.flagColor == "#aabbcc" and room.flagSymbol == "F")
    world.flagDefinitions.shop = { color = "#010203", symbol = "N" }
    world.commands.awatlas("show"); assert(world.flagReads == 3)
    world.request("inspect", { roomId = 2, generation = 3 }); assert(world.last().room.flagSymbol == "N")
  `,
  'structured native details remain bounded inert JSON text': `
    ${setup}
    world.rooms[2].details = { kind = "forest", values = { 1, "<script>inert</script>" }, safe = true }
    world.request("inspect", { roomId = 2, generation = 0 })
    local value = json.decode(world.last().room.details)
    assert(value.kind == "forest" and value.values[2] == "<script>inert</script>" and value.safe)
    world.rooms[2].details = { huge = string.rep("x", 20000) }
    world.request("inspect", { roomId = 2, generation = 1 })
    assert(world.last().room.details == "[Details exceed the 16 KiB display limit]")
    world.rooms[2].details = {}
    world.rooms[2].details.self = world.rooms[2].details
    world.request("inspect", { roomId = 2, generation = 2 })
    assert(world.last().room.details == "[Details could not be serialized]")
  `,
  'route uses native locks and weights without moving and preserves custom directions': `
    ${setup}
    world.request("route", { roomId = 3, generation = 0 })
    local route = world.last()
    assert(route.found and route.cost == 8 and route.stepCount == 2 and #route.steps == 2)
    assert(route.steps[1].roomId == 2 and route.steps[2].roomId == 3)
    assert(route.steps[2].areaId == "Beta" and route.steps[2].z == 2 and route.steps[2].direction == "enter portal")
    assert(world.pathCalls == 1 and world.writes == 0)
    world.metadata[3] = { locked = true }
    world.request("route", { roomId = 3, generation = 1 }); assert(not world.last().found and world.last().error == "Destination locked")
    world.request("route", { roomId = 1, generation = 2 }); assert(world.last().stepCount == 0 and world.last().cost == 0)
    local calls = world.pathCalls
    world.request("route", { roomId = 3, generation = 1 }); assert(world.pathCalls == calls)
  `,
  'oversized inspection and routes fail explicitly without publishing partial results': `
    ${setup}
    world.metadata[2].userData = { huge = string.rep("x", 140000) }
    world.request("inspect", { roomId = 2, generation = 0 })
    assert(world.last().type == "error" and world.last().requestAction == "inspect")
    local path = { found = true, distance = 3000, vnums = {}, directions = {} }
    for id = 4, 3003 do
      world.add(id); table.insert(path.vnums, id); table.insert(path.directions, "e")
    end
    env.findPath = function() return path end
    local count = #world.messages
    world.request("route", { roomId = 3003, generation = 0 })
    assert(#world.messages == count + 1 and world.last().type == "error" and world.last().requestAction == "route")
    assert(world.last().steps == nil)
  `,
  'same-room native paths without arrays remain zero-step zero-cost routes': `
    ${setup}
    env.findPath = function(origin, target)
      assert(origin == target and origin == 1)
      return { found = true, distance = 0 }
    end
    world.request("route", { roomId = 1, generation = 0 })
    assert(world.last().type == "route" and world.last().found)
    assert(world.last().stepCount == 0 and world.last().cost == 0 and next(world.last().steps) == nil)
    assert(world.echo == nil)
  `,
  'malformed messages and other worlds cannot read data or change preferences': `
    ${setup}
    local reads, writes, count = world.reads, world.writes, #world.messages
    for _, value in ipairs({ false, "bad", {}, { v = 2, action = "ready" }, { v = 1, action = {} },
      { v = 1, action = "area", areaId = {}, generation = 0 }, { v = 1, action = "inspect", roomId = "2", generation = 0 },
      { v = 1, action = "route", roomId = 2.5, generation = 0 }, { v = 1, action = "area", areaId = "Alpha", generation = -1 },
      { v = 1, action = "inspect", roomId = math.huge, generation = 0 },
      { v = 1, action = "area", areaId = "Alpha", generation = 0, offset = false } }) do world.message(value) end
    world.message({ v = 1, action = "inspect", roomId = 2, generation = 0 }, "other-world")
    assert(world.reads == reads and world.writes == writes and #world.messages == count)
  `,
  'preferences are world-local, validated, durable and rolled back after a failed save': `
    ${setup}
    local preferences = { view = "perspective", follow = false, exploded = true, collapsed = true }
    world.request("preferences", { preferences = preferences })
    assert(world.last().preferences.view == "perspective" and world.writes == 1)
    world.refuseWrites = true
    world.request("preferences", { preferences = { view = "overhead", follow = true, exploded = false, collapsed = false } })
    assert(world.last().preferences.view == "perspective" and world.messages[#world.messages - 1].type == "error")
    local writes = world.writes
    world.request("preferences", { preferences = { view = "invalid" } }); assert(world.writes == writes)
    env.cleanup(); env.init(); world.handshake(); assert(world.last().preferences.view == "perspective")
  `,
  'map clearing clears streams and missing location reports a recoverable error': `
    ${setup}
    world.request("area", { areaId = "Alpha", generation = 0 })
    world.rooms, world.areaNames, world.player = {}, {}, nil
    world.emit("update"); assert(world.last().invalidate and next(world.last().areas) == nil and world.last().playerRoomId == nil)
    world.request("route", { roomId = 3, generation = 0 }); assert(world.last().type == "error")
  `,
  'native companion is read-only and cleanup fences captured callbacks across reloads': `
    ${setup}
    world.request("fallback"); assert(world.companionConfig.interactive == false)
    local oldReady, oldMessage = world.events.ready[1], world.panel().events.luamsg
    world.commands.awatlas("hide"); assert(not world.panel().visible and not world.last().visible)
    env.cleanup(); assert(next(world.widgets) == nil)
    local count, reads = #world.messages, world.reads
    oldReady(); oldMessage({ event = "atlas", data = { v = 1, action = "ready" } })
    assert(#world.messages == count and world.reads == reads)
    env.init(); world.handshake(); count = #world.messages; oldReady();
    oldMessage({ event = "atlas", data = { v = 1, action = "ready" } }); assert(#world.messages == count)
    world.ready(); assert(world.last().mapReady)
  `,
  'migrates legacy preferences without writes and rejects malformed display options': `
    local world, env = atlasWorld({ storage = { ["atlas-preferences"] = {
      view = "perspective", follow = false, exploded = true, collapsed = true
    } } })
    world.handshake()
    local p = world.last().preferences
    assert(p.view == "perspective" and not p.follow and p.exploded and p.collapsed)
    assert(p.showVnums and not p.northUp and not p.floatingDetails and world.writes == 0)
    for _, key in ipairs({ "showVnums", "northUp", "floatingDetails" }) do
      local invalid = { view = "overhead", follow = true, exploded = false, collapsed = false }
      invalid[key] = "true"
      world.request("preferences", { preferences = invalid })
      assert(world.last().type == "error" and world.writes == 0)
    end
    local bad = atlasWorld({ storage = { ["atlas-preferences"] = {
      view = "perspective", follow = false, exploded = true, collapsed = true, northUp = 1
    } } })
    bad.handshake()
    assert(bad.last().preferences.view == "overhead" and bad.last().preferences.showVnums)
  `,
  'settings is lazy, independently ready, reusable, world-local and accepts only allowed boolean patches': `
    ${setup}
    assert(world.surface("settings") == nil and world.surface("details") == nil)
    world.request("settings")
    local settings = world.surface("settings")
    assert(settings and settings.visible and settings.config.name == "atlas-settings")
    assert(settings.config.title == "Atlas Settings" and world.lastFor("settings") == nil)
    world.surfaceRequest("settings", "setting", { key = "showVnums", value = false })
    assert(world.writes == 0)
    world.surfaceHandshake("settings")
    local p = world.lastFor("settings").preferences
    assert(p.showVnums and not p.northUp and not p.floatingDetails)
    settings.position = { x = 777, y = 888 }
    world.close("settings"); world.request("settings")
    assert(world.surface("settings") == settings and settings.visible)
    assert(settings.position.x == 777 and world.creations["atlas:atlas-settings"] == 1)
    world.surfaceRequest("settings", "setting", { key = "showVnums", value = false })
    world.surfaceRequest("settings", "setting", { key = "northUp", value = true })
    p = world.lastFor("settings").preferences
    assert(not p.showVnums and p.northUp and not p.floatingDetails and p.view == "overhead" and p.follow)
    assert(world.writes == 2 and world.storage["atlas-preferences"].northUp)
    local count = #world.messages
    for _, patch in ipairs({ { key = "view", value = true }, { key = "showVnums", value = "false" }, { key = "unknown", value = true } }) do
      world.surfaceRequest("settings", "setting", patch)
    end
    world.surfaceRequest("settings", "setting", { key = "showVnums", value = true }, "foreign-world")
    world.surfaceRequest("settings", "preferences", { preferences = p })
    world.surfaceRequest("settings", "inspect", { roomId = 2, generation = 99 })
    assert(world.writes == 2 and #world.messages == count)
    env.cleanup(); env.init(); world.handshake()
    p = world.lastFor().preferences
    assert(not p.showVnums and p.northUp and not p.floatingDetails)
  `,
  'map preference patches preserve independent settings and reject malformed patches atomically': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "showVnums", value = false })
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    world.request("preferences", { patch = { follow = false }, preferences = {
      view = "overhead", follow = false, exploded = false, collapsed = false, showVnums = true,
      northUp = false, floatingDetails = false
    } })
    local p = world.lastFor().preferences
    assert(not p.follow and not p.showVnums and p.floatingDetails)
    world.request("preferences", { patch = { view = "perspective", exploded = true, collapsed = true } })
    p = world.lastFor("settings").preferences
    assert(p.view == "perspective" and p.exploded and p.collapsed and p.floatingDetails and not p.showVnums)
    local writes = world.writes
    for _, patch in ipairs({ false, "bad", { follow = 1 }, { northUp = "false" }, { view = false },
      { view = "invalid" }, { [1] = true }, { follow = true, unknown = false } }) do
      world.request("preferences", { patch = patch })
      assert(world.writes == writes)
    end
    world.request("settings")
    p = world.lastFor("settings").preferences
    assert(not p.follow and not p.showVnums and p.floatingDetails and p.view == "perspective")
    world.refuseWrites = true
    world.request("preferences", { patch = { follow = true, showVnums = true } })
    p = world.lastFor().preferences
    assert(not p.follow and not p.showVnums and p.floatingDetails)
  `,
  'failed setting patches restore every surface and keep prior durable preferences': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "showVnums", value = false })
    world.refuseWrites = true
    local count = #world.deliveries
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local sawPanelError, sawSettingsError = false, false
    for index = count + 1, #world.deliveries do
      local message = world.deliveries[index]
      if message.payload.type == "error" then
        if message.id == "atlas:atlas" then sawPanelError = true end
        if message.id == "atlas:atlas-settings" then sawSettingsError = true end
      end
    end
    assert(sawPanelError and sawSettingsError)
    assert(not world.lastFor().preferences.showVnums and not world.lastFor().preferences.floatingDetails)
    assert(not world.lastFor("settings").preferences.showVnums and not world.lastFor("settings").preferences.floatingDetails)
    assert(not world.storage["atlas-preferences"].showVnums and not world.storage["atlas-preferences"].floatingDetails)
    assert(world.surface("details") == nil)
    world.refuseWrites = false
    world.surfaceRequest("settings", "setting", { key = "northUp", value = true })
    assert(world.lastFor().preferences.northUp and not world.lastFor().preferences.showVnums)
  `,
  'details handshakes route navigation, docking and parent visibility preserve selection and placement': `
    ${setup}
    local snapshot = { selected = 2, generation = 5, room = { id = 2, name = "Destination" },
      steps = { { roomId = 2, direction = "e" }, { roomId = 3, direction = "u", hidden = true } }, summary = "Route" }
    world.request("details", { revision = 0, snapshot = snapshot })
    assert(world.surface("details") == nil)
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local details = world.surface("details")
    assert(details and details.visible and details.config.position.x ~= world.surface("settings").config.position.x)
    assert(world.surface("settings").zOrder == 49)
    assert(world.lastFor("details") == nil)
    world.surfaceRequest("details", "navigate", { index = 0, generation = 5 })
    assert(world.lastFor().type == "preferences")
    world.surfaceHandshake("details")
    assert(world.lastFor("details").snapshot.selected == 2 and world.lastFor("details").snapshot.room.name == "Destination")
    local count, writes = #world.messages, world.writes
    world.surfaceRequest("details", "setting", { key = "showVnums", value = false })
    world.surfaceRequest("settings", "navigate", { index = 0, generation = 5 })
    world.surfaceRequest("details", "navigate", { index = 0, generation = 4 })
    world.surfaceRequest("details", "navigate", { index = 1, generation = 5 })
    world.surfaceRequest("details", "navigate", { index = 100, generation = 5 })
    world.surfaceRequest("details", "navigate", { index = 0, generation = 5 }, "foreign-world")
    assert(#world.messages == count and world.writes == writes)
    world.surfaceRequest("details", "navigate", { index = 0, generation = 5 })
    assert(world.lastFor().type == "navigate" and world.lastFor().index == 0)
    details.position = { x = 999, y = 888 }
    world.commands.awatlas("hide")
    assert(not details.visible and not world.surface("settings").visible)
    world.commands.awatlas("show")
    assert(details.visible and not world.surface("settings").visible and details.position.x == 999)
    world.surfaceRequest("details", "dock")
    assert(not details.visible and not world.lastFor().preferences.floatingDetails)
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    assert(details.visible and world.creations["atlas:atlas-details"] == 1)
    assert(world.lastFor("details").snapshot.selected == 2)
  `,
  'floating route navigation normalizes native zero-indexed widget arrays before checking steps': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local snapshot = { selected = 2, generation = 5, room = { id = 2 },
      steps = world.native({ { roomId = 2, direction = "e" } }), summary = "One step" }
    world.request("details", { revision = 0, snapshot = snapshot }); world.surfaceHandshake("details")
    assert(world.lastFor("details").snapshot.steps[1].roomId == 2)
    world.surfaceRequest("details", "navigate", { index = 0, generation = 5 })
    assert(world.lastFor().type == "navigate" and world.lastFor().index == 0)
    snapshot.generation = 6
    snapshot.steps = world.native({ { roomId = 2, hidden = true }, { roomId = 3 } })
    world.request("details", { revision = 0, snapshot = snapshot })
    local count = #world.messages
    world.surfaceRequest("details", "navigate", { index = 0, generation = 6 })
    assert(#world.messages == count)
    world.surfaceRequest("details", "navigate", { index = 1, generation = 6 })
    assert(world.lastFor().type == "navigate" and world.lastFor().index == 1)
  `,
  'closing or clearing floating details rejects cached snapshots and preserves floating preference': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local snapshot = { selected = 2, generation = 5, room = { id = 2 }, steps = {}, summary = "Route" }
    world.request("details", { revision = 0, snapshot = snapshot }); world.surfaceHandshake("details")
    world.close("details")
    assert(world.lastFor().type == "deselect" and world.lastFor("details").snapshot == nil)
    world.request("details", { revision = 0, snapshot = snapshot })
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
    snapshot.generation = 6
    world.request("details", { revision = 0, snapshot = snapshot })
    assert(world.surface("details").visible and world.lastFor("details").snapshot.selected == 2)
    world.request("details", { revision = 0, snapshot = { generation = 7, steps = {}, summary = "Select a room" } })
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
    world.request("details", { revision = 0, snapshot = snapshot })
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
    world.request("settings")
    assert(world.lastFor("settings").preferences.floatingDetails)
  `,
  'player movement invalidates queued route snapshots while retaining selection identity': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local snapshot = { selected = 2, generation = 5, selectionEpoch = 2, room = { id = 2 }, steps = { { roomId = 2 } }, summary = "Route" }
    world.request("details", { revision = 0, snapshot = snapshot }); world.surfaceHandshake("details")
    world.emit("room")
    assert(next(world.lastFor("details").snapshot.steps) == nil)
    world.request("details", { revision = 0, snapshot = { selected = 2, generation = 5, selectionEpoch = 2,
      room = { id = 2 }, steps = { { roomId = 2 } }, summary = "Stale route" } })
    assert(next(world.lastFor("details").snapshot.steps) == nil)
    world.request("details", { revision = 0, snapshot = { selected = 2, generation = 6, selectionEpoch = 2,
      room = { id = 2 }, steps = { { roomId = 3 } }, summary = "New route" } })
    assert(world.lastFor("details").snapshot.steps[1].roomId == 3)
    world.close("details")
    assert(world.lastFor().type == "deselect" and world.lastFor().selectionEpoch == 2)
    world.request("details", { revision = 0, snapshot = { selected = 2, generation = 7, selectionEpoch = 2,
      room = { id = 2 }, steps = {}, summary = "Late refresh" } })
    assert(not world.surface("details").visible)
    world.request("details", { revision = 0, snapshot = { selected = 2, generation = 8, selectionEpoch = 3,
      room = { id = 2 }, steps = {}, summary = "New selection" } })
    assert(world.surface("details").visible)
  `,
  'map invalidation clears floating details and rejects delayed old-revision snapshots': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    local snapshot = { selected = 2, generation = 5, room = { id = 2 }, steps = { { roomId = 2 } }, summary = "Route" }
    world.request("details", { revision = 0, snapshot = snapshot }); world.surfaceHandshake("details")
    world.emit("update")
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
    snapshot.generation = 6
    world.request("details", { revision = 0, snapshot = snapshot })
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
    world.request("details", { revision = 1, snapshot = snapshot })
    assert(world.surface("details").visible and world.lastFor("details").snapshot.generation == 6)
    world.handshake()
    assert(not world.surface("details").visible and world.lastFor("details").snapshot == nil)
  `,
  'auxiliary callbacks cannot cross sessions or survive cleanup and reinitialization': `
    ${setup}
    world.request("settings"); world.surfaceHandshake("settings")
    world.surfaceRequest("settings", "setting", { key = "floatingDetails", value = true })
    world.request("details", { revision = 0, snapshot = { selected = 2, generation = 1, room = { id = 2 }, steps = {}, summary = "Route" } })
    world.surfaceHandshake("details")
    local callbacks = { world.surface("settings").events.luamsg, world.surface("details").events.luamsg }
    local close = world.surface("details").events.close
    local other, otherEnv = atlasWorld({ id = "other-world" }); other.handshake(); other.ready()
    local otherCount = #other.messages
    local oldSettings = world.surface("settings")
    env.cleanup(); assert(next(world.widgets) == nil)
    local count, writes = #world.messages, world.writes
    for _, callback in ipairs(callbacks) do callback({ event = "atlas", sessionId = world.id, data = { v = 1, action = "ready" } }) end
    close({ sessionId = world.id })
    assert(#world.messages == count and world.writes == writes)
    env.init(); world.handshake()
    assert(world.surface("settings") == nil and world.surface("details") == nil)
    count = #world.messages
    for _, callback in ipairs(callbacks) do callback({ event = "atlas", sessionId = world.id, data = { v = 1, action = "ready" } }) end
    close({ sessionId = world.id })
    assert(#world.messages == count and world.writes == writes and #other.messages == otherCount)
    world.request("settings"); world.surfaceHandshake("settings")
    assert(world.surface("settings") ~= oldSettings)
    assert(world.lastFor("settings").preferences.floatingDetails)
    assert(world.surface("details") == nil)
  `,
};
for (const [name, body] of Object.entries(cases)) {
  test(`atlas adapter ${name}`, () => runLua(fixture + body, { atlas_source: () => source }));
}
test('atlas Lua template is MudForge-compatible with one assembly marker per surface', () => {
  parseMudForgeLua(source, 'atlas');
  for (const marker of ['__ATLAS_HTML__', '__ATLAS_SETTINGS_HTML__', '__ATLAS_DETAILS_HTML__']) {
    assert.equal(source.split(marker).length - 1, 1);
  }
});
