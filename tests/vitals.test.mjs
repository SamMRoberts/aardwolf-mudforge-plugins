import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { root } from '../tools/build-repository.mjs';
import { runLua } from './lua-runtime.mjs';

const setup = `
  function panelWorld(session)
    local world = newWorld(session)
    local core = world.core()
    local panel = world.loadPlugin("vitals", "vitals-file-id", "Aardwolf Vitals")
    world.connect(); world.packet("char.base", { name = "Fixture" })
    return world, panel, panel.widgets["vitals-file-id:vitals"], core
  end
  function fullVitals(world, hp, mana, moves)
    world.packet("char.vitals", { hp = hp or 100, mana = mana or 100, moves = moves or 100 })
    world.packet("char.maxstats", { maxhp = 100, maxmana = 100, maxmoves = 100 })
  end
  function form()
    return { fontFamily = "system-ui", fontSize = "13", fontWeight = "normal", fontStyle = "normal",
      hpWarning = "30", hpCritical = "15", manaWarning = "30", manaCritical = "15", movesWarning = "30", movesCritical = "15" }
  end
`;

const cases = {
  'vitals starts before Core and synchronizes controls after the iframe is ready': `
    local world = newWorld()
    local panel = world.loadPlugin("vitals", "vitals-file-id", "Aardwolf Vitals")
    local widget = panel.widgets["vitals-file-id:vitals"]
    assert(widget.bindings.status == "Aardwolf API Core unavailable" and widget.vitalsPreferences == nil)
    widget.events.luamsg({ event = "unrelated" }); assert(widget.vitalsPreferences == nil)
    widget.events.luamsg({ event = "ready" }); assert(json.decode(widget.vitalsPreferences).fontSize == 13)
    world.core(); world.connect(); world.packet("char.base", { name = "Fixture" }); fullVitals(world, 20, 50, 80)
    assert(widget.bindings.hpValues == "20 / 100" and widget.bindings.hpLevel == "warning")
    assert(#panel.broadcasts == 1 and widget.contentWrites == 1 and panel.writes == 0)
  `,
  'vitals handles either packet order, numeric strings and partial updates': `
    for _, first in ipairs({ "vitals", "maxima" }) do
      local world, panel, widget = panelWorld()
      assert(widget.bindings.hpValues == "? / ?" and widget.bindings.hpLevel == "unknown")
      if first == "vitals" then
        world.packet("char.vitals", { hp = "50", mana = "20", moves = "10" })
        assert(widget.bindings.hpValues == "50 / ?" and widget.bindings.hpLevel == "unknown")
      else
        world.packet("char.maxstats", { maxhp = "100", maxmana = "100", maxmoves = "100" })
        assert(widget.bindings.hpValues == "? / 100" and widget.bindings.hpLevel == "unknown")
      end
      fullVitals(world, 50, 20, 10)
      assert(widget.bindings.status == "Live vitals")
      assert(widget.bindings.hpValues == "50 / 100" and widget.bindings.hpWidth == "50%")
      assert(widget.bindings.hpLevel == "normal" and widget.bindings.manaLevel == "warning" and widget.bindings.movesLevel == "critical")
      world.packet("char.vitals", { hp = "75" })
      assert(widget.bindings.hpValues == "75 / 100" and widget.bindings.manaValues == "20 / 100")
      world.packet("char.maxstats", { maxhp = "150" })
      assert(widget.bindings.hpWidth == "50%" and widget.bindings.movesValues == "10 / 100")
      assert(widget.contentWrites == 1 and panel.writes == 0)
    end
  `,
  'vitals marks invalid currents and nonpositive maxima unknown independently': `
    local world, panel, widget = panelWorld(); fullVitals(world, 10, 20, 30)
    world.packet("char.vitals", { hp = "bad", mana = {} })
    assert(widget.bindings.hpValues == "? / 100" and widget.bindings.hpLevel == "unknown" and widget.bindings.hpWidth == "0%")
    assert(widget.bindings.manaLevel == "unknown" and widget.bindings.movesState == "Low")
    world.packet("char.maxstats", { maxmoves = 0 })
    assert(widget.bindings.movesValues == "30 / ?" and widget.bindings.movesLevel == "unknown" and widget.bindings.movesPercent == "--")
    world.packet("char.maxstats", { maxmoves = -100 })
    assert(widget.bindings.movesLevel == "unknown")
    world.packet("char.maxstats", { maxmoves = "bad" })
    assert(widget.bindings.movesLevel == "unknown")
    world.packet("char.vitals", { hp = "" })
    assert(widget.bindings.hpLevel == "unknown" and widget.bindings.hpState == "Waiting")
    assert(widget.bindings.status == "Waiting for remaining vitals or maxima")
  `,
  'vitals compares exact thresholds and clamps bars without altering reported values': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    for _, sample in ipairs({ { 30.1, "normal" }, { 30, "warning" }, { 15.1, "warning" }, { 15, "critical" }, { 0, "critical" } }) do
      world.packet("char.vitals", { hp = sample[1] })
      assert(widget.bindings.hpLevel == sample[2])
    end
    world.packet("char.vitals", { hp = 150, mana = -5, moves = 100000 })
    assert(widget.bindings.hpValues == "150 / 100" and widget.bindings.hpWidth == "100%" and widget.bindings.hpLevel == "normal")
    assert(widget.bindings.manaValues == "-5 / 100" and widget.bindings.manaWidth == "0%" and widget.bindings.manaLevel == "critical")
    assert(widget.bindings.movesValues == "100000 / 100" and widget.bindings.movesPercent == "100%")
    world.packet("char.vitals", { hp = "Infinity" })
    assert(widget.bindings.hpLevel == "unknown")
  `,
  'vitals saves independent thresholds and typography with no markup rebuild': `
    local world, panel, widget = panelWorld(); fullVitals(world, 40, 40, 40)
    assert(widget.bindings.fontFamily == "system-ui" and widget.bindings.fontSize == "13px")
    local fields = form()
    fields.fontFamily, fields.fontSize, fields.fontWeight, fields.fontStyle = "SF Pro Text", "18", "bold", "italic"
    fields.hpWarning, fields.hpCritical = "60", "45"
    fields.manaWarning, fields.manaCritical = "45", "10"
    widget.events.submit({ formData = fields })
    assert(panel.writes == 1 and widget.bindings.feedback == "Preferences saved.")
    assert(widget.bindings.hpLevel == "critical" and widget.bindings.manaLevel == "warning" and widget.bindings.movesLevel == "normal")
    assert(widget.bindings.fontFamily == "'SF Pro Text'" and widget.bindings.fontSize == "18px")
    assert(widget.bindings.fontWeight == "bold" and widget.bindings.fontStyle == "italic")
    local values = json.decode(widget.vitalsPreferences)
    assert(values.fontSize == 18 and values.hpWarning == 60)
    local controls = widget.vitalsPreferences
    world.packet("char.vitals", { mana = 30 }); assert(widget.vitalsPreferences == controls)
    assert(widget.contentWrites == 1)
    panel.env.cleanup(); panel.env.init()
    widget = panel.widgets["vitals-file-id:vitals"]
    assert(widget.bindings.fontSize == "18px" and widget.bindings.hpLevel == "critical")
    assert(string.find(widget.content, 'value="SF Pro Text"', 1, true))
    widget.events.luamsg({ event = "ready" })
    assert(json.decode(widget.vitalsPreferences).fontWeight == "bold")
  `,
  'vitals rejects malformed, non-finite and injectable preferences before saving': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    for _, invalid in ipairs({
      { "fontFamily", "x';color:red" }, { "fontFamily", "<img src=x>" }, { "fontFamily", "" }, { "fontFamily", "   " },
      { "fontFamily", string.rep("a", 81) }, { "fontSize", "13.5" }, { "fontSize", "7" }, { "fontSize", "49" },
      { "fontSize", "" }, { "fontSize", " " }, { "fontSize", {} }, { "fontSize", math.huge }, { "fontSize", 0/0 },
      { "fontWeight", "900" }, { "fontStyle", "oblique" }, { "hpWarning", "15" }, { "hpWarning", "101" },
      { "hpCritical", "-1" }, { "hpCritical", "31" }, { "manaWarning", "" }, { "movesCritical", math.huge }
    }) do
      local fields = form(); fields[invalid[1]] = invalid[2]
      widget.events.submit({ formData = fields })
      assert(panel.writes == 0 and widget.bindings.fontSize == "13px" and widget.bindings.fontFamily == "system-ui")
      assert(widget.bindings.feedback ~= "Preferences saved." and widget.bindings.status == "Live vitals")
    end
    local missing = form(); missing.hpCritical = nil
    widget.events.submit({ formData = missing }); assert(panel.writes == 0)
    widget.events.submit({}); assert(panel.writes == 0)
    for _, size in ipairs({ "8", "48" }) do
      local fields = form(); fields.fontSize = size; fields.hpWarning = "100"; fields.hpCritical = "0"
      widget.events.submit({ formData = fields }); assert(widget.bindings.fontSize == size .. "px")
    end
    local fields = form(); fields.hpWarning, fields.hpCritical = "30.5", "15.5"
    widget.events.submit({ formData = fields }); assert(panel.writes == 3)
    assert(widget.contentWrites == 1)
  `,
  'vitals falls back on malformed or future storage without overwriting it': `
    local world, panel, widget = panelWorld()
    for _, envelope in ipairs({ { schemaVersion = 99, value = {} }, { schemaVersion = 1 },
      { schemaVersion = 1, value = { typography = {}, thresholds = {} } },
      { schemaVersion = 1, value = { typography = { family = "x';color:red", size = 13, weight = "normal", style = "normal" },
        thresholds = {} } } }) do
      panel.env.cleanup(); panel.storage["aardwolf-api:preferences"] = envelope; panel.env.init()
      widget = panel.widgets["vitals-file-id:vitals"]
      assert(widget.bindings.fontFamily == "system-ui" and widget.bindings.fontSize == "13px")
      assert(string.find(widget.bindings.feedback, "Using defaults:", 1, true))
      assert(panel.writes == 0 and panel.storage["aardwolf-api:preferences"] == envelope)
    end
  `,
  'vitals refused saves and resets preserve applied preferences and connection status': `
    local world, panel, widget = panelWorld(); fullVitals(world, 40, 40, 40)
    local fields = form(); fields.fontSize = "20"; fields.hpWarning = "60"
    widget.events.submit({ formData = fields }); assert(panel.writes == 1)
    panel.refuseWrites = true
    fields.fontSize = "30"; widget.events.submit({ formData = fields })
    assert(widget.bindings.fontSize == "20px" and widget.bindings.status == "Live vitals")
    assert(widget.bindings.feedback == "Preferences not saved: storage refused the write")
    widget.events.action({ action = "reset-defaults" })
    assert(panel.writes == 1 and widget.bindings.fontSize == "20px" and widget.bindings.hpLevel == "warning")
    panel.refuseWrites = false; panel.storageState = "starting"
    widget.events.action({ action = "reset-defaults" }); assert(panel.writes == 1)
    panel.storageState = "ready"; widget.events.action({ action = "reset-defaults" })
    assert(panel.writes == 2 and widget.bindings.fontSize == "13px" and widget.bindings.hpLevel == "normal")
    assert(json.decode(widget.vitalsPreferences).hpWarning == 30 and widget.bindings.feedback == "Defaults restored.")
    assert(widget.contentWrites == 1)
  `,
  'vitals refresh is explicit and reports unavailable and refused transport': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    local sent = #world.sent
    for i = 1, 10 do world.packet("char.vitals", { hp = i }); world.packet("char.base", { name = "Fixture" }) end
    assert(#world.sent == sent)
    widget.events.action({ action = "refresh" })
    assert(#world.sent == sent + 1 and world.sent[#world.sent].package == "request char")
    world.refuseTransport = true; widget.events.action({ action = "refresh" })
    assert(widget.bindings.feedback == "Refresh unavailable: transport refused the request")
    assert(widget.bindings.status == "Live vitals" and #world.sent == sent + 1)
    world.disconnect(); widget.events.action({ action = "refresh" })
    assert(widget.bindings.feedback == "Refresh unavailable: disconnected")
    world.connect(); widget.events.action({ action = "refresh" })
    assert(string.find(widget.bindings.feedback, "Refresh unavailable:", 1, true))
    widget.events.action({ action = "unknown" }); assert(#world.sent == sent + 1)
  `,
  'vitals clears on disconnect and Core loss, rediscovers and cleans up idempotently': `
    local world, panel, widget, core = panelWorld(); fullVitals(world, 10, 20, 30)
    panel.env.init(); assert(#panel.broadcasts == 1 and #panel.events.disconnected == 1 and world.nextWidget == 1)
    world.disconnect()
    assert(widget.bindings.status == "Disconnected" and widget.bindings.hpValues == "? / ?" and widget.bindings.hpLevel == "unknown")
    world.connect(); assert(widget.bindings.hpValues == "? / ?")
    world.packet("char.base", { name = "New" }); fullVitals(world, 80, 90, 100)
    world.unload(core)
    assert(widget.bindings.status == "Aardwolf API Core unavailable" and widget.bindings.hpValues == "? / ?")
    widget.events.action({ action = "refresh" }); assert(string.find(widget.bindings.feedback, "Refresh unavailable:", 1, true))
    core = world.core("reloaded"); world.tick(1000); fullVitals(world, 70, 80, 90)
    assert(widget.bindings.hpValues == "70 / 100" and widget.bindings.hpLevel == "normal")
    panel.env.cleanup(); panel.env.cleanup(); assert(next(panel.widgets) == nil and #panel.events.disconnected == 0)
    world.packet("char.vitals", { hp = 10 })
    panel.env.init(); assert(#panel.broadcasts == 2 and #panel.events.disconnected == 1)
    widget = panel.widgets["vitals-file-id:vitals"]; assert(widget.bindings.hpValues == "10 / 100")
    local before = widget.contentWrites; world.packet("char.vitals", { hp = 45 }); assert(widget.contentWrites == before)
    assert(#panel.errors == 0)
    world.unload(panel); assert(next(panel.widgets) == nil)
  `,
  'vitals isolates data and saved preferences between sessions and the example': `
    local a, pa, wa = panelWorld("a"); local b, pb, wb = panelWorld("b")
    fullVitals(a, 10, 20, 30); fullVitals(b, 80, 90, 100)
    local fields = form(); fields.fontSize = "22"; wa.events.submit({ formData = fields })
    assert(wb.bindings.fontSize == "13px" and pb.writes == 0)
    a.disconnect(); assert(wa.bindings.hpLevel == "unknown" and wb.bindings.hpValues == "80 / 100")
    local example = b.loadPlugin("example", "example-id", "Aardwolf API Vitals Example")
    local sample = example.widgets["example-id:vitals"]
    wb.events.action({ action = "reset-defaults" }); assert(example.writes == 0)
    b.unload(pb); assert(sample and example.widgets["example-id:vitals"] == sample)
  `,
  'vitals reports failed widget creation and can initialize again': `
    local world, panel, widget = panelWorld()
    panel.env.cleanup()
    local create = panel.env.createWidget; panel.env.createWidget = function() return "" end
    panel.env.init(); assert(next(panel.widgets) == nil and #panel.events.disconnected == 0)
    assert(panel.errors[#panel.errors] == "Aardwolf Vitals: widget creation failed")
    panel.env.createWidget = create; panel.env.init(); assert(panel.widgets["vitals-file-id:vitals"])
  `,
};

for (const [name, source] of Object.entries(cases)) test(name, () => runLua(setup + source));

test('vitals form property handler updates controls only on an explicit property message', () => {
  const source = readFileSync(resolve(root, 'src/plugins/aardwolf-vitals.lua'), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const controls = { fontFamily: { value: 'Unfinished edit' }, fontSize: { value: '21' }, hpWarning: { value: '45' } };
  const handlers = new Map();
  const messages = [];
  runInNewContext(script, {
    document: { getElementById(id) { assert.equal(id, 'preferences'); return { elements: { namedItem: name => controls[name] } }; } },
    mudforge: { onProperty: (name, fn) => handlers.set(name, fn), send: (name, data) => messages.push([name, data]) },
  });
  assert.equal(messages[0][0], 'ready');
  assert.equal(controls.fontFamily.value, 'Unfinished edit');
  handlers.get('vitalsPreferences')(JSON.stringify({ fontFamily: 'system-ui', fontSize: 13, hpWarning: 30, absent: 1 }));
  assert.equal(controls.fontFamily.value, 'system-ui');
  assert.equal(controls.fontSize.value, '13');
  assert.equal(controls.hpWarning.value, '30');
});
