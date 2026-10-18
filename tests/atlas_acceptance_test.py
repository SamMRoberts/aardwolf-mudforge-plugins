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
SPEC = importlib.util.spec_from_file_location("atlas_acceptance", ROOT / "tools/atlas-acceptance.py")
acceptance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acceptance)


class AtlasAcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.path = self.directory / "atlas.mfw"
        with contextlib.redirect_stdout(io.StringIO()):
            acceptance.make_world(self.path)
        self.before = acceptance.read_map(self.path)

    def test_fixture_has_complete_coverage_and_native_edge_cases(self):
        rooms = {room["num"]: room for room in self.before["rooms"]}
        self.assertEqual(len(rooms), 124)
        self.assertEqual(len({rooms[index]["terrain"] for index in range(10000, 10115)}), 115)
        self.assertTrue(rooms[10117]["hidden"])
        self.assertEqual([rooms[10000][k] for k in ("x", "y", "z")], [rooms[10118][k] for k in ("x", "y", "z")])
        self.assertNotIn("x", rooms[10119])
        self.assertEqual(rooms[10000]["exits"]["enter portal"], 20000)
        self.assertTrue(rooms[20002]["locked"])
        self.assertTrue(rooms[20000]["lockedExits"]["enter sealed gate"])
        self.assertEqual(rooms[20001]["weight"], 8)
        self.assertNotIn("w", rooms[10002]["exits"])
        for room in rooms.values():
            self.assertTrue(set(room["exits"].values()) <= rooms.keys())
        with zipfile.ZipFile(self.path) as archive:
            self.assertEqual(len(archive.namelist()), 4)
            world = json.loads(archive.read("world.json"))
            self.assertEqual(world["name"], acceptance.WORLD)
            self.assertEqual((world["host"], world["port"], world["autoConnect"]), ("127.0.0.1", 1, False))

    def test_large_fixture_has_10000_rooms_in_one_area(self):
        payload = acceptance.fixture(large=True)
        self.assertEqual(sum(room["zone"] == acceptance.AREA for room in payload["rooms"]), 10000)
        self.assertEqual(len({room["num"] for room in payload["rooms"]}), 10004)

    def compare(self, after):
        path = self.directory / "after.json"
        path.write_text(json.dumps(after))
        with contextlib.redirect_stdout(io.StringIO()):
            acceptance.compare(self.path, path)

    def test_comparison_allows_collection_order_but_no_map_field_changes(self):
        after = copy.deepcopy(self.before)
        after["rooms"].reverse()
        after["metadata"] = {"exportedAt": "later"}
        self.compare(after)
        for mutate in [
            lambda data: data["rooms"][0].update(notes="changed"),
            lambda data: data["rooms"][0].update(lastVisited=123),
            lambda data: data["rooms"][0]["exits"].update(e=10000),
            lambda data: data["settings"].update(zoomLevel=2),
            lambda data: data["settings"]["terrainStyles"][0].update(color="#ffffff"),
            lambda data: data["labels"][0].update(text="changed"),
            lambda data: data["extras"]["mapUserData"].update(edited="yes"),
            lambda data: data["state"].update(currentRoom=10001),
        ]:
            with self.subTest(mutate=mutate):
                candidate = copy.deepcopy(self.before)
                mutate(candidate)
                with self.assertRaises(ValueError):
                    self.compare(candidate)

    def test_archive_output_is_deterministic(self):
        other = self.directory / "other.mfw"
        with contextlib.redirect_stdout(io.StringIO()):
            acceptance.make_world(other)
        self.assertEqual(self.path.read_bytes(), other.read_bytes())


if __name__ == "__main__":
    unittest.main()
