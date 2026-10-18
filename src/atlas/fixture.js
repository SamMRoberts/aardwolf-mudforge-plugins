export function createPreviewBridge(assets, large = false) {
  const terrains = assets.terrains || [];
  const side = large ? 100 : 11;
  const rooms = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const id = y * side + x + 1;
    rooms.push({ id, areaId: "The Emerald Expanse", name: ["Mossbound crossing", "Old watchtower", "Silverwater bank", "Windward orchard"][(x + y) % 4], x, y, z: 0, terrain: terrains[(x + y * 3) % Math.max(1, terrains.length)]?.name || "forest", exits: { ...x < side - 1 ? { e: id + 1 } : {}, ...x ? { w: id - 1 } : {}, ...y < side - 1 ? { s: id + side } : {}, ...y ? { n: id - side } : {} }, doors: id % 17 === 0 ? { n: 2 } : {}, notes: "Illustrative fixture room. Live Atlas reads the native mapper.", flags: id % 13 === 0 ? ["landmark"] : [], symbol: id % 19 === 0 ? "✦" : void 0 });
  }
  if (!large) {
    rooms.push({ id: 500, areaId: "The Emerald Expanse", name: "Upper observatory", x: 5, y: 5, z: 1, terrain: "stone", exits: { d: 61 }, notes: "A second floor above the crossing." });
    rooms.push({ id: 501, areaId: "The Emerald Expanse", name: "A hidden passage at the crossing", x: 5, y: 5, z: 0, terrain: "inside", exits: { e: 62 } });
  }
  let receive = () => {
  };
  const emit = (data) => queueMicrotask(() => receive({ v: 1, ...data }));
  return { onMessage(callback) {
    receive = callback;
  }, send(event, message) {
    if (event !== "atlas") return;
    if (message.action === "ready") emit({ type: "init", mapReady: true, areas: [{ id: "The Emerald Expanse", name: large ? "10,000-room performance fixture" : "The Emerald Expanse" }, { id: "The Glass Archive", name: "The Glass Archive" }], playerRoomId: Math.min(61, rooms.length), playerAreaId: "The Emerald Expanse", playerZ: 0 });
    else if (message.action === "area") {
      const source = message.areaId === "The Emerald Expanse" ? rooms : [{ id: 800, areaId: "The Glass Archive", name: "The reading room", x: 0, y: 0, z: 0, terrain: "inside", exits: {} }];
      const offset = message.offset;
      emit({ type: "area", generation: message.generation, areaId: message.areaId, offset, rooms: source.slice(offset, offset + 128), nextOffset: Math.min(offset + 128, source.length), total: source.length, done: offset + 128 >= source.length });
    } else if (message.action === "inspect") emit({ type: "room", generation: message.generation, room: rooms.find((r) => r.id === message.roomId) });
    else if (message.action === "route") {
      const destination = rooms.find((r) => r.id === message.roomId);
      emit({ type: "route", generation: message.generation, found: !!destination, stepCount: destination?.id === 61 ? 0 : 1, cost: destination?.id === 61 ? 0 : 3, steps: destination && destination.id !== 61 ? [{ roomId: destination.id, areaId: destination.areaId, z: destination.z, name: destination.name, direction: "Fixture route" }] : [] });
    }
  } };
}
