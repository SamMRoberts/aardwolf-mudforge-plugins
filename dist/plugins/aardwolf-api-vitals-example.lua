plugin = {
  id = "aardwolf-api-vitals-example", name = "Aardwolf API Vitals Example", version = "0.1.0",
  author = "Sam Roberts", description = "Small reactive vitals panel demonstrating the shared Aardwolf API."
}

local client, widget = nil, nil
local apiLibrary = nil
local unsubscribers = {}
local typography = { family = "system-ui", size = 13, style = "normal", weight = "normal", spacing = 0 }

local function render()
  local status = client.status()
  local vitals = client.get("char.vitals") or {}
  local maxima = client.get("char.maxstats") or {}
  local label = "Waiting for character data"
  if not status.available then label = "Aardwolf API Core unavailable"
  elseif not status.connected then label = "Disconnected"
  elseif not status.negotiated then label = status.reason or "Waiting for GMCP"
  elseif type(vitals.hp) == "number" or type(vitals.mana) == "number" or type(vitals.moves) == "number" then label = "Live vitals" end
  client.ui.bind(widget, "status", label)
  for _, stat in ipairs({ "hp", "mana", "moves" }) do
    local value, maximum = vitals[stat], maxima["max" .. stat]
    local percent = apiLibrary.percent(value, maximum)
    local text = "Unknown"
    if type(value) == "number" then
      text = string.format("%g", value) .. " / " .. (type(maximum) == "number" and string.format("%g", maximum) or "?")
    end
    client.ui.bind(widget, stat, text)
    client.ui.bind(widget, stat .. "Width", string.format("%g%%", percent or 0))
    client.ui.bind(widget, stat .. "Tip", type(percent) == "number" and (tostring(math.floor(percent)) .. "%") or "Unknown maximum")
  end
end

local function markup(css)
  return "<style>body{margin:0;padding:12px;color:#eee;background:#18212b;" .. css
    .. "}p{margin:0 0 10px;color:#ccd3dc}.row{margin:8px 0}.track{height:5px;background:#39424d}"
    .. ".fill{height:100%;background:#dfbd72}label{display:block;margin-top:10px}input,button{font:inherit}"
    .. "input{width:4em}</style><p data-mud-bind='status'>Waiting for Core</p>"
    .. "<div class='row'>HP <span data-mud-bind='hp'>Unknown</span><div class='track'><div class='fill' data-mud-bind-style='width:hpWidth' data-mud-bind-attr='title:hpTip'></div></div></div>"
    .. "<div class='row'>Mana <span data-mud-bind='mana'>Unknown</span><div class='track'><div class='fill' data-mud-bind-style='width:manaWidth' data-mud-bind-attr='title:manaTip'></div></div></div>"
    .. "<div class='row'>Moves <span data-mud-bind='moves'>Unknown</span><div class='track'><div class='fill' data-mud-bind-style='width:movesWidth' data-mud-bind-attr='title:movesTip'></div></div></div>"
    .. "<form><label>Font size <input name='fontSize' type='number' min='8' max='48' value='" .. tostring(typography.size)
    .. "'></label><button type='submit'>Save</button></form><button type='button' data-mud-action='refresh'>Refresh vitals</button>"
end

local function savePreferences(event)
  if type(event) ~= "table" or type(event.formData) ~= "table" then return end
  if type(event.formData.fontSize) ~= "string" and type(event.formData.fontSize) ~= "number" then return end
  local size = tonumber(event.formData.fontSize)
  if type(size) ~= "number" or size ~= size or size < 8 or size > 48 then return end
  local updated = { family = typography.family, size = size, style = typography.style, weight = typography.weight, spacing = typography.spacing }
  local saved, reason = client.storage.set("typography", updated)
  if not saved then client.ui.bind(widget, "status", reason); return end
  typography = updated
  -- A deliberate preference change rebuilds the static stylesheet; server
  -- updates only touch bindings and never reset the form or scroll position.
  client.ui.content(widget, markup(client.ui.typography(typography)))
  render()
end

local function action(event)
  if type(event) ~= "table" or event.action ~= "refresh" then return end
  local sent, reason = client.request("char")
  if not sent then client.ui.bind(widget, "status", reason) end
end

function init()
  if type(client) == "table" then return end
  apiLibrary = require("aardwolf-api")
  client = apiLibrary.new({
    findPluginByName = findPluginByName,
    onPluginBroadcast = onPluginBroadcast, broadcastToPlugin = broadcastToPlugin,
    on = on, off = off, sendGMCP = sendGMCP,
    loadTable = loadTable, saveTable = saveTable, storageStatus = storageStatus,
    createWidget = createWidget, destroyWidget = destroyWidget,
    setWidgetProperty = setWidgetProperty, setBoundValue = setBoundValue,
    registerWidgetEvent = registerWidgetEvent,
    reportError = function(message) echo(message) end
  }, { packages = { "Char" } })
  local saved = client.storage.get("typography", typography)
  if type(saved) ~= "table" then saved = typography end
  local candidate = { family = saved.family or typography.family, size = saved.size or typography.size,
    style = saved.style or typography.style, weight = saved.weight or typography.weight,
    spacing = saved.spacing or typography.spacing }
  local valid, css = pcall(client.ui.typography, candidate)
  if valid then typography = candidate else css = client.ui.typography(typography) end
  widget = client.ui.create({ type = "html", name = "vitals", title = "Aardwolf API Vitals",
    position = { x = 40, y = 100 }, size = { width = 280, height = 240 } })
  if type(widget) ~= "string" then client.stop(); client, apiLibrary = nil, nil; return end
  client.ui.content(widget, markup(css))
  client.ui.on(widget, "submit", savePreferences)
  client.ui.on(widget, "action", action)
  for _, topic in ipairs({ "session", "char.vitals", "char.maxstats" }) do table.insert(unsubscribers, client.on(topic, render)) end
  client.start()
  render()
end

function cleanup()
  if type(client) ~= "table" then return end
  for _, unsubscribe in ipairs(unsubscribers) do unsubscribe() end
  unsubscribers = {}
  client.stop()
  client, widget, apiLibrary = nil, nil, nil
end
