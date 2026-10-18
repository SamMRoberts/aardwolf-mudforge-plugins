import * as THREE from "three";
import { connections, roomPosition } from "./model.js";

export const connectionStyles = {
  normal: { color: "#e2eee9", width: 2 },
  custom: { color: "#c9a1ff", width: 2.5 },
  openDoors: { color: "#87edbd", width: 3.5 },
  closedDoors: { color: "#ffd166", width: 4 },
  lockedDoors: { color: "#ff997d", width: 4 },
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

export function connectionSegments(rooms, exploded = false) {
  const visible = rooms.filter(room => room.positioned && !room.hidden);
  const batches = Object.fromEntries(Object.keys(connectionStyles).map(key => [key, []]));
  const edges = connections(visible);
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

    const door = Number(edge.from.doors?.[edge.direction]);
    const center = a.clone().lerp(b, 0.55);
    if (door === 1) {
      // Two jambs and an open leaf differ in shape as well as color from a bar.
      segment(batches.openDoors, center.clone().addScaledVector(side, -0.24), center.clone().addScaledVector(side, -0.14));
      segment(batches.openDoors, center.clone().addScaledVector(side, 0.14), center.clone().addScaledVector(side, 0.24));
      segment(batches.openDoors, center.clone().addScaledVector(side, -0.14), center.clone().addScaledVector(side, -0.14).addScaledVector(axis, 0.26));
    } else if (door === 2 || door === 3) {
      segment(door === 2 ? batches.closedDoors : batches.lockedDoors,
        center.clone().addScaledVector(side, -0.24), center.clone().addScaledVector(side, 0.24));
    }
    if (door === 3 || edge.from.exitLocks?.[edge.direction] === true) {
      const lock = a.clone().lerp(b, door === 3 ? 0.7 : 0.3);
      lock.y += 0.025;
      padlock(batches.exitLocks, lock, 1.3);
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
