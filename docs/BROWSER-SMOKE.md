# Reproducible browser smoke checks

`npm run test:browser` runs the built widget documents in headless Chromium with
an explicitly synthetic host. It checks rendering, keyboard input and update
stability. These results belong to the **synthetic-browser** layer in the
[acceptance ledger](ACCEPTANCE-EVIDENCE.md); they do not establish native
MudForge bridge, docking, storage, transpilation or live Aardwolf acceptance.

## Run

Use the repository's Node/npm versions described in [CI](CI.md). From the root:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

On a Linux runner that needs browser system libraries, use
`npx playwright install --with-deps chromium` during setup instead. Installation
is a separate, networked setup step. The smoke tests serve embedded documents
only over an ephemeral `127.0.0.1` port and fail unexpected external requests.
Playwright and its matching Chromium revision are pinned through the lockfile;
see the [official browser setup documentation](https://playwright.dev/docs/browsers).

The command first runs `build:check`. Stale/missing generated files fail before
the browser starts; it does not rebuild them. If source was deliberately changed,
run `npm run build`, review the generated diff, then rerun the command. No plugin
version change or regeneration is needed for changes confined to this harness.

Useful subsets and interactive troubleshooting:

```sh
npm run test:browser -- --project=narrow
npm run test:browser -- atlas.spec.mjs
npm run test:browser -- widgets.spec.mjs --headed
```

The projects use **320 × 480** and **1280 × 720** viewports. Spells also resizes
to **260 × 220** or **1280 × 220** during the interaction. Chromium uses
SwiftShader software WebGL for reproducibility; a machine without functional
software WebGL fails the rendering/context-loss cases instead of skipping them.
Browser launch failure is a setup failure, never a passing browser result. Some
restricted macOS execution environments need permission to launch Chromium.

This is a separate, opt-in command. `npm test` and the existing GitHub Actions
workflow continue to run the offline Node/Python checks without launching a
browser. To run this harness in another CI job, install its matching Chromium
and system dependencies, then invoke the same command and retain its output.

## Documents and synthetic bridge

[documents.mjs](../tests/browser/documents.mjs) captures Inventory summary,
manager and setup; Spells; Room Details; and Vitals panel/settings by executing
**`dist/` Lua files** in the existing Fengari host fixture with the `distribution`
option. The library and Core also load from `dist/`. This includes dynamically
assembled markup and initial property/binding snapshots; it never copies an old
HTML preview into the tests. Atlas HTML is extracted directly from the long
string in **`dist/plugins/aardwolf-atlas.lua`**, including its bundled renderer
and artwork. Auxiliary Atlas documents are extracted for provenance but are not
exercised by these scenarios.

The documents are served without rewriting them. Before their scripts run,
[bridge.mjs](../tests/browser/bridge.mjs) installs `window.mudforge` with this
limited contract:

| API | Synthetic behavior |
| --- | --- |
| `onProperty(name, callback)` | Registers property receivers; `smoke.property` delivers JSON strings. |
| `send(event, data)` | Records a structured clone in `smoke.messages`, emits a `smoke-send` browser event and returns success. It never executes a command. |
| `onMessage(callback)` | Receives fixture messages delivered by `smoke.receive`; used by Atlas. |
| `showMenu(items, x, y)` | Records menu requests only; it does not implement native menus. |
| Bound text/styles/attributes | `smoke.bindings` applies the supplied snapshot to `data-mud-bind*` nodes using text content, CSS properties and attributes. Boolean `aria-disabled` also controls button disabled state. |
| Declarative actions/forms | DOM clicks and default form submissions record synthetic action/form messages. Document-owned form handlers keep their own behavior. |

Tests supply accepted layout/property replies explicitly. They check the actual
browser DOM and outbound payloads, without claiming that a native host accepted
or persisted them. The [Atlas bridge](../tests/browser/atlas-bridge.mjs) replies
to ready, area, inspect, route and preference messages using three fixed rooms
in two fixture areas. Routes and preference acknowledgments are synthetic;
there is no mapper, disk storage, MUD connection or gameplay in this harness.
Initial fixture collection uses existing offline Lua helpers, including their
ANSI stub; this does not test MudForge's native ANSI formatter.

## Coverage

There are nine scenarios, each run at both viewport sizes:

| Surface | Checked behavior |
| --- | --- |
| Inventory summary | Carried count update, bag Enter activation, Setup by Space, retained bag focus. |
| Inventory manager | Search and result updates; selected-row Enter; recipient draft/focus surviving unrelated updates; submitted payload. |
| Inventory setup | Unsaved potion/rule text, focus and scroll survive new bag discovery; keyboard save payload; simulated save refusal retains draft. |
| Spells | Learned ability bindings, keyboard edit/reorder, accepted order/focus, label update, compact resize and reachable toolbar. |
| Room Details | Literal markup stays text, original-text filtering, duplicate row selection, Tab/Enter Clear, Enter details, Escape focus restoration, Space collapse. |
| Vitals | HP text/bar/severity updates, keyboard refresh, settings draft/focus retained through an ordinary bound update, keyboard form submission. |
| Atlas rendering | Nonuniform WebGL pixels from the built renderer, keyboard pan/zoom/3D/search selection, fixture route, retained search draft/focus, area replacement. |
| Atlas unavailable WebGL | Null WebGL contexts before startup, visible failure feedback, keyboard native-mapper fallback **message**. |
| Atlas context loss | Real `WEBGL_lose_context` extension loss, visible failure feedback, keyboard fallback message. |

Widget cases also assert no horizontal document overflow. Initial and final
screenshots are evidence for human inspection, not pixel-diff baselines or a
complete accessibility audit. The rendered Atlas pixel check requests
`preserveDrawingBuffer` in the browser fixture so pixels remain readable after
composition. The unavailable-WebGL test expects exactly the pinned renderer's
initialization console error; all other console errors and uncaught exceptions
fail. Warnings are retained for inspection. Network failures and HTTP errors
also fail the run.

Not covered: native menus/windows/docking, OS scaling, native bridge delivery,
clipboard permissions, storage read/write/reopen, native transpilation, live
GMCP/terminal collection, terrain-pack import, other browser engines, the Vitals
Example and auxiliary/import widgets. Follow the
[native checklist](NATIVE-ACCEPTANCE.md) for those distinct acceptance gates.

## Evidence and failures

The command prints `Synthetic browser evidence: <directory>`. By default each
run creates a unique directory in the system temp folder, outside the checkout.
To choose a durable location, supply a fresh external directory:

```sh
SMOKE_OUTPUT_DIR=$(mktemp -d /tmp/aardwolf-smoke.XXXXXX) npm run test:browser
```

Keep the printed directory after a failure. Reusing a directory replaces its
Playwright `artifacts/` results. Paths inside the checkout are refused. Copy
needed evidence to a durable external location before temporary cleanup.

- `results.json` records scenario outcomes, failures and attachment paths.
- `artifacts/` contains initial/final PNG attachments and per-test
  `evidence.json`: UTC observation time, source commit, tracked patch SHA-256,
  untracked input hashes, artifact versions/hashes, captured HTML hashes,
  documents actually loaded, Node/Playwright/Chromium/OS/viewport details,
  console warnings/errors, request failures and outbound bridge messages.
- Failures retain a Playwright trace and error context. Open a retained trace
  with `npx playwright show-trace /absolute/path/to/trace.zip`.

Artifact hashes are captured alongside document extraction. A changed
artifact during capture fails rather than attributing old HTML to new bytes.
Console/network evidence is still written if the page closes or screenshot
capture fails; a capture failure also fails the test. Browser-launch/setup
failures occur before page evidence is available and remain in `results.json`.
The JSON run result is the authoritative pass/fail record; an evidence snapshot
alone is not a pass.

When appending an observation to the acceptance ledger, identify the exact
source/patch and untracked input hashes from this run, the built artifact set,
actual environment and retained evidence location. Keep native/live rows
pending unless those separate checks were actually performed.
