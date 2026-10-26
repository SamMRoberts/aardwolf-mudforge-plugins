# Versioned acceptance evidence

This ledger records observations for particular artifacts and environments. The
[native checklist](NATIVE-ACCEPTANCE.md), [Atlas guide](ATLAS.md#disposable-native-acceptance)
and [terrain guide](TERRAIN-ICONS.md#import-and-restore) describe how to repeat the
checks. A checklist, a target client version or an available fixture is not a
recorded result.

## Record format and release gates

Each result has a unique ID and refers to an immutable artifact/environment
profile. Tables below separate profiles from results to avoid repeating hashes.

| Field | Required content |
| --- | --- |
| Observation date | Date of the check, not the date its documentation was copied; `unrecorded` for missing historical dates. |
| Source revision | Full Git commit of the tested source. If dirty, also record a SHA-256 of the tested patch and identify changed/untracked inputs. A documentation revision alone does not identify tested bytes. |
| Artifacts | Repository paths and full SHA-256 digests of the actual tested files, including library/Core dependencies. For edited installed copies, hash those copies and describe the edits. |
| Versions | Actual library, Core and plugin/pack versions. Use `not applicable` only for absent dependencies, such as standalone Atlas or terrain packs. |
| MudForge build | Actual tested client build, architecture and desktop/browser variant; never substitute a planned target. Offline or synthetic checks use `not applicable`. |
| Environment | OS version/build and architecture; relevant Node/Python/browser versions, fixture and transport. Record missing historical details as `unrecorded`. |
| Layer and scope | One layer per row, with the component/scenarios actually exercised. Split partial outcomes into separate rows. |
| Result | Exactly `passed`, `failed`, `blocked` or `not run`, as defined below. |
| Observation/evidence | Short observed behavior or concrete blocker, plus a safe evidence reference or command. Do not include credentials, private logs, world exports or backups. |

| Result | Meaning |
| --- | --- |
| `passed` | The listed checks ran and met their expectations, only within the recorded scope. |
| `failed` | A check ran and an observed result contradicted an expectation; record the mismatch. |
| `blocked` | An attempted check could not complete because of a concrete obstacle; record what prevented verification. |
| `not run` | No check was performed for this profile/scope, including work still awaiting authorization. |

The layers are `offline` (source/build checks and simulated hosts),
`synthetic-browser` (standalone rendered previews; plugin checks use injected
bindings/bridges),
`native-disposable-world` (installed desktop client and an authorized disposable
world, including local loopback transport), and `live` (separately authorized
Aardwolf transport). Historical real browser-client import/reload checks use
`browser-client-disposable-world`; they are neither synthetic HTML checks nor
desktop native acceptance. An existing-world migration is recorded separately
as `native-existing-world` and requires its own authorization.

A `blocked` record does **not** pass a component release gate. Neither does
`failed`, `not run`, or a pass in a different layer. A partial pass does not
complete the remaining checklist. Historical passes with missing provenance
remain useful observations but cannot establish acceptance of current bytes.
Evaluate each affected component's required checks for its exact artifact set
and environment; do not roll these rows into a single release-wide pass.

Append new profiles/results for changed bytes, builds, environments or reruns.
Preserve previous results and blockers; add a dated correction referencing the
original ID if a record needs correcting. Do not relabel an old pass as current
because a version string or test count happens to match.

## Baseline B1 — source and artifacts

Source revision: `f7deb46545f846c13bc4519edaa9f672b8d9dc50`.
Observed **2026-10-25** on **macOS 27.0.1 (26A434), arm64**, with
**Node.js v26.10.0**, **Python 3.14.8** and the checked-in npm lockfile.
Runtime source, tests, lockfile and generated artifacts were unmodified during
the checks. This documentation change does not change those inputs.
MudForge build: **not applicable** to B1's offline run; no client was tested.

These SHA-256 digests were computed directly from the files. Lua digests also
matched `plugins.json`; pack versions came from their source `terrains.json`.
The library/Core artifacts paired with consumers in B1 are API **0.9.1** /
Core **0.5.0**; this is not a claim about an installed client.
Atlas and the terrain packs are standalone, with library/Core **not applicable**.

| ID | Artifact | Version | SHA-256 |
| --- | --- | --- | --- |
| A1 | [aardwolf-api](../dist/libs/aardwolf-api.lua) | 0.9.1 | `f7b209db1a7b754e0ac0871ad9eef1522eb4e89266f24be2c60ebd536bf2437c` |
| A2 | [API Core](../dist/plugins/aardwolf-api-core.lua) | 0.5.0 | `b47db8e42cf040f3ea8b94f0709dc042cb0fef4079e1be9a1b8f9b9210df2c49` |
| A3 | [Vitals Example](../dist/plugins/aardwolf-api-vitals-example.lua) | 0.1.0 | `06621760bbea7d9e0b1bda9523fcf1f919e1db59322f37f9d8c88ca85058a96c` |
| A4 | [Vitals](../dist/plugins/aardwolf-vitals.lua) | 0.1.6 | `132ffef843ae6ba642405f71e1a0163e33b5cb73d2e3c49dbe3fd9ecdd0c46a5` |
| A5 | [Spells](../dist/plugins/aardwolf-spells.lua) | 0.5.1 | `953dc3035da56f762c5137641c6e5e0e5ec2db4fef4f48a7b6c9913bfd3da298` |
| A6 | [Room Details](../dist/plugins/aardwolf-room-details.lua) | 0.2.3 | `0ceb0d1896965438d527c2c28c03d4505bfced309f4e2e6634a1883013e38feb` |
| A7 | [Inventory Management](../dist/plugins/aardwolf-inventory.lua) | 0.4.0 | `32a1974a34ee5e4954abc0e93e1e897c3d2ec599368c215b24a5d75cffac98e1` |
| A8 | [Atlas](../dist/plugins/aardwolf-atlas.lua) | 0.3.0 | `1a10d1aae33924b90221d866e4cef57db676f8860157e5f049149ab30d1aac55` |
| A9 | [Terrain Icons](../dist/map-packs/aardwolf-terrain-icons.json) | 4.2.1 | `af4935cc81268df1434e4ea5a6776794cf43b7c3e13bbc89f4029c02ff5db7e4` |
| A10 | [Three Moons](../dist/map-packs/aardwolf-three-moons.json) | 1.3.1 | `0032a64740034f0e8b030ff002c1d90ed13bbaa1a0451eaed17511f5f4a51619` |

Artifact links resolve to the checkout's files; use the source revision above
to retrieve historical bytes after they change. The immutable digests, rather
than the current link targets, identify this baseline.

## Baseline B1 — results

All rows dated **2026-10-25**. `not run` rows record gaps in this baseline run;
they do not erase the narrower historical observations below. Their MudForge
build/browser environment is **unrecorded (not exercised)**, not a claimed test
of the initial 2.0.3701 target.

| Result ID | Profile / scope | Layer | Result | Observation/evidence |
| --- | --- | --- | --- | --- |
| B1-01 | B1, A1–A10; full repository suite | offline | passed | `npm test`: 623 JavaScript tests and 18 Python tests passed; no JavaScript failures or skips. Fengari/host fixtures do not execute the native transpiler, widgets or transport. |
| B1-02 | B1, A1–A10; generated distribution | offline | passed | `npm run build:check`: 252 repository files checked without rewriting them. Direct Lua SHA-256 checks matched the catalog. |
| B1-03 | B1, widget and pack previews | synthetic-browser | not run | No rendered browser checks performed for this baseline. |
| B1-04 | B1, A1–A10; applicable component native checklists | native-disposable-world | not run | No desktop client/world access performed for this issue; native transpilation, rendering, persistence and loopback verification remain open. |
| B1-05 | B1, A1–A7; connected API and consumer behavior | live | not run | No Aardwolf connection or gameplay acceptance performed; separate authorization required. |

## Historical profiles

The following is a compact index of existing records, transcribed from the
guides at [documentation revision f7deb46545f846c13bc4519edaa9f672b8d9dc50](https://github.com/SamMRoberts/aardwolf-mudforge-plugins/tree/f7deb46545f846c13bc4519edaa9f672b8d9dc50/docs).
It is not a new execution or an exhaustive replacement for their detailed
observations. **Tested source revision and actual artifact hashes are unrecorded
for every H profile.** The documentation revision is evidence provenance only;
do not substitute its catalog hashes for the files used in those earlier runs.
OS versions/builds and unlisted tool/browser versions are also **unrecorded**.

| Profile | Actual tested component/dependencies | MudForge build / environment | Evidence reference |
| --- | --- | --- | --- |
| H1 | Atlas 0.1.0; library/Core not applicable | Desktop 2.0.3701 for native checks; offline/browser tools unrecorded | [Recorded 0.1.0 verification](ATLAS.md#recorded-010-verification--2026-10-18) |
| H2 | Atlas 0.3.0; library/Core not applicable | Desktop 2.0.3701 arm64 for blocked import; synthetic bridge/browser build unrecorded | [Indicator verification](ATLAS.md#indicator-verification-030) |
| H3 | API 0.4.0 / Spells 0.3.0; Core version unrecorded | Desktop 2.0.3915; disconnected. Disposable copy used isolated library name `aardwolf-api-storage-acceptance` and an edited Spells dependency | [Native storage subset](NATIVE-ACCEPTANCE.md#2026-10-24-native-verification--mudforge-203915) |
| H4 | Spells 0.5.0 widget HTML; API/Core versions unrecorded | MudForge not applicable; headless Chrome with synthetic bindings/actions, build unrecorded | [Single/Area checks](NATIVE-ACCEPTANCE.md#singlearea-panel--050-acceptance-pending) |
| H5 | Terrain Icons 1.0.0; library/Core not applicable | Actual browser client 2.0.3702 for import/reload; desktop 2.0.3701 for interrupted native attempt | [Historical 1.0.0 checks](TERRAIN-ICONS.md#historical-100-browser-acceptance) |
| H6 | Terrain Icons 4.2.1; library/Core not applicable | MudForge not applicable to offline checks; runtime versions unrecorded | [4.2.1 checks](TERRAIN-ICONS.md#421-named-vendor-terrain-styles) |
| H7 | Three Moons 1.3.1; library/Core not applicable | MudForge not applicable to offline checks; runtime versions unrecorded | [Three Moons verification](THREE-MOONS.md#sources-builds-and-verification) |

## Historical results

Each row inherits its H profile's missing revision/hash/OS details. Passes apply
only to the stated subset and version. Historical blockers are retained even
when an offline check of a later artifact succeeds.

| Result ID | Profile / observation date | Layer | Result | Observation/evidence |
| --- | --- | --- | --- | --- |
| H1-01 | H1 / 2026-10-18 | offline | passed | 223 JavaScript and 25 Python tests; 243 generated-file checks. |
| H1-02 | H1 / 2026-10-18 | synthetic-browser | passed | Standalone preview rendered 3D terrain and keyboard-selected inspection; fixture routes, not server routes. |
| H1-03 | H1 / 2026-10-18 | native-disposable-world | passed | Compressed bundle reloaded in both disconnected fixture worlds; overhead/3D, routes, docking and separate saved preferences observed. Before/after map comparisons passed. GPU loss, screen-reader audit and long soak were not performed. |
| H2-01 | H2 / unrecorded | offline | passed | 282 JavaScript and 25 Python tests, including 82 focused Atlas checks. |
| H2-02 | H2 / unrecorded | synthetic-browser | passed | Five visibility controls, colors, overhead/3D, narrow settings and 10,000-room preview exercised. Fixture iframe exposed an Electron-injected exception; standalone preview had no console errors. |
| H2-03 | H2 / unrecorded | native-disposable-world | blocked | Plugin-file Import returned without installing a plugin, including retry; loading, rendering and persisted reload could not be verified. |
| H3-01 | H3 / 2026-10-24 | native-disposable-world | passed | Isolated library/Spells loaded, panel rendered; chooser/paste imports, identical-import refusal and world-reopen persistence verified. Comprehensive UI and connected collection remained open. |
| H3-02 | H3 / 2026-10-24 | native-existing-world | passed | Separately authorized disconnected migration preserved 370 abilities, 89 details, 88 memberships and 40 timestamps; layout/unrelated data preserved and identical reimport refused a write. No live transport exercised. |
| H4-01 | H4 / 2026-10-24 | synthetic-browser | passed | Normal/edit layouts at five sizes from 260 × 500 to 1600 × 220; Single/Area, reordering, toolbar access and resizing checked without horizontal overflow or console errors. |
| H5-01 | H5 / unrecorded | offline | passed | 174 JavaScript and 21 Python tests, deterministic build and whitespace checks. |
| H5-02 | H5 / unrecorded | synthetic-browser | passed | Contact sheet loaded 684 samples without image failure or horizontal overflow. |
| H5-03 | H5 / unrecorded | browser-client-disposable-world | passed | 1.0.0 imported; reload retained 114 images. Repeated comparison at normalized zoom 2 preserved all 115 room records and unrelated map settings; loopback connection refused, no public MUD used. |
| H5-04 | H5 / unrecorded | native-disposable-world | blocked | Desktop automation interrupted twice; pack not installed, no native test world created. Browser-client pass did not complete desktop acceptance. |
| H6-01 | H6 / unrecorded | offline | passed | 294 JavaScript and 27 Python tests; 251 generated-file checks. Vendor masters/exports byte-identical; native import/persistence not exercised. |
| H7-01 | H7 / unrecorded | offline | passed | Same automated checks as recorded for 1.3.0: 20 focused checks, 185 JavaScript and 21 Python tests, 241 generated-file checks; shop reviewed in offline renders. Native import/persistence not exercised. |

Other version-specific records remain in the linked guides, including Atlas
0.2.x, earlier terrain artwork and Spells 0.3.x browser checks. They are not
evidence for B1. No historical live pass is established by this index.

## Adding the next observation

1. Identify the tested source and hash every tested artifact, including actual
   loaded dependencies/overrides. Verify installed versions rather than relying
   on the catalog or the planned install list.
2. Add a profile with the actual OS, client build and tools. Reuse a profile only
   when its bytes and environment match; use explicit `unrecorded` fields for
   legacy evidence that cannot be recovered reliably.
3. Append one dated row per layer/scope with an allowed result state, a short
   observation and a safe reference/command. For a blocker, list the unverified
   checks and the obstacle; for a failure, record expected versus observed.
4. Keep native map-preservation, cleanup and live checks distinct. Follow the
   component guide's authorization/backup requirements before client writes or
   connections; recording a row grants no access or publication permission.

## Room Details R62 — 0.3.0 local implementation

Observed **2026-10-26** on **macOS 27.0.1 (26A434), arm64**, **Node.js v26.10.0**,
**Python 3.14.8**, and headless **Google Chrome 156.0.8078.47** via Playwright CLI.
MudForge build: **not applicable**; no installed client/world was exercised.
Source: `fc355aa7b8140ce54508a4eb866ee7e7358a6df5` plus the uncommitted runtime/test
patch on local branch `codex/issue-62`. The patch is `git diff --binary --
src/plugins/aardwolf-room-details.lua tests/room-details-display.test.mjs
tests/room-details.test.mjs tests/distribution.test.mjs`, SHA-256
`9d5e475efa7d6f71b1fe9f9cc4211971f0d29a8565f6251d620b841ddb750750`.
These are the only changed runtime/test inputs; there are no untracked runtime
inputs. README, acceptance documentation and generated output changes accompany
the implementation and are excluded from that patch digest.

| Artifact | Version | SHA-256 |
| --- | --- | --- |
| [Room Details](../dist/plugins/aardwolf-room-details.lua) | 0.3.0 | `2212b404e34f2ee3994f0638bae04d7ef7e9e4f5f5ba71f8865f0d8826658a60` |
| [aardwolf-api](../dist/libs/aardwolf-api.lua), offline dependency | 0.9.1 | `f7b209db1a7b754e0ac0871ad9eef1522eb4e89266f24be2c60ebd536bf2437c` |
| [API Core](../dist/plugins/aardwolf-api-core.lua), offline dependency | 0.5.0 | `b47db8e42cf040f3ea8b94f0709dc042cb0fef4079e1be9a1b8f9b9210df2c49` |

The synthetic browser loads extracted production HTML at
`http://127.0.0.1:8762/panel.html` with an injected bridge, 37 character rows
(including identical merchants), two objects, and styled literal-markup text.
It does not load the library/Core or native formatter. Temporary local evidence
is outside the repository in `/private/tmp/issue62-browser/`: `panel.html`
SHA-256 `b99813285ffdfde1f08b455e8b9875d8f9f34e6c089ae3037b36340c0708f34a`,
`check.cjs` SHA-256
`15e29faf8ac14743eea1718ff667c94dc69b69e3c9b6fecd33fb546df8f1ec31`,
`result.txt`, `filtered-360.png`, `collapsed-clean-260.png` and `large-font-200.png`.
These temporary files are local evidence, not a committed browser harness.

| Result ID | Profile / scope | Layer | Result | Observation/evidence |
| --- | --- | --- | --- | --- |
| R62-01 | R62; capture, preferences and display | offline | passed | `node --test tests/room-details.test.mjs tests/room-details-display.test.mjs`: 48 passed. Covers original-text filtering, duplicate indices, ANSI spans, hidden selection/Details/Copy, unchanged DOM/focus/scroll, strict persisted booleans, malformed messages/records, world isolation/reload and refused saves. |
| R62-02 | R62; full suite and generated artifacts | offline | passed | `npm test`: 632 JavaScript and 18 Python tests passed; no JavaScript failures/skips. `npm run build` and `npm run build:check`: 252 files; `git diff --check` passed. Catalog pins Room Details 0.3.0 and the exact generated bytes. |
| R62-03 | R62; local synthetic widget | synthetic-browser | passed | `node /private/tmp/issue62-browser/check.cjs`: page URL/title, nonblank content, no application error overlay, zero page/console errors on the checked reload; widths/heights 200×150, 260×180, 360×240, 640×480 with 12/20 px interface and 32 px room text. No horizontal overflow; toolbar remained in viewport. Tab/Enter Clear, Space/Enter collapse/expand, independent counts, duplicate selection, hidden Details/Copy, Escape focus restoration, literal filtering, retained row/focus/scroll and simulated save refusal/retry passed. Only ready/select/collapse bridge events occurred. Screenshots inspected separately at 360×240, 260×180 and 200×150. An initial missing fixture favicon returned 404; adding the local fixture icon removed it before the checked reload. |
| R62-04 | R62; affected [native checklist](NATIVE-ACCEPTANCE.md#room-details--030-acceptance-pending) | native-disposable-world | not run | No disposable world was authorized. Native transpilation, ANSI formatting, widget bridge/docking, storage refusal and world reopen remain pending; browser/host passes do not clear this gate. |
| R62-05 | R62; connected room capture | live | not run | No Aardwolf access was authorized. Live formatting, suppression and refresh scheduling remain unverified. |
