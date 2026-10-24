# Migrate Aardwolf Spells to native storage

Aardwolf Spells **0.3.0** and `aardwolf-api` **0.4.0** replace the SQLite file
bridge with MudForge's native storage. Normal collection, damage refreshes and
command overrides need no Python process, SQLite reader or File System Access.
The library's `client.sqlite` API is removed; passing `options.sqlite` now fails
with a clear migration message. Existing `client.storage` preferences are unchanged.

## Preserve and convert the legacy data

1. Back up the target MudForge world and keep the original SQLite databases.
   Stop the old helper and disable the old Spells version during the transition
   so it cannot write another legacy snapshot after conversion.
2. Find each legacy `spells.sqlite` under
   `~/MudForge/aardwolf-sqlite/databases/<namespace-hash>/`. The old helper used a
   hash of the installed plugin ID and lowercase character name. That directory
   name is not reversible; the database metadata identifies its character.
3. From this repository, use Python 3 to create a new JSON file:

   ```sh
   python3 tools/migrate-spells-storage.py \
     --database "$HOME/MudForge/aardwolf-sqlite/databases/<namespace-hash>/spells.sqlite" \
     --output "$HOME/Documents/aardwolf-spells-migration.json"
   ```

   Replace the hash and output location. The output's parent folder must exist;
   an existing output file is never overwritten. Treat the JSON as personal data.

The standalone converter opens the source read-only and reads a consistent
committed snapshot, including committed WAL data. It validates the schema,
metadata, row ordering and relationships before exporting. It preserves ability
names, levels, optional spell numbers/percentages, unusable flags and display
order; kind/mana details; every damage membership and refresh timestamp; and
command overrides, including overrides for temporarily absent abilities.
Legacy databases with only metadata/abilities are supported. Unsupported tables,
columns, future versions, malformed values and overflow are refused without
truncation. The converter never changes or deletes the source database.

A successful export prints counts for abilities, details, memberships, refreshes
and commands. The new file has owner-only permissions and must be at most
**16 MiB**. Runtime plugins contain no SQLite code; this one-time converter is
the only SQLite-dependent migration component.

## Import into the intended world

1. Open the intended world, remain disconnected, and install the updated library
   and Spells plugin. API Core is needed for later collection;
   importing a saved record does not require a connected MUD session.
2. Type **`awspells import`**. Choose the converter's JSON in MudForge's platform
   file picker. The chooser completes asynchronously through `pickFile`'s
   callback; the command's initial response does not mean data was imported.
   File System Access is unnecessary. Cancellation leaves storage unchanged.
   A build without `pickFile` directs you to `awspells import-paste`.

   Alternatively, type **`awspells import-paste`** for a paste workflow. Open the
   converter's JSON in a text editor, copy its complete contents, and paste them
   into the labeled text box in **Import saved abilities**. Press **Import saved
   data**. This option also works on builds without a file picker and uses the
   same 16 MiB limit, validation, native save/read-back and identical-data/conflict
   handling. Opening it replaces a pending picker attempt, so a later chooser
   callback cannot repeat that attempt. Do not paste the SQLite file or its path.

   Both import paths record their last result for **`awspells status`**. Use that
   command if asynchronous terminal output is not visible. The paste panel also
   displays import feedback. A missing visible terminal message does not establish
   that the chooser callback failed or that the import was unsuccessful.
3. Check the imported-count result in the terminal or `awspells status`. The
   plugin validates the entire file,
   saves one native record, reads it back, and compares every field before
   reporting success. Compare the counts with the converter's output.
4. Repeat the same import: identical data reports that it is already saved and
   performs no write. Different existing native data causes refusal; neither
   version is silently merged or replaced. Invalid/future native records also
   remain preserved. Retain both files for reconciliation.
5. Reload and reopen the world to verify persistence. After connection and
   verified matching GMCP character identity, the provider can expose the saved
   snapshot. Disconnected imports send no gameplay commands and do not expose
   another character's data. Normal login collection can subsequently refresh
   the record from Aardwolf.

A pending chooser or paste form is ignored after unload, world change or
character identity change. Import during collection/save is refused. Failed storage readiness,
failed saves, malformed/oversized JSON or failed read-back verification report
failure; keep the migration file and backups. Do not remove the legacy database
until the native record has been verified after world reopen.

## Storage ownership and compatibility

Spells saves a schema-versioned record through default-scope native
`loadTable`/`saveTable` under `aardwolf-spells:data:<lowercase-character>`. It
contains the canonical snapshot plus damage details, memberships, timestamps
and commands. Every successful collection or override change saves a complete
validated record before publishing new state. Storage must report `ready` and
`saveTable` must accept the write; failed writes retain the prior published data.
A dedicated record validator supports up to 1,000 abilities and the bounded
damage catalog without loosening the shared API's GMCP/preference copy limits.

Data belongs to this installed plugin and world. Import each character's file
explicitly into every intended world; separate worlds do not share records.
Changing the installed plugin ID or renaming a character selects another store.
Existing native panel layout preferences retain their key, order and visibility;
the importer does not overwrite them. The public `client.spells` methods,
schema-version-1 snapshot and provider messaging contract remain unchanged.

Arbitrary databases opened through the former generic SQLite API or registered
aliases have no automatic native-storage translation. This converter accepts
only the supported Aardwolf Spells schema and preserves unrelated databases.
Consumers of the removed SQL API must adopt an appropriate native data model.

## Native verification

On **2026-10-24**, MudForge **2.0.3915** loaded API 0.4.0 and reinstalled Spells
0.3.0 in place under the existing plugin ID. Fresh native-picker import and
fresh/repeated paste import succeeded. The migrated record in an exported world
matched the converter's output across all fields after normalizing native
one-based lists and absent/null values. Closing and reopening the original world,
then repeating the paste import, reported identical data and confirmed persistence.

The original map graph, terrain styles, unrelated plugin state and existing
widget positions were preserved. Temporary verification world/library fixtures
were removed and their absence checked. This verifies native import and storage
for that client version; no live MUD connectivity or collection was tested.
Broader damage-panel interactions, pager behavior and connected collection remain
pending in [the acceptance checklist](NATIVE-ACCEPTANCE.md). Offline converter
and injected-host tests remain separate evidence.
