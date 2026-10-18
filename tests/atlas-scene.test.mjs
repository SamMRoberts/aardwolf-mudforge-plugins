import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AtlasScene } from "../src/atlas/scene.js";
import { connectionSegments, connectionStyles, configuredConnectionStyles } from "../src/atlas/connections.js";
import { normalizeRoom } from "../src/atlas/model.js";

// Exercise the production camera and controls without a WebGL context.
function harness() {
  const scene = Object.create(AtlasScene.prototype);
  const document = new EventTarget();
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 900, clientHeight: 600, style: {}, ownerDocument: document,
    getRootNode: () => document,
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
  });
  Object.assign(scene, {
    canvas,
    ortho: new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 100000),
    perspective: new THREE.PerspectiveCamera(45, 1.5, 0.01, 100000),
    view: "overhead", northUp: false, showVnums: true, extent: 20,
    rooms: [], meshes: [], down: null, request() {}, manual() { this.manualCount++; }, manualCount: 0,
    select(rooms) { this.selected = rooms; },
    renderer: { setSize() {} },
  });
  scene.camera = scene.ortho;
  scene.camera.up.set(0, 0, -1);
  scene.controls = scene.createControls();
  scene.resetCamera();
  return scene;
}
function assertNorthUp(scene) {
  const offset = scene.camera.position.clone().sub(scene.controls.target);
  assert.ok(Math.abs(offset.x) < 1e-8, `horizontal offset ${offset.x}`);
  assert.ok(offset.z > 0);
  assert.ok(offset.y > 0);
  assert.ok(Math.abs(scene.controls.getAzimuthalAngle()) < 1e-8);
}

test("3D left-drag pans and right-drag orbits; overhead keeps both panning and touch retains its mapping", () => {
  const scene = harness();
  scene.setView("perspective");
  assert.equal(scene.controls.mouseButtons.LEFT, THREE.MOUSE.PAN);
  assert.equal(scene.controls.mouseButtons.RIGHT, THREE.MOUSE.ROTATE);
  assert.equal(scene.controls.touches.ONE, THREE.TOUCH.ROTATE);
  scene.setView("overhead");
  assert.equal(scene.controls.mouseButtons.LEFT, THREE.MOUSE.PAN);
  assert.equal(scene.controls.mouseButtons.RIGHT, THREE.MOUSE.PAN);
  assert.equal(scene.controls.touches.ONE, THREE.TOUCH.PAN);
});

test("real drag controls pan with left and orbit with right, retaining locked heading during tilt", () => {
  const scene = harness();
  scene.setView("perspective");
  const drag = (button, dx, dy) => {
    const event = (type, x, y) => Object.assign(new Event(type), { pointerId: 1, pointerType: "mouse", button, clientX: x, clientY: y, pageX: x, pageY: y });
    scene.canvas.dispatchEvent(event("pointerdown", 100, 100));
    scene.canvas.ownerDocument.dispatchEvent(event("pointermove", 100 + dx, 100 + dy));
    scene.canvas.ownerDocument.dispatchEvent(event("pointerup", 100 + dx, 100 + dy));
  };
  const heading = scene.controls.getAzimuthalAngle();
  drag(0, 40, 0);
  assert.ok(scene.controls.target.length() > 0);
  assert.ok(Math.abs(scene.controls.getAzimuthalAngle() - heading) < 1e-8);
  const target = scene.controls.target.clone();
  drag(2, 40, 0);
  assert.ok(Math.abs(scene.controls.getAzimuthalAngle() - heading) > 0.1);
  assert.ok(scene.controls.target.distanceTo(target) < 1e-8);
  scene.setDisplayOptions({ northUp: true });
  const tilt = scene.controls.getPolarAngle();
  drag(2, 40, 20);
  assertNorthUp(scene);
  assert.notEqual(scene.controls.getPolarAngle(), tilt);
});

test("north-up applies immediately and survives fit, reset, centering, view changes, and keyboard navigation", () => {
  const scene = harness();
  scene.setView("perspective");
  assert.ok(scene.camera.position.x > 0);
  scene.setDisplayOptions({ northUp: true });
  assertNorthUp(scene);
  scene.resetCamera();
  assertNorthUp(scene);
  scene.rooms = [{ id: 1, x: -5, y: 3, z: 1, positioned: true }, { id: 2, x: 12, y: -8, z: 6, positioned: true }];
  scene.fit();
  assertNorthUp(scene);
  scene.center(scene.rooms[1]);
  assertNorthUp(scene);
  scene.setView("overhead");
  scene.setView("perspective");
  assertNorthUp(scene);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"]) {
    scene.keyboard({ key, preventDefault() {} });
    assertNorthUp(scene);
  }
  // The actual controls enforce heading and the above-horizon limit during orbit.
  scene.camera.position.copy(scene.controls.target).add(new THREE.Vector3(4, -8, -2));
  scene.controls.update();
  assertNorthUp(scene);
  scene.setDisplayOptions({ northUp: false });
  assert.equal(scene.controls.maxAzimuthAngle, Infinity);
  assert.equal(scene.controls.minAzimuthAngle, -Infinity);
  assert.equal(scene.controls.maxPolarAngle, Math.PI);
});

test("north-up retains distance and permits changing tilt", () => {
  const scene = harness();
  scene.setView("perspective");
  const distance = scene.camera.position.distanceTo(scene.controls.target);
  scene.setDisplayOptions({ northUp: true });
  assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target) - distance) < 1e-8);
  const angle = scene.controls.getPolarAngle();
  scene.camera.position.copy(scene.controls.target).add(new THREE.Vector3(0, 3, 8));
  scene.controls.update();
  assertNorthUp(scene);
  assert.notEqual(scene.controls.getPolarAngle(), angle);
});

const pointer = (overrides = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientX: 100, clientY: 100, ...overrides });
test("only primary short clicks pick; drag return-to-origin and right clicks never pick", () => {
  const scene = harness();
  let picks = 0;
  scene.pick = () => picks++;
  scene.beginPointer(pointer());
  scene.endPointer(pointer({ clientX: 103 }));
  assert.equal(picks, 1);
  scene.beginPointer(pointer({ button: 2 }));
  scene.endPointer(pointer({ button: 2 }));
  scene.beginPointer(pointer());
  scene.movePointer(pointer({ clientX: 110 }));
  scene.endPointer(pointer());
  scene.beginPointer(pointer());
  scene.endPointer(pointer({ clientX: 105 }));
  scene.beginPointer(pointer({ isPrimary: false }));
  scene.endPointer(pointer({ isPrimary: false }));
  assert.equal(picks, 1);
  assert.equal(scene.manualCount, 2);
});

test("foreign pointers, multi-touch, cancellation, and capture loss cannot select", () => {
  const scene = harness();
  let picks = 0;
  scene.pick = () => picks++;
  scene.beginPointer(pointer());
  scene.movePointer(pointer({ pointerId: 2, clientX: 200 }));
  scene.endPointer(pointer({ pointerId: 2 }));
  assert.equal(scene.down.distance, 0);
  scene.beginPointer(pointer({ pointerId: 2, isPrimary: false }));
  scene.endPointer(pointer());
  assert.equal(picks, 0);
  for (const kind of ["pointercancel", "lostpointercapture"]) {
    scene.beginPointer(pointer());
    scene.cancelPointer(pointer({ type: kind }));
    scene.endPointer(pointer());
  }
  assert.equal(picks, 0);
  assert.equal(scene.down, null);
});

test("raycast misses clear selection and raycast hits preserve overlap choices", () => {
  const scene = harness();
  scene.camera.updateMatrixWorld();
  scene.pick(pointer());
  assert.deepEqual(scene.selected, []);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshBasicMaterial(), 1);
  const rooms = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 0 }];
  mesh.userData.rooms = [rooms[0]];
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.updateMatrixWorld();
  scene.meshes = [mesh];
  scene.groups = new Map([["0,0,0", rooms]]);
  scene.pick(pointer({ clientX: 450, clientY: 300 }));
  assert.equal(scene.selected, rooms);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test("vnum visibility suppresses numbers while preserving symbols and label density limits", () => {
  const scene = harness();
  scene.labels = { children: [], replaceChildren() { this.children = []; }, append(label) { this.children.push(label); } };
  const oldDocument = globalThis.document;
  const oldCSS = globalThis.CSS;
  globalThis.document = { createElement: () => ({ style: {} }) };
  globalThis.CSS = { supports: () => true };
  try {
    scene.rooms = [{ id: 1, x: -2, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: 0, symbol: "☆", symbolColor: "#fff" }, { id: 3, x: 2, y: 0, z: 0, flagSymbol: "!" }];
    scene.camera.zoom = 3;
    scene.camera.updateProjectionMatrix();
    scene.camera.updateMatrixWorld();
    scene.drawLabels();
    assert.deepEqual(scene.labels.children.map(label => label.textContent), ["1", "☆", "!"]);
    scene.setDisplayOptions({ showVnums: false });
    scene.drawLabels();
    assert.deepEqual(scene.labels.children.map(label => label.textContent), ["☆", "!"]);
    assert.equal(scene.labels.children[0].style.color, "#fff");
    scene.rooms = Array.from({ length: 130 }, () => ({ id: 1, x: 0, y: 0, z: 0, symbol: "*" }));
    scene.drawLabels();
    assert.equal(scene.labels.children.length, 120);
    scene.rooms = Array.from({ length: 1501 }, () => scene.rooms[0]);
    scene.drawLabels();
    assert.equal(scene.labels.children.length, 0);
  } finally {
    globalThis.document = oldDocument;
    globalThis.CSS = oldCSS;
  }
});


test("area centering preserves orthographic world scale and perspective distance/orientation", () => {
  const scene = harness();
  scene.rooms = [{ id: 1, positioned: true, x: 50, y: -30, z: 2 }, { id: 2, positioned: true, x: 80, y: 10, z: 6 }];
  scene.extent = 42;
  scene.ortho.zoom = 3.4;
  scene.resize();
  const scale = scene.extent / scene.ortho.zoom;
  const frustum = scene.ortho.top - scene.ortho.bottom;
  let offset = scene.camera.position.clone().sub(scene.controls.target);
  scene.centerArea();
  assert.ok(Math.abs(scene.extent / scene.ortho.zoom - scale) < 1e-8);
  assert.equal(scene.ortho.top - scene.ortho.bottom, frustum);
  assert.ok(scene.camera.position.clone().sub(scene.controls.target).distanceTo(offset) < 1e-8);
  assert.ok(scene.controls.target.distanceTo(new THREE.Vector3(130, 10.4, -20)) < 1e-8);
  scene.setView("perspective");
  scene.camera.position.copy(scene.controls.target).add(new THREE.Vector3(-14, 30, 19));
  scene.controls.update();
  offset = scene.camera.position.clone().sub(scene.controls.target);
  scene.rooms = [{ id: 10, positioned: true, x: -100, y: 10, z: -1 }];
  scene.centerArea();
  assert.ok(scene.camera.position.clone().sub(scene.controls.target).distanceTo(offset) < 1e-8);
  scene.setDisplayOptions({ northUp: true });
  offset = scene.camera.position.clone().sub(scene.controls.target);
  scene.exploded = true;
  scene.rooms = [{ id: 11, positioned: true, x: 4, y: 7, z: 8 }];
  scene.centerArea();
  assertNorthUp(scene);
  assert.ok(scene.camera.position.clone().sub(scene.controls.target).distanceTo(offset) < 1e-8);
  assert.ok(scene.controls.target.distanceTo(new THREE.Vector3(8, 48, 14)) < 1e-8);
  const target = scene.controls.target.clone();
  scene.rooms = [];
  scene.centerArea();
  assert.ok(scene.controls.target.equals(target));
});

const room = (id, x, y, z = 0, fields = {}) => normalizeRoom({ id, x, y, z, ...fields });
test("connections clip tile faces, retain direction arrows, separate reverse lanes and use distinct custom style", () => {
  const batches = connectionSegments([
    room(1, 0, 0, 0, { exits: { e: 2 }, specialExits: { portal: 3 } }),
    room(2, 1, 0, 0, { exits: { w: 1 } }), room(3, 0, 3),
  ]);
  assert.equal(batches.normal.length, 36); // Two shafts and four chevron arms.
  assert.equal(batches.custom.length, 18);
  assert.notEqual(connectionStyles.normal.color, connectionStyles.custom.color);
  assert.ok(connectionStyles.normal.width > 1);
  const forward = batches.normal.slice(0, 6), reverse = batches.normal.slice(18, 24);
  assert.ok(Math.abs(forward[0] - 0.82) < 1e-8);
  assert.ok(Math.abs(forward[3] - 1.18) < 1e-8);
  assert.ok(forward[1] > 0.11 && forward[4] > 0.11);
  assert.ok(forward[2] > 0 && reverse[2] < 0);
  const gap = forward[3] - forward[0];
  const arrowLength = batches.normal[9] - batches.normal[6];
  const arrowWidth = Math.abs(batches.normal[8] - forward[2]);
  assert.ok(Math.abs(arrowLength - gap * 0.45) < 1e-8);
  assert.ok(Math.abs(arrowWidth - gap * 0.28) < 1e-8);
  // Widely separated rooms get capped arrowheads rather than giant chevrons.
  assert.ok(Math.abs(batches.custom[11] - batches.custom[8] - 0.24) < 1e-8);
  assert.ok(Math.abs(Math.abs(batches.custom[6]) - 0.15) < 1e-8);
});

test("reverse vertical connections use opposing lanes and finite direction/lock markers", () => {
  const batches = connectionSegments([
    room(1, 0, 0, 0, { exits: { u: 2 }, doors: { u: 3 } }),
    room(2, 0, 0, 1, { exits: { d: 1 }, exitLocks: { d: true } }),
  ], true);
  assert.equal(batches.normal.length, 36);
  assert.ok(batches.normal[0] > 0);
  assert.ok(batches.normal[18] < 0);
  assert.ok(batches.normal[1] < batches.normal[4]);
  assert.ok(batches.normal[19] > batches.normal[22]);
  assert.equal(batches.exitLocks.length, 54);
  assert.equal(batches.lockedDoorLocks.length, 54);
  assert.ok(Object.values(batches).flat().every(Number.isFinite));
});

test("open, closed, locked doors and independent room/exit locks have distinct bounded geometry", () => {
  const source = room(1, 0, 0, 0, {
    exits: { e: 2, s: 3, w: 4, n: 5 }, doors: { e: 1, s: 2, w: 3 },
    exitLocks: { n: true }, locked: true,
  });
  const batches = connectionSegments([source, room(2, 1, 0), room(3, 0, 1), room(4, -1, 0), room(5, 0, -1)]);
  assert.equal(batches.openDoors.length, 18);
  assert.equal(batches.closedDoors.length, 6);
  assert.equal(batches.lockedDoors.length, 6);
  assert.equal(batches.exitLocks.length, 54); // Independent routing lock keeps its own color.
  assert.equal(batches.lockedDoorLocks.length, 54);
  assert.equal(batches.roomLocks.length, 54);
  assert.equal(connectionStyles.openDoors.color, connectionStyles.closedDoors.color);
  assert.notEqual(connectionStyles.closedDoors.color, connectionStyles.lockedDoors.color);
  assert.notDeepEqual(batches.openDoors, batches.closedDoors);
  // Padlock bodies retain a visible interior at normal tile sizes, while the
  // room-corner marker stays within the slab's 0.74-unit half-width.
  assert.equal(connectionStyles.exitLocks.width, 2);
  assert.equal(connectionStyles.roomLocks.width, 2);
  const lockXs = batches.roomLocks.filter((_, index) => index % 3 === 0);
  const lockZs = batches.roomLocks.filter((_, index) => index % 3 === 2);
  assert.ok(Math.max(...lockXs) <= 0.74 && Math.min(...lockXs) >= -0.74);
  assert.ok(Math.max(...lockZs) <= 0.74 && Math.min(...lockZs) >= -0.74);
  assert.ok(Math.max(...lockXs) - Math.min(...lockXs) > 0.38);
  assert.ok(Object.values(batches).flat().every(Number.isFinite));
});

test("diagonal, vertical, coincident, hidden and unpositioned rooms cannot create invalid or invented edges", () => {
  const batches = connectionSegments([
    room(1, 0, 0, 0, { exits: { ne: 2, u: 3, portal: 4, s: 5, w: 6, out: 999 } }),
    room(2, 1, -1), room(3, 0, 0, 1), room(4, 0, 0),
    room(5, 0, 1, 0, { hidden: true, locked: true }), normalizeRoom({ id: 6, locked: true }),
  ], true);
  assert.equal(batches.normal.length, 36); // Diagonal plus vertical, no coincident loop.
  assert.equal(batches.custom.length, 0);
  assert.equal(batches.roomLocks.length, 0);
  assert.ok(Object.values(batches).flat().every(Number.isFinite));
});

function geometryHarness() {
  const scene = harness();
  scene.content = new THREE.Group();
  scene.assets = { terrains: [] };
  scene.materials = new Map();
  scene.textures = new Map();
  scene.material = () => {
    if (!scene.materials.has("plain")) scene.materials.set("plain", new THREE.MeshBasicMaterial());
    return scene.materials.get("plain");
  };
  return scene;
}
test("wide connection layers are batched, preserve room picking and keep route/player/selection above connections", () => {
  const scene = geometryHarness();
  const rooms = Array.from({ length: 100 }, (_, i) => room(i + 1, i, 0, 0, { exits: i < 99 ? { e: i + 2 } : {}, locked: true }));
  scene.setRooms(rooms, false);
  const links = scene.content.children.filter(child => child.userData.connection);
  assert.ok(links.length <= Object.keys(connectionStyles).length * 2);
  assert.ok(links.every(child => child.isLineSegments2 && child.material.isLineMaterial && child.material.linewidth >= 2));
  assert.ok(links.every(child => child.material.depthWrite === false && child.material.alphaToCoverage));
  assert.equal(connectionStyles.normal.width, 2);
  assert.equal(connectionStyles.custom.width, 2.5);
  assert.ok(scene.meshes.every(mesh => mesh.isInstancedMesh && !mesh.userData.connection));
  scene.camera.updateMatrixWorld();
  scene.content.updateMatrixWorld(true);
  scene.pick(pointer({ clientX: 450, clientY: 300 }));
  assert.equal(scene.selected[0].id, 1);
  scene.overlays(1, 2, [{ roomId: 1 }, { roomId: 2 }]);
  const overlays = scene.content.children.filter(child => child.userData.overlay);
  assert.equal(overlays.length, 4);
  assert.ok(overlays.every(child => child.material.depthTest === false));
  assert.ok(overlays.filter(child => child.isLineSegments2).every(child => child.renderOrder >= 3));
  const route = overlays.find(child => child.isLineSegments2 && child.renderOrder === 4);
  const routeHalo = overlays.find(child => child.isLineSegments2 && child.renderOrder === 3);
  assert.equal(route.material.linewidth, 4);
  assert.equal(routeHalo.material.linewidth, 6);
  assert.ok(overlays.filter(child => child.isMesh && !child.isLineSegments2).every(child => child.renderOrder === 5));
  let geometryDisposals = 0, materialDisposals = 0;
  const owned = [...scene.content.children];
  for (const child of owned) {
    child.geometry.addEventListener("dispose", () => geometryDisposals++);
    if (child.userData.ownMaterial) child.material.addEventListener("dispose", () => materialDisposals++);
  }
  scene.overlays(1, null);
  const replacedCount = overlays.length;
  assert.equal(geometryDisposals, replacedCount);
  assert.equal(materialDisposals, replacedCount);
  scene.clear();
  assert.equal(scene.content.children.length, 0);
  assert.equal(scene.meshes.length, 0);
  assert.equal(geometryDisposals, owned.length);
  assert.equal(materialDisposals, owned.filter(child => child.userData.ownMaterial).length);
  for (const material of scene.materials.values()) material.dispose();
});

test("source indicators survive off-floor, cross-area and unpositioned destinations without inventing links", () => {
  const source = room(1, 0, 0, 0, { areaId: "A", exits: { u: 2, down: 3, e: 4 }, specialExits: { "enter portal": 5 },
    doors: { u: 3, down: 1, e: 2 }, exitTargets: { u: { areaId: "B" }, down: { areaId: "A" }, e: { areaId: "B" }, "enter portal": { areaId: "B" } } });
  const batches = connectionSegments([source]);
  assert.equal(batches.normal.length + batches.custom.length, 0);
  assert.equal(batches.upExits.length, 18);
  assert.equal(batches.downExits.length, 18);
  assert.equal(batches.areaExits.length, 3 * 30);
  assert.equal(batches.openDoors.length, 18);
  assert.equal(batches.closedDoors.length, 6);
  assert.equal(batches.lockedDoors.length, 6);
  assert.equal(batches.lockedDoorLocks.length, 54);
  assert.ok(Object.values(batches).flat().every(Number.isFinite));
  // The same floor arrow is retained when the destination is also visible.
  const connected = connectionSegments([source, room(2, 0, 0, 1, { areaId: "B" })], true);
  assert.equal(connected.upExits.length, 18);
  assert.equal(connected.normal.length, 18);
  assert.equal(connected.lockedDoors.length, 6); // No duplicate source door.
});

test("five indicator toggles and colors are independent of connections and routing locks", () => {
  const rooms = [room(1, 0, 0, 0, { areaId: "A", exits: { up: 2, d: 3, e: 4 },
    doors: { up: 3, d: 1, e: 2 }, exitLocks: { up: true }, locked: true }),
    room(2, 0, 0, 1, { areaId: "B" }), room(3, 0, 0, -1, { areaId: "A" }), room(4, 1, 0, 0, { areaId: "A" })];
  const defaults = connectionSegments(rooms, true);
  for (const [toggle, batches] of [
    ["showDoors", ["openDoors", "closedDoors"]], ["showLockedDoors", ["lockedDoors", "lockedDoorLocks"]],
    ["showUpExits", ["upExits"]], ["showDownExits", ["downExits"]], ["showAreaExits", ["areaExits"]],
  ]) {
    const result = connectionSegments(rooms, true, { [toggle]: false });
    for (const [key, vertices] of Object.entries(result)) {
      if (batches.includes(key)) assert.equal(vertices.length, 0, key);
      else assert.deepEqual(vertices, defaults[key], `${toggle} must preserve ${key}`);
    }
  }
  const styles = configuredConnectionStyles({ doorColor: "#ABCDEF", lockedDoorColor: "#123456", upExitColor: "#456789", downExitColor: "#654321", areaExitColor: "#987654" });
  assert.equal(styles.openDoors.color, "#abcdef");
  assert.equal(styles.closedDoors.color, "#abcdef");
  assert.equal(styles.lockedDoorLocks.color, "#123456");
  assert.equal(styles.lockedDoors.color, "#123456");
  assert.equal(styles.upExits.color, "#456789");
  assert.equal(styles.downExits.color, "#654321");
  assert.equal(styles.areaExits.color, "#987654");
  assert.equal(styles.exitLocks.color, "#ff555f");
  assert.equal(styles.roomLocks.color, "#ff555f");
});

test("unresolved or hidden targets and height differences do not invent source symbols", () => {
  const batches = connectionSegments([
    room(1, 0, 0, 0, { exits: { u: 999, d: 2, e: 3, toString: 998 }, doors: { u: 3, d: 3, toString: 3 } }),
    room(2, 0, 0, -1, { hidden: true }), room(3, 1, 0, 1),
  ], true);
  assert.equal(batches.upExits.length + batches.downExits.length + batches.areaExits.length, 0);
  assert.equal(batches.lockedDoors.length, 0);
  assert.equal(batches.normal.length, 18); // e is not an up exit despite z increasing.
  assert.ok(Object.values(batches).flat().every(Number.isFinite));
  for (const direction of ["u", "up"]) assert.equal(connectionSegments([room(1, 0, 0, 0, { exits: { [direction]: 2 }, exitTargets: { [direction]: { areaId: "" } } })]).upExits.length, 18);
  for (const direction of ["d", "down"]) assert.equal(connectionSegments([room(1, 0, 0, 0, { exits: { [direction]: 2 }, exitTargets: { [direction]: { areaId: "" } } })]).downExits.length, 18);
});

test("custom marker placement is stable across exit order and combined symbols remain distinct", () => {
  const source = fields => room(1, 0, 0, 0, { areaId: "A", exitTargets: { up: { areaId: "B" }, gate: { areaId: "B" }, portal: { areaId: "B" } }, doors: { up: 3 }, ...fields });
  const first = connectionSegments([source({ exits: { up: 2 }, specialExits: { portal: 4, gate: 3 } })]);
  const second = connectionSegments([source({ specialExits: { gate: 3, portal: 4 }, exits: { up: 2 } })]);
  assert.deepEqual(first, second);
  const points = vertices => Array.from({ length: vertices.length / 3 }, (_, i) => vertices.slice(i * 3, i * 3 + 3).join(","));
  assert.ok(!points(first.upExits).some(point => points(first.areaExits).includes(point)));
  assert.ok(!points(first.upExits).some(point => points(first.lockedDoors).includes(point)));
});

test("changing indicator materials disposes old lines and preserves terrain, overlays and camera", () => {
  const scene = geometryHarness();
  scene.setRooms([room(1, 0, 0, 0, { exits: { e: 2 }, doors: { e: 3 } }), room(2, 1, 0)], false);
  scene.overlays(1, 2, [{ roomId: 1 }, { roomId: 2 }]);
  const terrain = [...scene.meshes], overlays = scene.content.children.filter(child => child.userData.overlay);
  const before = scene.content.children.filter(child => child.userData.connection);
  const camera = scene.camera.position.clone(), target = scene.controls.target.clone();
  let geometryDisposals = 0, materialDisposals = 0;
  before.forEach(child => {
    child.geometry.addEventListener("dispose", () => geometryDisposals++);
    child.material.addEventListener("dispose", () => materialDisposals++);
  });
  scene.setIndicatorOptions({ lockedDoorColor: "#123456" });
  assert.equal(geometryDisposals, before.length);
  assert.equal(materialDisposals, before.length);
  assert.deepEqual(scene.meshes, terrain);
  assert.ok(overlays.every(child => scene.content.children.includes(child)));
  assert.ok(scene.camera.position.equals(camera));
  assert.ok(scene.controls.target.equals(target));
  const locks = scene.content.children.filter(child => child.userData.connection === "lockedDoorLocks");
  assert.equal(locks[1].material.color.getHexString(), "123456");
  const current = [...scene.content.children];
  scene.setIndicatorOptions({ lockedDoorColor: "#123456" });
  assert.deepEqual(scene.content.children, current); // Identical preferences do no work.
  scene.clear();
  for (const material of scene.materials.values()) material.dispose();
});

test("area and door source markers occupy disjoint projected lanes in every compass direction", () => {
  for (const [direction, dx, dz] of [["e", 1, 0], ["w", -1, 0], ["n", 0, -1], ["s", 0, 1], ["ne", 1, -1], ["se", 1, 1], ["sw", -1, 1], ["nw", -1, -1], ["up", 0, -1], ["down", 0, -1], ["enter portal", 0, -1]]) {
    for (const door of [1, 2, 3]) {
      const source = room(1, 0, 0, 0, { areaId: "A", exits: { [direction]: 2 }, doors: { [direction]: door }, exitTargets: { [direction]: { areaId: "B" } } });
      const batches = connectionSegments([source]);
      const side = new THREE.Vector3(-dz, 0, dx).normalize();
      const project = vertices => Array.from({ length: vertices.length / 3 }, (_, i) => new THREE.Vector3(...vertices.slice(i * 3, i * 3 + 3)).dot(side));
      const area = project(batches.areaExits);
      const doors = project([...batches.openDoors, ...batches.closedDoors, ...batches.lockedDoors, ...batches.lockedDoorLocks]);
      assert.ok(Math.max(...area) < Math.min(...doors), `${direction} door ${door} must not cross area glyph in overhead`);
    }
  }
});
