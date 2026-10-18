export function createPreviewBridge(assets, large = false) {
  const terrains = assets.terrains || [];
  const side = large ? 100 : 11;
  const rooms = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const id = y * side + x + 1;
    rooms.push({ id, areaId: "The Emerald Expanse", name: ["Mossbound crossing", "Old watchtower", "Silverwater bank", "Windward orchard"][(x + y) % 4], x, y, z: 0, terrain: terrains[(x + y * 3) % Math.max(1, terrains.length)]?.name || "forest", exits: { ...x < side - 1 ? { e: id + 1 } : {}, ...x ? { w: id - 1 } : {}, ...y < side - 1 ? { s: id + side } : {}, ...y ? { n: id - side } : {} }, doors: id % 17 === 0 && y > 0 ? { n: 1 + Math.floor(id / 17) % 3 } : {}, exitLocks: id % 23 === 0 && x < side - 1 ? { e: true } : {}, locked: id % 41 === 0, notes: "Illustrative fixture room. Live Atlas reads the native mapper.", flags: id % 13 === 0 ? ["landmark"] : [], symbol: id % 19 === 0 ? "✦" : void 0 });
  }
  if (!large) {
    rooms.push({ id: 500, areaId: "The Emerald Expanse", name: "Upper observatory", x: 5, y: 5, z: 1, terrain: "stone", exits: { d: 61 }, notes: "A second floor above the crossing." });
    rooms.push({ id: 501, areaId: "The Emerald Expanse", name: "A hidden passage at the crossing", x: 5, y: 5, z: 0, terrain: "inside", exits: { e: 62 } });
  }
  const archiveRooms = [
    { id: 800, areaId: "The Glass Archive", name: "The reading room", x: 400, y: -30, z: 2, terrain: "inside", exits: { e: 801 }, doors: { e: 3 } },
    { id: 801, areaId: "The Glass Archive", name: "The locked collection", x: 401, y: -30, z: 2, terrain: "city", exits: { w: 800 }, locked: true },
  ];
  const allRooms = [...rooms, ...archiveRooms];
  const preferences = { view: "overhead", follow: true, exploded: false, collapsed: false, showVnums: true, northUp: false, floatingDetails: false };
  const windows = {}, ready = {};
  let snapshot = null;
  const name = `atlas-${crypto.randomUUID()}`;
  const post = (role, data) => { if (ready[role] && windows[role] && !windows[role].closed) windows[role].postMessage({ channel: "atlas-preview", v: 1, ...data }, location.origin); };
  const open = (role) => {
    if (!windows[role] || windows[role].closed) {
      ready[role] = false;
      windows[role] = window.open(`aardwolf-atlas-${role}.html`, `${name}-${role}`, `popup,width=${role === "settings" ? 340 : 320},height=${role === "settings" ? 240 : 520}`);
    } else windows[role].focus();
  };
  const sync = () => {
    post("settings", { type: "preferences", preferences });
    post("details", { type: "details", snapshot });
    if (preferences.floatingDetails && snapshot?.selected) { if (!windows.details || windows.details.closed) open("details"); }
    else if (windows.details && !windows.details.closed) { windows.details.close(); ready.details = false; }
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.channel !== "atlas-preview") return;
    const role = Object.keys(windows).find((key) => windows[key] === event.source);
    if (!role) return;
    const data = event.data;
    if (data.action === "ready") { ready[role] = true; sync(); }
    else if (role === "settings" && data.action === "setting" && ["showVnums", "northUp", "floatingDetails"].includes(data.key) && typeof data.value === "boolean") {
      preferences[data.key] = data.value; emit({ type: "preferences", preferences: { ...preferences } }); sync();
    } else if (role === "details" && data.action === "dock") { preferences.floatingDetails = false; emit({ type: "preferences", preferences: { ...preferences } }); sync(); }
    else if (role === "details" && data.action === "navigate" && data.generation === snapshot?.generation) emit({ type: "navigate", index: data.index, generation: data.generation });
    else if (role === "details" && data.action === "closed" && preferences.floatingDetails && data.selectionEpoch === snapshot?.selectionEpoch) { snapshot = null; emit({ type: "deselect", selectionEpoch: data.selectionEpoch }); }
  });
  window.addEventListener("pagehide", () => { for (const value of Object.values(windows)) if (value && !value.closed) value.close(); });
  let receive = () => {
  };
  const emit = (data) => queueMicrotask(() => receive({ v: 1, ...data }));
  return { onMessage(callback) {
    receive = callback;
  }, send(event, message) {
    if (event !== "atlas") return;
    if (message.action === "ready") emit({ type: "init", mapReady: true, areas: [{ id: "The Emerald Expanse", name: large ? "10,000-room performance fixture" : "The Emerald Expanse" }, { id: "The Glass Archive", name: "The Glass Archive" }], playerRoomId: Math.min(61, rooms.length), playerAreaId: "The Emerald Expanse", playerZ: 0 });
    else if (message.action === "settings") open("settings");
    else if (message.action === "details") { snapshot = message.snapshot.selected ? message.snapshot : null; sync(); }
    else if (message.action === "preferences") { Object.assign(preferences, message.patch || message.preferences); emit({ type: "preferences", preferences: { ...preferences } }); sync(); }
    else if (message.action === "area") {
      const source = message.areaId === "The Emerald Expanse" ? rooms : archiveRooms;
      const offset = message.offset;
      emit({ type: "area", generation: message.generation, areaId: message.areaId, offset, rooms: source.slice(offset, offset + 128), nextOffset: Math.min(offset + 128, source.length), total: source.length, done: offset + 128 >= source.length });
    } else if (message.action === "inspect") emit({ type: "room", generation: message.generation, room: allRooms.find((r) => r.id === message.roomId) });
    else if (message.action === "route") {
      const destination = allRooms.find((r) => r.id === message.roomId);
      emit({ type: "route", generation: message.generation, found: !!destination, stepCount: destination?.id === 61 ? 0 : 1, cost: destination?.id === 61 ? 0 : 3, steps: destination && destination.id !== 61 ? [{ roomId: destination.id, areaId: destination.areaId, z: destination.z, name: destination.name, direction: "Fixture route" }] : [] });
    }
  } };
}

// Browser-only auxiliary-window transport; native documents exclusively use mudforge.
export function createSurfacePreviewBridge() {
  let selectionEpoch = null;
  let receive = () => {};
  const send = (action, data = {}) => window.opener?.postMessage({ channel: "atlas-preview", v: 1, action, ...data }, location.origin);
  window.addEventListener("message", (event) => {
    if (event.source !== window.opener || event.origin !== location.origin || event.data?.channel !== "atlas-preview") return;
    if (event.data.type === "details") selectionEpoch = event.data.snapshot?.selectionEpoch ?? null;
    receive(event.data);
  });
  window.addEventListener("pagehide", () => send("closed", { selectionEpoch }));
  return { onMessage(callback) { receive = callback; }, send(event, data) { if (event === "atlas") send(data.action, data); } };
}
