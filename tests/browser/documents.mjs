import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { root } from '../../tools/build-repository.mjs';
import { runLua } from '../lua-runtime.mjs';

const read = path => readFileSync(`${root}/${path}`, 'utf8');
const fixture = name => read(`tests/fixtures/${name}.lua`);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Execute committed distribution bytes in the existing offline Lua host. This
// captures dynamic markup too; it does not execute MudForge's Lua transpiler.
export function builtDocuments() {
  const documents = {};
  const capture = (name, widget) => {
    assert.equal(typeof widget.content, 'string', `${name} has built HTML`);
    const properties = Object.fromEntries(['inventory', 'roomDetails', 'panelLayout', 'vitalsPreferences']
      .filter(key => widget[key] != null).map(key => [key, widget[key]]));
    documents[name] = { html: widget.content, bindings: widget.bindings, properties };
  };
  const captureLua = `function captureWidget(name, widget)
    capture(name, {content=widget.content,bindings=widget.bindings,inventory=widget.inventory,
      roomDetails=widget.roomDetails,panelLayout=widget.panelLayout,vitalsPreferences=widget.vitalsPreferences})
  end`;
  runLua(`${captureLua}\n${fixture('inventory-manager')}
    local world = inventoryWorld(); world.loaded(); world.open(); world.setup()
    for _, role in ipairs({"summary", "manager", "setup"}) do captureWidget("inventory-" .. role, world.widget(role)) end
  `, { capture }, { distribution: true });
  runLua(`${captureLua}\n${fixture('spells')}
    local world = spellsWorld(); world.active(); world.sample(); world.packet("char.status", { level = 200 })
    world.query("skill"); world.bash(); world.query("spell"); world.fire()
    world.panel().events.luamsg({event="ready",data={}})
    captureWidget("spells", world.panel())
  `, { capture }, { distribution: true });
  runLua(`${captureLua}\n${fixture('room-details')}
    local world = roomWorld(); world.ready(); world.active(); world.tick(300); world.prompt()
    world.block("chars", {"(White Aura) A merchant.", "(White Aura) A merchant.", "<img src=x onerror=bad()>"})
    world.block("objs", {"  (Magic) A key."})
    captureWidget("room-details", world.panel())
  `, { capture }, { distribution: true });
  runLua(`${captureLua}
    local world = newWorld(); world.core()
    local panel = world.loadPlugin("vitals", "vitals-id", "Aardwolf Vitals")
    world.connect(); world.packet("char.base", { name="Fixture", level=42, perlevel=1000 })
    world.packet("char.vitals", {hp=80,mana=60,moves=40})
    world.packet("char.maxstats", {maxhp=100,maxmana=100,maxmoves=100})
    world.packet("char.status", {state=3,tnl=250})
    local widget = panel.widgets["vitals-id:vitals"]
    captureWidget("vitals", widget)
    widget.events.action({action="settings"})
    local settings = panel.widgets["vitals-id:vitals-settings"]
    settings.events.luamsg({event="ready"})
    captureWidget("vitals-settings", settings)
  `, { capture }, { distribution: true });
  const atlas = read('dist/plugins/aardwolf-atlas.lua');
  for (const [name, binding] of [['atlas', 'HTML'], ['atlas-settings', 'SETTINGS_HTML'], ['atlas-details', 'DETAILS_HTML']]) {
    const match = atlas.match(new RegExp(`local ${binding} = \\[====\\[([\\s\\S]*?)\\]====\\]`));
    assert(match, `${name} exists in built Lua`);
    documents[name] = { html: match[1], bindings: {}, properties: {} };
  }
  return documents;
}
