import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { perspectiveFitDistance, exitEntries, AreaTransfer, nativeList, terrainKey, normalizeRoom, visibleRooms, coordinateGroups, connections, roomPosition } from "../src/atlas/model.js";
const terrains = [{ name: "forest", id: 3 }, { name: "forest1", id: 51 }, { name: "default", id: 999 }];
test("terrain resolution preserves numbered keys, numeric ids, and neutral fallback", () => {
  assert.equal(terrainKey(" Forest1 ", terrains), "forest1");
  assert.equal(terrainKey(3, terrains), "forest");
  assert.equal(terrainKey("3", terrains), "forest");
  for (const value of [null, "", {}, "unknown"]) assert.equal(terrainKey(value, terrains), "default");
});
test("native arrays support zero-indexed object bridges", () => {
  assert.deepEqual(nativeList({ "2": "c", "0": "a", "1": "b", length: 3 }), ["a", "b", "c"]);
  assert.deepEqual(nativeList({}), []);
});
test("hidden and missing-coordinate rooms stay out of scene without inventing layout", () => {
  const rooms = [normalizeRoom({ id: 1, x: 0, y: 0, z: 0 }), normalizeRoom({ id: 2, x: 1, y: 0, z: 0, hidden: true }), normalizeRoom({ id: 3, x: 1, y: 0 }), normalizeRoom({ id: 4, x: 2, y: 0, z: 1 })];
  assert.deepEqual(visibleRooms(rooms, 0, false).map((r) => r.id), [1]);
  assert.deepEqual(visibleRooms(rooms, 0, true).map((r) => r.id), [1, 4]);
  assert.equal(normalizeRoom({ id: "bad" }), null);
  assert.equal(normalizeRoom({ id: 5, x: null, y: 0, z: 0 }).positioned, false);
});
test("coordinates retain collisions and correct north/floor axes", () => {
  const rooms = [normalizeRoom({ id: 1, x: 2, y: 3, z: 1 }), normalizeRoom({ id: 2, x: 2, y: 3, z: 1 })];
  assert.equal(coordinateGroups(rooms).get("2,3,1").length, 2);
  assert.deepEqual(roomPosition(rooms[0]), [4, 2.6, 6]);
  assert.deepEqual(roomPosition(rooms[0], true), [4, 6, 6]);
});
test("topology retains directed and custom exits without inferred reverse edges", () => {
  const rooms = [normalizeRoom({ id: 1, exits: { e: 2 }, specialExits: { "enter portal": 3 } }), normalizeRoom({ id: 2 }), normalizeRoom({ id: 3 })];
  const edges = connections(rooms);
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map((e) => [e.from.id, e.to, e.custom]), [[1, 2, false], [1, 3, true]]);
});
test("chunk generations reject stale areas, duplicate offsets and empty nonprogress", () => {
  const transfer = new AreaTransfer();
  const old = transfer.begin("old");
  const generation = transfer.begin("current");
  const base = { generation, areaId: "current", offset: 0, total: 3, rooms: [{ id: 1 }], nextOffset: 2 };
  assert.equal(transfer.accept({ ...base, generation: old }), null);
  assert.equal(transfer.accept({ ...base, areaId: "old" }), null);
  assert.equal(transfer.accept({ ...base, rooms: {}, nextOffset: 0 }), null);
  assert.deepEqual(transfer.accept(base).rooms.map((r) => r.id), [1]);
  assert.equal(transfer.accept(base), null);
  assert.equal(transfer.accept({ ...base, offset: 2, rooms: {}, nextOffset: 3, done: true }).complete, true);
});
test("map clearing starts a new transfer and cannot retain old rooms", () => {
  const transfer = new AreaTransfer();
  const generation = transfer.begin("area");
  transfer.accept({ generation, areaId: "area", offset: 0, total: 1, rooms: [{ id: 1 }] });
  transfer.begin("");
  assert.deepEqual(transfer.rooms, []);
  assert.equal(transfer.accept({ generation, areaId: "area", offset: 0, total: 1, rooms: [{ id: 1 }] }), null);
});
test("widget renders native text safely and owns lifecycle cleanup", () => {
  const main = readFileSync(new URL("../src/atlas/main.js", import.meta.url), "utf8");
  const scene = readFileSync(new URL("../src/atlas/scene.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /innerHTML|outerHTML|eval\(/);
  assert.match(main, /bridge\.onMessage\(receive\);\s*send\("ready"\)/);
  assert.match(scene, /resizeObserver\.disconnect/);
  assert.match(scene, /texture\?\.dispose/);
  assert.match(scene, /material\.map\s*=\s*null/);
  assert.match(scene, /document\.hidden/);
  assert.match(scene, /InstancedBufferAttribute/);
  assert.doesNotMatch(main, /walkTo|sendCommand/);
});
test("perspective fit includes the bounding sphere even in a narrow viewport", () => {
  for (const aspect of [0.3, 1, 2]) {
    const distance = perspectiveFitDistance(20, 45, aspect);
    const halfAngle = Math.min(Math.PI / 8, Math.atan(Math.tan(Math.PI / 8) * aspect));
    assert.ok(distance * Math.sin(halfAngle) > 20);
  }
});
test("custom native exit directions are classified and deduplicated", () => {
  const exits = exitEntries({ exits: { n: 2, "enter portal": 3 }, specialExits: { "enter portal": 3 } });
  assert.equal(exits.length, 2);
  assert.equal(exits.find((exit) => exit.direction === "enter portal").custom, true);
});
import vm from "node:vm";
import * as model from "../src/atlas/model.js";
function widgetHarness() {
  const elements = /* @__PURE__ */ new Map();
  class Element {
    constructor() {
      this.value = "";
      this.textContent = "";
      this.hidden = false;
      this.style = {};
      this.children = [];
      this.handlers = {};
      this.classList = { toggle() {
      } };
    }
    addEventListener(name, callback) {
      this.handlers[name] = callback;
    }
    setAttribute() {
    }
    replaceChildren(...children) {
      this.children = children;
    }
    append(...children) {
      this.children.push(...children);
    }
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  element("failure").hidden = true;
  let scene;
  class Scene {
    constructor() {
      scene = this;
      this.builds = 0;
      this.overlay = [];
    }
    setRooms() {
      this.builds++;
    }
    overlays(player, selected, steps) {
      this.overlay = steps;
    }
    setView() {
    }
    setVisible() {
    }
    center() {
    }
    fit() {
    }
    resetCamera() {
    }
    resize() {
    }
    dispose() {
    }
  }
  const sent = [];
  const window = { ATLAS_ASSETS: { terrains: [] }, mudforge: { send(event, message) {
    sent.push(message);
  }, onMessage(fn) {
    this.receive = fn;
  } }, addEventListener() {
  } };
  const context = { ...model, AtlasScene: Scene, createPreviewBridge() {
    throw Error("Not a preview");
  }, window, document: { getElementById: element, createElement() {
    return new Element();
  } }, Option: class extends Element {
    constructor(text, value) {
      super();
      this.textContent = text;
      this.value = value;
    }
  }, URLSearchParams, location: { search: "" } };
  vm.runInNewContext(readFileSync(new URL("../src/atlas/main.js", import.meta.url), "utf8").replace(/^import .*?;\n/gm, ""), context);
  const receive = (message) => window.mudforge.receive({ v: 1, revision: 1, ...message });
  const init = { type: "init", mapReady: true, areas: [{ id: "a", name: "Area" }], playerRoomId: 1, playerAreaId: "a", playerZ: 0 };
  receive(init);
  const generation = sent.findLast((message) => message.action === "area").generation;
  receive({ type: "area", areaId: "a", generation, offset: 0, nextOffset: 2, total: 2, done: true, rooms: [{ id: 1, areaId: "a", x: 0, y: 0, z: 0, name: "Start" }, { id: 2, areaId: "a", x: 1, y: 0, z: 0, name: "Destination" }] });
  return { element, scene, sent, receive, init, state: () => window.atlasPreview.getState(), select() {
    element("search").value = "Destination";
    element("search").handlers.input();
    element("results").children[0].handlers.click();
    return sent.findLast((message) => message.action === "route").generation;
  } };
}
test("player updates clear the old route before drawing and reject its delayed response", () => {
  const h = widgetHarness();
  const generation = h.select();
  h.receive({ type: "route", generation, found: true, cost: 2, stepCount: 1, steps: [{ roomId: 2, areaId: "a", z: 0 }] });
  assert.equal(h.state().routeCount, 1);
  h.receive({ ...h.init, type: "update", playerRoomId: 2 });
  assert.equal(h.state().routeCount, 0);
  assert.equal(h.scene.overlay.length, 1);
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 2 }] });
  assert.equal(h.state().routeCount, 0);
});
test("clearing a map rejects late selection responses and clears inspection", () => {
  const h = widgetHarness();
  const generation = h.select();
  h.receive({ type: "update", mapReady: false, areas: [] });
  h.receive({ type: "room", generation, room: { id: 2, name: "Stale room" } });
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 2 }] });
  assert.equal(h.state().roomCount, 0);
  assert.equal(h.state().routeCount, 0);
  assert.equal(h.state().selected, null);
  assert.equal(h.element("room-name").textContent, "Select a room");
});
test("preferences and player movement reuse area geometry and refresh following status", () => {
  const h = widgetHarness();
  const builds = h.scene.builds;
  h.receive({ type: "preferences", preferences: { collapsed: true } });
  h.receive({ ...h.init, type: "update", playerRoomId: 2 });
  assert.equal(h.scene.builds, builds);
  h.element("fit").handlers.click();
  assert.match(h.element("status").textContent, /Browsing/);
});
test("offline maps browse their first area without a player and accept unscoped errors", () => {
  const h = widgetHarness();
  h.receive({ ...h.init, type: "update", playerRoomId: null, playerAreaId: null, invalidate: true });
  assert.equal(h.sent.findLast((message) => message.action === "area").areaId, "a");
  h.receive({ type: "error", generation: null, requestAction: "fallback", error: "Native companion unavailable" });
  assert.equal(h.element("status").textContent, "Native companion unavailable");
});


test("route prompt recovers when native readiness arrives after initialization", () => {
  const h = widgetHarness();
  h.receive({ type: "update", mapReady: false, areas: [] });
  assert.equal(h.element("route-summary").textContent, "Waiting for native map readiness.");
  h.receive({ ...h.init, type: "update" });
  assert.equal(h.element("route-summary").textContent, "Select a destination to preview a native route.");
  h.receive({ type: "update", mapReady: true, areas: [] });
  assert.equal(h.element("route-summary").textContent, "No mapped rooms are available.");
});
