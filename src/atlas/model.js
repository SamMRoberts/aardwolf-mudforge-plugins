export function nativeList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
}
export function terrainKey(value, terrains = []) {
  const key = String(value ?? "").trim().toLowerCase();
  const match = terrains.find((t) => t.name === key || key !== "" && String(t.id) === key);
  return match?.name || "default";
}
export function normalizeRoom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = Number(raw.id ?? raw.vnum);
  if (!Number.isSafeInteger(id) || id < 0) return null;
  const coordinates = raw.coordinates || raw;
  const positioned = ["x", "y", "z"].every((k) => typeof coordinates[k] === "number" && Number.isFinite(coordinates[k]));
  return {
    ...raw,
    id,
    area: String(raw.areaId ?? raw.area ?? raw.zone ?? ""),
    name: String(raw.name ?? `Room ${id}`),
    positioned,
    x: positioned ? coordinates.x : 0,
    y: positioned ? coordinates.y : 0,
    z: positioned ? coordinates.z : 0,
    hidden: raw.hidden === true,
    exits: raw.exits && typeof raw.exits === "object" ? raw.exits : {},
    flags: Array.isArray(raw.flags) ? raw.flags : nativeList(raw.flags)
  };
}
export function visibleRooms(rooms, floor, exploded) {
  return rooms.filter((room) => !room.hidden && room.positioned && (exploded || room.z === Number(floor)));
}
export function coordinateGroups(rooms) {
  const groups = /* @__PURE__ */ new Map();
  for (const room of rooms) {
    const key = `${room.x},${room.y},${room.z}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(room);
  }
  return groups;
}
export function roomPosition(room, exploded = false) {
  return [room.x * 2, room.z * (exploded ? 6 : 2.6), room.y * 2];
}
export function exitEntries(room) {
  const entries = Object.entries(room.exits || {}).map(([direction, to]) => ({ direction, to: Number(typeof to === "object" ? to.to ?? to.vnum : to), custom: !["n", "ne", "e", "se", "s", "sw", "w", "nw", "u", "d", "in", "out", "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "up", "down"].includes(direction) }));
  for (const [direction, to] of Object.entries(room.specialExits || {})) entries.push({ direction, to: Number(typeof to === "object" ? to.to ?? to.vnum : to), custom: true });
  return entries.filter((exit, index) => Number.isSafeInteger(exit.to) && entries.findIndex((other) => other.direction === exit.direction && other.to === exit.to) === index);
}
export function connections(rooms) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return rooms.flatMap((from) => exitEntries(from).filter((exit) => byId.has(exit.to)).map((exit) => ({ ...exit, from, toRoom: byId.get(exit.to) })));
}
export class AreaTransfer {
  constructor() {
    this.generation = 0;
    this.area = null;
    this.rooms = [];
    this.next = 0;
  }
  begin(area) {
    this.generation++;
    this.area = String(area);
    this.rooms = [];
    this.next = 0;
    return this.generation;
  }
  accept(message) {
    if (message.generation !== this.generation || String(message.areaId) !== this.area || message.offset !== this.next || !Number.isSafeInteger(message.total) || message.total < 0 || (!message.rooms || typeof message.rooms !== "object")) return null;
    const chunk = nativeList(message.rooms);
    const next = message.nextOffset ?? this.next + chunk.length;
    if (!Number.isSafeInteger(next) || next < this.next || next === this.next && this.next < message.total) return null;
    this.rooms.push(...chunk.map(normalizeRoom).filter(Boolean));
    this.next = next;
    return { complete: message.done === true || this.next >= message.total, next: this.next, rooms: this.rooms };
  }
}
export function perspectiveFitDistance(radius, verticalFovDegrees, aspect) {
  const vertical = verticalFovDegrees * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(0.01, aspect));
  return Math.max(1, radius) / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12;
}
