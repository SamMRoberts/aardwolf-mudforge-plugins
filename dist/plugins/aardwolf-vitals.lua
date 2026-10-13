plugin = {
  id = "aardwolf-vitals", name = "Aardwolf Vitals", version = "0.1.2",
  author = "Sam Roberts", description = "Responsive HP, mana and moves with configurable typography and low-vital alerts."
}

local client, widget, settingsWidget, apiLibrary = nil, nil, nil, nil
local settingsReady = false
local openSettings
local unsubscribers = {}
local preferences = nil
local stats = { "hp", "mana", "moves" }
local labels = { hp = "HP", mana = "Mana", moves = "Moves" }

local function defaults()
  return { typography = { family = "system-ui", size = 13, weight = "normal", style = "normal" },
    thresholds = { hp = { warning = 30, critical = 15 }, mana = { warning = 30, critical = 15 },
      moves = { warning = 30, critical = 15 } } }
end

local function numeric(value)
  if type(value) ~= "string" and type(value) ~= "number" then return nil end
  if type(value) == "string" and string.match(value, "^%s*$") then return nil end
  local number = tonumber(value)
  if type(number) ~= "number" or number ~= number or number == math.huge or number == -math.huge then return nil end
  return number
end

local function validate(candidate)
  if type(candidate) ~= "table" or type(candidate.typography) ~= "table" or type(candidate.thresholds) ~= "table" then
    return nil, "Invalid preferences."
  end
  local font = candidate.typography
  local size = numeric(font.size)
  if not size or size ~= math.floor(size) or size < 8 or size > 48 then return nil, "Font size must be an integer from 8 to 48." end
  if type(font.family) ~= "string" or string.match(font.family, "^%s*$") or type(font.weight) ~= "string" or type(font.style) ~= "string" then
    return nil, "Choose a font family, weight and style."
  end
  local typography = { family = font.family, size = size, weight = font.weight, style = font.style }
  local valid = pcall(client.ui.typography, typography)
  if not valid then return nil, "Use a plain font family name and the listed weight and style options." end
  local updated = { typography = typography, thresholds = {} }
  for _, stat in ipairs(stats) do
    local levels = candidate.thresholds[stat]
    if type(levels) ~= "table" then return nil, "Missing " .. labels[stat] .. " thresholds." end
    local warning, critical = numeric(levels.warning), numeric(levels.critical)
    if not warning or not critical or critical < 0 or warning > 100 or critical >= warning then
      return nil, labels[stat] .. " requires 0 <= critical < warning <= 100."
    end
    updated.thresholds[stat] = { warning = warning, critical = critical }
  end
  return updated
end

local function feedback(message, target)
  if target == widget or type(settingsWidget) ~= "string" then
    client.ui.bind(widget, "settingsHint", message)
  else
    client.ui.bind(settingsWidget, "feedback", message)
  end
end

local function formValues()
  local font = preferences.typography
  local values = { fontFamily = font.family, fontSize = font.size, fontWeight = font.weight, fontStyle = font.style }
  for _, stat in ipairs(stats) do
    values[stat .. "Warning"] = preferences.thresholds[stat].warning
    values[stat .. "Critical"] = preferences.thresholds[stat].critical
  end
  return values
end

local function syncControls()
  -- Custom properties are delivered only after the iframe's ready handshake.
  if settingsReady then setWidgetProperty(settingsWidget, "vitalsPreferences", json.encode(formValues())) end
end

local function applyTypography()
  local font = preferences.typography
  local family = "'" .. font.family .. "'"
  if font.family == "system-ui" or font.family == "serif" or font.family == "sans-serif" or font.family == "monospace" then family = font.family end
  client.ui.bind(widget, "fontFamily", family)
  client.ui.bind(widget, "fontSize", tostring(font.size) .. "px")
  client.ui.bind(widget, "fontWeight", font.weight)
  client.ui.bind(widget, "fontStyle", font.style)
end

local function displayNumber(value)
  return type(value) == "number" and string.format("%.15g", value) or "?"
end

local function render()
  local status = client.status()
  local vitals, maxima = {}, {}
  local message = "Waiting for character data"
  if not status.available then message = "Aardwolf API Core unavailable"
  elseif not status.connected then message = "Disconnected"
  elseif not status.negotiated then message = status.reason or "Waiting for GMCP"
  else
    vitals, maxima = client.get("char.vitals") or {}, client.get("char.maxstats") or {}
    local complete, any = true, false
    for _, stat in ipairs(stats) do
      if type(vitals[stat]) == "number" then any = true end
      if apiLibrary.percent(vitals[stat], maxima["max" .. stat]) == nil then complete = false end
    end
    if complete then message = "Live vitals" elseif any then message = "Waiting for remaining vitals or maxima" end
  end
  client.ui.bind(widget, "status", message)
  for _, stat in ipairs(stats) do
    local value, maximum = vitals[stat], maxima["max" .. stat]
    if type(maximum) ~= "number" or maximum <= 0 then maximum = nil end
    local percent = apiLibrary.percent(value, maximum)
    local level, label = "unknown", "Waiting"
    if type(percent) == "number" then
      local thresholds = preferences.thresholds[stat]
      level, label = "normal", "Ready"
      if percent <= thresholds.critical then level, label = "critical", "Critical"
      elseif percent <= thresholds.warning then level, label = "warning", "Low" end
    end
    client.ui.bind(widget, stat .. "Values", displayNumber(value) .. " / " .. displayNumber(maximum))
    client.ui.bind(widget, stat .. "Percent", percent and string.format("%.0f%%", percent) or "--")
    client.ui.bind(widget, stat .. "Width", string.format("%g%%", percent or 0))
    client.ui.bind(widget, stat .. "Level", level)
    client.ui.bind(widget, stat .. "State", label)
    client.ui.bind(widget, stat .. "Description", labels[stat] .. ": " .. displayNumber(value) .. " of "
      .. displayNumber(maximum) .. ". " .. label)
  end
end

local function persist(candidate, message)
  local updated, reason = validate(candidate)
  if not updated then feedback(reason); return end
  local saved, problem = client.storage.set("preferences", updated)
  if not saved then feedback("Preferences not saved: " .. tostring(problem)); return end
  preferences = updated
  applyTypography()
  syncControls()
  render()
  feedback(message)
end

local function savePreferences(event)
  if type(event) ~= "table" or type(event.formData) ~= "table" then feedback("Invalid settings form."); return end
  local fields = event.formData
  local candidate = { typography = { family = fields.fontFamily, size = fields.fontSize,
    weight = fields.fontWeight, style = fields.fontStyle }, thresholds = {} }
  for _, stat in ipairs(stats) do
    candidate.thresholds[stat] = { warning = fields[stat .. "Warning"], critical = fields[stat .. "Critical"] }
  end
  persist(candidate, "Preferences saved.")
end

local function action(event)
  if type(event) ~= "table" then return end
  if event.action == "settings" then openSettings()
  elseif event.action == "refresh" then
    local sent, reason = client.request("char")
    client.ui.bind(widget, "refreshHint", sent and "Refresh vitals" or ("Refresh unavailable: " .. tostring(reason)))
  end
end

local function styles()
  return [[
<style>
  *{box-sizing:border-box}body{margin:0;background:#101722;color:#eef3fc;font:13px system-ui;line-height:1.45}
  main{padding:8px}header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  h1{font-size:1em;margin:0;font-weight:700;letter-spacing:.04em}small{color:#b5c1d6;font-size:.85em}
  .hud{padding:6px}.hud header{gap:6px;margin-bottom:4px;flex-wrap:nowrap}
  .header-title{display:flex;align-items:baseline;gap:6px;min-width:0;flex:1}
  .header-title h1{font-size:.95em;flex:none;max-width:100%;overflow-wrap:anywhere}
  .header-title small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cards{display:flex;flex-wrap:wrap;gap:10px}
  .card{--accent:#f87171;--warning:#fb923c;--critical:#fb7185;--critical-pulse:#fb718580;min-width:0;flex:1 1 calc(9em + 6px);display:grid;grid-template-columns:minmax(0,min(3.8em,30%)) minmax(0,1fr);gap:6px;align-items:center}
  .mana{--accent:#60a5fa;--warning:#38bdf8;--critical:#818cf8;--critical-pulse:#818cf880}
  .moves{--accent:#facc15;--warning:#fbbf24;--critical:#fb923c;--critical-pulse:#fb923c80}
  .heading{min-width:0;overflow-wrap:anywhere}.name{font-weight:700}.state{display:block;color:var(--accent);font-size:.7em}
  .card[data-level="normal"] .state{display:none}
  .track{position:relative;min-width:0;min-height:24px;background:#192333;border:1px solid #354359;border-radius:5px;overflow:hidden}
  .fill{position:absolute;inset:0 auto 0 0;width:0;background:var(--accent);opacity:.4}
  .readout{position:relative;z-index:1;display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:2px 6px;padding:2px 5px;min-height:22px;
    font-size:.9em;font-variant-numeric:tabular-nums;text-align:center;text-shadow:0 1px 2px #101722}
  .values{min-width:0;overflow-wrap:anywhere}.percent{font-size:.85em;white-space:nowrap}
  .card[data-level="warning"]{--accent:var(--warning)}.card[data-level="warning"] .track{border-color:var(--accent)}
  .card[data-level="critical"]{--accent:var(--critical)}.card[data-level="critical"] .track{border-color:var(--accent);animation:critical-pulse 2.4s ease-in-out infinite}
  .card[data-level="unknown"]{--accent:#b5c1d6}
  @keyframes critical-pulse{0%,100%{box-shadow:inset 0 0 0 0 transparent}50%{box-shadow:inset 0 0 0 2px var(--critical-pulse)}}
  @media(prefers-reduced-motion:reduce){.card[data-level="critical"] .track{animation:none}}
  @media(max-width:480px){.card{flex-basis:100%}}
  .font-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  label{display:flex;flex-direction:column;gap:4px;color:#c9d4e6;font-size:.9em}
  input,select,button{font:inherit;color:inherit;border:1px solid #4a5b74;border-radius:6px;background:#1d2a3d;padding:5px 8px}
  input,select{width:100%;min-width:0}button{cursor:pointer}button:hover{background:#293b55}
  .toolbar{display:flex;flex-wrap:wrap;max-width:100%;gap:5px}
  .toolbar button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;flex:none;line-height:1}
  .toolbar .icon{font:18px system-ui}
  :focus-visible{outline:2px solid #8bb8ff;outline-offset:2px}fieldset{min-width:0;border:1px solid #354359;border-radius:8px;margin:10px 0;padding:8px}
  legend{color:#c9d4e6;font-size:.9em}.thresholds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}.feedback{font-size:.85em;color:#c9d4e6;margin:8px 0 0;overflow-wrap:anywhere}
  .feedback:empty{display:none}@media(max-width:260px){.font-settings,.thresholds{grid-template-columns:1fr}}
</style>
]]
end

local function markup()
  local html = { styles(), [[
<main class="hud" data-mud-bind-style="font-family:fontFamily;font-size:fontSize;font-weight:fontWeight;font-style:fontStyle">
  <header><div class="header-title"><h1>Vitals</h1><small data-mud-bind="status" data-mud-bind-attr="title:status" role="status">Waiting for Core</small></div>
    <div class="toolbar"><button type="button" data-mud-action="settings" aria-label="Open vitals settings" title="Settings" data-mud-bind-attr="title:settingsHint"><span class="icon" aria-hidden="true">&#9881;&#65038;</span></button>
    <button type="button" data-mud-action="refresh" aria-label="Refresh vitals" title="Refresh" data-mud-bind-attr="title:refreshHint"><span class="icon" aria-hidden="true">&#8635;</span></button></div></header>
  <div class="cards">
]] }
  for _, stat in ipairs(stats) do
    table.insert(html, '<section class="card ' .. stat .. '" data-level="unknown" data-mud-bind-attr="data-level:' .. stat .. 'Level;aria-label:' .. stat .. 'Description">'
      .. '<div class="heading"><span class="name">' .. labels[stat] .. '</span><span class="state" data-mud-bind="' .. stat .. 'State">Waiting</span></div>'
      .. '<div class="track"><div class="fill" aria-hidden="true" data-mud-bind-style="width:' .. stat .. 'Width"></div>'
      .. '<div class="readout"><span class="values" data-mud-bind="' .. stat .. 'Values">? / ?</span><span class="percent" data-mud-bind="' .. stat .. 'Percent">--</span></div></div></section>')
  end
  table.insert(html, '</div></main>')
  return table.concat(html)
end

local function settingsMarkup()
  local html = { styles(), '<main><header><h1>Vitals settings</h1><button type="button" data-mud-action="close-settings">Close</button></header>' }
  local values = formValues()
  table.insert(html, [[<form id="preferences"><div class="font-settings">]])
  table.insert(html, '<label>Font family<input name="fontFamily" maxlength="80" required value="' .. apiLibrary.escape(values.fontFamily) .. '"></label>')
  table.insert(html, '<label>Font size (px)<input name="fontSize" type="number" min="8" max="48" step="1" required value="' .. tostring(values.fontSize) .. '"></label>')
  for _, choice in ipairs({ { name = "fontWeight", label = "Weight", other = "bold" }, { name = "fontStyle", label = "Style", other = "italic" } }) do
    table.insert(html, '<label>' .. choice.label .. '<select name="' .. choice.name .. '">')
    for _, option in ipairs({ "normal", choice.other }) do
      table.insert(html, '<option value="' .. option .. '"' .. (values[choice.name] == option and ' selected' or '') .. '>' .. option .. '</option>')
    end
    table.insert(html, '</select></label>')
  end
  table.insert(html, '</div>')
  for _, stat in ipairs(stats) do
    table.insert(html, '<fieldset><legend>' .. labels[stat] .. ' alerts (%)</legend><div class="thresholds">')
    for _, level in ipairs({ "Warning", "Critical" }) do
      local name = stat .. level
      table.insert(html, '<label>' .. level .. '<input name="' .. name .. '" type="number" min="0" max="100" step="any" required value="' .. tostring(values[name]) .. '"></label>')
    end
    table.insert(html, '</div></fieldset>')
  end
  table.insert(html, [[
  <div class="actions"><button type="submit">Save settings</button><button type="button" data-mud-action="reset-defaults">Reset defaults</button></div>
  </form><p class="feedback" data-mud-bind="feedback" role="status"></p>
</main>
<script>
  mudforge.onProperty("vitalsPreferences", function(encoded) {
    var values = JSON.parse(encoded);
    var form = document.getElementById("preferences");
    Object.keys(values).forEach(function(name) {
      var control = form.elements.namedItem(name);
      if (control) control.value = String(values[name]);
    });
  });
  mudforge.send("ready", {});
</script>
]])
  return table.concat(html)
end

openSettings = function()
  if type(settingsWidget) == "string" then
    client.ui.bind(widget, "settingsHint", "Settings")
    showWidget(settingsWidget, true)
    return
  end
  local failure
  settingsWidget, failure = client.ui.create({ type = "html", name = "vitals-settings", title = "Aardwolf Vitals Settings",
    position = { x = 120, y = 160 }, size = { width = 420, height = 520 } })
  if type(settingsWidget) ~= "string" then
    feedback("Settings unavailable: " .. tostring(failure), widget)
    return
  end
  settingsReady = false
  client.ui.on(settingsWidget, "submit", savePreferences)
  client.ui.on(settingsWidget, "action", function(event)
    if type(event) ~= "table" then return end
    if event.action == "reset-defaults" then persist(defaults(), "Defaults restored.")
    elseif event.action == "close-settings" then hideWidget(settingsWidget, true) end
  end)
  client.ui.on(settingsWidget, "keydown", function(event)
    if type(event) == "table" and event.key == "Escape" then hideWidget(settingsWidget, true) end
  end)
  client.ui.on(settingsWidget, "luamsg", function(event)
    if type(event) == "table" and event.event == "ready" then settingsReady = true; syncControls() end
  end)
  client.ui.content(settingsWidget, settingsMarkup())
  client.ui.bind(widget, "settingsHint", "Settings")
  -- This is an explicit user request, including when saved visibility was closed.
  showWidget(settingsWidget, true)
end

function init()
  if type(client) == "table" then return end
  apiLibrary = require("aardwolf-api")
  client = apiLibrary.new({
    findPluginByName = findPluginByName, onPluginBroadcast = onPluginBroadcast, broadcastToPlugin = broadcastToPlugin,
    on = on, off = off, sendGMCP = sendGMCP,
    loadTable = loadTable, saveTable = saveTable, storageStatus = storageStatus,
    createWidget = createWidget, destroyWidget = destroyWidget, setWidgetProperty = setWidgetProperty,
    setBoundValue = setBoundValue, registerWidgetEvent = registerWidgetEvent,
    reportError = function(message) echo(message) end
  }, { packages = { "Char" } })
  preferences = defaults()
  local saved, reason = client.storage.get("preferences", preferences)
  local updated, problem = validate(saved)
  if updated then preferences = updated end
  local failure
  widget, failure = client.ui.create({ type = "html", name = "vitals", title = "Aardwolf Vitals",
    position = { x = 80, y = 100 }, size = { width = 640, height = 90 } })
  if type(widget) ~= "string" then
    echo("Aardwolf Vitals: " .. tostring(failure))
    client.stop(); client, apiLibrary, preferences = nil, nil, nil
    return
  end
  client.ui.on(widget, "action", action)
  client.ui.content(widget, markup())
  applyTypography()
  if not updated then feedback("Using defaults: " .. tostring(reason or problem)) end
  for _, topic in ipairs({ "session", "char.vitals", "char.maxstats" }) do
    table.insert(unsubscribers, client.on(topic, render))
  end
  client.start()
  render()
end

function cleanup()
  if type(client) ~= "table" then return end
  for _, unsubscribe in ipairs(unsubscribers) do unsubscribe() end
  unsubscribers = {}
  client.stop()
  client, widget, settingsWidget, apiLibrary, preferences = nil, nil, nil, nil, nil
  settingsReady = false
end
