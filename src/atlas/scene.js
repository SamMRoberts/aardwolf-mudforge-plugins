import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { connections, coordinateGroups, roomPosition, terrainKey, perspectiveFitDistance } from "./model.js";
export class AtlasScene {
  constructor(canvas, assets, { select, manual, failed }) {
    this.canvas = canvas;
    this.assets = assets;
    this.select = select;
    this.manual = manual;
    this.failed = failed;
    this.textures = /* @__PURE__ */ new Map();
    this.materials = /* @__PURE__ */ new Map();
    this.meshes = [];
    this.rooms = [];
    this.exploded = false;
    this.view = "overhead";
    this.showVnums = true;
    this.northUp = false;
    this.disposed = false;
    this.visible = true;
    this.frame = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor("#121b21");
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight("#d6e5e0", 2.2));
    const light = new THREE.DirectionalLight("#fff3de", 3);
    light.position.set(-10, 30, 15);
    this.scene.add(light);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.ortho = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 1e5);
    this.perspective = new THREE.PerspectiveCamera(45, 1, 0.01, 1e5);
    this.camera = this.ortho;
    this.camera.position.set(0, 50, 1e-3);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.controls = this.createControls();
    this.down = null;
    this.pointerDown = (event) => this.beginPointer(event);
    this.pointerMove = (event) => this.movePointer(event);
    this.pointerUp = (event) => this.endPointer(event);
    this.pointerCancel = (event) => this.cancelPointer(event);
    this.wheel = () => this.manual();
    canvas.addEventListener("wheel", this.wheel, { passive: true });
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("lostpointercapture", this.pointerCancel);
    this.keydown = (e) => this.keyboard(e);
    canvas.addEventListener("keydown", this.keydown);
    this.visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      } else this.request();
    };
    document.addEventListener("visibilitychange", this.visibility);
    this.contextLost = (e) => {
      e.preventDefault();
      this.failed("The graphics context was lost. Reload Atlas or open the native mapper.");
    };
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.labels = document.getElementById("labels");
    this.resize();
  }
  request() {
    if (this.disposed || !this.visible || document.hidden || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
      this.drawLabels();
    });
  }
  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.request();
  }
  resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    const extent = this.extent || 20;
    this.ortho.left = -extent * w / h;
    this.ortho.right = extent * w / h;
    this.ortho.top = extent;
    this.ortho.bottom = -extent;
    this.ortho.updateProjectionMatrix();
    this.request();
  }
  createControls() {
    const controls = new OrbitControls(this.camera, this.canvas);
    controls.enableDamping = false;
    controls.enableRotate = this.view === "perspective";
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = this.view === "perspective" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = this.view === "perspective" ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.addEventListener("change", () => this.request());
    return controls;
  }
  setView(view) {
    this.view = view;
    const target = this.controls.target.clone();
    this.controls.dispose();
    this.camera = view === "perspective" ? this.perspective : this.ortho;
    this.camera.up.set(0, 1, 0);
    if (view === "overhead") this.camera.up.set(0, 0, -1);
    // OrbitControls captures the camera's up axis at construction time.
    this.controls = this.createControls();
    this.controls.target.copy(target);
    this.resetCamera();
  }
  setDisplayOptions({ showVnums = this.showVnums, northUp = this.northUp }) {
    this.showVnums = showVnums;
    this.northUp = northUp;
    this.constrainCamera();
    this.controls.update();
    this.request();
  }
  constrainCamera() {
    const locked = this.view === "perspective" && this.northUp;
    this.controls.minAzimuthAngle = locked ? 0 : -Infinity;
    this.controls.maxAzimuthAngle = locked ? 0 : Infinity;
    this.controls.maxPolarAngle = locked ? Math.PI / 2 - 0.01 : Math.PI;
    if (locked) {
      // Preserve distance and tilt while putting north along the top of the map.
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta = 0;
      spherical.phi = Math.min(spherical.phi, this.controls.maxPolarAngle);
      spherical.makeSafe();
      this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
      this.camera.lookAt(this.controls.target);
    }
  }
  resetCamera() {
    const target = this.controls.target;
    const scale = Math.max(5, this.extent || 20);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
    const offset = this.view === "perspective" ? new THREE.Vector3(1, 1.4, 1).normalize().multiplyScalar(perspectiveFitDistance(this.radius || scale, this.perspective.fov, this.perspective.aspect)) : new THREE.Vector3(0, scale * 3, 1e-3);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.constrainCamera();
    this.controls.update();
    this.request();
  }
  fit() {
    if (!this.rooms.length) return;
    const points = this.rooms.map((r) => new THREE.Vector3(...roomPosition(r, this.exploded)));
    const box = new THREE.Box3().setFromPoints(points);
    const size = box.getSize(new THREE.Vector3());
    this.extent = Math.max(6, size.z / 2 + 4, (size.x / 2 + 4) / Math.max(0.1, this.canvas.clientWidth / this.canvas.clientHeight), size.y / 2 + 4);
    this.ortho.zoom = 1;
    this.radius = Math.max(3, box.getBoundingSphere(new THREE.Sphere()).radius + 2);
    this.controls.target.copy(box.getCenter(new THREE.Vector3()));
    this.resize();
    this.resetCamera();
  }
  center(room) {
    if (!room?.positioned) return;
    const center = new THREE.Vector3(...roomPosition(room, this.exploded));
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.constrainCamera();
    this.controls.update();
    this.request();
  }
  terrain(room) {
    const key = terrainKey(room.terrain, this.assets.terrains);
    return this.assets.terrains?.find((t) => t.name === key) || this.assets.terrains?.find((t) => t.name === "default");
  }
  texture(key) {
    if (this.textures.has(key)) return this.textures.get(key);
    const sheet = this.assets.sheets?.find((s) => s.id === key);
    const uri = sheet?.image || this.assets.images?.[key] || this.assets.images?.default;
    if (!uri) return null;
    const texture = new THREE.TextureLoader().load(uri, () => this.request(), void 0, () => {
      this.textures.set(key, null);
      for (const [cacheKey, material] of this.materials) if (cacheKey.startsWith(`${key}|`)) {
        material.map = null;
        material.color.set("#49645b");
        material.needsUpdate = true;
      }
      this.request();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.set(key, texture);
    return texture;
  }
  material(room) {
    const terrain = this.terrain(room);
    const key = terrain?.sheet || terrain?.name || "default";
    const color = room.color || room.flagColor || "";
    const cacheKey = color ? "override" : `${key}|`;
    if (!this.materials.has(cacheKey)) {
      let safeColor = "#ffffff";
      try {
        if (color && CSS.supports("color", color)) safeColor = color;
      } catch {
      }
      const material = new THREE.MeshStandardMaterial({ color: color ? "#ffffff" : safeColor, map: color ? null : this.texture(key), roughness: 0.94, metalness: 0 });
      if (terrain?.sheet && !color) {
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = "attribute vec4 atlasRect; varying vec4 vAtlasRect;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvAtlasRect = atlasRect;");
          shader.fragmentShader = "varying vec4 vAtlasRect;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vAtlasRect.xy + vMapUv * vAtlasRect.zw )"));
        };
        material.customProgramCacheKey = () => "atlas-instanced-uv-v1";
      }
      this.materials.set(cacheKey, material);
    }
    return this.materials.get(cacheKey);
  }
  clear() {
    while (this.content.children.length) {
      const child = this.content.children[0];
      this.content.remove(child);
      child.geometry?.dispose();
      if (child.userData.ownMaterial) child.material?.dispose();
      child.dispose?.();
    }
    this.meshes = [];
    this.labels?.replaceChildren();
  }
  setRooms(rooms, exploded) {
    this.clear();
    this.rooms = rooms;
    this.exploded = exploded;
    this.groups = coordinateGroups(rooms);
    const terrainGroups = /* @__PURE__ */ new Map();
    for (const group of this.groups.values()) {
      const room = group[0];
      const material = this.material(room);
      if (!terrainGroups.has(material)) terrainGroups.set(material, []);
      terrainGroups.get(material).push(room);
    }
    const matrix = new THREE.Matrix4();
    for (const [material, group] of terrainGroups) {
      const geometry = new THREE.BoxGeometry(1.48, 0.22, 1.48);
      const rects = new Float32Array(group.length * 4);
      const mesh = new THREE.InstancedMesh(geometry, material, group.length);
      mesh.userData.rooms = group;
      group.forEach((room, i) => {
        matrix.makeTranslation(...roomPosition(room, exploded));
        mesh.setMatrixAt(i, matrix);
        if (room.color || room.flagColor) {
          const color = String(room.color || room.flagColor);
          mesh.setColorAt(i, new THREE.Color(CSS.supports("color", color) ? color : "#49645b"));
        }
        const terrain = this.terrain(room);
        const sheet = this.assets.sheets?.find((s) => s.id === terrain?.sheet);
        rects.set(sheet ? [(terrain.x + 0.5) / sheet.width, 1 - (terrain.y + terrain.height - 0.5) / sheet.height, (terrain.width - 1) / sheet.width, (terrain.height - 1) / sheet.height] : [0, 0, 1, 1], i * 4);
      });
      geometry.setAttribute("atlasRect", new THREE.InstancedBufferAttribute(rects, 4));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.content.add(mesh);
      this.meshes.push(mesh);
    }
    const vertices = [], doors = [], arrows = [], custom = [];
    for (const edge of connections(rooms)) {
      const a = roomPosition(edge.from, exploded), b = roomPosition(edge.toRoom, exploded);
      a[1] -= 0.05;
      b[1] -= 0.05;
      (edge.custom ? custom : vertices).push(...a, ...b);
      const direction = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
      if (direction.length() > 0.01) {
        const end = new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), 0.73);
        const axis = direction.normalize();
        const side = new THREE.Vector3(-axis.z, 0, axis.x).multiplyScalar(0.14);
        const back = end.clone().addScaledVector(axis, -0.3);
        arrows.push(...back.clone().add(side).toArray(), ...end.toArray(), ...back.clone().sub(side).toArray(), ...end.toArray());
      }
      const state = edge.from.doors?.[edge.direction];
      if (state) {
        const center = new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), 0.5);
        const side = new THREE.Vector3(-(b[2] - a[2]), 0, b[0] - a[0]).normalize().multiplyScalar(0.22);
        doors.push(...center.clone().add(side).toArray(), ...center.clone().sub(side).toArray());
      }
    }
    this.line(vertices, "#526c6c");
    this.line(custom, "#8a78ae");
    this.line(arrows, "#879a90");
    this.line(doors, "#dbad74");
    this.request();
  }
  line(vertices, color) {
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
    line.userData.ownMaterial = true;
    this.content.add(line);
    return line;
  }
  overlays(player, selected, steps = []) {
    for (const child of [...this.content.children]) if (child.userData.overlay) {
      this.content.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    const byId = new Map(this.rooms.map((r) => [r.id, r]));
    const mark = (id, color, radius) => {
      const room = byId.get(id);
      if (!room) return;
      const mesh = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.09, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(...roomPosition(room, this.exploded));
      mesh.position.y += 0.18;
      mesh.renderOrder = 5;
      mesh.userData.overlay = true;
      mesh.userData.ownMaterial = true;
      this.content.add(mesh);
    };
    mark(selected, "#efbd73", 1.02);
    mark(player, "#88f0d8", 0.85);
    const points = [];
    for (let i = 1; i < steps.length; i++) {
      const a = byId.get(Number(steps[i - 1].roomId)), b = byId.get(Number(steps[i].roomId));
      if (a && b) {
        const ap = roomPosition(a, this.exploded), bp = roomPosition(b, this.exploded);
        ap[1] += 0.3;
        bp[1] += 0.3;
        points.push(...ap, ...bp);
      }
    }
    const line = this.line(points, "#f8c57b");
    if (line) {
      line.userData.overlay = true;
      line.material.depthTest = false;
      line.renderOrder = 4;
    }
    this.request();
  }
  beginPointer(event) {
    if (this.down) {
      // A second pointer starts a gesture, never a room click.
      this.down.selectable = false;
      return;
    }
    this.down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, selectable: event.button === 0 && event.isPrimary !== false };
  }
  movePointer(event) {
    if (this.down?.pointerId !== event.pointerId) return;
    this.down.distance = Math.max(this.down.distance, Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y));
  }
  cancelPointer(event) {
    if (this.down?.pointerId === event.pointerId) this.down = null;
  }
  endPointer(event) {
    if (this.down?.pointerId !== event.pointerId) return;
    this.movePointer(event);
    const down = this.down;
    this.down = null;
    if (down.distance >= 5) this.manual();
    else if (down.selectable && event.button === 0 && event.isPrimary !== false) this.pick(event);
  }
  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects(this.meshes, false)[0];
    if (hit) {
      const room = hit.object.userData.rooms[hit.instanceId];
      this.select(this.groups.get(`${room.x},${room.y},${room.z}`));
    } else this.select([]);
  }
  keyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) return;
    event.preventDefault();
    this.manual();
    if (["+", "=", "-"].includes(event.key)) {
      const factor = event.key === "-" ? 1.15 : 1 / 1.15;
      if (this.view === "overhead") {
        this.camera.zoom = Math.max(0.01, Math.min(100, this.camera.zoom / factor));
        this.camera.updateProjectionMatrix();
      } else this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);
    } else {
      const delta = new THREE.Vector3(event.key === "ArrowRight" ? 2 : event.key === "ArrowLeft" ? -2 : 0, 0, event.key === "ArrowDown" ? 2 : event.key === "ArrowUp" ? -2 : 0);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.constrainCamera();
    this.controls.update();
    this.request();
  }
  drawLabels() {
    this.labels.replaceChildren();
    if (this.rooms.length > 1500) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    let count = 0;
    for (const room of this.rooms) {
      if (count >= 120) break;
      if (!this.showVnums && !room.symbol && !room.flagSymbol) continue;
      const world = new THREE.Vector3(...roomPosition(room, this.exploded));
      world.y += 0.2;
      const p = world.clone().project(this.camera), next = world.clone().add(new THREE.Vector3(1, 0, 0)).project(this.camera);
      if (p.z > 1 || p.z < -1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(next.x - p.x) * width < (room.symbol || room.flagSymbol ? 18 : 40)) continue;
      const label = document.createElement("span");
      label.className = "room-label";
      label.style.left = `${(p.x + 1) * width / 2}px`;
      label.style.top = `${(-p.y + 1) * height / 2}px`;
      label.textContent = String(room.symbol || room.flagSymbol || room.id);
      const symbolColor = room.symbol ? room.symbolColor : room.flagSymbolColor;
      if (typeof symbolColor === "string" && CSS.supports("color", symbolColor)) label.style.color = symbolColor;
      this.labels.append(label);
      count++;
    }
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    document.removeEventListener("visibilitychange", this.visibility);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.pointerCancel);
    this.down = null;
    this.canvas.removeEventListener("keydown", this.keydown);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.clear();
    for (const texture of this.textures.values()) texture?.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.renderer.dispose();
  }
}
