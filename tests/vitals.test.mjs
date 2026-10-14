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
  function openPreferences(panel, widget)
    widget.events.action({ action = "settings" })
    local settings = panel.widgets["vitals-file-id:vitals-settings"]
    settings.events.luamsg({ event = "ready" })
    return settings
  end
  function form()
    return { fontFamily = "system-ui", fontSize = "13", fontWeight = "normal", fontStyle = "normal",
      hpWarning = "30", hpCritical = "15", manaWarning = "30", manaCritical = "15", movesWarning = "30", movesCritical = "15" }
  end
`;

const cases = {
  'vitals starts before Core and synchronizes settings only after their iframe is ready': `
    local world = newWorld()
    local panel = world.loadPlugin("vitals", "vitals-file-id", "Aardwolf Vitals")
    local widget = panel.widgets["vitals-file-id:vitals"]
    assert(widget.bindings.status == "Aardwolf API Core unavailable")
    assert(panel.widgets["vitals-file-id:vitals-settings"] == nil and widget.events.submit == nil)
    widget.events.action({ action = "settings" })
    local settings = panel.widgets["vitals-file-id:vitals-settings"]
    assert(settings.vitalsPreferences == nil)
    settings.events.luamsg({ event = "unrelated" }); assert(settings.vitalsPreferences == nil)
    settings.events.luamsg({ event = "ready" }); assert(json.decode(settings.vitalsPreferences).fontSize == 13)
    world.core(); world.connect(); world.packet("char.base", { name = "Fixture" }); fullVitals(world, 20, 50, 80)
    assert(widget.bindings.hpValues == "20 / 100" and widget.bindings.hpLevel == "warning")
    assert(#panel.broadcasts == 1 and widget.contentWrites == 1 and settings.contentWrites == 1 and panel.writes == 0)
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
    local settings = openPreferences(panel, widget)
    assert(widget.bindings.fontFamily == "system-ui" and widget.bindings.fontSize == "13px")
    local fields = form()
    fields.fontFamily, fields.fontSize, fields.fontWeight, fields.fontStyle = "SF Pro Text", "18", "bold", "italic"
    fields.hpWarning, fields.hpCritical = "60", "45"
    fields.manaWarning, fields.manaCritical = "45", "10"
    settings.events.submit({ formData = fields })
    assert(panel.writes == 1 and settings.bindings.feedback == "Preferences saved.")
    assert(widget.bindings.hpLevel == "critical" and widget.bindings.manaLevel == "warning" and widget.bindings.movesLevel == "normal")
    assert(widget.bindings.fontFamily == "'SF Pro Text'" and widget.bindings.fontSize == "18px")
    assert(widget.bindings.fontWeight == "bold" and widget.bindings.fontStyle == "italic")
    local values = json.decode(settings.vitalsPreferences)
    assert(values.fontSize == 18 and values.hpWarning == 60)
    local controls = settings.vitalsPreferences
    world.packet("char.vitals", { mana = 30 }); assert(settings.vitalsPreferences == controls)
    assert(widget.contentWrites == 1)
    panel.env.cleanup(); panel.env.init()
    widget = panel.widgets["vitals-file-id:vitals"]
    assert(widget.bindings.fontSize == "18px" and widget.bindings.hpLevel == "critical")
    assert(panel.widgets["vitals-file-id:vitals-settings"] == nil)
    settings = openPreferences(panel, widget)
    assert(string.find(settings.content, 'value="SF Pro Text"', 1, true))
    settings.events.luamsg({ event = "ready" })
    assert(json.decode(settings.vitalsPreferences).fontWeight == "bold")
  `,
  'vitals rejects malformed, non-finite and injectable preferences before saving': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    local settings = openPreferences(panel, widget)
    for _, invalid in ipairs({
      { "fontFamily", "x';color:red" }, { "fontFamily", "<img src=x>" }, { "fontFamily", "" }, { "fontFamily", "   " },
      { "fontFamily", string.rep("a", 81) }, { "fontSize", "13.5" }, { "fontSize", "7" }, { "fontSize", "49" },
      { "fontSize", "" }, { "fontSize", " " }, { "fontSize", {} }, { "fontSize", math.huge }, { "fontSize", 0/0 },
      { "fontWeight", "900" }, { "fontStyle", "oblique" }, { "hpWarning", "15" }, { "hpWarning", "101" },
      { "hpCritical", "-1" }, { "hpCritical", "31" }, { "manaWarning", "" }, { "movesCritical", math.huge }
    }) do
      local fields = form(); fields[invalid[1]] = invalid[2]
      settings.events.submit({ formData = fields })
      assert(panel.writes == 0 and widget.bindings.fontSize == "13px" and widget.bindings.fontFamily == "system-ui")
      assert(settings.bindings.feedback ~= "Preferences saved." and widget.bindings.status == "Live vitals")
    end
    local missing = form(); missing.hpCritical = nil
    settings.events.submit({ formData = missing }); assert(panel.writes == 0)
    settings.events.submit({}); assert(panel.writes == 0)
    for _, size in ipairs({ "8", "48" }) do
      local fields = form(); fields.fontSize = size; fields.hpWarning = "100"; fields.hpCritical = "0"
      settings.events.submit({ formData = fields }); assert(widget.bindings.fontSize == size .. "px")
    end
    local fields = form(); fields.hpWarning, fields.hpCritical = "30.5", "15.5"
    settings.events.submit({ formData = fields }); assert(panel.writes == 3)
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
      assert(string.find(widget.bindings.settingsHint, "Using defaults:", 1, true))
      assert(panel.writes == 0 and panel.storage["aardwolf-api:preferences"] == envelope)
    end
  `,
  'vitals refused saves and resets preserve applied preferences and connection status': `
    local world, panel, widget = panelWorld(); fullVitals(world, 40, 40, 40)
    local settings = openPreferences(panel, widget)
    local fields = form(); fields.fontSize = "20"; fields.hpWarning = "60"
    settings.events.submit({ formData = fields }); assert(panel.writes == 1)
    panel.refuseWrites = true
    fields.fontSize = "30"; settings.events.submit({ formData = fields })
    assert(widget.bindings.fontSize == "20px" and widget.bindings.status == "Live vitals")
    assert(settings.bindings.feedback == "Preferences not saved: storage refused the write")
    settings.events.action({ action = "reset-defaults" })
    assert(panel.writes == 1 and widget.bindings.fontSize == "20px" and widget.bindings.hpLevel == "warning")
    panel.refuseWrites = false; panel.storageState = "starting"
    settings.events.action({ action = "reset-defaults" }); assert(panel.writes == 1)
    panel.storageState = "ready"; settings.events.action({ action = "reset-defaults" })
    assert(panel.writes == 2 and widget.bindings.fontSize == "13px" and widget.bindings.hpLevel == "normal")
    assert(json.decode(settings.vitalsPreferences).hpWarning == 30 and settings.bindings.feedback == "Defaults restored.")
    assert(widget.contentWrites == 1)
  `,
  'vitals refresh is explicit and reports unavailable and refused transport': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    local sent = #world.sent
    for i = 1, 10 do world.packet("char.vitals", { hp = i }); world.packet("char.base", { name = "Fixture" }) end
    assert(#world.sent == sent)
    widget.events.action({ action = "refresh" })
    assert(#world.sent == sent + 1 and world.sent[#world.sent].package == "request char")
    assert(widget.bindings.refreshHint == "Refresh vitals" and widget.bindings.feedback == nil)
    assert(not string.find(widget.content, 'data-mud-bind="feedback"', 1, true))
    world.refuseTransport = true; widget.events.action({ action = "refresh" })
    assert(widget.bindings.refreshHint == "Refresh unavailable: transport refused the request")
    assert(widget.bindings.status == "Live vitals" and #world.sent == sent + 1)
    world.disconnect(); widget.events.action({ action = "refresh" })
    assert(widget.bindings.refreshHint == "Refresh unavailable: disconnected")
    world.connect(); widget.events.action({ action = "refresh" })
    assert(string.find(widget.bindings.refreshHint, "Refresh unavailable:", 1, true))
    widget.events.action({ action = "unknown" }); assert(#world.sent == sent + 1)
    world.refuseTransport = false; world.packet("char.base", { name = "Fixture" })
    local recoveredSent = #world.sent
    widget.events.action({ action = "refresh" })
    assert(#world.sent == recoveredSent + 1 and world.sent[#world.sent].package == "request char")
    assert(widget.bindings.refreshHint == "Refresh vitals")
    assert(widget.bindings.feedback == nil and widget.contentWrites == 1)
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
    widget.events.action({ action = "refresh" }); assert(string.find(widget.bindings.refreshHint, "Refresh unavailable:", 1, true))
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
    local sa = openPreferences(pa, wa); local sb = openPreferences(pb, wb)
    local fields = form(); fields.fontSize = "22"; sa.events.submit({ formData = fields })
    assert(wb.bindings.fontSize == "13px" and pb.writes == 0)
    a.disconnect(); assert(wa.bindings.hpLevel == "unknown" and wb.bindings.hpValues == "80 / 100")
    local example = b.loadPlugin("example", "example-id", "Aardwolf API Vitals Example")
    local sample = example.widgets["example-id:vitals"]
    sb.events.action({ action = "reset-defaults" }); assert(example.writes == 0)
    assert(sb.visible and json.decode(sb.vitalsPreferences).fontSize == 13)
    a.unload(pa); assert(next(pa.widgets) == nil and sb.visible)
    b.unload(pb); assert(next(pb.widgets) == nil); assert(sample and example.widgets["example-id:vitals"] == sample)
  `,
  'vitals reports failed widget creation and can initialize again': `
    local world, panel, widget = panelWorld()
    panel.env.cleanup()
    local create = panel.env.createWidget; panel.env.createWidget = function() return "" end
    panel.env.init(); assert(next(panel.widgets) == nil and #panel.events.disconnected == 0)
    assert(panel.errors[#panel.errors] == "Aardwolf Vitals: widget creation failed")
    panel.env.createWidget = create; panel.env.init(); assert(panel.widgets["vitals-file-id:vitals"])
  `,
  'settings reopens one window, preserves markup and controls, and closes independently': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    local settings = openPreferences(panel, widget)
    local content, controls = settings.content, settings.vitalsPreferences
    assert(widget.config.size.width == 640 and widget.config.size.height == 150)
    assert(settings.config.size.width == 420 and settings.config.size.height == 520)
    assert(settings.config.title == "Aardwolf Vitals Settings" and settings.visible and settings.lastShowForced)
    assert(not string.find(widget.content, '<form', 1, true))
    assert(string.find(widget.content, 'data-mud-action="settings"', 1, true))
    local created = world.nextWidget
    for i = 1, 3 do
      panel.closeWidget("vitals-file-id:vitals-settings")
      assert(not settings.visible and settings.userClosed)
      widget.events.action({ action = "settings" })
      assert(settings.visible and settings.lastShowForced)
    end
    assert(world.nextWidget == created and settings.contentWrites == 1 and settings.content == content)
    fullVitals(world, 10, 20, 30)
    assert(settings.vitalsPreferences == controls)
    settings.events.keydown({ key = "Enter" }); assert(settings.visible)
    settings.events.keydown({ key = "Escape" }); assert(not settings.visible)
    widget.events.action({ action = "settings" }); assert(settings.visible)
    settings.events.action({ action = "close-settings" }); assert(not settings.visible)
    assert(panel.widgets["vitals-file-id:vitals"] == widget and widget.bindings.hpValues == "10 / 100")
    widget.events.action({ action = "settings" })
    settings.events.submit({ formData = form() })
    assert(settings.visible and settings.bindings.feedback == "Preferences saved." and widget.bindings.feedback == nil)
    widget.events.action({ action = "refresh" })
    assert(widget.bindings.refreshHint == "Refresh vitals" and widget.bindings.feedback == nil and settings.bindings.feedback == "Preferences saved.")
    settings.events.action({ action = "reset-defaults" }); assert(settings.visible)
    panel.env.cleanup(); panel.env.cleanup(); assert(next(panel.widgets) == nil)
    panel.env.init(); assert(panel.widgets["vitals-file-id:vitals-settings"] == nil)
    settings = openPreferences(panel, panel.widgets["vitals-file-id:vitals"])
    assert(settings ~= nil and json.decode(settings.vitalsPreferences).fontSize == 13)
  `,
  'failed settings creation leaves the HUD working and can be retried': `
    local world = newWorld()
    local panel = world.loadPlugin("vitals", "vitals-file-id", "Aardwolf Vitals")
    local widget = panel.widgets["vitals-file-id:vitals"]
    panel.failWidgetName = "vitals-settings"
    widget.events.action({ action = "settings" })
    assert(panel.widgets["vitals-file-id:vitals-settings"] == nil)
    assert(widget.bindings.settingsHint == "Settings unavailable: widget creation failed")
    world.core(); world.connect(); world.packet("char.base", { name = "Fixture" }); fullVitals(world, 50, 60, 70)
    assert(widget.bindings.hpValues == "50 / 100")
    panel.failWidgetName = nil
    assert(openPreferences(panel, widget).visible)
    assert(widget.bindings.settingsHint == "Settings" and widget.bindings.feedback == nil)
  `,

  'character status renders the supplied snapshot without replacing either widget': `
    local world, panel, widget = panelWorld(); fullVitals(world)
    local settings = openPreferences(panel, widget)
    local controls = settings.vitalsPreferences
    world.packet("char.status", { level = 210, tnl = 1000, hunger = 70, thirst = 70,
      align = 1867, state = 3, pos = "Standing", enemy = "an owl", enemypct = 93 })
    assert(widget.bindings.targetName == "an owl" and widget.bindings.targetPercent == "93%")
    assert(widget.bindings.targetWidth == "93%" and widget.bindings.targetLevel == "normal")
    assert(widget.bindings.alignmentText == "+1867 Good" and widget.bindings.alignmentPosition == "87.34%")
    assert(widget.bindings.alignmentKnown == "true" and widget.bindings.alignmentMarkerOpacity == "1")
    assert(widget.bindings.characterlevel == "210" and widget.bindings.charactertnl == "1000")
    assert(widget.bindings.characterhunger == "70" and widget.bindings.characterthirst == "70")
    assert(widget.bindings.characterState == "Active" and widget.bindings.characterPosition == "Standing")
    assert(widget.contentWrites == 1 and settings.contentWrites == 1 and settings.vitalsPreferences == controls)
    world.packet("char.status", { tnl = "900", enemypct = "45" })
    assert(widget.bindings.charactertnl == "900" and widget.bindings.targetPercent == "45%")
    assert(widget.bindings.targetName == "an owl" and widget.bindings.alignmentText == "+1867 Good")
    assert(widget.contentWrites == 1 and settings.vitalsPreferences == controls and panel.writes == 0)
  `,
  'character state names cover every documented code and preserve position text': `
    local world, panel, widget = panelWorld()
    for _, sample in ipairs({ {1, "Login"}, {2, "MOTD/login"}, {3, "Active"}, {4, "AFK"}, {5, "Note"},
      {6, "Building/edit"}, {7, "Pager"}, {8, "Combat"}, {9, "Sleeping"}, {11, "Resting/sitting"}, {12, "Running"} }) do
      world.packet("char.status", { state = tostring(sample[1]), pos = "Standing" })
      assert(widget.bindings.characterState == sample[2] and widget.bindings.characterPosition == "Standing")
    end
    world.packet("char.status", { state = 10, pos = "Sitting" })
    assert(widget.bindings.characterState == "State 10" and widget.bindings.characterPosition == "Sitting")
    world.packet("char.status", { state = "invalid", pos = false })
    assert(widget.bindings.characterState == "?" and widget.bindings.characterPosition == "?")
    world.packet("char.status", { pos = "   " }); assert(widget.bindings.characterPosition == "?")
  `,
  'target HP distinguishes empty and unknown enemies, merges partial data and bounds only the fill': `
    local world, panel, widget = panelWorld()
    assert(widget.bindings.targetName == "Target unknown" and widget.bindings.targetPercent == "--")
    world.packet("char.status", { enemy = "an owl", state = 3 })
    assert(widget.bindings.targetName == "an owl" and widget.bindings.targetWidth == "0%")
    assert(widget.bindings.targetPercent == "--" and widget.bindings.targetLevel == "unknown")
    for _, sample in ipairs({ {0, "0%"}, {100, "100%"}, {-5, "0%"}, {120, "100%"} }) do
      world.packet("char.status", { enemypct = sample[1] })
      assert(widget.bindings.targetPercent == tostring(sample[1]) .. "%" and widget.bindings.targetWidth == sample[2])
      assert(widget.bindings.targetLevel == "normal")
    end
    world.packet("char.status", { enemy = "another owl", enemypct = "75" })
    assert(widget.bindings.targetName == "another owl" and widget.bindings.targetPercent == "75%")
    world.packet("char.status", { enemy = "a third owl" })
    assert(widget.bindings.targetName == "a third owl" and widget.bindings.targetPercent == "75%")
    world.packet("char.status", { enemy = "" })
    assert(widget.bindings.targetName == "No target" and widget.bindings.targetPercent == "--" and widget.bindings.targetWidth == "0%")
    world.packet("char.status", { enemy = "   " }); assert(widget.bindings.targetName == "No target")
    world.packet("char.status", { enemy = false })
    assert(widget.bindings.targetName == "Target unknown" and widget.bindings.targetPercent == "--")
    world.packet("char.status", { enemy = "an owl", enemypct = "bad" })
    assert(widget.bindings.targetPercent == "--" and widget.bindings.targetWidth == "0%")
    world.packet("char.status", { enemy = '<img src=x onerror="alert(1)">', enemypct = 25 })
    assert(widget.bindings.targetName == '<img src=x onerror="alert(1)">')
    assert(not string.find(widget.content, '<img src=x', 1, true))
    assert(string.find(widget.bindings.targetDescription, '<img src=x', 1, true))
  `,
  'alignment categories and marker positions respect boundaries and preserve reported values': `
    local world, panel, widget = panelWorld()
    assert(widget.bindings.alignmentText == "?" and widget.bindings.alignmentMarkerOpacity == "0")
    for _, sample in ipairs({ {-2500,"-2500 Evil","0%"}, {-875,"-875 Evil","32.5%"},
      {-874,"-874 Neutral","32.52%"}, {0,"0 Neutral","50%"}, {874,"+874 Neutral","67.48%"},
      {875,"+875 Good","67.5%"}, {2500,"+2500 Good","100%"},
      {-4000,"-4000 Evil","0%"}, {4000,"+4000 Good","100%"} }) do
      world.packet("char.status", { align = tostring(sample[1]) })
      assert(widget.bindings.alignmentText == sample[2])
      local marker = tonumber(string.sub(widget.bindings.alignmentPosition, 1, -2))
      local expected = tonumber(string.sub(sample[3], 1, -2))
      assert(marker and math.abs(marker - expected) < 0.0001)
      assert(widget.bindings.alignmentKnown == "true" and widget.bindings.alignmentMarkerOpacity == "1")
    end
    world.packet("char.status", { align = "bad" })
    assert(widget.bindings.alignmentText == "?" and widget.bindings.alignmentKnown == "false")
    assert(widget.bindings.alignmentMarkerOpacity == "0")
  `,
  'summary metrics preserve zero, numeric strings and unknown fields': `
    local world, panel, widget = panelWorld()
    assert(widget.bindings.characterlevel == "?" and widget.bindings.charactertnl == "?")
    assert(widget.bindings.characterhunger == "?" and widget.bindings.characterthirst == "?")
    world.packet("char.status", { level = "210", tnl = "0", hunger = 0, thirst = "70" })
    assert(widget.bindings.characterlevel == "210" and widget.bindings.charactertnl == "0")
    assert(widget.bindings.characterhunger == "0" and widget.bindings.characterthirst == "70")
    world.packet("char.status", { level = "bad", tnl = {}, hunger = " ", thirst = false })
    assert(widget.bindings.characterlevel == "?" and widget.bindings.charactertnl == "?")
    assert(widget.bindings.characterhunger == "?" and widget.bindings.characterthirst == "?")
  `,
  'character status clears with session availability and stays isolated across worlds and reloads': `
    local a, pa, wa, core = panelWorld("a"); local b, pb, wb = panelWorld("b")
    a.packet("char.status", { enemy = "owl", enemypct = 93, align = 1867, state = 8, level = 210, pos = "Fighting" })
    b.packet("char.status", { enemy = "wolf", enemypct = 20, align = -875, state = 4, level = 100 })
    pa.env.init(); assert(#pa.broadcasts == 1 and #pa.events.disconnected == 1)
    a.disconnect()
    assert(wa.bindings.targetName == "Target unknown" and wa.bindings.alignmentMarkerOpacity == "0")
    assert(wa.bindings.characterlevel == "?" and wa.bindings.characterState == "?" and wa.bindings.characterPosition == "?")
    assert(wb.bindings.targetName == "wolf" and wb.bindings.alignmentText == "-875 Evil")
    a.connect(); a.packet("char.status", { enemy = "early owl", enemypct = 99, align = 2000 })
    assert(wa.bindings.targetName == "Target unknown")
    a.packet("char.base", { name = "Fixture" })
    assert(wa.bindings.targetName == "early owl")
    a.unload(core)
    assert(wa.bindings.targetName == "Target unknown" and wa.bindings.alignmentKnown == "false")
    core = a.core("reloaded"); a.tick(1000)
    a.packet("char.status", { enemy = "new owl", enemypct = 45, align = 0, state = 3 })
    assert(wa.bindings.targetName == "new owl" and wa.bindings.alignmentText == "0 Neutral")
    pa.env.cleanup(); pa.env.cleanup(); assert(next(pa.widgets) == nil)
    pa.env.init(); wa = pa.widgets["vitals-file-id:vitals"]
    assert(wa.bindings.targetName == "new owl" and wa.contentWrites == 1)
    a.unload(pa); assert(next(pa.widgets) == nil and wb.bindings.targetName == "wolf")
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
