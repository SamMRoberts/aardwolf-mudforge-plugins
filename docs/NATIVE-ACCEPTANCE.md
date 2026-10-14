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

## Room Details — 0.1.0 acceptance pending

Offline fixtures exercise capture/suppression return values, ANSI state passed
to a stubbed native formatter, bounded recovery, login sequencing, selection,
room-event ordering and refresh scheduling. They do not execute MudForge's
transpiler, ANSI parser, actual suppression or docking. Browser checks exercise
the real panel markup with synthetic native messages, not live room transport.

- In an independently authorized disposable world, install `aardwolf-api`, API
  Core and Room Details 0.1.0. No helper, database or file permission is required.
  Record the client version. Keep Core as the only GMCP negotiation owner.
- Observe the initial 360 × 240 widget, drag-to-dock, resizing at 200/360/540 px,
  close/show, reload and world reopen. Confirm saved placement/visibility.
- After authenticated active status, observe exactly `tags roomobjs on`,
  `tags roomchars on`, then `look`. Repeat status packets, reconnect, enable in
  an already connected world and restart Core. A new plugin runtime performs
  one setup; a temporary Core restart does not repeat it.
- Feed the example in `tests/fixtures/room-details.txt`, empty blocks, duplicate
  descriptions and multiline output. Compare panel text against unsuppressed
  console output: terminal font, 16/256/true colors, foreground/background,
  native intensity, italic/underline and styles spanning tags/lines. Change
  terminal font and verify synchronization on incoming output/show/resize.
- Verify only ready/visible panel captures are suppressed. Close the panel,
  delay its ready message and remove a formatting API in a fixture: output
  must remain readable. Exercise mismatched/nested tags, missing close, 500-line,
  128-KiB and five-second bounds; confirm incomplete content and released gagging.
- Select either kind with mouse/keyboard, copy text and preserve focus/scroll
  through updates to the other section. Selection must send no command and
  must clear on its section/room/character changing. Server markup stays text.
- Confirm room GMCP before/after tagged blocks and the prompt preserves the new
  lists without mixing old-room content. Test two sessions and disconnect.
- Combat ending and the documented item commands should coalesce into one look
  after a normal prompt, active state and 300 ms quiet, never faster than one
  per second. Confirm no looks during combat, pager, a room block, or Spells
  collection/save. Native provisional/newline prompts must not double-send.
- Verify Refresh, Auto on/off, failed sends, refused timers and five-second
  response timeout. Auto is the only persisted preference. Cleanup must cancel
  timers/unsubscribe/destroy the widget and must not send tag-off commands.
- Record connected Aardwolf acceptance separately, including automatic look
  timing with real command aliases and server output. Complete preservation and
  cleanup checks before marking native or live acceptance complete.

## Aardwolf Spells — native and live acceptance pending

Offline fixtures test parsing, collection lifecycle and shared access. The real
file bridge test stores 250 abilities in SQLite, verifies rollback, reads back
an unknown commit outcome, reloads persisted data and separates characters.
These tests do not execute MudForge's transpiler, real file adapters, command
hooks, provisional output, pager or connected Aardwolf transport.

- With separate authorization, install library 0.3.0, API Core and Spells 0.2.4
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

### Damage panel — 0.2.4 acceptance pending

Offline fixtures cover the supplied tables and mixed-type continuation rows,
empty bulk lists, two sequential requests, selection, command overrides, cancellation, malformed data and
character isolation. The real bridge exercises a 0.1.0-shaped database upgrade,
kind-wide membership replacement, mana/spell-number persistence, rollback, unknown
outcome readback and reload. Browser checks use synthetic bindings/action capture
and establish only rendered HTML behavior.

- In an authorized disposable world, observe the 540 × 400 panel, then dock it,
  resize to narrow/wide tiles, close/reopen with `awspells show`, reload and reopen
  the world. Verify saved docking, position and visibility, readable stacked
  rows, vertical scrolling and one panel through character/client rebuilds.
- Check the icon-only Edit, Refresh all and Cancel collection toolbar labels,
  tooltips and keyboard focus. Enter Edit: all 20 types and 40 slots must be
  visible with checked-means-visible checkboxes, and ability execution disabled.
  Hide one type, one slot and both slots of a row; leave Edit and confirm the
  correct controls disappear. Re-enter Edit to restore them, including after
  hiding every row. Refresh all must still collect both bulk lists.
- Drag a type using its handle; verify a single immediate native save and the
  resulting order. Focus a handle and use Alt+Up/Down, including first/last-row
  boundaries. Ordinary updates must preserve drag state, focus and scroll.
  Resize to 220, 360 and 540 px and inspect both normal and edit layouts.
- Reload/reopen the disposable world and switch verified characters: order and
  visibility must persist independently, with Edit off. Refuse native storage
  writes and verify the previous layout is restored with feedback; delayed
  messages from the prior character must not alter the new character's layout.
  Confirm native `luamsg` delivery and the ready/property handshake directly.
- Load an existing 18-type layout with custom order and hidden slots. Confirm
  those settings survive, Disease and Special appear at the end, and the next
  explicit layout change saves the expanded configuration.
- Feed the supplied bash and fire lists: expect Sap and None learned respectively.
  Include 0/1/2% practice, stars, equal levels/percentages and a level decrease.
  Verify actual text/attribute bindings, disabled state and retained focus/scroll.
- Click and keyboard-activate an ability and the toolbar's Refresh all. Verify one
  `sap`, `dirt` or `cast <sn>` as applicable, with no appended target; verify
  refreshed output is preserved. Test active/combat/ineligible/disconnected
  states and unsafe/invalid widget actions without sending commands.
- Run Refresh all: expect only `skills combat` followed by `spells combat`, including `No skills found.` and
  `No spells found.`. Confirm native empty-output wording and table footers,
  repeated headers, ANSI-clean lines, manual pager continuation and bounded
  timeouts. Include `Hammerswing 85%` with a blank Damage column: retain its
  catalog fields without a damage-group button, keep Sap as the Bash selection,
  and continue to `spells combat`. Cancel while capturing, preparing and saving; no further queued
  query may begin. Disconnect/change character/lose eligibility mid-queue.
- Feed mixed Damage columns, inherited levels, Disease and Special, lower
  practice or omit a prior winner. Verify replacement across all groups of that
  kind, empty omitted groups, and preservation of the other kind. Confirm there
  are no per-type refresh controls. Test an ability in two damage groups,
  full `allspells` replacement, malformed/duplicate/conflicting rows, helper
  failure and an unknown commit outcome without retrying writes.
- Save, inspect and reset a skill command override. Reload/reopen and switch
  characters; verify database isolation, persistence and command precedence.
  Check upgrade from a disposable 0.1.0 database retains its abilities.
- Live acceptance remains separately authorized. Compare both list formats and
  actual commands with visible server output, then complete preservation/cleanup
  checks before recording success.

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
