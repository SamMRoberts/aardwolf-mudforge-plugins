import * as THREE from "three";
import { connections, exitEntries, indicatorOptions, roomPosition } from "./model.js";

export const connectionStyles = {
  normal: { color: "#e2eee9", width: 2 },
  custom: { color: "#c9a1ff", width: 2.5 },
  openDoors: { color: "#ffd166", width: 3.5 },
  closedDoors: { color: "#ffd166", width: 4 },
  lockedDoors: { color: "#ff997d", width: 4 },
  lockedDoorLocks: { color: "#ff997d", width: 2 },
  upExits: { color: "#87edbd", width: 2.5 },
  downExits: { color: "#80bfff", width: 2.5 },
  areaExits: { color: "#c9a1ff", width: 2.5 },
  exitLocks: { color: "#ff555f", width: 2 },
  roomLocks: { color: "#ff555f", width: 2 },
};

const segment = (output, a, b) => output.push(...a.toArray(), ...b.toArray());
function padlock(output, center, size = 1) {
  const point = (x, z) => center.clone().add(new THREE.Vector3(x * size, 0, z * size));
  const body = [[-0.13, 0], [0.13, 0], [0.13, 0.2], [-0.13, 0.2], [-0.13, 0]];
  for (let i = 1; i < body.length; i++) segment(output, point(...body[i - 1]), point(...body[i]));
  // A squared body and rounded shackle remain readable above terrain artwork.
  const shackle = [[-0.09, 0], [-0.09, -0.1], [-0.06, -0.16], [0.06, -0.16], [0.09, -0.1], [0.09, 0]];
  for (let i = 1; i < shackle.length; i++) segment(output, point(...shackle[i - 1]), point(...shackle[i]));
}
function boundaryDistance(direction) {
  // Expanded slab bounds keep links off the textured tile faces, including
  // diagonal and inter-floor edges. Zero components must not divide by zero.
  return Math.min(...[0.82, 0.18, 0.82].map((half, index) => Math.abs(direction.getComponent(index)) > 1e-8 ? half / Math.abs(direction.getComponent(index)) : Infinity));
}

export function configuredConnectionStyles(preferences = {}) {
  const options = indicatorOptions(preferences);
  return Object.fromEntries(Object.entries(connectionStyles).map(([kind, style]) => [kind, {
    ...style, color: kind === "openDoors" || kind === "closedDoors" ? options.doorColor
      : kind === "lockedDoors" || kind === "lockedDoorLocks" ? options.lockedDoorColor
      : kind === "upExits" ? options.upExitColor : kind === "downExits" ? options.downExitColor
      : kind === "areaExits" ? options.areaExitColor : style.color,
  }]));
}

function doorMarker(batches, door, center, axis, side, options, lockCenter) {
  if (door === 3 ? !options.showLockedDoors : !options.showDoors) return;
  if (door === 1) {
    segment(batches.openDoors, center.clone().addScaledVector(side, -0.24), center.clone().addScaledVector(side, -0.14));
    segment(batches.openDoors, center.clone().addScaledVector(side, 0.14), center.clone().addScaledVector(side, 0.24));
    segment(batches.openDoors, center.clone().addScaledVector(side, -0.14), center.clone().addScaledVector(side, -0.14).addScaledVector(axis, 0.26));
  } else if (door === 2 || door === 3) {
    segment(door === 2 ? batches.closedDoors : batches.lockedDoors,
      center.clone().addScaledVector(side, -0.24), center.clone().addScaledVector(side, 0.24));
  }
  if (door === 3) padlock(batches.lockedDoorLocks, lockCenter, 1.3);
}
function arrow(output, center, axis, size = 0.16) {
  const side = new THREE.Vector3(-axis.z, 0, axis.x);
  const tip = center.clone().addScaledVector(axis, size);
  const back = center.clone().addScaledVector(axis, -size);
  segment(output, back, tip);
  segment(output, center.clone().addScaledVector(side, size * 0.7), tip);
  segment(output, center.clone().addScaledVector(side, -size * 0.7), tip);
}

const compass = {
  __proto__: null,
  n: [0, -1], north: [0, -1], ne: [1, -1], northeast: [1, -1],
  e: [1, 0], east: [1, 0], se: [1, 1], southeast: [1, 1],
  s: [0, 1], south: [0, 1], sw: [-1, 1], southwest: [-1, 1],
  w: [-1, 0], west: [-1, 0], nw: [-1, -1], northwest: [-1, -1],
};
function sourceAnchor(position, direction, customIndex, customCount) {
  const offset = compass[direction];
  if (offset) return position.clone().add(new THREE.Vector3(offset[0] * 0.87, 0.24, offset[1] * 0.87));
  if (direction === "u" || direction === "up") return position.clone().add(new THREE.Vector3(-0.48, 0.24, -0.48));
  if (direction === "d" || direction === "down") return position.clone().add(new THREE.Vector3(0.48, 0.24, -0.48));
  // Stable ordered slots on the lower tile edge avoid moving custom markers
  // when settings change. Only the slots, never destination positions, are made up.
  return position.clone().add(new THREE.Vector3(-0.6 + 1.2 * (customIndex + 0.5) / customCount, 0.24, 0.6));
}

export function connectionSegments(rooms, exploded = false, preferences = {}) {
  const options = indicatorOptions(preferences);
  const visible = rooms.filter(room => room.positioned && !room.hidden);
  const batches = Object.fromEntries(Object.keys(connectionStyles).map(key => [key, []]));
  const edges = connections(visible);
  const connected = new Set();
  const directed = new Set(edges.map(edge => `${edge.from.id}:${edge.toRoom.id}`));
  for (const edge of edges) {
    const from = new THREE.Vector3(...roomPosition(edge.from, exploded));
    const to = new THREE.Vector3(...roomPosition(edge.toRoom, exploded));
    const axis = to.clone().sub(from);
    const distance = axis.length();
    // Coincident rooms retain the picker overlap choices without inventing a
    // loop or feeding a zero-length segment to the wide-line shader.
    if (distance < 1e-5) continue;
    axis.divideScalar(distance);
    const trim = boundaryDistance(axis);
    if (trim * 2 >= distance) continue;
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    if (side.lengthSq() < 1e-8) side.set(axis.y >= 0 ? 1 : -1, 0, 0);
    else side.normalize();
    const lane = directed.has(`${edge.toRoom.id}:${edge.from.id}`) ? 0.09 : 0;
    const lift = Math.abs(axis.y) < 1e-8 ? 0.19 : 0;
    const a = from.clone().addScaledVector(axis, trim).addScaledVector(side, lane);
    const b = to.clone().addScaledVector(axis, -trim).addScaledVector(side, lane);
    a.y += lift; b.y += lift;
    const output = edge.custom ? batches.custom : batches.normal;
    segment(output, a, b);
    const gap = a.distanceTo(b);
    const arrowLength = Math.min(0.24, gap * 0.45);
    const arrowWidth = Math.min(0.15, gap * 0.28);
    const tip = a.clone().lerp(b, 0.82);
    const back = tip.clone().addScaledVector(axis, -arrowLength);
    segment(output, back.clone().addScaledVector(side, arrowWidth), tip);
    segment(output, back.clone().addScaledVector(side, -arrowWidth), tip);

    connected.add(`${edge.from.id}:${edge.direction}:${edge.toRoom.id}`);
    const door = Number(edge.from.doors?.[edge.direction]);
    const center = a.clone().lerp(b, 0.55);
    const lock = a.clone().lerp(b, 0.7); lock.y += 0.025;
    doorMarker(batches, door, center, axis, side, options, lock);
    // Routing locks are independent native metadata and keep their own style.
    if (edge.from.exitLocks?.[edge.direction] === true) {
      const routingLock = a.clone().lerp(b, 0.3); routingLock.y += 0.025;
      padlock(batches.exitLocks, routingLock, 1.3);
    }
  }
  const byId = new Map(visible.map(room => [room.id, room]));
  for (const room of visible) {
    const position = new THREE.Vector3(...roomPosition(room, exploded));
    const exits = exitEntries(room).sort((a, b) => a.direction < b.direction ? -1 : a.direction > b.direction ? 1 : a.to - b.to);
    const custom = exits.filter(exit => !compass[exit.direction] && !["u", "up", "d", "down"].includes(exit.direction));
    for (const exit of exits) {
      const target = Object.hasOwn(room.exitTargets || {}, exit.direction) ? room.exitTargets[exit.direction] : byId.get(exit.to);
      if (!target || target.hidden) continue;
      const center = sourceAnchor(position, exit.direction, custom.indexOf(exit), custom.length);
      const offset = compass[exit.direction] || [0, -1];
      const axis = new THREE.Vector3(offset[0], 0, offset[1]).normalize();
      const side = new THREE.Vector3(-axis.z, 0, axis.x);
      const up = exit.direction === "u" || exit.direction === "up";
      const down = exit.direction === "d" || exit.direction === "down";
      if (up && options.showUpExits) arrow(batches.upExits, center, new THREE.Vector3(0, 0, -1));
      if (down && options.showDownExits) arrow(batches.downExits, center, new THREE.Vector3(0, 0, 1));
      const area = target.areaId ?? target.area;
      if (typeof area === "string" && area !== room.area && options.showAreaExits) {
        // Keep the area glyph in a separate projected lane, opposite the door
        // padlock. A height offset alone does not prevent overlap in overhead.
        const areaCenter = center.clone().addScaledVector(side, -0.55);
        areaCenter.y += 0.01;
        // An open doorway plus an outward arrow is distinct from a floor arrow.
        const point = (x, z) => areaCenter.clone().add(new THREE.Vector3(x, 0, z));
        segment(batches.areaExits, point(-0.12, -0.1), point(-0.12, 0.12));
        segment(batches.areaExits, point(-0.12, 0.12), point(0.1, 0.12));
        arrow(batches.areaExits, areaCenter, new THREE.Vector3(1, 0, -1).normalize(), 0.15);
      }
      if (!connected.has(`${room.id}:${exit.direction}:${exit.to}`)) {
        const doorCenter = center.clone().addScaledVector(axis, -0.28);
        const lock = doorCenter.clone().addScaledVector(side, 0.28); lock.y += 0.025;
        doorMarker(batches, Number(room.doors?.[exit.direction]), doorCenter, axis, side, options, lock);
      }
    }
  }
  for (const room of visible) {
    if (room.locked !== true) continue;
    const position = new THREE.Vector3(...roomPosition(room, exploded));
    position.add(new THREE.Vector3(0.48, 0.22, 0.43));
    padlock(batches.roomLocks, position, 1.5);
  }
  return batches;
}
