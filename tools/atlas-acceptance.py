"""Create an offline Atlas acceptance world or strictly compare native map exports.

Only supplied files are read/written. This tool never accesses live client storage.
Use a native export AFTER importing/setup as the before baseline: MudForge may
normalize fields or assign import visit timestamps. No room fields, map settings,
labels, extras, or mapper state are ignored by comparison. Export-envelope data
(exportedAt, world metadata, ZIP entry dates, plugin sources/preferences) is outside
the map comparison. Room/label collection ordering is immaterial.
"""

import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORLD = "Atlas Disposable Acceptance"
AREA = "Atlas Terrain Gallery"
SECOND_AREA = "Atlas Portal Annex"
START = 10000
ANNEX = 20000
STAMP = "2026-10-18T00:00:00.000Z"


def fixture(large=False):
    registry = json.loads((ROOT / "src/map-packs/aardwolf-terrain-icons/terrains.json").read_text())
    names = [entry["name"].strip().lower() for entry in registry["terrains"]]
    if len(names) != 114 or len(set(names)) != 114:
        raise ValueError("Expected the complete 114-key terrain registry")
    names.append("atlas-unknown-terrain")
    rooms = []
    for index, terrain in enumerate(names):
        number = START + index
        exits = {}
        for direction, offset, valid in [
            ("e", 1, index % 12 != 11), ("w", -1, index % 12 != 0),
            ("n", -12, index >= 12), ("s", 12, index + 12 < len(names)),
        ]:
            if valid and 0 <= index + offset < len(names):
                exits[direction] = number + offset
        rooms.append({"num": number, "name": f"Terrain {terrain}", "zone": AREA,
                      "terrain": terrain, "x": (index % 12) * 2, "y": (index // 12) * 2,
                      "z": 0, "exits": exits, "notes": "Illustrative terrain acceptance room",
                      "details": "Native coordinates: east +X; south +Y; floors +Z.", "visited": True})
    for offset, name, coordinates, terrain in [
        (115, "Upper gallery", (0, 0, 1), " Mudschool "),
        (116, "Lower gallery", (2, 0, -1), "7"),
        (117, "Hidden room sentinel", (4, 0, 0), "inside"),
        (118, "Overlapping room sentinel", (0, 0, 0), "forest"),
        (119, "Unpositioned room sentinel", None, "default"),
    ]:
        room = {"num": START + offset, "name": name, "zone": AREA, "terrain": terrain,
                "exits": {"return to gallery": START}, "visited": True}
        if coordinates is not None:
            room.update(zip(("x", "y", "z"), coordinates))
        rooms.append(room)
    rooms[0]["exits"].update({"u": 10115, "d": 10116, "enter portal": ANNEX, "inspect alcove": 10118})
    rooms[0].update({"symbol": "A", "symbolColor": "#ffd166", "flags": ["atlas-fixture"],
                     "userData": {"atlas": "preserve this exact value"},
                     "notes": "<b>Literal text, not markup</b> & \"quoted\"", "color": "#6a5c9a"})
    rooms[1]["doors"] = {"e": 2}
    rooms[1]["exits"]["enter mist"] = 10117
    rooms[2]["exits"].pop("w", None)  # Directed edge: 10001 -> 10002 only.
    rooms[115]["exits"] = {"d": START}
    rooms[116]["exits"] = {"u": START}
    rooms[117]["hidden"] = True
    if large:
        for index in range(120, 10000):
            rooms.append({"num": START + index, "name": f"Load room {index}", "zone": AREA,
                          "terrain": names[index % 114], "x": (index % 100) * 2,
                          "y": 30 + (index // 100) * 2, "z": 0,
                          "exits": {"e": START + index + 1} if index < 9999 else {}, "visited": True})
    rooms.extend([
        {"num": ANNEX, "name": "Portal arrival", "zone": SECOND_AREA, "terrain": "inside", "x": 0, "y": 0, "z": 2,
         "exits": {"e": ANNEX + 1, "s": ANNEX + 2, "enter sealed gate": ANNEX + 3, "return portal": START},
         "lockedExits": {"enter sealed gate": True}, "doors": {"s": 3}, "visited": True},
        {"num": ANNEX + 1, "name": "Weighted destination", "zone": SECOND_AREA, "terrain": "city", "x": 2, "y": 0, "z": 2,
         "weight": 8, "exits": {"w": ANNEX}, "visited": True},
        {"num": ANNEX + 2, "name": "Locked destination", "zone": SECOND_AREA, "terrain": "inside", "x": 0, "y": 2, "z": 2,
         "locked": True, "exits": {"n": ANNEX}, "visited": True},
        {"num": ANNEX + 3, "name": "Exit-lock destination", "zone": SECOND_AREA, "terrain": "inside", "x": 2, "y": 2, "z": 2,
         "exits": {}, "visited": True},
    ])
    return {"rooms": rooms, "settings": {
        "showVnums": True, "showBannerVnum": True, "zoomLevel": 1,
        "terrainStyles": [{"name": "default", "color": "#63766a"},
                          {"name": "atlas-unknown-terrain", "color": "#ff00ff"}],
        "autoSave": True, "maxRooms": 20000, "fastWalk": False, "customExitTimeout": 5,
        "walkStepDelayMs": 0, "nodeMode": True, "nodeLinkLength": 20, "nodeLineColor": "#ffffff",
        "recentRoomsCount": 0, "recentRoomsColor": "#ffaf00", "autoRecenterOnMove": False, "showCurrentAreaOnly": False,
    }, "state": {"currentRoom": START, "currentLevel": 0,
                  "levels": {"0": {"rooms": {}, "currentRoom": START}}},
        "labels": [{"id": "atlas-sentinel-label", "area": AREA, "x": 0, "y": -2, "z": 0,
                    "text": "Preserve native label", "fgColor": "#ffcc88", "fontSize": 12}],
        "extras": {"knownAreas": [AREA, SECOND_AREA], "envColors": {"7": "#a0c0e0"},
                   "flagDefs": {"atlas-fixture": {"name": "atlas-fixture", "color": "#789e8a", "symbol": "F"}},
                   "areaUserData": {AREA: {"purpose": "read-only acceptance"}},
                   "mapUserData": {"atlas-sentinel": "must survive unchanged"}}}


def make_world(destination, large=False):
    payload = fixture(large)
    world = {"name": WORLD, "formatVersion": 1, "createdAt": STAMP,
             "host": "127.0.0.1", "port": 1, "useTLS": False, "allowSelfSignedCerts": False,
             "autoConnect": False}
    # autoConnect is a native session/world connection property, verified in the
    # installed client bundle. Opening a world must still be checked in the UI.
    export = {"worldName": WORLD, "formatVersion": 2, "exportedAt": STAMP,
              "exportedFrom": "Atlas acceptance fixture", "fileCount": 4,
              "options": {"includeMaps": True, "includePluginSource": False, "includeSounds": False}}
    config = {key: value for key, value in payload.items() if key != "rooms"}
    config["metadata"] = {"worldName": WORLD}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in [("world.json", world), ("maps/config.json", config),
                            ("maps/rooms.json", payload["rooms"]), ("_export.json", export)]:
            entry = zipfile.ZipInfo(name, date_time=(2026, 10, 18, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, json.dumps(value, indent=2, ensure_ascii=True) + "\n")
    print(f"Created {destination}: {len(payload['rooms'])} rooms, 2 areas; autoConnect=false; loopback only")


def read_map(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            payload = json.loads(archive.read("maps/config.json"))
            payload["rooms"] = json.loads(archive.read("maps/rooms.json"))
            return payload
    return json.loads(Path(path).read_text())


def ordered(value, field, identity):
    if isinstance(value, dict):
        value = list(value.values())
    if not isinstance(value, list) or any(not isinstance(item, dict) or identity not in item for item in value):
        raise ValueError(f"Invalid {field} collection")
    identities = [str(item[identity]) for item in value]
    if len(set(identities)) != len(identities):
        raise ValueError(f"Duplicate identities in {field}")
    return sorted(value, key=lambda item: str(item[identity]))


def compare(before_path, after_path):
    before, after = read_map(before_path), read_map(after_path)
    for field in ["rooms", "settings", "labels", "extras", "state"]:
        if field not in before or field not in after:
            raise ValueError(f"Both exports must include map {field}")
        left, right = before[field], after[field]
        if field in ("rooms", "labels"):
            left = ordered(left, field, "num" if field == "rooms" else "id")
            right = ordered(right, field, "num" if field == "rooms" else "id")
        if left != right:
            raise ValueError(f"Map {field} changed; Atlas preservation acceptance failed")
    if len(ordered(before["rooms"], "rooms", "num")) < 124:
        raise ValueError("Baseline is incomplete: expected at least 124 acceptance rooms")
    print("PASS: complete room records, settings, labels, extras and mapper state unchanged")
    print("Only export-envelope metadata and collection order were excluded; no map fields were ignored")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("make")
    make.add_argument("output", type=Path)
    make.add_argument("--large", action="store_true", help="10,000-room gallery plus four annex rooms")
    check = commands.add_parser("compare")
    check.add_argument("before", type=Path)
    check.add_argument("after", type=Path)
    args = parser.parse_args()
    if args.command == "make":
        make_world(args.output, args.large)
    else:
        compare(args.before, args.after)


if __name__ == "__main__":
    main()
