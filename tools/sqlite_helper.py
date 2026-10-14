#!/usr/bin/env python3
"""Local file bridge for aardwolf-api. Never replay an interrupted request."""

import argparse
import base64
import binascii
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time
import uuid

VERSION = 1
MAX_BYTES = 1024 * 1024
MAX_ROWS = 1000
SAFE_INTEGER = 2**53 - 1
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,200}\Z")


class BridgeError(Exception):
    def __init__(self, code, message, outcome="rejected"):
        super().__init__(message)
        self.code, self.message, self.outcome = code, message, outcome

    def value(self):
        return {"code": self.code, "message": self.message, "outcome": self.outcome}


def now_ms():
    return int(time.time() * 1000)


def safe_path(path):
    """Reject symlinks at every existing component, including broken links."""
    path = Path(os.path.abspath(Path(path).expanduser()))
    for component in (path, *path.parents):
        if component.is_symlink():
            raise BridgeError("path_refused", "A filesystem path is not permitted.")
    return path


def read_json(path):
    path = safe_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise BridgeError("invalid_message", "The message is not a regular file.")
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise BridgeError("message_limit", "The message exceeds the size limit.")
    try:
        return json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise BridgeError("invalid_message", "The message is not valid JSON.") from None


def publish(path, value):
    path = safe_path(path)
    data = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
    if len(data) > MAX_BYTES:
        raise BridgeError("message_limit", "The response exceeds the size limit.")
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def namespace(value):
    if not isinstance(value, dict) or set(value) != {"pluginId", "characterKey"}:
        raise BridgeError("invalid_namespace", "A plugin and character namespace is required.")
    for item in value.values():
        if not isinstance(item, str) or "\0" in item:
            raise BridgeError("invalid_namespace", "A namespace identifier is invalid.")
        try:
            valid = 1 <= len(item.encode("utf-8")) <= 128
        except UnicodeError:
            valid = False
        if not valid:
            raise BridgeError("invalid_namespace", "A namespace identifier is invalid.")
    return value["pluginId"], value["characterKey"]


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise BridgeError("invalid_database", "A database identifier is invalid.")
    return value


def encode_cell(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, bytes):
        return {"type": "blob", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise BridgeError("unsupported_value", "A result contains a non-finite number.")
        return {"type": "real", "value": value}
    if isinstance(value, str):
        return {"type": "text", "value": value}
    raise BridgeError("unsupported_value", "A result contains an unsupported value.")


def decode_cell(cell):
    if not isinstance(cell, dict):
        raise BridgeError("invalid_parameter", "A parameter is invalid.")
    kind, value = cell.get("type"), cell.get("value")
    if kind == "null" and set(cell) == {"type"}:
        return None
    if set(cell) != {"type", "value"}:
        raise BridgeError("invalid_parameter", "A parameter is invalid.")
    if kind == "text" and isinstance(value, str):
        return value
    if kind == "integer" and isinstance(value, str) and re.fullmatch(r"-?(0|[1-9][0-9]{0,18})", value):
        number = int(value)
        if -(2**63) <= number < 2**63:
            return number
    if kind == "real" and type(value) in (int, float) and abs(value) <= sys.float_info.max and math.isfinite(value):
        return value
    if kind == "blob" and isinstance(value, str):
        try:
            return base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error):
            pass
    raise BridgeError("invalid_parameter", "A parameter is invalid.")


def statement(value):
    if not isinstance(value, dict) or set(value) != {"kind", "sql", "params"}:
        raise BridgeError("invalid_statement", "A statement is invalid.")
    if value["kind"] not in ("query", "execute"):
        raise BridgeError("invalid_statement", "A statement kind is invalid.")
    sql = value["sql"]
    if not isinstance(sql, str) or not sql.strip() or "\0" in sql:
        raise BridgeError("invalid_statement", "SQL must be nonempty text without NUL.")
    params = value["params"]
    # MudForge encodes an empty Lua table as {}, rather than [].
    if params == {}:
        params = []
    if not isinstance(params, list) or len(params) > 1000:
        raise BridgeError("invalid_parameter", "A parameter list is invalid.")
    return value["kind"], sql, [decode_cell(cell) for cell in params]


WRITE_ACTIONS = {
    sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE,
    sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_CREATE_TRIGGER,
    sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_DROP_TABLE,
    sqlite3.SQLITE_DROP_TRIGGER, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_ALTER_TABLE,
    sqlite3.SQLITE_REINDEX, sqlite3.SQLITE_ANALYZE, sqlite3.SQLITE_CREATE_VTABLE,
    sqlite3.SQLITE_DROP_VTABLE, sqlite3.SQLITE_CREATE_TEMP_INDEX, sqlite3.SQLITE_CREATE_TEMP_TABLE,
    sqlite3.SQLITE_CREATE_TEMP_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_VIEW,
    sqlite3.SQLITE_DROP_TEMP_INDEX, sqlite3.SQLITE_DROP_TEMP_TABLE,
    sqlite3.SQLITE_DROP_TEMP_TRIGGER, sqlite3.SQLITE_DROP_TEMP_VIEW,
}
BLOCKED_ACTIONS = {
    sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_PRAGMA,
    sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_SAVEPOINT,
}


class Helper:
    def __init__(self, root, aliases=None):
        self.root = safe_path(root)
        self.aliases = aliases or {}
        self.generation = uuid.uuid4().hex
        self.lock = None
        self.heartbeat_at = 0

    def acquire(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        lock_path = safe_path(self.root / "helper.lock")
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(descriptor)
            raise BridgeError("helper_running", "A helper already owns this bridge directory.") from None
        self.lock = descriptor
        for folder in ("requests", "processing", "responses", "databases"):
            path = safe_path(self.root / folder)
            path.mkdir(mode=0o700, exist_ok=True)
            os.chmod(path, 0o700)
        # A crash between commit and response cannot be distinguished from a
        # crash before commit. Preserve that uncertainty; never run it again.
        for path in (self.root / "processing").glob("*.json"):
            if REQUEST_ID.fullmatch(path.stem):
                try:
                    request = read_json(path)
                    receipt = self.root / "responses" / path.name
                    recorded = None
                    try:
                        recorded = read_json(receipt)
                    except (OSError, BridgeError):
                        pass
                    if not (isinstance(recorded, dict) and recorded.get("version") == VERSION
                            and recorded.get("id") == path.stem
                            and recorded.get("generation") == request.get("generation")):
                        self.respond(path.stem, request.get("generation"), problem=BridgeError(
                            "interrupted", "The helper was interrupted; the operation outcome is unknown.", "unknown"))
                    safe_path(path).unlink()
                except (OSError, BridgeError, AttributeError):
                    continue
        self.heartbeat()

    def close(self):
        if self.lock is not None:
            os.close(self.lock)
            self.lock = None

    def heartbeat(self):
        publish(self.root / "heartbeat.json", {
            "version": VERSION, "generation": self.generation, "time": now_ms(),
        })
        self.heartbeat_at = time.monotonic()

    def database(self, selection, owner):
        if not isinstance(selection, dict) or set(selection) != {"kind", "name"}:
            raise BridgeError("invalid_database", "A database selection is invalid.")
        name = identifier(selection["name"])
        if selection["kind"] == "managed":
            key = hashlib.sha256(json.dumps(owner, separators=(",", ":")).encode()).hexdigest()
            directory = safe_path(self.root / "databases" / key)
            directory.mkdir(mode=0o700, exist_ok=True)
            return safe_path(directory / (name + ".sqlite")), False, True
        if selection["kind"] != "alias" or name not in self.aliases:
            raise BridgeError("alias_refused", "The database alias is not registered.")
        alias = self.aliases[name]
        if owner not in alias["namespaces"]:
            raise BridgeError("alias_refused", "The namespace cannot access this database alias.")
        path = safe_path(alias["path"])
        if not path.is_file():
            raise BridgeError("database_missing", "The registered database does not exist.")
        return path, alias["mode"] == "ro", False

    def perform(self, request):
        if not isinstance(request, dict) or set(request) != {
            "version", "id", "generation", "expiresAt", "namespace", "database", "operation", "statements"
        }:
            raise BridgeError("invalid_request", "The request shape is invalid.")
        if type(request["version"]) is not int or request["version"] != VERSION:
            raise BridgeError("protocol_mismatch", "The bridge protocol is unsupported.")
        if not isinstance(request["id"], str) or not REQUEST_ID.fullmatch(request["id"]):
            raise BridgeError("invalid_request", "The request identifier is invalid.")
        if request["generation"] != self.generation:
            raise BridgeError("helper_restarted", "The helper generation changed.")
        expiry = request["expiresAt"]
        if type(expiry) not in (int, float) or not 0 <= expiry <= now_ms() + 60000:
            raise BridgeError("invalid_request", "The request expiry is invalid.")
        if expiry <= now_ms():
            raise BridgeError("expired", "The request expired before execution.")
        owner = namespace(request["namespace"])
        operation = request["operation"]
        values = request["statements"]
        if values == {}:
            values = []
        if not isinstance(values, list) or len(values) > 100:
            raise BridgeError("invalid_request", "The statement batch is invalid.")
        statements = [statement(value) for value in values]
        if operation == "open":
            valid = not statements
        elif operation in ("query", "execute"):
            valid = len(statements) == 1 and statements[0][0] == operation
        elif operation == "transaction":
            valid = bool(statements)
        else:
            valid = False
        if not valid:
            raise BridgeError("invalid_request", "The operation is invalid.")
        path, readonly, managed = self.database(request["database"], owner)
        connection = None
        began = False
        deadline = min(time.monotonic() + 5, time.monotonic() + max(0, (expiry - now_ms()) / 1000))
        try:
            # mode=rw never creates a missing alias; mode=rwc is managed only.
            mode = "ro" if readonly else ("rwc" if managed else "rw")
            for suffix in ("-wal", "-shm", "-journal"):
                safe_path(str(path) + suffix)
            connection = sqlite3.connect(path.as_uri() + "?mode=" + mode, uri=True,
                                         timeout=min(2, max(0, deadline - time.monotonic())),
                                         isolation_level=None, cached_statements=0)
            if managed:
                os.chmod(path, 0o600)
            if hasattr(connection, "enable_load_extension"):
                connection.enable_load_extension(False)
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_BYTES)
            connection.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 1000)
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 1000)
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA schema_version").fetchone()

            def budget():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BridgeError("execution_timeout", "The database execution deadline expired.")
                connection.set_authorizer(None)
                connection.execute("PRAGMA busy_timeout=" + str(min(2000, int(remaining * 1000))))

            def progress():
                current = time.monotonic()
                if current >= deadline:
                    return 1
                if current - self.heartbeat_at >= 1:
                    self.heartbeat()
                return 0

            connection.set_progress_handler(progress, 1000)
            if operation == "open":
                budget()
                return {"opened": True}
            budget()
            connection.execute("BEGIN" if readonly or operation == "query" else "BEGIN IMMEDIATE")
            began = True
            results = []
            result_bytes = 0
            for kind, sql, params in statements:
                budget()
                def authorize(action, arg1, arg2, _database, _source):
                    if action in BLOCKED_ACTIONS or (action == sqlite3.SQLITE_FUNCTION and arg2 == "load_extension"):
                        return sqlite3.SQLITE_DENY
                    if (readonly or kind == "query") and action in WRITE_ACTIONS:
                        return sqlite3.SQLITE_DENY
                    return sqlite3.SQLITE_OK

                connection.set_authorizer(authorize)
                cursor = connection.execute(sql, params)
                rows = []
                row_count = 0
                # Fetch incrementally so 1,000 individually large rows cannot
                # consume unbounded memory before the response-size check.
                if cursor.description:
                    while True:
                        row = cursor.fetchone()
                        if row is None:
                            break
                        row_count += 1
                        if row_count > MAX_ROWS:
                            raise BridgeError("row_limit", "The result exceeds 1,000 rows; use LIMIT and pagination.")
                        if kind == "query":
                            cells = [encode_cell(value) for value in row]
                            result_bytes += len(json.dumps(cells, ensure_ascii=True).encode())
                            if result_bytes > MAX_BYTES - 1024:
                                raise BridgeError("message_limit", "The response exceeds the size limit.")
                            rows.append(cells)
                if kind == "query":
                    result = {"columns": [column[0] for column in cursor.description or []],
                              "rows": rows}
                else:
                    result = {"changes": max(0, cursor.rowcount), "lastInsertId": encode_cell(cursor.lastrowid or None)}
                results.append(result)
                # Validate response size before committing any changes.
                if len(json.dumps(results, ensure_ascii=True).encode()) > MAX_BYTES - 1024:
                    raise BridgeError("message_limit", "The response exceeds the size limit.")
            budget()
            connection.execute("COMMIT")
            began = False
            return {"results": results} if operation == "transaction" else results[0]
        except (BridgeError, sqlite3.Error, OSError, UnicodeError, OverflowError) as exc:
            outcome = "rejected"
            if began:
                try:
                    connection.set_authorizer(None)
                    connection.set_progress_handler(None, 0)
                    connection.execute("ROLLBACK")
                    outcome = "rolled_back"
                except sqlite3.Error:
                    outcome = "unknown"
            if isinstance(exc, BridgeError):
                raise BridgeError(exc.code, exc.message, outcome) from None
            code = getattr(exc, "sqlite_errorname", "database_error").lower()
            raise BridgeError(code, "The database operation failed.", outcome) from None
        finally:
            if connection is not None:
                connection.close()

    def respond(self, request_id, generation, result=None, problem=None):
        response = {"version": VERSION, "id": request_id, "generation": generation}
        if problem is None:
            response["result"] = result
        else:
            response["error"] = problem.value()
        publish(self.root / "responses" / (request_id + ".json"), response)

    def process_once(self):
        for incoming in sorted((self.root / "requests").glob("*.json")):
            request_id = incoming.stem
            if not REQUEST_ID.fullmatch(request_id):
                continue
            claimed = self.root / "processing" / incoming.name
            generation = None
            try:
                safe_path(incoming)
                safe_path(claimed)
                response_path = safe_path(self.root / "responses" / incoming.name)
                if response_path.exists() or claimed.exists():
                    incoming.unlink()
                    continue
                os.replace(incoming, claimed)
                self.heartbeat()
                request = read_json(claimed)
                generation = request.get("generation") if isinstance(request, dict) else None
                if not isinstance(request, dict) or request.get("id") != request_id:
                    raise BridgeError("invalid_request", "The request identifier does not match its file.")
                try:
                    result = self.perform(request)
                    self.respond(request_id, generation, result=result)
                except BridgeError as problem:
                    self.respond(request_id, generation, problem=problem)
                claimed.unlink()
            except (BridgeError, ValueError, RecursionError) as problem:
                if isinstance(problem, BridgeError):
                    try:
                        self.respond(request_id, generation, problem=problem)
                        safe_path(claimed).unlink(missing_ok=True)
                    except (OSError, BridgeError):
                        continue
            except OSError:
                # Keep a claimed request for crash recovery when response
                # publication fails. Never turn it back into runnable work.
                continue

    def prune(self):
        cutoff = time.time() - 86400
        for folder in ("responses", "requests"):
            for path in (self.root / folder).iterdir():
                try:
                    path = safe_path(path)
                    if path.is_file() and path.stat().st_mtime < cutoff:
                        path.unlink()
                except (OSError, BridgeError):
                    continue


def load_aliases(config):
    if config is None:
        return {}
    value = read_json(config)
    if not isinstance(value, dict) or set(value) != {"aliases"} or not isinstance(value["aliases"], dict):
        raise BridgeError("invalid_config", "The helper configuration is invalid.")
    aliases = {}
    for name, entry in value["aliases"].items():
        identifier(name)
        if not isinstance(entry, dict) or set(entry) != {"path", "mode", "namespaces"}:
            raise BridgeError("invalid_config", "A registered alias is invalid.")
        if entry["mode"] not in ("ro", "rw") or not isinstance(entry["namespaces"], list):
            raise BridgeError("invalid_config", "A registered alias is invalid.")
        if not isinstance(entry["path"], str) or not Path(entry["path"]).expanduser().is_absolute():
            raise BridgeError("invalid_config", "A registered path must be absolute.")
        path = safe_path(entry["path"])
        if not path.is_file():
            raise BridgeError("database_missing", "A registered database does not exist.")
        aliases[name] = {"path": path, "mode": entry["mode"],
                         "namespaces": {namespace(owner) for owner in entry["namespaces"]}}
    return aliases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="~/MudForge/aardwolf-sqlite")
    parser.add_argument("--config", help="JSON alias registry (loaded at startup)")
    args = parser.parse_args()
    helper = None
    try:
        helper = Helper(args.root, load_aliases(args.config))
        helper.acquire()
        print("Aardwolf SQLite helper ready. Stop with Ctrl+C.", flush=True)
        heartbeat_at, prune_at = 0, 0
        while True:
            current = time.monotonic()
            if current >= heartbeat_at:
                helper.heartbeat()
                heartbeat_at = current + 1
            helper.process_once()
            if current >= prune_at:
                helper.prune()
                prune_at = current + 60
            time.sleep(0.1)
    except KeyboardInterrupt:
        return 0
    except (BridgeError, OSError, ValueError):
        print("SQLite helper could not start or continue; check configuration and filesystem access.", file=sys.stderr)
        return 1
    finally:
        if helper is not None:
            helper.close()


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        sys.exit("Python 3.11 or newer is required.")
    sys.exit(main())
