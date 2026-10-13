# aardwolf-mudforge-plugins

A shared Lua API for Aardwolf plugins in [MudForge](https://mudforge.org/).
Version **0.1.0** provides a session Core, an injected library facade, storage
and widget helpers, and a small reactive vitals example.

| Component | Purpose |
| --- | --- |
| `aardwolf-api` library | Data subscriptions, snapshots, refresh requests, local persistence and consumer-owned UI |
| Aardwolf API Core | One GMCP negotiation owner and one authoritative state cache per session |
| Aardwolf API Vitals Example | HP/mana/moves bindings, an explicit refresh button and saved font-size preferences |

## Installation

This checkout includes generated install files and a repository catalog. They
have **not been published or installed** by this scaffold.

1. Install `dist/libs/aardwolf-api.lua` through **Plugin Manager → Libraries**.
   Use the library name `aardwolf-api` (no extension).
2. Disable any other Aardwolf GMCP negotiation owner, including **Aardwolf
   Core** / `aw-core` / `aardwolf-core`, in the target world.
3. Install and enable `dist/plugins/aardwolf-api-core.lua` as a plugin.
4. Optionally install `dist/plugins/aardwolf-api-vitals-example.lua`.

With these files hosted, the root `plugins.json` publishes both plugin and
library listings. Add the repository URL in MudForge's repository manager,
then install the library and plugins from their respective tabs. No `.mfp`
package or world/profile data is included. A user-edited/file library can take
precedence over a repository library of the same name; check the loaded copy
when testing updates.

Core discovers registered consumers in either load order. Each consuming
plugin gets its own library instance; Core communicates with them using
world/session-scoped messages. The API does not connect to the MUD itself.

## Writing a consumer

```lua
plugin = {
  id = "my-aardwolf-plugin", name = "My Aardwolf Plugin", version = "0.1.0",
  author = "Your name", description = "Reads vitals through the shared API."
}

local client, unsubscribe

function init()
  if type(client) == "table" then return end
  local aardwolf = require("aardwolf-api")
  client = aardwolf.new({
    findPluginByName = findPluginByName,
    onPluginBroadcast = onPluginBroadcast, broadcastToPlugin = broadcastToPlugin,
    on = on, off = off, sendGMCP = sendGMCP
  }, { packages = { "Char" } })
  unsubscribe = client.on("char.vitals", function(vitals)
    if type(vitals) == "table" and type(vitals.hp) == "number" then
      echo("HP: " .. tostring(vitals.hp))
    end
  end)
  client.start()
end

function cleanup()
  if type(client) ~= "table" then return end
  unsubscribe()
  client.stop()
  client = nil
end
```

Use one API instance per consuming plugin. Subscribe before `start()` to
receive the initial state. Subscribe to `session` to clear a display when Core
stops or the connection closes. Call `get()` after subscribing if you need to
render an instance that was already started.

See [the API reference](docs/API.md) for adapters and semantics, and
[the vitals source](src/plugins/aardwolf-api-vitals-example.lua) for a complete
consumer with storage and widgets.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run build:check
git diff --check
```

Edit `src/`; `build` copies exact Lua bytes into `dist/` and regenerates catalog
hashes/sizes. Commit source and generated files together when making a release.
The generator has no timestamps or network dependency and resolves paths
relative to this repository, including when run from another directory.

Tests check Lua 5.1 syntax and execute behavior in **Fengari's Lua 5.3 VM**
with injected host fixtures. This verifies library logic, simulated lifecycle,
and deterministic distribution; it does not execute MudForge's JavaScript
transpiler, native widgets, persistence engine or GMCP transport.

The initial native target is MudForge **2.0.3701**. Native and live-MUD
acceptance remain pending; follow [the separate checklist](docs/NATIVE-ACCEPTANCE.md).
No existing worlds, maps or plugins were changed.

`npm audit` currently reports the unpatched moderate `sprintf-js` precision
specifier advisory through Fengari. These are development-only dependencies;
the distributed Lua files contain no Node dependencies. Fixture format strings
are fixed locally. See [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

## References

- [MudForge plugin and library authoring guide](https://mudforge.org/docs/ai-plugin-guide.md)
- [Aardwolf GMCP modules and commands](https://www.aardwolf.com/wiki/index.php/Clients/GMCP)

This foundation does not migrate older plugin suites, provide a mapper or
automate gameplay. Consumers must not send `Core.Supports.Set` themselves.
