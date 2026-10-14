"""Real SQLite and filesystem acceptance for the local helper (no MudForge)."""

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from tools.sqlite_helper import (
    BridgeError, Helper, MAX_BYTES, decode_cell, encode_cell, load_aliases,
    now_ms, publish, read_json,
)


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name).resolve()
        self.root = self.directory / "bridge"
        self.helper = Helper(self.root)
        self.helper.acquire()
        self.counter = 0

    def tearDown(self):
        self.helper.close()
        self.temporary.cleanup()

    def request(self, kind="open", statements=None, selection=None, owner=None):
        self.counter += 1
        return {
            "version": 1, "id": "request-" + str(self.counter),
            "generation": self.helper.generation, "expiresAt": now_ms() + 10000,
            "namespace": owner or {"pluginId": "fixture", "characterKey": "character"},
            "database": selection or {"kind": "managed", "name": "records"},
            "operation": kind, "statements": statements or [],
        }

    def sql(self, sql, params=(), kind="execute"):
        return {"kind": kind, "sql": sql, "params": [encode_cell(value) for value in params]}

    def execute(self, sql, params=()):
        return self.helper.perform(self.request("execute", [self.sql(sql, params)]))

    def query(self, sql, params=()):
        result = self.helper.perform(self.request("query", [self.sql(sql, params, "query")]))
        return result["columns"], [[decode_cell(cell) for cell in row] for row in result["rows"]]

    def test_crud_types_schema_and_persistence(self):
        self.assertEqual(self.helper.perform(self.request()), {"opened": True})
        self.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT, data BLOB, n INTEGER, x REAL)")
        result = self.execute("INSERT INTO records (name, data, n, x) VALUES (?, ?, ?, ?)",
                              ("quoted '\"\0 🐺", b"\x00\xff", 9223372036854775807, 1.25))
        self.assertEqual(result["changes"], 1)
        self.assertEqual(decode_cell(result["lastInsertId"]), 1)
        self.assertEqual(self.query("SELECT name, data, n, x FROM records")[1],
                         [["quoted '\"\0 🐺", b"\x00\xff", 9223372036854775807, 1.25]])
        self.execute("UPDATE records SET name = ? WHERE id = ?", (None, 1))
        self.assertEqual(self.query("SELECT name, id, id FROM records"), (["name", "id", "id"], [[None, 1, 1]]))
        self.execute("ALTER TABLE records ADD COLUMN extra TEXT")
        path = next((self.root / "databases").glob("*/*.sqlite"))
        with closing(sqlite3.connect(path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM records").fetchone()[0], 1)
        self.execute("DELETE FROM records WHERE id = ?", (1,))
        self.assertEqual(self.query("SELECT * FROM records")[1], [])
        self.execute("DROP TABLE records")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_parameter_binding_never_executes_data(self):
        self.execute("CREATE TABLE records (value TEXT)")
        value = "'); DROP TABLE records; --"
        self.execute("INSERT INTO records VALUES (?)", (value,))
        self.assertEqual(self.query("SELECT value FROM records")[1], [[value]])

    def test_atomic_transaction_and_rollback(self):
        self.execute("CREATE TABLE records (id INTEGER PRIMARY KEY)")
        result = self.helper.perform(self.request("transaction", [
            self.sql("INSERT INTO records VALUES (?)", (1,)),
            self.sql("SELECT id FROM records", kind="query"),
        ]))
        self.assertEqual(decode_cell(result["results"][1]["rows"][0][0]), 1)
        with self.assertRaises(BridgeError) as error:
            self.helper.perform(self.request("transaction", [
                self.sql("INSERT INTO records VALUES (2)"), self.sql("INSERT INTO records VALUES (1)"),
            ]))
        self.assertEqual(error.exception.outcome, "rolled_back")
        self.assertEqual(self.query("SELECT id FROM records")[1], [[1]])

    def test_schema_changes_roll_back_and_foreign_keys_are_enforced(self):
        with self.assertRaises(BridgeError):
            self.helper.perform(self.request("transaction", [self.sql("CREATE TABLE records (n INTEGER)"),
                                                            self.sql("INSERT INTO missing VALUES (1)")]))
        self.assertEqual(self.query("SELECT name FROM sqlite_schema WHERE name='records'")[1], [])
        self.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
        self.execute("CREATE TABLE child (id INTEGER REFERENCES parent(id))")
        with self.assertRaises(BridgeError):
            self.execute("INSERT INTO child VALUES (123)")

    def test_plugin_and_character_isolation(self):
        self.execute("CREATE TABLE records (value TEXT)")
        for owner in ({"pluginId": "other", "characterKey": "character"},
                      {"pluginId": "fixture", "characterKey": "other"}):
            self.helper.perform(self.request(owner=owner))
            with self.assertRaises(BridgeError):
                self.helper.perform(self.request("query", [self.sql("SELECT * FROM records", kind="query")], owner=owner))
        self.assertEqual(len(list((self.root / "databases").glob("*/*.sqlite"))), 3)

    def test_registered_files_modes_namespaces_and_missing_files(self):
        external = self.directory / "existing.sqlite"
        with closing(sqlite3.connect(external)) as connection:
            connection.execute("CREATE TABLE records (n INTEGER)")
        config = self.directory / "aliases.json"
        owner = {"pluginId": "fixture", "characterKey": "character"}
        publish(config, {"aliases": {"existing": {"path": str(external), "mode": "ro", "namespaces": [owner]}}})
        self.helper.aliases = load_aliases(config)
        selection = {"kind": "alias", "name": "existing"}
        self.helper.perform(self.request(selection=selection))
        with self.assertRaises(BridgeError):
            self.helper.perform(self.request("execute", [self.sql("INSERT INTO records VALUES (1)")], selection))
        self.helper.aliases["existing"]["mode"] = "rw"
        self.helper.perform(self.request("execute", [self.sql("INSERT INTO records VALUES (1)")], selection))
        with self.assertRaises(BridgeError) as refused:
            self.helper.perform(self.request(selection=selection, owner={"pluginId": "other", "characterKey": "character"}))
        self.assertEqual(refused.exception.code, "alias_refused")
        external.unlink()
        with self.assertRaises(BridgeError) as missing:
            self.helper.perform(self.request(selection=selection))
        self.assertEqual(missing.exception.code, "database_missing")
        self.assertFalse(external.exists())

    def test_sql_boundary_and_readonly_queries(self):
        self.execute("CREATE TABLE records (n INTEGER)")
        for sql in ("ATTACH ':memory:' AS escape", "DETACH escape", "PRAGMA writable_schema=ON",
                    "BEGIN", "COMMIT", "SAVEPOINT escape", "VACUUM INTO 'escape.sqlite'",
                    "SELECT load_extension('escape')", "INSERT INTO records VALUES (1); DELETE FROM records"):
            with self.subTest(sql=sql), self.assertRaises(BridgeError):
                self.execute(sql)
        with self.assertRaises(BridgeError):
            self.query("INSERT INTO records VALUES (1) RETURNING n")
        self.assertEqual(self.query("SELECT * FROM records")[1], [])

    def test_row_message_batch_and_deadline_limits(self):
        with self.assertRaises(BridgeError) as error:
            self.query("WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<1001) SELECT n FROM x")
        self.assertEqual(error.exception.code, "row_limit")
        with self.assertRaises(BridgeError) as error:
            self.query("SELECT hex(zeroblob(300000)) UNION ALL SELECT hex(zeroblob(300000))")
        self.assertEqual(error.exception.code, "message_limit")
        with self.assertRaises(BridgeError) as error:
            self.query("SELECT zeroblob(2000000)")
        self.assertEqual(error.exception.code, "sqlite_toobig")
        with self.assertRaises(BridgeError):
            self.helper.perform(self.request("transaction", [self.sql("SELECT 1")] * 101))
        request = self.request("query", [self.sql(
            "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x) SELECT sum(n) FROM x", kind="query")])
        request["expiresAt"] = now_ms() + 50
        start = time.monotonic()
        with self.assertRaises(BridgeError) as error:
            self.helper.perform(request)
        self.assertLess(time.monotonic() - start, 1)
        self.assertEqual(error.exception.outcome, "rolled_back")

    def test_database_lock_timeout(self):
        self.execute("CREATE TABLE records (n INTEGER)")
        path = next((self.root / "databases").glob("*/*.sqlite"))
        connection = sqlite3.connect(path)
        try:
            connection.execute("BEGIN EXCLUSIVE")
            start = time.monotonic()
            with self.assertRaises(BridgeError) as error:
                self.execute("INSERT INTO records VALUES (1)")
            self.assertEqual(error.exception.code, "sqlite_busy")
            self.assertGreaterEqual(time.monotonic() - start, 1.8)
            self.assertLess(time.monotonic() - start, 3)
        finally:
            connection.close()

    def test_expired_wrong_generation_and_invalid_requests_create_no_database(self):
        for modification in ({"expiresAt": 0}, {"generation": "old"}, {"version": 99},
                             {"database": {"kind": "managed", "name": "../escape"}},
                             {"namespace": {"pluginId": "fixture", "characterKey": ""}},
                             {"operation": "unknown"}):
            request = self.request()
            request.update(modification)
            with self.assertRaises(BridgeError):
                self.helper.perform(request)
        self.assertEqual(list((self.root / "databases").iterdir()), [])

    def test_file_bridge_duplicate_receipts_and_crash_recovery(self):
        self.execute("CREATE TABLE records (n INTEGER)")
        request = self.request("execute", [self.sql("INSERT INTO records VALUES (1)")])
        incoming = self.root / "requests" / (request["id"] + ".json")
        publish(incoming, request)
        self.helper.process_once()
        response = read_json(self.root / "responses" / incoming.name)
        self.assertEqual(response["id"], request["id"])
        self.assertEqual(response["result"]["changes"], 1)
        publish(incoming, request)
        self.helper.process_once()
        self.assertEqual(self.query("SELECT * FROM records")[1], [[1]])
        interrupted = self.request("execute", [self.sql("INSERT INTO records VALUES (2)")])
        publish(self.root / "processing" / (interrupted["id"] + ".json"), interrupted)
        self.helper.close()
        self.helper = Helper(self.root)
        self.helper.acquire()
        response = read_json(self.root / "responses" / (interrupted["id"] + ".json"))
        self.assertEqual(response["generation"], interrupted["generation"])
        self.assertEqual(response["error"]["outcome"], "unknown")
        self.assertEqual(self.query("SELECT * FROM records")[1], [[1]])

    def test_publish_failure_does_not_replay_committed_write(self):
        self.execute("CREATE TABLE records (n INTEGER)")
        request = self.request("execute", [self.sql("INSERT INTO records VALUES (1)")])
        filename = request["id"] + ".json"
        publish(self.root / "requests" / filename, request)
        with patch.object(self.helper, "respond", side_effect=OSError()):
            self.helper.process_once()
        self.assertTrue((self.root / "processing" / filename).exists())
        self.assertEqual(self.query("SELECT * FROM records")[1], [[1]])
        self.helper.close()
        self.helper = Helper(self.root)
        self.helper.acquire()
        self.assertEqual(read_json(self.root / "responses" / filename)["error"]["outcome"], "unknown")
        self.assertEqual(self.query("SELECT * FROM records")[1], [[1]])

    def test_recovery_preserves_an_already_published_success_receipt(self):
        request = self.request()
        filename = request["id"] + ".json"
        publish(self.root / "processing" / filename, request)
        self.helper.respond(request["id"], request["generation"], result={"opened": True})
        self.helper.close()
        self.helper = Helper(self.root)
        self.helper.acquire()
        response = read_json(self.root / "responses" / filename)
        self.assertEqual(response["result"], {"opened": True})
        self.assertFalse((self.root / "processing" / filename).exists())

    def test_single_helper_and_symlink_paths(self):
        second = Helper(self.root)
        with self.assertRaises(BridgeError):
            second.acquire()
        self.assertEqual((self.root / "requests").stat().st_mode & 0o777, 0o700)
        link = self.directory / "link"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(BridgeError):
            Helper(link)
        self.execute("CREATE TABLE records (n INTEGER)")
        path = next((self.root / "databases").glob("*/*.sqlite"))
        path.unlink()
        path.symlink_to(self.directory / "outside.sqlite")
        with self.assertRaises(BridgeError):
            self.helper.perform(self.request())

    def test_malformed_and_oversized_json(self):
        for name, content in (("bad", "{not json"), ("big", " " * (MAX_BYTES + 1))):
            path = self.root / "requests" / (name + ".json")
            path.write_text(content)
            self.helper.process_once()
            self.assertIn("error", read_json(self.root / "responses" / path.name))

    def test_pruning_old_receipts(self):
        old = self.root / "responses" / "old.json"
        publish(old, {})
        import os
        os.utime(old, (time.time() - 90000, time.time() - 90000))
        self.helper.prune()
        self.assertFalse(old.exists())

    def test_untrusted_parameter_and_namespace_edge_cases(self):
        values = ({"type": "real", "value": 10**1000}, {"type": "real", "value": float("inf")},
                  {"type": "blob", "value": "invalid"}, {"type": "integer", "value": "9223372036854775808"},
                  {"type": "integer", "value": "01"}, {"type": "null", "value": "extra"})
        for value in values:
            with self.subTest(value=value), self.assertRaises(BridgeError):
                decode_cell(value)
        for modification in ({"expiresAt": 10**1000},
                             {"namespace": {"pluginId": "fixture", "characterKey": "\ud800"}}):
            request = self.request()
            request.update(modification)
            with self.assertRaises(BridgeError):
                self.helper.perform(request)
        self.execute("CREATE TABLE records (value TEXT)")
        with self.assertRaises(BridgeError) as error:
            self.execute("INSERT INTO records VALUES (?)", ("\ud800",))
        self.assertEqual(error.exception.outcome, "rolled_back")
        self.assertEqual(self.query("SELECT * FROM records")[1], [])

    def test_symlink_mailbox_and_sqlite_sidecars_are_refused(self):
        outside = self.directory / "outside.json"
        publish(outside, {"untouched": True})
        incoming = self.root / "requests" / "symlink.json"
        incoming.symlink_to(outside)
        self.helper.process_once()
        self.assertEqual(read_json(outside), {"untouched": True})
        self.assertTrue(incoming.is_symlink())
        self.assertEqual(read_json(self.root / "responses" / incoming.name)["error"]["code"], "path_refused")
        self.execute("CREATE TABLE records (n INTEGER)")
        database = next((self.root / "databases").glob("*/*.sqlite"))
        Path(str(database) + "-journal").symlink_to(outside)
        with self.assertRaises(BridgeError):
            self.execute("INSERT INTO records VALUES (1)")
        self.assertEqual(read_json(outside), {"untouched": True})


if __name__ == "__main__":
    unittest.main()
