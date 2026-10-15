"""Make an offline test world, or compare its exported maps after pack import.

Never reads or writes the active client's storage. Uses only supplied files.
"""

import argparse
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
AREA = "Terrain Icons Acceptance"


def make_world(destination):
    registry = json.loads((ROOT / "src/map-packs/aardwolf-terrain-icons/terrains.json").read_text())
    names = [terrain["name"].lower() for terrain in registry["terrains"]] + ["acceptance-only"]
    rooms = []
    for index, name in enumerate(names):
        number = 10000 + index
        exits = {}
        for direction, offset, valid in [
            ("e", 1, index % 10 != 9), ("w", -1, index % 10 != 0),
            ("n", -10, index >= 10), ("s", 10, index + 10 < len(names)),
        ]:
            if valid and 0 <= index + offset < len(names):
                exits[direction] = number + offset
        rooms.append({"num": number, "name": name, "zone": AREA, "terrain": name,
                      "x": (index % 10) * 2, "y": -(index // 10) * 2, "z": 0,
                      "exits": exits, "notes": "Disposable terrain-pack acceptance fixture", "visited": True})
    config = {
        "settings": {
            "showVnums": False, "showBannerVnum": True, "zoomLevel": 1,
            "terrainStyles": [{"name": "default", "color": "#3498db"},
                              {"name": "inside", "color": "#ff00ff"},
                              {"name": "acceptance-only", "color": "#ff00ff"}],
            "autoSave": True, "maxRooms": 1000, "fastWalk": False,
            "customExitTimeout": 5, "walkStepDelayMs": 0, "nodeMode": True,
            "nodeLinkLength": 20, "nodeLineColor": "#ffffff",
            "recentRoomsCount": 0, "recentRoomsColor": "#ffaf00",
            "autoRecenterOnMove": False, "showCurrentAreaOnly": False,
        },
        "state": {"currentRoom": 10000, "currentLevel": 0,
                  "levels": {"0": {"rooms": {}, "currentRoom": 10000}}},
        "metadata": {"worldName": AREA}, "labels": [],
        "extras": {"envColors": {}, "knownAreas": [AREA]},
    }
    world = {"name": AREA, "formatVersion": 1, "createdAt": "2026-10-14T00:00:00.000Z",
             "host": "127.0.0.1", "port": 1, "useTLS": False, "allowSelfSignedCerts": False}
    export = {"worldName": AREA, "formatVersion": 2, "exportedAt": world["createdAt"],
              "exportedFrom": "Terrain icon acceptance fixture", "fileCount": 4,
              "options": {"includeMaps": True, "includePluginSource": False, "includeSounds": False}}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in [("world.json", world), ("maps/config.json", config), ("maps/rooms.json", rooms), ("_export.json", export)]:
            archive.writestr(name, json.dumps(value, indent=2) + "\n")
    print(f"Created {destination}: {len(rooms)} rooms; loopback only; no plugins or global settings")


def read_map(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            result = json.loads(archive.read("maps/config.json"))
            result["rooms"] = json.loads(archive.read("maps/rooms.json"))
            return result
    return json.loads(Path(path).read_text())


def compare(before_path, after_path):
    before, after = read_map(before_path), read_map(after_path)
    def rooms(value):
        entries = value["rooms"]
        if isinstance(entries, dict):
            entries = entries.values()
        return sorted(entries, key=lambda room: room["num"])
    if len(rooms(before)) != 115 or rooms(before) != rooms(after):
        raise ValueError("Room records or exits changed, or fixture is incomplete")
    for field in ["labels", "extras"]:
        if before.get(field) != after.get(field):
            raise ValueError(f"Map {field} changed")
    def other_settings(value):
        return {key: item for key, item in value["settings"].items() if key != "terrainStyles"}
    if other_settings(before) != other_settings(after):
        raise ValueError("Map settings outside terrain styles changed")
    pack = json.loads((ROOT / "dist/map-packs/aardwolf-terrain-icons.json").read_text())
    styles = after["settings"]["terrainStyles"]
    if styles != pack["terrainStyles"]:
        raise ValueError("Exported terrain styles differ from the pack")
    print("PASS: all 115 room records and exits preserved; labels/extras preserved; all 114 styles match")
    if not any(style["name"] == "acceptance-only" for style in styles):
        print("Importer replaces the terrain-style list: the unmatched sentinel style was removed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("make")
    make.add_argument("output", type=Path)
    check = commands.add_parser("compare")
    check.add_argument("before", type=Path)
    check.add_argument("after", type=Path)
    args = parser.parse_args()
    if args.command == "make":
        make_world(args.output)
    else:
        compare(args.before, args.after)


if __name__ == "__main__":
    main()
