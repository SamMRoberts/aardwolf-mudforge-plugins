# Native acceptance — pending

Target: **MudForge 2.0.3701**, initially observed on macOS. This scaffold has
offline evidence only. No installation, native rendering/persistence, loopback
transport or live Aardwolf acceptance has been performed.

Use an explicitly authorized disposable world for these checks. Record the
actual app version, original selected world and a private backup before writes.
Do not use an existing character profile or map as the fixture. Keep credentials,
private messages, world exports and raw gameplay logs out of this repository.

## Native library and lifecycle

- Install the library separately, then Core and the example. Verify each loaded
  library version is 0.3.0 and Core/example versions are 0.1.0, including library
  precedence over repository/package copies.
- Try both load orders, reload Core with consumers enabled, then disable and
  re-enable the example. Expect one panel, one subscription per source and no
  callbacks into unloaded consumers.
- Try a file import that assigns an ID different from the source metadata.
  Confirm discovery and targeted replies use that installed ID.
- In a disposable fixture only, load API Core with a known conflicting Core
  enabled. Expect negotiation refusal with a useful status; disable the other
  Core and reload API Core.

## Loopback transport and session isolation

- Connect to a local Telnet/GMCP fixture and observe actual negotiation. Expect
  the baseline supports list and no automatic channel, debug or tag commands.
- Declare Group from a test consumer, then disable it. Expect Group to leave
  the supports union within the coalescing/cooldown window while baseline
  Char/Comm/Room/Core remain.
- Send partial character values, invalid known fields, empty room exits and a
  smaller Group list. Confirm values merge or disappear according to the API.
- Send each Comm packet and verify one event per delivered packet, no replay
  on consumer enable, and no Comm persistence.
- Open a second disposable session with different vitals. Disconnect/reconnect
  one, and confirm both state and targeted messaging remain isolated.
- Enable Core on an existing connection. After negotiation, use the explicit
  Refresh button and observe a single `request char` and a fresh response.
- Feed repeated `char.base`; confirm no negotiation/request feedback loop.
  Inspect nested data copying against the actual transpiler.

## UI, persistence and preservation

- Observe the native vitals panel, including unknown values/maxima, disconnect
  state, resize and text bindings. Confirm ordinary updates preserve scroll,
  focus, form input and widget geometry.
- Click and keyboard-activate Refresh; verify it fails clearly while unavailable
  and sends the documented request only when connected and negotiated.
- Save font size. Disable/reload, then close/reopen the disposable world and
  verify the actual persisted value, stable geometry and visibility.
- Feed external text containing markup into a text binding; verify it renders
  as text. Check a canvas helper selects the correct target before drawing.
- Disable/remove the fixtures and restore the originally selected world.
  Confirm no existing worlds, maps, themes or layout settings changed.

Record observed results and concrete blockers separately from offline tests.
Any connection to live Aardwolf remains a separate, explicitly authorized
acceptance step; loopback transport does not establish live-server behavior.

## SQLite — native acceptance pending

Offline tests execute Fengari, real temporary SQLite databases and the Lua/Python
file protocol together. They do not verify MudForge's transpiler, File System
Access toggle, text-file handles, rename semantics or native timer delivery.

- With separate authorization, create a disposable world and a dedicated helper
  bridge directory inside the home folder. Start the Python helper manually;
  record Python/SQLite and MudForge versions. Do not register existing databases.
- Install library 0.3.0 and `examples/sqlite-consumer.lua`. Connect only to the
  disposable loopback fixture. The example does not require API Core or GMCP.
- With File System Access off, confirm a clear unavailable result and no helper
  request. Enable it for the example, then run `awsql-demo disposable-character`.
  Observe the success message and inspect the created managed SQLite file through
  Python/sqlite3 after the operation. Verify actual atomic file rename and response
  delivery, rather than inferring them from the offline filesystem adapters.
- Run twice, reload the plugin and reopen the world. Confirm one command, no
  duplicate poll timers and persisted schema. Test separate character keys and
  plugins; only explicitly registered disposable aliases may be shared.
- Exercise NULL between populated columns, Unicode/NUL TEXT, BLOB/base64 and int64
  wrappers through native JSON encode/decode, including empty and zero-based arrays.
- Stop the helper, restart it during a request, refuse permissions and inject
  malformed replies. Confirm safe errors, no automatic write retries and no
  callbacks after unloading. Disconnect during submitted and queued operations;
  observe unknown/rejected outcomes and reject new disconnected operations.
- Test helper locking, a read-only disposable alias, rollback, oversized results
  and reopen persistence. Remove only disposable artifacts, restore the original
  selected world and record evidence separately from live Aardwolf acceptance.

## Aardwolf Spells — native and live acceptance pending

Offline fixtures test parsing, collection lifecycle and shared access. The real
file bridge test stores 250 abilities in SQLite, verifies rollback, reads back
an unknown commit outcome, reloads persisted data and separates characters.
These tests do not execute MudForge's transpiler, real file adapters, command
hooks, provisional output, pager or connected Aardwolf transport.

- With separate authorization, install library 0.3.0, API Core and Spells 0.1.0
  in a disposable world. Start the helper manually and record client/helper
  versions. Confirm both provider/consumer load orders and the actual installed IDs.
- With the helper absent or File System Access off, complete simulated login.
  Expect one actionable error, no `allspells` send and no repeated retries.
  Enable access/start the helper and invoke `awspells refresh`.
- Deliver `char.base.name` and active state in either order. Expect one
  automatic query only after negotiated GMCP and state 3, including enable
  during an existing active session. Repeat updates; no additional query occurs.
- Feed the supplied table with ANSI, dash fields, stars, repeated page headers
  and chatter. Verify display order, preserved terminal output/prompt and the
  saved database content after the footer. Verify Lua pattern behavior and
  provisional line delivery directly in the installed client.
- Test plain user `allspells`, filtered variants, overlapping refreshes, manual
  pager continuation, malformed/duplicate rows and missing footer. Wait 60
  seconds for a partial capture; the previous database snapshot must survive.
  Do not change the character's pager settings or send pager-control commands.
- Inspect committed snapshots from a separate `spells = true` consumer with no
  file permission. Reload/disable the provider, disconnect during capture/save
  and switch character identity. Verify cache invalidation and no stale callbacks.
- Simulate helper restart/lost commit receipts using only disposable data.
  Confirm readback without write replay and explicit recovery after a failed
  reconciliation. Save/reopen the world and verify actual SQLite persistence.
- With a separately authorized live Aardwolf connection, run one collection and
  compare stored rows with the visible output. Record live acceptance separately.
  Restore the original selected world and remove only disposable test artifacts.

## Aardwolf Vitals — native and live acceptance pending

Repository tests cover Aardwolf Vitals data handling, settings validation and
save refusal, reactive updates, simulated preference reload, lifecycle and
session isolation. An isolated JavaScript fixture checks the form property
handler. These checks do not execute MudForge's transpiler, iframe sanitizer,
native message delivery, rendering, disk persistence or live GMCP transport.
Standalone Chromium checks cover 220–640 px panel widths, 8–48 px fonts,
long numeric readouts, alert and unknown states, reduced motion, and settings
layout/editing. These use the plugin's generated HTML with synthetic bindings;
they do not test native iframe sanitization or widget message delivery.
This checklist requires separate authorization for disposable native or live testing.

- Install the `aardwolf-api` library, API Core and Aardwolf Vitals 0.1.3 in a
  disposable world. Verify one compact horizontal strip with left labels and
  overlaid numeric readouts, status beside the title, and no message area below
  the bars. The new Target/Alignment row and character summary should fit at
  640 × 150 px with default typography.
- Resize above/below 480 px, open the floating Settings window and try large
  fonts. Expect readable wrapping, accessible controls, vertical scrolling and
  preserved geometry.
- Send current/maxima packets in either order and partial/invalid data. Verify
  unknown values are neutral, zero maxima suppress alerts, and over-max values
  preserve numeric readouts while bars remain bounded.
- Feed the supplied `char.status` sample. Verify an owl at 93%, alignment
  +1867 Good, Level 210, TNL 1000, Hunger/Thirst 70, Active and Standing.
- Send partial status packets, all documented state codes, unknown codes and
  invalid fields. Confirm ordinary updates preserve settings edits and focus.
- Replace and clear the enemy; distinguish No target from Target unknown.
  Confirm names containing markup remain literal text, long names truncate
  with full hover text, missing HP is unknown, and only the target fill clamps.
- Check alignment at −2500, −875, −874, 0, 874, 875 and 2500. Verify segment
  colors, signed values, categories and marker placement, including out-of-range
  clamping and a hidden marker for unknown data.
- Disconnect, reload Core and reconnect; confirm all character-status displays
  clear while unavailable and remain isolated between two disposable sessions.
- Cross each configured threshold, including equality. Verify red HP, blue mana
  and yellow moves, their matching Low/Critical shades, a gentle critical border
  pulse and recovery to normal. Enable OS
  reduced motion and verify the pulse stops.
- Navigate and operate Refresh, Settings, Close, Save and Reset using the keyboard.
  Confirm Refresh failures appear in its hover text and successful refreshes
  add no message area below the bars.
  Close settings with Escape and ×; reopen repeatedly and confirm one window,
  intact unfinished edits, and continued vitals updates. Save/Reset stays open.
  Confirm native action/submit payloads and the iframe ready/property handshake.
- Change font family/size/weight/style and per-vital thresholds. Check validation
  errors, refused saves, successful reset and feedback separate from session
  status. Type unfinished settings during repeated GMCP updates; edits and
  focus must remain intact.
- Save settings, disable/reload, and close/reopen the disposable world. Verify
  actual disk persistence, one vitals panel, settings closed until requested,
  and no stale callbacks. Test disconnect, Core reload and two sessions with different vitals and preferences.
- With a separately authorized live Aardwolf connection, observe current and
  maximum GMCP fields, use Refresh and verify a fresh server response. This is
  independent of native loopback or offline fixture results.
- Complete the preservation/cleanup checks above before recording native success.
