import { AreaTransfer, nativeList, normalizeRoom, terrainKey, visibleRooms, exitEntries } from "./model.js";
import { AtlasScene } from "./scene.js";
import { createPreviewBridge } from "./fixture.js";
const $ = (id) => document.getElementById(id);
const assets = window.ATLAS_ASSETS || { terrains: [], images: {} };
const bridge = window.mudforge || (window.ATLAS_PREVIEW ? createPreviewBridge(assets, new URLSearchParams(location.search).has("large")) : null);
const state = { revision: 0, areas: [], rooms: [], player: null, playerArea: null, playerZ: 0, area: null, floor: 0, selected: null, selectionGeneration: 0, route: [], preferences: { view: "overhead", follow: true, exploded: false, collapsed: false }, mapReady: false };
const transfer = new AreaTransfer();
let scene = null, loadedArea = null, routeGeneration = 0;
let geometryCache = { source: null, floor: null, exploded: null, rooms: [] };
function send(action, details = {}) {
  bridge?.send("atlas", { v: 1, action, revision: state.revision, ...details });
}
function status(text) {
  $("status").textContent = text;
}
function fail(text) {
  $("failure").hidden = false;
  $("failure-detail").textContent = text;
  $("empty").hidden = true;
  status("Native mapper remains available");
}
try {
  scene = new AtlasScene($("map"), assets, { select: (rooms) => {
    if (rooms.length === 1) selectRoom(rooms[0].id);
    else {
      $("collision-items").replaceChildren(...rooms.map((room) => button(`${room.name} · #${room.id}`, () => selectRoom(room.id))));
      $("collision").hidden = false;
    }
  }, manual: () => setPreferences({ follow: false }), failed: fail });
} catch (error) {
  fail(`WebGL could not initialize: ${error.message}`);
}
function button(text, action) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.addEventListener("click", action);
  return node;
}
function followingStatus() {
  return state.player === null ? "Map ready · player room unknown" : `Player #${state.player} · ${state.preferences.follow ? "Following" : "Browsing"}`;
}
function clearRoute(message = "Finding a native route…") {
  state.route = [];
  $("route-steps").replaceChildren();
  $("route-summary").textContent = message;
}
function applyPreferences(preferences) {
  state.preferences = { ...state.preferences, ...preferences };
  const p = state.preferences;
  $("overhead").setAttribute("aria-pressed", String(p.view === "overhead"));
  $("perspective").setAttribute("aria-pressed", String(p.view === "perspective"));
  $("follow").setAttribute("aria-pressed", String(p.follow));
  $("stack").checked = p.exploded;
  $("stack").disabled = p.view !== "perspective";
  $("iso").disabled = p.view !== "perspective";
  $("inspector").classList.toggle("collapsed", p.collapsed);
  $("collapse").setAttribute("aria-expanded", String(!p.collapsed));
  $("collapse").textContent = p.collapsed ? "Show details" : "Hide details";
  $("view-caption").textContent = p.view === "perspective" ? "ORBIT · 3D PERSPECTIVE" : "N ↑ · OVERHEAD";
  if (scene && scene.view !== p.view) scene.setView(p.view);
  render(false);
  if (state.mapReady) status(followingStatus());
}
function setPreferences(patch) {
  const changed = Object.entries(patch).some(([key, value]) => state.preferences[key] !== value);
  if (!changed) return;
  applyPreferences(patch);
  send("preferences", { preferences: state.preferences });
}
function requestArea(area, options = {}) {
  if (area === null || area === void 0) return;
  if (options.manual) setPreferences({ follow: false });
  state.area = String(area);
  $("area").value = state.area;
  $("area-title").textContent = state.areas.find((a) => String(a.id) === state.area)?.name || state.area || "Unassigned area";
  const generation = transfer.begin(state.area);
  state.rooms = [];
  render(false);
  $("empty").hidden = false;
  $("empty").textContent = "Loading native rooms…";
  send("area", { areaId: state.area, offset: 0, generation });
}
function render(fit = false) {
  const exploded = state.preferences.view === "perspective" && state.preferences.exploded;
  if (geometryCache.source !== state.rooms || geometryCache.floor !== state.floor || geometryCache.exploded !== exploded) {
    geometryCache = { source: state.rooms, floor: state.floor, exploded, rooms: visibleRooms(state.rooms, state.floor, exploded) };
    scene?.setRooms(geometryCache.rooms, exploded);
  }
  const rooms = geometryCache.rooms;
  scene?.overlays(state.player, state.selected, [{ roomId: state.player }, ...state.route]);
  if (fit) scene?.fit();
  $("room-count").textContent = `${rooms.length.toLocaleString()} visible / ${state.rooms.filter((r) => !r.hidden).length.toLocaleString()} rooms`;
  $("empty").hidden = rooms.length > 0 || !$("failure").hidden;
  if (!rooms.length) $("empty").textContent = state.mapReady ? "No positioned rooms on this floor. Search can still find rooms without coordinates." : "Waiting for the native mapper…";
  search();
}
function floors() {
  const values = [...new Set(state.rooms.filter((r) => !r.hidden && r.positioned).map((r) => r.z))].sort((a, b) => b - a);
  if (!values.includes(state.floor)) state.floor = values.includes(state.playerZ) ? state.playerZ : values[0] ?? 0;
  $("floor").replaceChildren(...values.map((value) => new Option(`Z ${value}`, String(value))));
  $("floor").value = String(state.floor);
}
function search() {
  const term = $("search").value.toLowerCase().trim();
  const rooms = state.rooms.filter((room) => !room.hidden && (!term || `${room.id} ${room.name}`.toLowerCase().includes(term)));
  const show = term ? rooms.slice(0, 60) : [];
  $("results").replaceChildren(...show.map((room) => button(`${room.name} · #${room.id}${room.positioned ? "" : " · no coordinates"}`, () => selectRoom(room.id))));
  if (term && rooms.length > 60) {
    const note = document.createElement("p");
    note.textContent = `Showing 60 of ${rooms.length} matches. Refine your search.`;
    $("results").append(note);
  }
}
function selectRoom(id) {
  state.selected = Number(id);
  state.selectionGeneration++;
  routeGeneration = state.selectionGeneration;
  state.route = [];
  $("collision").hidden = true;
  $("route-summary").textContent = "Finding a native route…";
  $("route-steps").replaceChildren();
  const local = state.rooms.find((r) => r.id === state.selected);
  if (local) {
    if (local.positioned) state.floor = local.z;
    floors();
    render();
    showRoom(local);
    scene?.center(local);
  }
  send("inspect", { roomId: state.selected, generation: state.selectionGeneration });
  send("route", { roomId: state.selected, generation: routeGeneration });
}
function previewTerrain(value) {
  const key = terrainKey(value, assets.terrains);
  const terrain = assets.terrains?.find((item) => item.name === key);
  const sheet = assets.sheets?.find((item) => item.id === terrain?.sheet);
  const image = assets.images?.[key] || assets.images?.default;
  $("terrain-preview").style.backgroundImage = "none";
  $("terrain-preview").style.backgroundSize = "cover";
  $("terrain-preview").style.backgroundPosition = "center";
  if (sheet && terrain) {
    const { width: w, height: h, x, y } = terrain;
    $("terrain-preview").style.backgroundImage = `url("${sheet.image}")`;
    $("terrain-preview").style.backgroundSize = `${sheet.width / w * 100}% ${sheet.height / h * 100}%`;
    $("terrain-preview").style.backgroundPosition = `${sheet.width === w ? 0 : x / (sheet.width - w) * 100}% ${sheet.height === h ? 0 : y / (sheet.height - h) * 100}%`;
  } else if (image) $("terrain-preview").style.backgroundImage = `url("${image}")`;
  $("terrain-name").textContent = `${String(value ?? "Unknown terrain")} · ILLUSTRATIVE TERRAIN`;
}
function describe(value) {
  if (value === null || value === void 0 || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
function clearInspector() {
  $("room-name").textContent = "Select a room";
  $("room-summary").textContent = "Inspect a room in the current native map.";
  $("room-fields").replaceChildren();
  $("terrain-preview").style.backgroundImage = "none";
  $("terrain-name").textContent = "SELECT A ROOM";
}
function showRoom(room) {
  $("room-name").textContent = room.name;
  previewTerrain(room.terrain);
  $("room-summary").textContent = describe(room.details || room.description || "Native map room");
  const fields = [["Room", `#${room.id}`], ["Area", room.area], ["Coordinates", room.positioned ? `${room.x}, ${room.y}, ${room.z}` : "Not available"], ["Notes", room.notes], ["Exits", exitEntries(room).map((e) => `${e.direction} → ${e.to}${e.custom ? " (custom)" : ""}`).join("\n")], ["Doors", room.doors], ["Flags", room.flags?.join(", ")], ["Routing", `${room.locked ? "Locked" : "Unlocked"} · weight ${room.weight ?? 1}`], ["Exit locks", room.exitLocks], ["User data", room.userData]];
  $("room-fields").replaceChildren();
  for (const [name, value] of fields) {
    if ((value === void 0 || value === null || value === "") && !["Room", "Area", "Coordinates"].includes(name)) continue;
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = describe(value);
    $("room-fields").append(dt, dd);
  }
}
function route(message) {
  if (message.generation !== routeGeneration) return;
  state.route = nativeList(message.steps);
  $("route-summary").textContent = message.found ? `${message.stepCount ?? state.route.length} steps · weighted cost ${message.cost ?? "unknown"}` : message.error || "No route found. Native room and exit locks are respected.";
  $("route-steps").replaceChildren(...state.route.map((step, index) => {
    const item = document.createElement("li");
    if (step.hidden) item.textContent = `${index + 1}. ${step.direction || "Move"} · hidden room`;
    else item.append(button(`${step.direction || "Start"} · ${step.name || `#${step.roomId}`} · ${step.areaId || "Unassigned"} / Z ${step.z ?? "?"}`, () => {
      setPreferences({ follow: false });
      state.floor = Number(step.z) || 0;
      if (String(step.areaId) !== state.area) requestArea(step.areaId);
      else {
        floors();
        render();
        scene?.center(state.rooms.find((r) => r.id === Number(step.roomId)));
      }
    }));
    return item;
  }));
  scene?.overlays(state.player, state.selected, [{ roomId: state.player }, ...state.route]);
}
function update(message) {
  scene?.setVisible(message.visible !== false);
  state.revision = Number.isSafeInteger(message.revision) ? message.revision : state.revision;
  state.mapReady = message.mapReady === true;
  state.areas = nativeList(message.areas).filter((a) => a && typeof a.id === "string");
  $("area").replaceChildren(...state.areas.map((area) => new Option(area.name || area.id || "Unassigned", area.id)));
  if (state.area !== null) $("area").value = state.area;
  state.player = Number.isSafeInteger(message.playerRoomId) ? message.playerRoomId : null;
  state.playerArea = message.playerAreaId ?? null;
  state.playerZ = Number.isFinite(message.playerZ) ? message.playerZ : 0;
  const refreshSelection = state.selected !== null && (message.invalidate || message.type === "update");
  if (refreshSelection) {
    routeGeneration = ++state.selectionGeneration;
    clearRoute();
  }
  if (message.preferences) applyPreferences(message.preferences);
  if (!state.mapReady || state.areas.length === 0) {
    transfer.begin("");
    state.area = null;
    loadedArea = null;
    state.rooms = [];
    state.route = [];
    state.selected = null;
    routeGeneration = ++state.selectionGeneration;
    clearInspector();
    $("route-steps").replaceChildren();
    $("route-summary").textContent = state.mapReady
      ? "No mapped rooms are available."
      : "Waiting for native map readiness.";
    $("area-title").textContent = "Native map";
    render();
    status(state.mapReady ? "Native map is empty" : "Waiting for native map");
    return;
  }
  if (state.selected === null) {
    $("route-summary").textContent = "Select a destination to preview a native route.";
  }
  const target = state.preferences.follow ? state.playerArea ?? state.areas[0]?.id : state.area ?? state.playerArea ?? state.areas[0]?.id;
  if (state.preferences.follow) state.floor = state.playerZ;
  if (target !== null && target !== void 0 && (state.area !== String(target) || message.invalidate || message.type === "init")) requestArea(target);
  else {
    floors();
    render();
    if (state.preferences.follow) scene?.center(state.rooms.find((r) => r.id === state.player));
  }
  status(state.player === null ? "Map ready · player room unknown" : `Player #${state.player} · ${state.preferences.follow ? "Following" : "Browsing"}`);
  if (refreshSelection && state.selected !== null) {
    if (message.invalidate) clearInspector();
    send("inspect", { roomId: state.selected, generation: state.selectionGeneration });
    send("route", { roomId: state.selected, generation: routeGeneration });
  }
}
function receive(message) {
  if (!message || message.v !== 1 || typeof message.type !== "string") return;
  if (["room", "route", "area"].includes(message.type) && Number.isSafeInteger(message.revision) && message.revision !== state.revision) return;
  if (message.type === "init" || message.type === "update") update(message);
  else if (message.type === "area") {
    if (Number.isSafeInteger(message.revision) && message.revision !== state.revision) return;
    const accepted = transfer.accept(message);
    if (!accepted) return;
    if (!accepted.complete) {
      status(`Loading ${accepted.next.toLocaleString()} / ${message.total.toLocaleString()} native rooms`);
      send("area", { areaId: state.area, offset: accepted.next, generation: transfer.generation });
    } else {
      state.rooms = accepted.rooms;
      floors();
      render(loadedArea !== state.area);
      loadedArea = state.area;
      if (state.preferences.follow) scene?.center(state.rooms.find((r) => r.id === state.player));
      status(`${state.area || "Unassigned area"} · ${state.rooms.length.toLocaleString()} rooms loaded`);
    }
  } else if (message.type === "room" && message.generation === state.selectionGeneration) {
    const room = normalizeRoom(message.room);
    if (room && !room.hidden) showRoom(room);
    else {
      clearInspector();
      state.selected = null;
      routeGeneration = ++state.selectionGeneration;
      clearRoute("Select a destination to preview a native route.");
    }
  } else if (message.type === "route") route(message);
  else if (message.type === "preferences") applyPreferences(message.preferences || {});
  else if (message.type === "error") {
    const expectedGeneration = message.requestAction === "area" ? transfer.generation : message.requestAction === "route" ? routeGeneration : state.selectionGeneration;
    if (message.generation != null && message.generation !== expectedGeneration) return;
    status(message.error || "Native mapper request failed");
    if (message.requestAction === "inspect") {
      clearInspector();
      state.selected = null;
      routeGeneration = ++state.selectionGeneration;
      clearRoute("Select a destination to preview a native route.");
      scene?.overlays(state.player, null, []);
    }
    if (message.requestAction === "route") $("route-summary").textContent = message.error || "Route unavailable";
    if (message.requestAction === "area") {
      $("empty").hidden = false;
      $("empty").textContent = message.error || "Area unavailable";
    }
  } else if (message.type === "visibility") {
    scene?.setVisible(message.visible !== false);
  } else if (message.type === "resize") scene?.resize();
}
$("area").addEventListener("change", () => requestArea($("area").value, { manual: true }));
$("floor").addEventListener("change", () => {
  setPreferences({ follow: false });
  state.floor = Number($("floor").value);
  render(true);
});
$("stack").addEventListener("change", () => {
  setPreferences({ exploded: $("stack").checked });
  scene?.fit();
});
$("overhead").addEventListener("click", () => setPreferences({ view: "overhead" }));
$("perspective").addEventListener("click", () => setPreferences({ view: "perspective" }));
$("fit").addEventListener("click", () => {
  setPreferences({ follow: false });
  scene?.fit();
});
$("reset").addEventListener("click", () => scene?.resetCamera());
$("iso").addEventListener("click", () => scene?.resetCamera());
$("follow").addEventListener("click", () => {
  setPreferences({ follow: true });
  state.floor = state.playerZ;
  if (state.playerArea !== null && state.area !== String(state.playerArea)) requestArea(state.playerArea);
  else {
    floors();
    render();
    scene?.center(state.rooms.find((r) => r.id === state.player));
  }
});
$("collapse").addEventListener("click", () => setPreferences({ collapsed: !state.preferences.collapsed }));
$("search").addEventListener("input", search);
$("collision-close").addEventListener("click", () => {
  $("collision").hidden = true;
});
$("fallback").addEventListener("click", () => send("fallback"));
window.addEventListener("pagehide", () => scene?.dispose());
if (bridge?.onMessage) {
  bridge.onMessage(receive);
  send("ready");
} else status("Preview mode · native bridge is unavailable");
window.atlasPreview = { receive, getState: () => ({ area: state.area, roomCount: state.rooms.length, view: state.preferences.view, generation: transfer.generation, selectionGeneration: state.selectionGeneration, routeCount: state.route.length, selected: state.selected }), dispose: () => scene?.dispose() };
