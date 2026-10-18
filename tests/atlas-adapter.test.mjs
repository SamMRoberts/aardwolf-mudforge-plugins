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
};
for (const [name, body] of Object.entries(cases)) {
  test(`atlas adapter ${name}`, () => runLua(fixture + body, { atlas_source: () => source }));
}
test('atlas Lua template is MudForge-compatible with a single assembly marker', () => {
  parseMudForgeLua(source, 'atlas');
  assert.equal(source.match(/__ATLAS_HTML__/g).length, 1);
});
