import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("terrain_acceptance", ROOT / "tools/terrain_acceptance.py")
acceptance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acceptance)


class TerrainAcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.world = self.directory / "fixture.mfw"
        with contextlib.redirect_stdout(io.StringIO()):
            acceptance.make_world(self.world)
        self.before = acceptance.read_map(self.world)
        self.after = copy.deepcopy(self.before)
        pack = json.loads((ROOT / "dist/map-packs/aardwolf-terrain-icons.json").read_text())
        self.after["settings"]["terrainStyles"] = pack["terrainStyles"]

    def check_exports(self):
        before = self.directory / "before.json"
        after = self.directory / "after.json"
        before.write_text(json.dumps(self.before))
        after.write_text(json.dumps(self.after))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            acceptance.compare(before, after)
        return output.getvalue()

    def test_fixture_is_complete_and_contains_only_local_test_data(self):
        with zipfile.ZipFile(self.world) as archive:
            self.assertEqual(set(archive.namelist()), {"world.json", "_export.json", "maps/rooms.json", "maps/config.json"})
            world = json.loads(archive.read("world.json"))
            self.assertEqual((world["host"], world["port"]), ("127.0.0.1", 1))
            self.assertEqual(json.loads(archive.read("_export.json"))["worldName"], acceptance.AREA)
        rooms = self.before["rooms"]
        self.assertEqual(len(rooms), 115)
        self.assertEqual(len({room["terrain"] for room in rooms}), 115)
        self.assertEqual(rooms[-1]["terrain"], "acceptance-only")
        numbers = {room["num"] for room in rooms}
        for room in rooms:
            self.assertTrue(set(room["exits"].values()) <= numbers)

    def test_comparison_accepts_terrain_style_replacement(self):
        output = self.check_exports()
        styles = self.after["settings"]["terrainStyles"]
        self.assertEqual(len(styles), 117)
        self.assertIn(f"all {len(styles)} styles match", output)

    def test_comparison_requires_named_vendor_styles_without_automatic_variants(self):
        styles = self.after["settings"]["terrainStyles"]
        shop = next(style for style in styles if style["name"] == "shop")
        valid = copy.deepcopy(styles)
        for name in ["shop-merchant", "shop-apothecary", "shop-smith"]:
            vendor = next(style for style in valid if style["name"] == name)
            self.assertNotIn("variants", vendor)
            self.assertNotIn(vendor["image"], shop["variants"])
            with self.subTest(missing=name):
                self.after["settings"]["terrainStyles"] = [style for style in valid if style["name"] != name]
                with self.assertRaisesRegex(ValueError, "terrain styles differ"):
                    self.check_exports()

    def test_comparison_rejects_changed_or_missing_shop_variants(self):
        shop = next(style for style in self.after["settings"]["terrainStyles"] if style["name"] == "shop")
        original = copy.deepcopy(shop)
        self.assertEqual(len(shop["variants"]), 10)
        for change in ["missing", "empty", "reordered", "truncated", "base"]:
            with self.subTest(change=change):
                shop.clear()
                shop.update(copy.deepcopy(original))
                if change == "missing":
                    shop.pop("variants")
                elif change == "empty":
                    shop["variants"][1] = ""
                elif change == "reordered":
                    shop["variants"].reverse()
                elif change == "truncated":
                    shop["variants"].pop()
                else:
                    shop["image"] = ""
                with self.assertRaisesRegex(ValueError, "terrain styles differ"):
                    self.check_exports()

    def test_comparison_rejects_room_exit_settings_and_image_changes(self):
        valid = copy.deepcopy(self.after)
        changes = [
            lambda value: value["rooms"][0]["exits"].update(e=99999),
            lambda value: value["rooms"][0].update(notes="overwritten"),
            lambda value: value["settings"].update(zoomLevel=2),
            lambda value: value["labels"].append({"text": "unexpected"}),
            lambda value: value["settings"]["terrainStyles"][0].update(image=""),
        ]
        for index, change in enumerate(changes):
            with self.subTest(change=index):
                self.after = copy.deepcopy(valid)
                change(self.after)
                with self.assertRaises(ValueError):
                    self.check_exports()


if __name__ == "__main__":
    unittest.main()
