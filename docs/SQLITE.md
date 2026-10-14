# Local SQLite support — aardwolf-api 0.3.0

Plugins can create and query real SQLite databases through a separately running
local helper. MudForge's built-in `sqlite` library is read-only and has no SQL
execution; its plugin HTTP API cannot reach local helper services. This bridge
uses text files with the consuming plugin's **File System Access** permission.
Only the helper reads or writes binary database files.

[Aardwolf Spells](../README.md#aardwolf-spells) is a production consumer of this
bridge. It selects its stable character key only after Core supplies a verified
GMCP character name, then recreates its single API consumer with SQLite configured.

## Setup

1. Use macOS with Python **3.11+** and its `sqlite3` module. The helper uses
   standard-library dependencies; no pip packages or database server are needed.
2. From this repository, start the helper in a terminal:

   ```sh
   python3 tools/sqlite_helper.py
   ```

3. Install `dist/libs/aardwolf-api.lua` as `aardwolf-api` and reload consumers.
   Check that a user-edited/file library is not shadowing the new version.
4. Enable **File System Access** in each consuming plugin's Permissions settings.
   Granting it switches `io.*` from world pseudo-files to real files. The bridge
   needs real files; a copied pseudo-file heartbeat does not provide SQLite.
5. Supply the adapters and SQLite options below. Start the API consumer and
   connect the world before submitting operations. GMCP Core availability and
   negotiation are independent of SQLite availability.

The helper creates `~/MudForge/aardwolf-sqlite`, containing `heartbeat.json`,
`requests/`, `processing/`, `responses/` and `databases/`. The directory is
private (0700); messages and managed database files use 0600. It holds an
exclusive process lock, so a second helper cannot use the same bridge.
Stop it with Ctrl+C. Plugins cannot start it themselves.

`--root /absolute/home/folder` selects another bridge directory; consumers must
set the same `bridgeDirectory`. MudForge real-file access stays inside the home
folder. Paths with symlinks, including macOS's `/tmp` or `/var` aliases, are
refused; use canonical paths when testing the helper separately.

## Host adapters and configuration

The complete text-file adapter implementation is in
[`examples/sqlite-consumer.lua`](../examples/sqlite-consumer.lua). It uses
`io.open`, bounded `file:read`, `file:write`, `file:close`, `os.rename` and
`os.remove` at plugin scope. Inject:

| Adapter | Contract |
| --- | --- |
| `sqliteReadFile(path, maximumBytes)` | Text or nil; read at most the requested amount. |
| `sqliteWriteFile(path, text)` | Close the written file; return true only on success. |
| `sqliteRenameFile(oldPath, newPath)` | Atomically rename within the bridge; true on success. |
| `sqliteRemoveFile(path)` | Remove a temporary message; true on success. |
| `getPluginId`, `getSession`, `getCurrentTime` | Native installed ID, session connectivity, Unix milliseconds. |
| `addTimer`, `removeTimer` | Native repeating response polling and cancellation. |

Keep the existing lifecycle adapters too:
`findPluginByName`, `onPluginBroadcast`, `broadcastToPlugin`, `on`, `off`.

```lua
local client = aardwolf.new(host, {
  sqlite = {
    characterKey = "my-stable-character-key",
    bridgeDirectory = "~/MudForge/aardwolf-sqlite", -- optional
    timeoutMs = 10000 -- optional; integer 1000-60000
  }
})
client.start()
```

Choose a stable key explicitly, rather than using a transient session ID or an
initially unknown GMCP character name. The helper hashes the installed plugin ID
and character key together for the managed directory. Different plugins and
characters cannot accidentally collide. Changing either identifier selects a
different database collection; there is no automatic data migration.
This separation and alias configuration are logical routing, not a security
sandbox against other code already granted broad home-folder access.

Construction and loading perform no filesystem calls. SQLite is optional;
unconfigured consumers work as before. Configured consumers validate adapter
presence immediately. Database operations require `client.start()` and a native
connected session. Call `client.stop()` in plugin cleanup.

## Database API

All methods use **dot calls**. Callbacks receive `(result, error)` once, with
one value absent. Immediate rejection calls back synchronously; accepted
requests complete through polling. Subscriber exceptions are contained and
optionally reported with a fixed message through `host.reportError`.

```lua
client.sqlite.open("records", function(db, issue)
  if issue then return end
  db.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT)", {}, function(_, createIssue)
    if createIssue then db.close(); return end
    db.execute("INSERT INTO notes (text) VALUES (?)", { "literal 'quoted' text" }, function(inserted, insertIssue)
      if insertIssue then db.close(); return end
      db.query("SELECT id, text FROM notes WHERE id=?", { inserted.lastInsertId }, function(result, readIssue)
        if not readIssue then
          -- result.columns = { "id", "text" }; result.rows[1] = { id, text }
        end
        db.close()
      end)
    end)
  end)
end)
```

`open(name, callback)` creates or opens a managed database. Names use
`A-Z`, `a-z`, digits, `_`, `-`, with 1-128 characters; they never contain paths.
`openAlias(alias, callback)` selects an explicitly registered existing file.
`status()` returns `{ configured, connected, available, reason?, generation? }`.

`db.query(sql, params, callback)` runs one read-only statement. Results are
`{ columns = { ... }, rows = { { ... }, ... } }`, with **one-based** lists even
when native JSON arrays are zero-based. Positional rows preserve duplicate
column names and NULL columns. Empty results have empty lists.

`db.execute(sql, params, callback)` runs one schema/data statement and commits
before success. Results contain `{ changes, lastInsertId }`; `changes` is the
driver's affected-row count (zero for DDL), excluding trigger side effects.
`lastInsertId` is the driver's connection-local last inserted ID, or the NULL
wrapper when unavailable; do not infer that an UPDATE inserted a record.
For row-producing statements submitted to execute, returned rows are drained
and discarded. Use query for reads.

`db.transaction(statements, callback)` accepts a nonempty list of
`{ kind = "execute" | "query", sql = "...", params = { ... } }`. All statements
share one connection and transaction; failure rolls back the whole batch,
including schema changes. Success returns `{ results = { ... } }` in statement
order. There are no transactions spanning callbacks or multiple databases.

`db.close()` is idempotent and prevents new submissions. Accepted work drains;
the helper already closes its connection after every operation. Stop closes
all handles; start again and reopen them. Disconnect cancels pending callbacks
but handles can be reused after reconnect.

Use positional `?` parameters; omit params or pass `{}` for none. Named params
and SQL scripts containing multiple statements are not supported. Schema and
migrations belong to the consuming plugin. No ORM or whole-database deletion
API is provided. Foreign keys are enabled on every connection. User PRAGMAs,
ATTACH/DETACH, extension loading and explicit transaction/savepoint commands
are refused. Query cannot perform writes, even through `RETURNING`.

### Values

| Lua value | SQLite / returned Lua value |
| --- | --- |
| String | TEXT; Unicode and embedded NUL are preserved. SQL itself cannot contain NUL. |
| Finite number | INTEGER for integral safe numbers, REAL otherwise. |
| `client.sqlite.real(1e30)` | Explicit REAL, including integral-looking numbers outside the safe integer range. |
| Boolean | INTEGER 1/0; reads return numbers. |
| `client.sqlite.null` | SQL NULL; reads use `{ sqliteType = "null" }`. Test the marker, not table identity. |
| `client.sqlite.blob("AP8=")` | BLOB from base64; reads return `{ sqliteType = "blob", value = base64 }`. |
| `client.sqlite.integer("9223372036854775807")` | Signed int64; reads outside ±9007199254740991 retain the decimal wrapper. |

Do not put nil in a parameter list: it removes the slot. Decimal integer text
must have no leading zeroes except zero itself and fit signed int64.
Arrays with holes, functions, arbitrary tables and non-finite numbers fail
before publication. Parameters and batches are copied at submission.

## Existing database aliases

Create a local configuration file, then launch with
`python3 tools/sqlite_helper.py --config /absolute/path/aliases.json`:

```json
{
  "aliases": {
    "shared-notes": {
      "path": "/Users/your-user/Documents/shared-notes.sqlite",
      "mode": "ro",
      "namespaces": [
        { "pluginId": "your-installed-plugin-id", "characterKey": "my-stable-character-key" }
      ]
    }
  }
}
```

Replace the example identifiers and path with actual values. Use `rw` explicitly
to allow schema/data changes. Add each permitted plugin/character namespace to
share an alias. Restart the helper after editing configuration. Registered
files must exist both at startup and when opened; a missing file is never
created. The standard SQLite engine reads WAL-backed data and observes normal
locking. Backup existing files using their owning application's normal process
before granting write access.

## Failure and lifecycle behavior

Errors have `{ code, message, outcome }`. Messages are fixed descriptions;
SQL, values, database paths and raw exception text are not logged. SQLite engine
errors retain their lowercase SQLite error name, such as `sqlite_busy`.

- `rejected`: work was not submitted, or the helper declined it before beginning
  a transaction. Opening a managed database may create an empty file before an
  open failure; rejection is not a guarantee of no filesystem activity.
- `rolled_back`: the helper confirmed transaction rollback.
- `unknown`: submitted work may have committed. Inspect application state before
  retrying; the API never automatically retries.

Polling uses one 250 ms timer per consumer while requests are pending. Operations
are serialized FIFO per consumer. Disconnect and stop remove the timer, reject
unsent work and classify submitted work as unknown. Late replies cannot invoke
cancelled callbacks. Independent consumers may submit to the same registered
database; SQLite locking and the helper serialize access.

The helper publishes a heartbeat every second, including during long SQLite
execution. Submissions require a heartbeat no older than five seconds.
Restart changes its generation. Requests expire after the configured timeout,
including queue time. A helper restart marks claimed unfinished requests unknown
and never replays them; a crash between commit and reply cannot be resolved
automatically. Response receipts are retained for 24 hours to prevent replay of
duplicate IDs. Unclaimed expired work is refused before execution.

Limits: 32 pending requests per consumer; 100 statements per transaction;
1,000 parameters, columns and result rows per statement; 1 MiB JSON messages
and individual SQLite values; two-second lock waits; five-second SQLite execution
deadline including connection setup. Oversized results fail without truncation,
and transaction results are checked before commit. Use SQL LIMIT/keyset pagination
for larger reads. Native file I/O and callback delivery remain client-controlled.

## Example and verification

Import `examples/sqlite-consumer.lua` only in an authorized disposable world,
enable File System Access, start the helper and connect. Type
`awsql-demo disposable-character`. It touches only its dedicated `sqlite-demo`
database and `demo_records` table: create/upsert/read/update, intentionally
fail a duplicate-key transaction, verify rollback, then delete the sample row.
It sends no gameplay commands and does not need GMCP Core.

Repository tests execute the Lua facade in Fengari, the helper against temporary
real databases, and both together through real request/response files. These
checks do not execute MudForge's JavaScript transpiler or its real-file adapters.
Native acceptance remains separate; see [NATIVE-ACCEPTANCE.md](NATIVE-ACCEPTANCE.md).

References: [MudForge authoring guide](https://mudforge.org/docs/ai-plugin-guide.md),
[Python sqlite3](https://docs.python.org/3/library/sqlite3.html),
[SQLite authorization](https://www.sqlite.org/c3ref/set_authorizer.html).
