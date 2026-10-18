import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AtlasScene } from "../src/atlas/scene.js";

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
