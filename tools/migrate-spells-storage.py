#!/usr/bin/env python3
"""Export a legacy Aardwolf Spells database for ``awspells import``.

The database is opened read-only, including its committed WAL, and is never
changed or removed. Export files contain personal data and are created with
owner-only permissions. No MudForge runtime or third-party modules are needed.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import sys


MAX_INTEGER = 9007199254740991
MAX_BYTES = 16 * 1024 * 1024
TYPES = frozenset(("acid", "air", "bash", "cold", "disease", "earth", "electric", "energy", "fire", "holy",
                   "light", "magic", "mental", "negative", "pierce", "slash", "shadow", "sonic", "special", "water"))
SCHEMA = {
    "metadata": ("id", "schema_version", "character_name", "collected_at", "entry_count"),
    "abilities": ("name", "level", "sn", "percent", "unusable", "display_order"),
    "ability_details": ("name", "kind", "mana"),
    "damage_memberships": ("kind", "damage_type", "name"),
    "damage_refreshes": ("kind", "damage_type", "collected_at"),
    "skill_commands": ("name", "command"),
}


class MigrationError(ValueError):
    """A safe, non-personal diagnostic suitable for the command line."""


def require(condition, message):
    if not condition:
        raise MigrationError(message)


def integer(value, minimum=0, maximum=MAX_INTEGER):
    return type(value) is int and minimum <= value <= maximum


def text(value):
    return (isinstance(value, str) and 0 < len(value.encode("utf-8")) <= 128
            and not re.search(r"[\x00-\x1f\x7f]", value) and bool(value.strip()))


def rows(connection, table, limit, order=""):
    # Identifiers come exclusively from the fixed schema above.
    columns = ",".join(SCHEMA[table])
    result = connection.execute(f"SELECT {columns} FROM {table} {order} LIMIT ?", (limit + 1,)).fetchall()
    require(len(result) <= limit, "Database exceeds supported record limits.")
    return result


def read_record(database):
    """Read one consistent committed snapshot; never expose values in errors."""
    try:
        path = Path(database).expanduser().resolve(strict=True)
        require(path.is_file(), "Database must be an existing regular file.")
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("BEGIN")
            require(connection.execute("PRAGMA quick_check").fetchall() == [("ok",)], "Database integrity check failed.")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_schema WHERE type='table'")
                      if not row[0].startswith("sqlite_")}
            require(tables <= SCHEMA.keys(), "Unsupported database tables; export refused to prevent data loss.")
            require({"metadata", "abilities"} <= tables, "Missing required Spells tables.")
            for table in tables:
                info = connection.execute(f"PRAGMA table_info({table})").fetchall()
                require(tuple(row[1] for row in info) == SCHEMA[table], "Unsupported Spells table schema.")
            record = decode_record(connection, tables)
            connection.rollback()
            return record
        finally:
            connection.close()
    except MigrationError:
        raise
    except (OSError, sqlite3.Error, UnicodeError, ValueError):
        raise MigrationError("Cannot read a valid Spells database; source was not modified.") from None


def decode_record(connection, tables):
    metadata = rows(connection, "metadata", 1)
    require(len(metadata) == 1, "Missing snapshot metadata.")
    identity, version, character, collected, count = metadata[0]
    require(integer(identity, 1, 1) and integer(version, 1, 1) and text(character)
            and character == character.strip() and integer(collected)
            and integer(count, 1, 1000), "Invalid snapshot metadata.")
    abilities = rows(connection, "abilities", 1000, "ORDER BY display_order")
    require(len(abilities) == count, "Snapshot count does not match abilities.")
    entries, names = [], set()
    for index, (name, level, sn, percent, unusable, position) in enumerate(abilities, 1):
        require(text(name) and integer(level, 1) and (sn is None or integer(sn, 1))
                and (percent is None or integer(percent, 0, 100)) and integer(unusable, 0, 1)
                and integer(position, 1, 1000) and position == index, "Invalid ability data or ordering.")
        key = name.lower()
        require(key not in names, "Duplicate ability names.")
        names.add(key)
        item = {"name": name, "level": level, "unusable": bool(unusable)}
        if sn is not None:
            item["sn"] = sn
        if percent is not None:
            item["percent"] = percent
        entries.append(item)
    damage = {"details": {}, "members": {}, "times": {}, "commands": {}}
    if "ability_details" in tables:
        for name, kind, mana in rows(connection, "ability_details", 1000):
            require(isinstance(name, str) and name in names and kind in ("skill", "spell")
                    and (mana is None or integer(mana)) and name not in damage["details"], "Invalid damage details.")
            info = {"kind": kind}
            if mana is not None:
                info["mana"] = mana
            damage["details"][name] = info
    if "damage_refreshes" in tables:
        for kind, damage_type, collected_at in rows(connection, "damage_refreshes", 40):
            require(kind in ("skill", "spell") and damage_type in TYPES and integer(collected_at), "Invalid damage refresh.")
            key = kind + ":" + damage_type
            require(key not in damage["times"], "Duplicate damage refresh.")
            damage["times"][key] = collected_at
            damage["members"][key] = {}
    if "damage_memberships" in tables:
        for kind, damage_type, name in rows(connection, "damage_memberships", 40000):
            require(kind in ("skill", "spell") and damage_type in TYPES and isinstance(name, str)
                    and name in names, "Invalid damage membership.")
            key = kind + ":" + damage_type
            require(key in damage["times"] and name in damage["details"]
                    and damage["details"][name]["kind"] == kind, "Damage membership has no matching detail or refresh.")
            require(name not in damage["members"][key], "Duplicate damage membership.")
            damage["members"][key][name] = True
    if "skill_commands" in tables:
        for name, command in rows(connection, "skill_commands", 1000):
            require(text(name) and name == name.lower() and isinstance(command, str)
                    and 0 < len(command) <= 128 and re.fullmatch(r"[A-Za-z][A-Za-z0-9 _'\-]*", command)
                    and name not in damage["commands"], "Invalid skill command.")
            damage["commands"][name] = command
    return {"schemaVersion": 1, "characterKey": character.lower(),
            "snapshot": {"schemaVersion": 1, "characterName": character, "collectedAt": collected, "entries": entries},
            "damage": damage}


def export_database(database, output):
    record = read_record(database)
    payload = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    require(len(payload) <= MAX_BYTES, "Export exceeds the native import size limit.")
    target = Path(output).expanduser()
    descriptor = None
    created = False
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = None
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        raise MigrationError("Output already exists; choose a new output path.") from None
    except OSError:
        if descriptor is not None:
            os.close(descriptor)
        if created:
            target.unlink(missing_ok=True)
        raise MigrationError("Cannot write export; choose a writable private output location.") from None
    damage = record["damage"]
    return {"abilities": len(record["snapshot"]["entries"]), "details": len(damage["details"]),
            "memberships": sum(map(len, damage["members"].values())), "refreshes": len(damage["times"]),
            "commands": len(damage["commands"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="Existing legacy Spells database (read-only).")
    parser.add_argument("--output", required=True, type=Path, help="New private JSON export file; must not exist.")
    args = parser.parse_args(argv)
    try:
        counts = export_database(args.database, args.output)
    except MigrationError as error:
        print(f"Migration refused: {error}", file=sys.stderr)
        return 1
    print("Export verified: " + ", ".join(f"{count} {label}" for label, count in counts.items()) + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
