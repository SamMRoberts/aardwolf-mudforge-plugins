import { terrainKey, exitEntries } from "./model.js";
export function createInspector(document, assets, navigate) {
  const $ = (id) => document.getElementById(id);
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
  function clear() {
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

  function showRoute(steps, summary) {
    $("route-summary").textContent = summary;
    $("route-steps").replaceChildren(...steps.map((step, index) => {
      const item = document.createElement("li");
      if (step.hidden) item.textContent = `${index + 1}. ${step.direction || "Move"} · hidden room`;
      else {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${step.direction || "Start"} · ${step.name || `#${step.roomId}`} · ${step.areaId || "Unassigned"} / Z ${step.z ?? "?"}`;
        button.addEventListener("click", () => navigate(index));
        item.append(button);
      }
      return item;
    }));
  }
  return { clear, showRoom, showRoute };
}
