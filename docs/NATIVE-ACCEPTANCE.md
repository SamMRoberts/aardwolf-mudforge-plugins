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
  version is 0.1.0, including library precedence over repository/package copies.
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
