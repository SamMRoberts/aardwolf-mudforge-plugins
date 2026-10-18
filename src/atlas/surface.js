import { createInspector } from "./inspector.js";
import { nativeList } from "./model.js";
import { createSurfacePreviewBridge } from "./fixture.js";
const role = document.body.dataset.surface;
const bridge = window.mudforge || (window.ATLAS_PREVIEW ? createSurfacePreviewBridge() : null);
const $ = (id) => document.getElementById(id);
const send = (action, data = {}) => bridge?.send("atlas", { v: 1, action, ...data });
let snapshot = null;
const inspector = role === "details" ? createInspector(document, window.ATLAS_ASSETS || {}, (index) => {
  if (snapshot) send("navigate", { index, generation: snapshot.generation });
}) : null;
if (role === "settings") {
  for (const key of ["showVnums", "northUp", "floatingDetails"]) {
    $(key).addEventListener("change", () => {
      $("surface-status").textContent = "";
      send("setting", { key, value: $(key).checked });
    });
  }
} else $("dock").addEventListener("click", () => {
  $("surface-status").textContent = "";
  send("dock");
});
function receive(message) {
  if (!message || message.v !== 1) return;
  if (role === "settings" && message.type === "preferences") {
    for (const key of ["showVnums", "northUp", "floatingDetails"]) $(key).checked = message.preferences?.[key] === true;
  } else if (role === "details" && message.type === "details") {
    snapshot = message.snapshot || null;
    $("inspector-content").hidden = !snapshot?.selected;
    if (snapshot?.room) inspector.showRoom(snapshot.room);
    else inspector.clear();
    inspector.showRoute(nativeList(snapshot?.steps), snapshot?.summary || "Select a room in Atlas.");
  } else if (message.type === "error") $("surface-status").textContent = message.error || "Atlas request failed.";
}
bridge?.onMessage(receive);
send("ready");
