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
import { createInspector } from "../src/atlas/inspector.js";
import vm from "node:vm";
import * as model from "../src/atlas/model.js";
function widgetHarness(initPatch = {}) {
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
  element("inspector").hidden = true;
  element("results").hidden = true;
  let scene;
  class Scene {
    constructor(canvas, assets, callbacks) {
      scene = this;
      this.callbacks = callbacks;
      this.builds = 0;
      this.overlay = [];
      this.fits = 0;
      this.areaCenters = 0;
      this.centers = [];
    }
    setRooms() {
      this.builds++;
    }
    overlays(player, selected, steps) {
      this.overlay = steps;
    }
    setDisplayOptions(options) { this.options = options; }
    setIndicatorOptions(options) { this.indicators = options; }
    setView(view) { this.view = view; }
    setVisible() {
    }
    center(room) { this.centers.push(room?.id); }
    centerArea() { this.areaCenters++; }
    fit() { this.fits++; }
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
  const context = { ...model, createInspector, AtlasScene: Scene, createPreviewBridge() {
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
  const init = { type: "init", mapReady: true, areas: [{ id: "a", name: "Area" }], playerRoomId: 1, playerAreaId: "a", playerZ: 0, ...initPatch };
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

test("details occupy space only after selection and move between surfaces without losing state", () => {
  const h = widgetHarness();
  assert.equal(h.element("inspector").hidden, true);
  const generation = h.select();
  assert.equal(h.element("inspector").hidden, false);
  h.receive({ type: "route", generation, found: true, cost: 2, steps: [{ roomId: 2, areaId: "a", z: 0 }] });
  h.receive({ type: "preferences", preferences: { floatingDetails: true, showVnums: false, northUp: true } });
  assert.equal(h.element("inspector").hidden, true);
  assert.equal(h.state().selected, 2);
  assert.equal(h.state().routeCount, 1);
  assert.equal(h.scene.options.showVnums, false);
  assert.equal(h.scene.options.northUp, true);
  const snapshot = h.sent.findLast((message) => message.action === "details").snapshot;
  assert.equal(snapshot.selected, 2);
  assert.equal(snapshot.steps.length, 1);
  h.receive({ type: "preferences", preferences: { floatingDetails: false } });
  assert.equal(h.element("inspector").hidden, false);
});
test("background deselection clears both surfaces, route and collision choices and rejects late replies", () => {
  const h = widgetHarness();
  const generation = h.select();
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 2 }] });
  h.scene.callbacks.select([]);
  assert.equal(h.state().selected, null);
  assert.equal(h.state().routeCount, 0);
  assert.equal(h.element("inspector").hidden, true);
  assert.equal(h.element("collision").hidden, true);
  assert.equal(h.element("results").hidden, true);
  assert.equal(h.sent.findLast((message) => message.action === "details").snapshot.selected, null);
  h.receive({ type: "room", generation, room: { id: 2, name: "Late details" } });
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 2 }] });
  assert.equal(h.element("room-name").textContent, "Select a room");
  assert.equal(h.state().routeCount, 0);
});
test("floating details close clears selection; map and overlap selections display the chosen room", () => {
  const h = widgetHarness();
  h.scene.callbacks.select([{ id: 1 }]);
  assert.equal(h.state().selected, 1);
  h.scene.callbacks.select([{ id: 1, name: "First" }, { id: 2, name: "Second" }]);
  assert.equal(h.element("collision").hidden, false);
  h.element("collision-items").children[1].handlers.click();
  assert.equal(h.state().selected, 2);
  h.receive({ type: "deselect", selectionEpoch: h.state().selectionEpoch });
  assert.equal(h.state().selected, null);
  assert.equal(h.element("inspector").hidden, true);
  h.scene.callbacks.select([{ id: 1 }]);
  assert.equal(h.element("inspector").hidden, false);
});
test("floating route navigation rejects obsolete generations and targets only current steps", () => {
  const h = widgetHarness();
  const generation = h.select();
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 8, areaId: "other", z: 2 }] });
  h.receive({ type: "navigate", generation: generation - 1, index: 0 });
  assert.equal(h.state().area, "a");
  h.receive({ type: "navigate", generation, index: 0 });
  assert.equal(h.state().area, "other");
  assert.equal(h.state().selected, 2);
});

test("a delayed floating close cannot clear a newer selection but still closes a refreshed selection", () => {
  const h = widgetHarness();
  h.select();
  const oldEpoch = h.state().selectionEpoch;
  h.scene.callbacks.select([{ id: 1 }]);
  h.receive({ type: "deselect", selectionEpoch: oldEpoch });
  assert.equal(h.state().selected, 1);
  const epoch = h.state().selectionEpoch;
  h.receive({ ...h.init, type: "update", playerRoomId: 2 });
  assert.equal(h.state().selectionEpoch, epoch);
  h.receive({ type: "deselect", selectionEpoch: epoch });
  assert.equal(h.state().selected, null);
});

function finishArea(h, area, rooms) {
  const generation = h.sent.findLast(message => message.action === "area").generation;
  h.receive({ type: "area", areaId: area, generation, offset: 0, nextOffset: rooms.length, total: rooms.length, done: true, rooms });
}
const areaB = { id: "b", name: "Second area" };
const entryB = { id: 7, areaId: "b", name: "Entrance", x: 400, y: -30, z: 2 };
test("entering a new character area always switches area, floor and resumes following without refitting", () => {
  const h = widgetHarness();
  h.element("fit").handlers.click();
  assert.equal(h.state().preferences.follow, false);
  const fits = h.scene.fits;
  h.receive({ ...h.init, type: "update", areas: [...h.init.areas, areaB], playerRoomId: 7, playerAreaId: "b", playerZ: 2 });
  assert.equal(h.state().area, "b");
  assert.equal(h.state().preferences.follow, true);
  finishArea(h, "b", [entryB]);
  assert.equal(h.element("floor").value, "2");
  assert.equal(h.scene.fits, fits);
  assert.equal(h.scene.centers.at(-1), 7);
});
test("manual area browsing preserves camera scale and stays paused until the character changes area", () => {
  const h = widgetHarness();
  const fits = h.scene.fits;
  h.element("area").value = "b";
  h.element("area").handlers.change();
  finishArea(h, "b", [entryB]);
  assert.equal(h.scene.fits, fits);
  assert.equal(h.scene.areaCenters, 1);
  assert.equal(h.state().preferences.follow, false);
  h.receive({ ...h.init, type: "update", playerRoomId: 2 });
  assert.equal(h.state().area, "b");
  assert.equal(h.state().preferences.follow, false);
  h.receive({ ...h.init, type: "update", areas: [...h.init.areas, areaB], playerRoomId: 7, playerAreaId: "b", playerZ: 2 });
  assert.equal(h.state().preferences.follow, true);
  assert.equal(h.scene.centers.at(-1), 7);
  assert.equal(h.scene.fits, fits);
});
test("unknown location updates cannot create a false area change; unassigned areas remain valid", () => {
  const h = widgetHarness();
  h.element("fit").handlers.click();
  h.receive({ ...h.init, type: "update", playerRoomId: null, playerAreaId: null });
  h.receive({ ...h.init, type: "update" });
  assert.equal(h.state().preferences.follow, false);
  h.receive({ ...h.init, type: "update", areas: [...h.init.areas, { id: "", name: "Unassigned" }], playerAreaId: "", playerRoomId: 5 });
  assert.equal(h.state().area, "");
  assert.equal(h.state().preferences.follow, true);
});
test("rapid area transitions reject obsolete chunks and do not reset zoom", () => {
  const h = widgetHarness();
  const fits = h.scene.fits;
  h.receive({ ...h.init, type: "update", areas: [...h.init.areas, areaB], playerRoomId: 7, playerAreaId: "b", playerZ: 2 });
  const oldGeneration = h.sent.findLast(message => message.action === "area").generation;
  h.receive({ ...h.init, type: "update", playerRoomId: 2 });
  h.receive({ type: "area", areaId: "b", generation: oldGeneration, offset: 0, nextOffset: 1, total: 1, done: true, rooms: [entryB] });
  assert.equal(h.state().area, "a");
  assert.equal(h.state().roomCount, 0);
  finishArea(h, "a", [{ id: 2, areaId: "a", name: "Return", x: 1, y: 0, z: 0 }]);
  assert.equal(h.state().roomCount, 1);
  assert.equal(h.scene.centers.at(-1), 2);
  assert.equal(h.scene.fits, fits);
});
test("the initial known character area resumes following even with a saved browsing preference", () => {
  const h = widgetHarness({ preferences: { follow: false } });
  assert.equal(h.state().preferences.follow, true);
  assert.equal(h.scene.centers.at(-1), 1);
});

test("indicator updates synchronize the legend without rebuilding terrain or losing view and selection", () => {
  const h = widgetHarness();
  const generation = h.select();
  h.receive({ type: "route", generation, found: true, steps: [{ roomId: 2 }] });
  const state = h.state(), builds = h.scene.builds, fits = h.scene.fits, centers = h.scene.areaCenters;
  h.receive({ type: "preferences", preferences: { showDoors: false, showUpExits: false, areaExitColor: "#ABCDEF" } });
  assert.equal(h.element("key-doors").hidden, true);
  assert.equal(h.element("key-upExits").hidden, true);
  assert.equal(h.element("key-lockedDoors").hidden, false);
  assert.equal(h.element("key-areaExits").style.color, "#abcdef");
  assert.equal(h.scene.indicators.showDoors, false);
  assert.equal(h.scene.builds, builds);
  assert.equal(h.scene.fits, fits);
  assert.equal(h.scene.areaCenters, centers);
  assert.equal(h.state().selected, state.selected);
  assert.equal(h.state().routeCount, state.routeCount);
  assert.equal(h.state().preferences.follow, state.preferences.follow);
  assert.equal(h.state().view, state.view);
});

test("settings controls send individual typed patches and restore authoritative values after save failure", () => {
  const elements = new Map(), sent = [];
  class Element {
    constructor() { this.handlers = {}; this.children = []; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    setAttribute(key, value) { this[key] = value; }
  }
  const element = id => { if (!elements.has(id)) { const node = new Element(); node.id = id; } return elements.get(id); };
  const bridge = { onMessage(fn) { this.receive = fn; }, send(event, message) { sent.push(message); } };
  const context = { ...model, createInspector, window: { mudforge: bridge }, document: {
    body: { dataset: { surface: "settings" } }, getElementById: element,
    createElement() { return new Element(); }, createTextNode(text) { return { textContent: text }; },
  } };
  vm.runInNewContext(readFileSync(new URL("../src/atlas/surface.js", import.meta.url), "utf8").replace(/^import .*?;\n/gm, ""), context);
  assert.equal(sent[0].action, "ready");
  bridge.receive({ v: 1, type: "preferences", preferences: {} });
  assert.equal(element("exit-indicators").children.length, 5);
  for (const { showKey, colorKey, color, label } of model.indicatorSettings) {
    assert.equal(element(showKey).checked, true);
    assert.equal(element(colorKey).value, color);
    assert.equal(element(colorKey)["aria-label"], `${label} color`);
    element(showKey).checked = false;
    element(showKey).handlers.change();
    assert.equal(sent.at(-1).key, showKey);
    assert.equal(sent.at(-1).value, false);
    element(colorKey).value = "#123456";
    element(colorKey).handlers.change();
    assert.equal(sent.at(-1).key, colorKey);
    assert.equal(sent.at(-1).value, "#123456");
  }
  bridge.receive({ v: 1, type: "error", error: "Save failed" });
  bridge.receive({ v: 1, type: "preferences", preferences: model.indicatorOptions() });
  assert.equal(element("surface-status").textContent, "Save failed");
  assert.equal(element("showDoors").checked, true);
  assert.equal(element("doorColor").value, "#ffd166");
});

test("large preview room identities and destination metadata stay consistent across areas", async () => {
  const context = { ...model, window: { addEventListener() {} }, crypto: { randomUUID: () => "fixture" }, queueMicrotask };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../src/atlas/fixture.js", import.meta.url), "utf8").replace(/^import .*?;\n/gm, "").replace(/^export /gm, "") + '\nthis.preview = createPreviewBridge({terrains:[]}, true);', context);
  const messages = [];
  context.preview.onMessage(message => messages.push(message));
  for (let offset = 0; offset < 10000; offset += 128) context.preview.send("atlas", { action: "area", areaId: "The Emerald Expanse", offset, generation: 1 });
  context.preview.send("atlas", { action: "area", areaId: "The Glass Archive", offset: 0, generation: 2 });
  await new Promise(resolve => queueMicrotask(resolve));
  const rooms = messages.flatMap(message => message.rooms);
  assert.equal(rooms.length, 10002);
  assert.equal(new Set(rooms.map(room => room.id)).size, rooms.length);
  const byId = new Map(rooms.map(room => [room.id, room]));
  for (const source of rooms) for (const exit of model.exitEntries(source)) {
    assert.equal(source.exitTargets[exit.direction].areaId, byId.get(exit.to).areaId);
  }
  assert.equal(byId.get(799).exitTargets.e.areaId, "The Emerald Expanse");
  assert.equal(byId.get(1).exitTargets["enter archive"].areaId, "The Glass Archive");
});

test("indicator display defaults reject malformed bridge colors and preserve explicit false", () => {
  for (const invalid of [null, false, "bad", 123]) assert.deepEqual(model.indicatorOptions(invalid), model.indicatorOptions());
  for (const color of ["red", "#abc", "#12345678", "#abcdef;display:none", {}, 1]) assert.equal(model.indicatorOptions({ doorColor: color }).doorColor, "#ffd166");
  assert.equal(model.indicatorOptions({ showDoors: false }).showDoors, false);
});
