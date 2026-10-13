plugin = {
  id = "aardwolf-vitals", name = "Aardwolf Vitals", version = "0.1.0",
  author = "Sam Roberts", description = "Responsive HP, mana and moves with configurable typography and low-vital alerts."
}

local client, widget, apiLibrary = nil, nil, nil
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

local function feedback(message)
  client.ui.bind(widget, "feedback", message)
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
  setWidgetProperty(widget, "vitalsPreferences", json.encode(formValues()))
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
  if event.action == "reset-defaults" then persist(defaults(), "Defaults restored.")
  elseif event.action == "refresh" then
    local sent, reason = client.request("char")
    feedback(sent and "Refresh requested." or ("Refresh unavailable: " .. tostring(reason)))
  end
end

local function markup()
  local html = { [[
<style>
  *{box-sizing:border-box}body{margin:0;background:#101722;color:#eef3fc;font:13px system-ui;line-height:1.45}
  main{padding:12px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
  h1{font-size:1em;margin:0;font-weight:700;letter-spacing:.04em}small{color:#b5c1d6;font-size:.85em}
  .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .card{--accent:#6de2b0;min-width:0;background:#192333;border:1px solid #354359;border-radius:12px;padding:12px}
  .mana{--accent:#8bb8ff}.moves{--accent:#c5a1ff}.heading,.readout{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline}
  .name{font-weight:700}.state{color:var(--accent);font-size:.8em}.values{font-size:1.08em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .percent{color:#b5c1d6;font-size:.85em;font-variant-numeric:tabular-nums}.readout{margin:8px 0 10px}
  .track{height:7px;background:#354359;border-radius:6px;overflow:hidden}.fill{height:100%;width:0;background:var(--accent);border-radius:6px}
  .card[data-level="warning"]{--accent:#f5ca78;border-color:#9c7843;background:#2b261e}
  .card[data-level="critical"]{--accent:#ffa0ad;border-color:#d87587;background:#30212d;animation:critical-pulse 2.4s ease-in-out infinite}
  .card[data-level="unknown"]{--accent:#b5c1d6}
  @keyframes critical-pulse{0%,100%{box-shadow:0 0 0 0 #d8758700}50%{box-shadow:0 0 0 3px #d875874d}}
  @media(prefers-reduced-motion:reduce){.card[data-level="critical"]{animation:none}}
  @media(max-width:480px){.cards{grid-template-columns:1fr}}
  details{margin-top:12px;border-top:1px solid #354359;padding-top:8px}summary{cursor:pointer;color:#c9d4e6}
  form{margin-top:10px}.font-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  label{display:flex;flex-direction:column;gap:4px;color:#c9d4e6;font-size:.9em}
  input,select,button{font:inherit;color:inherit;border:1px solid #4a5b74;border-radius:6px;background:#1d2a3d;padding:5px 8px}
  input,select{width:100%;min-width:0}button{cursor:pointer}button:hover{background:#293b55}
  :focus-visible{outline:2px solid #8bb8ff;outline-offset:3px}fieldset{border:1px solid #354359;border-radius:8px;margin:10px 0;padding:8px}
  legend{color:#c9d4e6;font-size:.9em}.thresholds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}.feedback{font-size:.85em;color:#c9d4e6;margin:8px 0 0;overflow-wrap:anywhere}
  .feedback:empty{display:none}@media(max-width:260px){.font-settings,.thresholds{grid-template-columns:1fr}header{flex-wrap:wrap}}
</style>
<main data-mud-bind-style="font-family:fontFamily;font-size:fontSize;font-weight:fontWeight;font-style:fontStyle">
  <header><div><h1>Vitals</h1><small data-mud-bind="status" role="status">Waiting for Core</small></div>
    <button type="button" data-mud-action="refresh" aria-label="Refresh vitals">Refresh</button></header>
  <div class="cards">
]] }
  for _, stat in ipairs(stats) do
    table.insert(html, '<section class="card ' .. stat .. '" data-level="unknown" data-mud-bind-attr="data-level:' .. stat .. 'Level;aria-label:' .. stat .. 'Description">'
      .. '<div class="heading"><span class="name">' .. labels[stat] .. '</span><span class="state" data-mud-bind="' .. stat .. 'State">Waiting</span></div>'
      .. '<div class="readout"><span class="values" data-mud-bind="' .. stat .. 'Values">? / ?</span><span class="percent" data-mud-bind="' .. stat .. 'Percent">--</span></div>'
      .. '<div class="track" aria-hidden="true"><div class="fill" data-mud-bind-style="width:' .. stat .. 'Width"></div></div></section>')
  end
  local values = formValues()
  table.insert(html, [[</div><details><summary>Settings</summary><form id="preferences"><div class="font-settings">]])
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
  </form></details><p class="feedback" data-mud-bind="feedback" role="status"></p>
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
    position = { x = 80, y = 100 }, size = { width = 640, height = 190 } })
  if type(widget) ~= "string" then
    echo("Aardwolf Vitals: " .. tostring(failure))
    client.stop(); client, apiLibrary, preferences = nil, nil, nil
    return
  end
  client.ui.on(widget, "submit", savePreferences)
  client.ui.on(widget, "action", action)
  client.ui.on(widget, "luamsg", function(event)
    if type(event) == "table" and event.event == "ready" then syncControls() end
  end)
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
  client, widget, apiLibrary, preferences = nil, nil, nil, nil
end
