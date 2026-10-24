# Native acceptance — pending

Target: **MudForge 2.0.3701**, initially observed on macOS. Repository tests do
not establish native rendering, persistence, picker, transport or live Aardwolf
acceptance. The checks below remain pending unless observed results are
recorded explicitly for their version and environment.

Use an explicitly authorized disposable world for these checks. Record the
actual app version, original selected world and a private backup before writes.
Do not use an existing character profile or map as the fixture. Keep credentials,
private messages, world exports and raw gameplay logs out of this repository.

## Native library and lifecycle

- Install the library separately, then Core and the example. Verify each loaded
  library version is 0.4.0 and Core/example versions are 0.1.0, including library
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

## Native storage and migration — verified subset

### 2026-10-24 native verification — MudForge 2.0.3915

A disconnected disposable world (`Native Storage Acceptance 20261024`,
127.0.0.1:9, auto-connect off) loaded API 0.4.0 under the isolated library name
`aardwolf-api-storage-acceptance` and Spells 0.3.0 with that dependency name.
The editor reported no problems and the damage panel rendered. Native chooser
and paste imports were exercised, including a fresh record, identical-import
refusal to write again, and exact persistence after closing/reopening the world.

Native execution exposed a read-back comparison bug: table constructors can
retain nil-valued optional fields in `pairs()`. Equality now ignores those
entries, matching Lua's absent-field semantics; a fixture regression reproduces
this behavior. The initial missing completion output did not establish a failed
picker callback: exported native state showed that the data had been saved.
The corrected importer verifies both chooser and paste paths. Results also remain
available through `awspells status`, and the paste panel displays feedback.

After disposable acceptance, the existing Spells installation was updated in
place to 0.3.0 with its original installed ID. In-place **Reinstall** refreshed
the installed version label, which the source editor alone had retained at the
old version. API 0.4.0 was saved as the native edited library; MudForge reloaded
Core, Vitals, Spells and Room Details without editor problems. The underlying
previous repository library remains available beneath this edited override.

The authorized existing-world migration imported **370 abilities, 89 details,
88 memberships, 40 refresh timestamps and 0 command overrides** while disconnected.
Its exported native record matches every converter field after normalizing
one-based numeric-key tables and nil/null fields. Closing/reopening the original
world and repeating the import reported identical saved data. Existing Spells
layout tables, unrelated plugin states, map rooms/connections/styles, world
definition, and all existing widget positions were preserved. Native reopen
updated only map save/cursor state; the optional paste panel adds its own saved
placement without changing existing widget positions.

Private before/after world exports, a consistent SQLite backup, the converter
JSON and a verification report were retained outside the repository. The original
SQLite database was not modified or deleted. With explicit cleanup approval,
the disposable world and isolated test library were deleted; the original
session label and selection were restored, still disconnected. No diagnostics
remain in distributed or installed production code.

These results establish native import, read-back, in-place installation and
world-reopen persistence. Connected collection, live Aardwolf transport,
comprehensive UI interaction, platform variants and the remaining scenarios
below are still pending; do not infer those results from migration acceptance.

Offline tests execute native-storage host fixtures and convert temporary real
legacy SQLite databases. They do not verify MudForge's transpiler, platform
file picker, storage engine or world reopen durability. The former Python
helper, SQL facade and SQLite demonstration plugin have been removed.

- Back up the selected world and preserve original plugin IDs, layout and saved
  data. Use disposable records for failure and conflict tests. A separately
  authorized migration into an existing world must preserve unrelated data.
- Install API 0.4.0 and Spells 0.3.0. With File System Access off and no helper,
  verify load/reload/disable/re-enable, native table availability and useful
  `starting`/`failed` storage status without automatic retries.
- Convert a legacy Spells fixture with `tools/migrate-spells-storage.py` and
  compare all fields/counts with its source, including optional fields, empty
  groups, multi-group memberships and retained command overrides. Verify source
  preservation, committed WAL support, private output and refusal to overwrite
  an existing export. Unknown schema or malformed data must fail without loss.
- While disconnected, run `awspells import` and choose the JSON. Verify the
  asynchronous native picker callback, count message and saved/read-back record.
  Cancellation, unavailable picker, invalid/oversized/future input and callbacks
  after unload, world switch or identity change must not write or send commands.
- Import twice: identical data must produce no additional save. Import different
  data for the same native key: refuse replacement and retain both inputs.
  Refused saves/read-back failure must report failure and preserve backups.
- Reopen/reload the world and confirm complete native persistence, original
  layout order/visibility and unchanged public schema-1 consumer snapshots.
  Verify separate characters, worlds and installed plugin IDs remain isolated;
  an offline import becomes exposed only for verified matching character data.
- Compare before/after worlds, maps and unrelated plugin records. Remove only
  disposable fixtures and restore the originally selected world. Record native
  evidence separately from connected Aardwolf acceptance.

## Room Details — 0.2.3 acceptance pending

Offline fixtures exercise capture/suppression return values, ANSI state passed
to a stubbed native formatter, bounded recovery, login sequencing, selection,
room-event ordering and refresh scheduling. They do not execute MudForge's
transpiler, ANSI parser, actual suppression or docking. Browser checks exercise
the real panel markup with synthetic native messages, not live room transport.

- In an independently authorized disposable world, install `aardwolf-api`, API
  Core and Room Details 0.2.3. No helper, database or file permission is required.
  Record the client version. Keep Core as the only GMCP negotiation owner.
- Observe the initial 360 × 240 widget, drag-to-dock, resizing at 200/360/540/900 px,
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
- Open Font settings by mouse and keyboard. Set room text to 6/10/32 px and
  interface text to 8/10/20 px, resize, and check ellipsis, headings and controls.
  Changes must preserve rows, selection, Details, focus and scroll. Close/Escape
  returns focus to the gear. Change terminal size while an override is active,
  then choose Terminal or Reset to resume following it. Verify independent sizes
  survive plugin reload and world reopen. Refused saves retain the saved sizes
  and show an error; font controls send no game commands.
- Verify only ready/visible panel captures are suppressed. Close the panel,
  delay its ready message and remove a formatting API in a fixture: output
  must remain readable. Exercise mismatched/nested tags, missing close, 500-line,
  128-KiB and five-second bounds; confirm incomplete content and released gagging.
- Select either kind with mouse/keyboard, copy text and preserve focus/scroll
  through updates to the other section. Selection must send no command and
  must survive identical snapshots and clear on its changed section/room/character
  or connection. Server markup stays text. Confirm unchanged status packets send
  no widget updates after initial ready delivery; iframe ready forces a full view.
- Check character markers across differently colored ANSI spans: `(Golden Aura)
  (White Aura)` displays as `(G)(W)` with each retained character styled as in
  the original. Leading object indentation disappears for display only;
  `(Magic) (Hum) A bag (open).` becomes `(M)(H) A bag (open).`
  Description parentheses and original text in Details remain unchanged.
- Long descriptions stay on one compact row at every width, with an ellipsis
  and full-text tooltip. Verify copying preserves the displayed text and
  ANSI spans retain their styling. Blank spacer rows occupy no vertical space.
- Verify the bottom-right Font settings/Auto/Details/Refresh bar stays visible while lists
  scroll, without hiding the last row. Copy/Close must sit at the lower right
  inside Details and remain reachable with long descriptions and copy feedback.
  Verify a 24 px buffer after the controls in both bars, clear of the corner grip.
- Open Details with the toolbar icon, double-click and Enter on a selected row.
  Check native dialog focus containment, Close/Escape focus restoration, narrow
  layout, scrolling and preserved original ANSI formatting. Copy must use original
  plain text; refused/unavailable clipboard must select text with honest fallback
  instructions. Unrelated updates must preserve the dialog; changed selected
  snapshots/room/character/connection must close it. No selection/detail action
  may send a game command.
- Confirm room GMCP before/after tagged blocks and the prompt preserves the new
  lists without mixing old-room content. Test two sessions and disconnect.
- Combat ending and the documented item commands should coalesce into one look
  after a normal prompt, active state and 300 ms quiet, never faster than one
  per second. Confirm no looks during combat, pager, a room block, or Spells
  collection/save. Native provisional/newline prompts must not double-send.
- Verify Refresh, Auto on/off, failed sends, refused timers and five-second
  response timeout. Pending/in-flight feedback stays in the toolbar; sleeping,
  pager, prompt, Spells and connection waits explain the actual blocking reason.
  Resolved capture/refresh faults disappear while unrelated failures remain.
  Auto is the only persisted preference. Cleanup must cancel
  timers/unsubscribe/destroy the widget and must not send tag-off commands.
- Record connected Aardwolf acceptance separately, including automatic look
  timing with real command aliases and server output. Complete preservation and
  cleanup checks before marking native or live acceptance complete.

## Aardwolf Spells — native and live acceptance pending

Offline fixtures test parsing, collection lifecycle, native record validation,
save refusal, reload, import and shared access. Converter tests exercise real
legacy databases separately. These tests do not execute MudForge's transpiler,
storage engine, picker, command hooks, provisional output, pager or connected
Aardwolf transport.

- With separate authorization, install library 0.5.0, API Core and Spells 0.4.0
  in a disposable world. Record the client version and confirm both
  provider/consumer load orders and actual installed IDs.
- With File System Access off and no helper, complete simulated login. Refuse
  native readiness or saves in a disposable fixture; expect actionable feedback,
  prior saved data retained and no repeated retries. Recover and invoke refresh.
- Deliver `char.base.name` and active state in either order. Expect one
  automatic query only after negotiated GMCP and state 3, including enable
  during an existing active session. Repeat updates; no additional query occurs.
- Feed the supplied table with ANSI, dash fields, stars, repeated page headers
  and chatter. Verify display order, preserved terminal output/prompt and the
  native record after the footer. Verify Lua pattern behavior and provisional
  line delivery directly in the installed client.
- Test plain user `allspells`, filtered variants, overlapping refreshes, manual
  pager continuation, malformed/duplicate rows and missing footer. Wait 60
  seconds for a partial capture; the previous native snapshot must survive.
  Do not change the character's pager settings or send pager-control commands.
- Inspect committed snapshots from a separate `spells = true` consumer without
  storage adapters. Reload/disable the provider, disconnect during capture/save
  and switch character identity. Verify invalidation and no stale callbacks.
- Save/reopen the world and verify actual native ability, enrichment and command
  persistence. Confirm malformed/future stored records remain untouched and
  cannot be replaced by an automatic collection.
- Complete the import/preservation checks above before claiming migration
  acceptance. With a separately authorized live Aardwolf connection, compare
  collection results with visible output. Record live acceptance separately and
  remove only disposable test artifacts.

### Damage panel — 0.3.2 acceptance pending

Offline fixtures cover the supplied tables and mixed-type continuation rows,
empty bulk lists, two sequential requests, selection, command overrides, cancellation, malformed data and
character isolation. Native-storage fixtures cover kind-wide membership
replacement, mana/spell-number persistence, failed saves and reload. Converter
tests cover a legacy metadata/abilities-only database. Browser checks use
synthetic bindings/action capture and establish only rendered HTML behavior.

On 2026-10-24, Chrome checks of the 0.3.1 widget HTML with synthetic bindings
passed at 260 × 500, 540 × 400, 540 × 800, 1200 × 300 and 1600 × 220 px.
The two wide, short sizes used three and four columns respectively, with no
vertical scrolling needed for all 20 types. Checks also covered final-row and
toolbar access, cross-column drag/keyboard reordering, visibility changes,
long labels, wrapped status/feedback, focus/scroll retention and resizing without
host messages or preference changes. These do not establish native docking,
MudForge bridge behavior, persistence or live transport acceptance.

The same five sizes passed Chrome checks for 0.3.2 in normal and edit modes.
The panel rendered without the repeated title/status line, retained all 20 type
rows and kept the toolbar and final row reachable without horizontal overflow.

- Confirm the 0.3.2 panel omits the repeated in-panel title and status line.
  Run `awspells status` to inspect collection state and errors; layout-save
  failures must still display their feedback in the panel.
- In an authorized disposable world, observe the 540 × 400 panel, then dock it,
  resize to narrow/wide tiles, close/reopen with `awspells show`, reload and reopen
  the world. Verify saved docking, position and visibility, readable stacked
  rows, vertical scrolling and one panel through character/client rebuilds.
  Check 260 × 500, 540 × 400, 540 × 800, 1200 × 300 and 1600 × 220 px content
  areas: wide, short layouts should split into readable columns in saved order,
  down each column then across, keeping each type's Skill and Spell together.
  Below 360 px in height, verify compact spacing and 22 px ability buttons with
  unchanged text size. Narrow columns should stack controls; insufficient space
  should scroll vertically without horizontal overflow.
- Confirm Edit, Refresh all and Cancel remain at the lower right before/after
  scrolling and while editing or collecting. The final ability row must remain
  reachable, and hidden rows must not move the bar away from the bottom. Verify
  a 24 px buffer after Cancel, clear of the corner grip. Repeat in compact and
  multicolumn layouts, with wrapped layout feedback, long ability names and all
  rows hidden. The final row must not be obscured by the toolbar.
- Check the icon-only Edit, Refresh all and Cancel collection toolbar labels,
  tooltips and keyboard focus. Enter Edit: all 20 types and 40 slots must be
  visible with checked-means-visible checkboxes, and ability execution disabled.
  Hide one type, one slot and both slots of a row; leave Edit and confirm the
  correct controls disappear. Re-enter Edit to restore them, including after
  hiding every row. Refresh all must still collect both bulk lists.
- Drag a type using its handle; verify a single immediate native save and the
  resulting order. Focus a handle and use Alt+Up/Down, including first/last-row
  boundaries. Ordinary updates must preserve drag state, focus and scroll.
  Reorder across column boundaries by dragging and keyboard; visual order must
  match saved order. Resize repeatedly in normal and edit layouts and confirm
  focus remains on the same control, ordinary updates retain scroll, and resizing
  alone neither saves preferences nor sends gameplay commands. Visibility changes
  and entering/leaving Edit must reflow the columns without losing row controls.
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
- Run Refresh all: expect `skills combat`, `spells combat`, then `spells area`, including `No skills found.` and
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
  full `allspells` replacement, malformed/duplicate/conflicting rows and native
  save refusal without retrying writes.
- Feed the supplied `spells area` table. Confirm matching saved names get
  `area = true` in native storage and a separate consumer, including 1% rows.
  Confirm case-insensitive matching, unknown names skipped, stale flags cleared
  after complete/empty area output, and unchanged canonical fields/damage groups.
  Test manual `spells area`, cancellation, timeout, malformed rows and refused
  saves retaining prior flags. Reload and save/reopen the disposable world to
  verify persistence. Full/combat refreshes must preserve retained area flags.
- Save, inspect and reset a skill command override. Reload/reopen and switch
  characters; verify native record isolation, persistence and command precedence.
  Check a converted legacy database retains its abilities and command overrides.
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

- Install the `aardwolf-api` library, API Core and Aardwolf Vitals 0.1.6 in a
  disposable world. Verify one compact horizontal strip with left labels and
  overlaid numeric readouts, status beside the title, and no message area below
  the bars. The Target/TNL/Alignment row and character summary should fit at
  640 × 150 px with default typography.
- Resize above/below 480 px, open the floating Settings window and try large
  fonts. Expect readable wrapping, accessible controls, vertical scrolling and
  preserved geometry.
- Send current/maxima packets in either order and partial/invalid data. Verify
  unknown values are neutral, zero maxima suppress alerts, and over-max values
  preserve numeric readouts while bars remain bounded.
- Feed the supplied `char.status` sample. Verify an owl at 93%, alignment
  +1867 Good, Level 210, TNL 1000, Hunger/Thirst 70, Active and Standing.
- Send `char.base.perlevel = 2000` and TNL 2000, 1000 and 0: expect 0%, 50%
  and 100% teal fill between Target and Alignment, with remaining XP in the bar
  and no duplicate summary entry. Verify tooltip/accessibility text, updates in
  either packet order, changed perlevel and level rollover. Missing/invalid TNL
  or missing/nonpositive perlevel must be neutral with an unknown percentage;
  out-of-range TNL preserves its number while the fill stays within 0–100%.
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
- Verify Settings/Refresh sit at the lower right of Vitals, and Save/Reset/Close
  at the lower right of Settings, including 200 px width and short windows.
  Both bars must reserve 26 px after the buttons, clear of the corner grip; all
  settings fields must remain visible when tabbing with wrapped controls.
  Scroll through all content; bars must remain visible and the last field/row
  reachable. Preserve saved native geometry and unfinished form edits.
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
