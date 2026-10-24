"""Offline converter acceptance using real read-only SQLite and WAL databases."""

import importlib.util
import json
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "migrate-spells-storage.py"
SPEC = importlib.util.spec_from_file_location("spells_migration", SCRIPT)
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class SpellsMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = self.root / "spells.sqlite"
        self.output = self.root / "native.json"

    def tearDown(self):
        self.temporary.cleanup()

    def fixture(self, optional=True, wal=False):
        connection = sqlite3.connect(self.database)
        if wal:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.executescript("""
            CREATE TABLE metadata(id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL,
                character_name TEXT NOT NULL,collected_at INTEGER NOT NULL,entry_count INTEGER NOT NULL);
            CREATE TABLE abilities(name TEXT PRIMARY KEY COLLATE NOCASE,level INTEGER NOT NULL,
                sn INTEGER,percent INTEGER,unusable INTEGER NOT NULL,display_order INTEGER NOT NULL UNIQUE);
            INSERT INTO metadata VALUES(1,1,'Tesobi',1729980000,2);
            INSERT INTO abilities VALUES('Éclair 🐺',5,NULL,NULL,0,2);
            INSERT INTO abilities VALUES('Dirt kicking',1,61,100,1,1);
        """)
        if optional:
            connection.executescript("""
                CREATE TABLE ability_details(name TEXT PRIMARY KEY COLLATE NOCASE,kind TEXT NOT NULL,mana INTEGER);
                CREATE TABLE damage_memberships(kind TEXT NOT NULL,damage_type TEXT NOT NULL,name TEXT NOT NULL,
                    PRIMARY KEY(kind,damage_type,name));
                CREATE TABLE damage_refreshes(kind TEXT NOT NULL,damage_type TEXT NOT NULL,collected_at INTEGER NOT NULL,
                    PRIMARY KEY(kind,damage_type));
                CREATE TABLE skill_commands(name TEXT PRIMARY KEY COLLATE NOCASE,command TEXT NOT NULL);
                INSERT INTO ability_details VALUES('dirt kicking','skill',NULL);
                INSERT INTO ability_details VALUES('éclair 🐺','spell',42);
                INSERT INTO damage_memberships VALUES('skill','bash','dirt kicking');
                INSERT INTO damage_memberships VALUES('spell','electric','éclair 🐺');
                INSERT INTO damage_refreshes VALUES('skill','bash',1729979000);
                INSERT INTO damage_refreshes VALUES('spell','electric',0);
                INSERT INTO damage_refreshes VALUES('skill','special',9007199254740991);
                INSERT INTO skill_commands VALUES('dirt kicking','dirt');
            """)
        connection.commit()
        return connection

    def execute(self, sql, params=()):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(sql, params)
            connection.commit()
        finally:
            connection.close()

    def test_full_export_preserves_null_unicode_order_and_timestamps(self):
        self.fixture().close()
        before = self.database.read_bytes()
        counts = migration.export_database(self.database, self.output)
        self.assertEqual(counts, {"abilities": 2, "details": 2, "memberships": 2, "refreshes": 3, "commands": 1})
        record = json.loads(self.output.read_text())
        self.assertEqual(record["characterKey"], "tesobi")
        self.assertEqual(record["schemaVersion"], 1)
        self.assertEqual(record["snapshot"], {"schemaVersion": 1, "characterName": "Tesobi", "collectedAt": 1729980000,
                         "entries": [{"name": "Dirt kicking", "level": 1, "sn": 61, "percent": 100, "unusable": True},
                                     {"name": "Éclair 🐺", "level": 5, "unusable": False}]})
        self.assertEqual(record["damage"], {"details": {"dirt kicking": {"kind": "skill"},
                                                       "éclair 🐺": {"kind": "spell", "mana": 42}},
                         "members": {"skill:bash": {"dirt kicking": True}, "spell:electric": {"éclair 🐺": True},
                                     "skill:special": {}},
                         "times": {"skill:bash": 1729979000, "spell:electric": 0, "skill:special": 9007199254740991},
                         "commands": {"dirt kicking": "dirt"}})
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(self.database.read_bytes(), before)

    def test_legacy_snapshot_without_optional_tables(self):
        self.fixture(optional=False).close()
        self.assertEqual(migration.read_record(self.database)["damage"],
                         {"details": {}, "members": {}, "times": {}, "commands": {}})

    def test_wal_reads_committed_data_without_changing_database_or_wal(self):
        connection = self.fixture(wal=True)
        try:
            connection.execute("UPDATE metadata SET collected_at=12345")
            connection.commit()
            wal = Path(str(self.database) + "-wal")
            originals = {path: path.read_bytes() for path in (self.database, wal)}
            self.assertEqual(migration.read_record(self.database)["snapshot"]["collectedAt"], 12345)
            for path, original in originals.items():
                self.assertEqual(path.read_bytes(), original)
        finally:
            connection.close()

    def test_maximum_catalog_and_all_damage_groups(self):
        connection = self.fixture()
        try:
            connection.executescript("DELETE FROM abilities; DELETE FROM ability_details; DELETE FROM damage_memberships;"
                                     "DELETE FROM damage_refreshes; DELETE FROM skill_commands; UPDATE metadata SET entry_count=1000;")
            connection.executemany("INSERT INTO abilities VALUES(?,1,NULL,NULL,0,?)",
                                   ((f"Ability {index}", index + 1) for index in range(1000)))
            connection.executemany("INSERT INTO ability_details VALUES(?,'skill',0)",
                                   ((f"ability {index}",) for index in range(1000)))
            connection.executemany("INSERT INTO damage_refreshes VALUES(?,?,0)",
                                   ((kind, damage_type) for kind in ("skill", "spell") for damage_type in migration.TYPES))
            connection.executemany("INSERT INTO damage_memberships VALUES('skill',?,?)",
                                   ((damage_type, f"ability {index}") for damage_type in migration.TYPES for index in range(1000)))
            connection.commit()
        finally:
            connection.close()
        counts = migration.export_database(self.database, self.output)
        self.assertEqual(counts["abilities"], 1000)
        self.assertEqual(counts["memberships"], 20000)
        self.assertEqual(counts["refreshes"], 40)

    def test_no_overwrite_and_same_source_output(self):
        self.fixture().close()
        self.output.write_text("preserved")
        with self.assertRaises(migration.MigrationError):
            migration.export_database(self.database, self.output)
        self.assertEqual(self.output.read_text(), "preserved")
        before = self.database.read_bytes()
        with self.assertRaises(migration.MigrationError):
            migration.export_database(self.database, self.database)
        self.assertEqual(self.database.read_bytes(), before)

    def test_rejects_malformed_records_and_relationships(self):
        mutations = [
            "UPDATE metadata SET entry_count=3", "UPDATE metadata SET schema_version=2",
            "UPDATE metadata SET character_name=' Tesobi'", "UPDATE metadata SET character_name='Tesobi '",
            "DELETE FROM metadata", "DELETE FROM abilities", "UPDATE abilities SET display_order=3 WHERE display_order=2",
            "UPDATE abilities SET level=0", "UPDATE abilities SET sn=0", "UPDATE abilities SET percent=101",
            "UPDATE abilities SET unusable=2", "UPDATE metadata SET collected_at=-1",
            "UPDATE ability_details SET mana=-1", "UPDATE ability_details SET kind='other'",
            "UPDATE damage_memberships SET damage_type='unknown'", "DELETE FROM damage_refreshes",
            "DELETE FROM ability_details", "UPDATE damage_memberships SET kind='spell' WHERE kind='skill'",
            "UPDATE skill_commands SET command='dirt;quit'", "UPDATE skill_commands SET name='Dirt kicking'",
            "UPDATE skill_commands SET name='   '",
            "CREATE TABLE unrelated (secret TEXT)", "ALTER TABLE abilities ADD COLUMN unexpected INTEGER",
        ]
        for sql in mutations:
            with self.subTest(sql=sql):
                self.database.unlink(missing_ok=True)
                self.fixture().close()
                self.execute(sql)
                with self.assertRaises(migration.MigrationError):
                    migration.export_database(self.database, self.output)
                self.assertFalse(self.output.exists())

    def test_duplicates_casefold_and_control_characters(self):
        self.fixture().close()
        # SQLite NOCASE stops ASCII duplicates; Unicode variants still need validation.
        self.execute("UPDATE abilities SET name='éclair 🐺' WHERE display_order=1")
        with self.assertRaises(migration.MigrationError):
            migration.read_record(self.database)
        self.execute("UPDATE abilities SET name=? WHERE display_order=1", ("private\nvalue",))
        with self.assertRaises(migration.MigrationError):
            migration.read_record(self.database)

    def test_cli_requires_explicit_paths_and_reports_counts_only(self):
        self.fixture().close()
        result = subprocess.run([sys.executable, str(SCRIPT), "--database", str(self.database), "--output", str(self.output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 abilities", result.stdout)
        self.assertNotIn("Tesobi", result.stdout + result.stderr)
        result = subprocess.run([sys.executable, str(SCRIPT), "--database", str(self.database), "--output", str(self.output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Output already exists", result.stderr)
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)

    def test_missing_invalid_and_oversized_exports_leave_no_output(self):
        with self.assertRaises(migration.MigrationError):
            migration.export_database(self.database, self.output)
        self.assertFalse(self.database.exists())
        self.database.write_bytes(b"not a database with private content")
        with self.assertRaises(migration.MigrationError) as caught:
            migration.export_database(self.database, self.output)
        self.assertNotIn("private content", str(caught.exception))
        self.database.unlink()
        self.fixture().close()
        original = migration.MAX_BYTES
        migration.MAX_BYTES = 10
        try:
            with self.assertRaises(migration.MigrationError):
                migration.export_database(self.database, self.output)
        finally:
            migration.MAX_BYTES = original
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
