plugin = {
  id = "aardwolf-room-details", name = "Aardwolf Room Details", version = "0.1.1",
  author = "Sam Roberts", description = "Formatted, selectable room characters and objects in a compact dockable panel."
}

local client, widget, initialized, ready = nil, nil, false, false
local subscriptions = {}
local automatic, character, configured, setupAttempted = true, nil, false, false
local snapshots, cycle, selection, roomNumber = {}, {}, nil, nil
local capture, captureTimer, refreshTimer, responseTimer = nil, nil, nil, nil
local pending, pendingAuto, requiredPrompt, promptSerial = false, false, 0, 0
local lastActivity, lastLook, lastPrompt, promptClosed = 0, -1000, -1000, true
local provisionalPrompt = nil
local inFlight, ownSend, previousState, combatPrompt = false, false, nil, 0
local revision, lifetime, issue, sgr = 0, 0, nil, {}
local publish, schedule, synchronize
local OPEN = { ["{roomchars}"] = "chars", ["{roomobjs}"] = "objs" }
local CLOSE = { ["{/roomchars}"] = "chars", ["{/roomobjs}"] = "objs" }
local ITEM_COMMANDS = { get = true, take = true, drop = true, put = true, give = true,
  sacrifice = true, sac = true, donate = true, buy = true, sell = true }
local FONT_FIELDS = { "family", "size", "weight" }
local font = nil

local function stopTimer(id)
  if type(id) == "string" and id ~= "" then removeTimer(id) end
end

local function timer(delay, callback)
  local epoch = lifetime
  local ok, id = pcall(addTimer, delay, function()
    if initialized and lifetime == epoch then callback() end
  end)
  if ok and type(id) == "string" and id ~= "" then return id end
  return nil
end

local function connected()
  local session = getSession()
  local status = client and client.status()
  return type(session) == "table" and session.connected == true and status
    and status.available and status.connected and status.negotiated
end

local function active()
  return connected() and character ~= nil and (client.get("char.status") or {}).state == 3
end

local function visible()
  if not widget or not ready then return false end
  local ok, value = pcall(getWidgetProperty, widget, "visible")
  return ok and value == true
end

local function terminalFont()
  if type(getTerminalFont) ~= "function" or type(getWidgetFont) ~= "function" then return nil end
  local ok, value = pcall(getTerminalFont)
  local valid, terminal = pcall(getWidgetFont, "terminal")
  if not ok or not valid or type(value) ~= "table" or type(terminal) ~= "table"
    or type(value.family) ~= "string" or #value.family > 256
    or type(value.size) ~= "number" or value.size ~= value.size or value.size < 6 or value.size > 96 then return nil end
  return { family = value.family, size = value.size, weight = terminal.weight or "normal" }
end

local function statusText()
  if issue then return issue end
  if not connected() then return "Waiting for Aardwolf API Core and a connection" end
  if not character then return "Waiting for login" end
  if not font or type(parseAnsiText) ~= "function" then return "Formatting API unavailable; room output stays in console" end
  if not configured then return "Waiting to enable room tags" end
  if inFlight then return "Refreshing room..." end
  if pending then return "Room refresh queued" end
  return ""
end

publish = function()
  if widget and ready then
    local ok = pcall(setWidgetProperty, widget, "roomDetails", json.encode({
      chars = snapshots.chars, objs = snapshots.objs, selection = selection,
      automatic = automatic, status = statusText(), font = font
    }))
    if not ok then ready = false; issue = "Panel update failed; room output stays in console" end
  end
end

local function updateFont()
  local current, changed = terminalFont(), false
  for _, key in ipairs(FONT_FIELDS) do
    if (current and current[key]) ~= (font and font[key]) then changed = true end
  end
  font = current
  if changed then publish() end
end

-- Keep a bounded SGR state, including attributes set before the opening tag.
-- The client's parser still owns color resolution and intensity semantics.
local function stylePrefix()
  local parts = { "0" }
  for _, key in ipairs({ "intensity", "italic", "underline", "inverse", "strike", "fg", "bg" }) do
    if sgr[key] then table.insert(parts, sgr[key]) end
  end
  return "\27[" .. table.concat(parts, ";") .. "m"
end

local function rememberStyle(raw)
  for codes in string.gmatch(raw, "\27%[([%d;]*)m") do
    local values = {}
    for value in string.gmatch(codes .. ";", "(.-);") do table.insert(values, tonumber(value) or 0) end
    local index = 1
    while index <= #values do
      local code = values[index]
      if code == 0 then sgr = {}
      elseif code == 1 or code == 2 then sgr.intensity = tostring(code)
      elseif code == 22 then sgr.intensity = nil
      elseif code == 3 then sgr.italic = "3"
      elseif code == 23 then sgr.italic = nil
      elseif code == 4 or code == 21 then sgr.underline = tostring(code)
      elseif code == 24 then sgr.underline = nil
      elseif code == 7 then sgr.inverse = "7"
      elseif code == 27 then sgr.inverse = nil
      elseif code == 9 then sgr.strike = "9"
      elseif code == 29 then sgr.strike = nil
      elseif code == 39 then sgr.fg = nil
      elseif code == 49 then sgr.bg = nil
      elseif (code >= 30 and code <= 37) or (code >= 90 and code <= 97) then sgr.fg = tostring(code)
      elseif (code >= 40 and code <= 47) or (code >= 100 and code <= 107) then sgr.bg = tostring(code)
      elseif code == 38 or code == 48 then
        local count = values[index + 1] == 5 and 1 or (values[index + 1] == 2 and 3 or 0)
        local parts, valid = { tostring(code), tostring(values[index + 1]) }, count > 0
        for offset = 1, count do
          local value = values[index + 1 + offset]
          if not value or value < 0 or value > 255 then valid = false end
          table.insert(parts, tostring(value))
        end
        if valid then sgr[code == 38 and "fg" or "bg"] = table.concat(parts, ";") end
        if count > 0 then index = index + count + 1 else break end
      end
      index = index + 1
    end
  end
end

local function color(value)
  if value == nil then return nil end
  if type(value) ~= "string" then return nil end
  if string.match(value, "^#%x%x%x$") or string.match(value, "^#%x%x%x%x%x%x$")
    or string.match(value, "^#%x%x%x%x%x%x%x%x$") then return value end
  local red, green, blue = string.match(value, "^rgb%(%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)%s*%)$")
  if red and tonumber(red) <= 255 and tonumber(green) <= 255 and tonumber(blue) <= 255 then return value end
  return nil
end

local function formatted(raw, clean, prefix)
  if type(parseAnsiText) ~= "function" then return nil end
  local ok, segments = pcall(parseAnsiText, prefix .. raw)
  if not ok or type(segments) ~= "table" then return nil end
  -- Native arrays may arrive with zero-based or string numeric keys.
  local ordered = {}
  for key, segment in pairs(segments) do
    local index = tonumber(key)
    if not index or index < 0 or index ~= math.floor(index) or #ordered >= 8192 then return nil end
    table.insert(ordered, { index = index, segment = segment })
  end
  table.sort(ordered, function(left, right) return left.index < right.index end)
  local runs, text = {}, {}
  for _, entry in ipairs(ordered) do
    local segment = entry.segment
    if type(segment) ~= "table" or type(segment.text) ~= "string" then return nil end
    local foreground, background = color(segment.color), color(segment.backgroundColor)
    if (segment.color ~= nil and not foreground) or (segment.backgroundColor ~= nil and not background) then return nil end
    table.insert(text, segment.text)
    table.insert(runs, { text = segment.text, color = foreground, background = background,
      italic = segment.italic == true, underline = segment.underline == true })
  end
  if table.concat(text) ~= clean then return nil end
  return { text = clean, runs = runs }
end

local function finishCapture(incomplete)
  if not capture then return end
  stopTimer(captureTimer); captureTimer = nil
  local current = capture
  capture = nil
  revision = revision + 1
  local snapshot = { revision = revision, rows = current.rows, incomplete = incomplete ~= nil }
  snapshots[current.kind], cycle[current.kind] = snapshot, snapshot
  if selection and selection.kind == current.kind then selection = nil end
  if incomplete then issue = incomplete end
  publish()
  schedule()
end

local function cancelWork()
  lifetime = lifetime + 1
  stopTimer(captureTimer); stopTimer(refreshTimer); stopTimer(responseTimer)
  captureTimer, refreshTimer, responseTimer, capture = nil, nil, nil, nil
  pending, pendingAuto, inFlight = false, false, false
end

local function resetSession()
  cancelWork()
  snapshots, cycle, selection, sgr = {}, {}, nil, {}
  character, roomNumber, previousState = nil, nil, nil
  configured, setupAttempted, issue = false, false, nil
  promptSerial, requiredPrompt, combatPrompt = 0, 0, 0
  provisionalPrompt = nil
  lastLook, lastActivity, lastPrompt, promptClosed = -1000, getCurrentTime(), -1000, true
  publish()
end

local function sendFixed(command)
  ownSend = true
  local ok, accepted = pcall(send, command)
  ownSend = false
  if not ok or accepted == false then
    issue = "Could not send " .. command .. "; use Refresh to try again"
    pending, pendingAuto = false, false
    publish()
    return false
  end
  return true
end

local function canRun()
  return active() and not capture and not inFlight and not client.spells.status().refreshing
end

local function runRefresh()
  refreshTimer = nil
  if not canRun() then return end
  if not setupAttempted then
    setupAttempted = true
    if not sendFixed("tags roomobjs on") or not sendFixed("tags roomchars on") then return end
    configured, pending, pendingAuto, requiredPrompt = true, true, false, 0
  end
  if not configured or not pending or promptSerial < requiredPrompt then return end
  pending, pendingAuto, inFlight, issue = false, false, true, nil
  lastLook = getCurrentTime()
  responseTimer = timer(5000, function()
    responseTimer, inFlight, pending, pendingAuto = nil, false, false, false
    issue = "Room response timed out; use Refresh to try again"
    publish()
  end)
  if not responseTimer then
    inFlight = false; issue = "Refresh timer unavailable; use Refresh to try again"; publish(); return
  end
  if not sendFixed("look") then stopTimer(responseTimer); responseTimer, inFlight = nil, false end
  publish()
end

schedule = function()
  if not initialized or refreshTimer or not canRun() then return end
  if setupAttempted and (not configured or not pending or promptSerial < requiredPrompt) then return end
  local now = getCurrentTime()
  local delay = math.max(1, lastActivity + 300 - now, lastLook + 1000 - now)
  refreshTimer = timer(delay, function()
    refreshTimer = nil
    if getCurrentTime() < lastActivity + 300 or getCurrentTime() < lastLook + 1000 then schedule()
    else runRefresh() end
  end)
  if not refreshTimer then
    setupAttempted, pending, pendingAuto = true, false, false
    issue = "Refresh timer unavailable; use Refresh to try again"; publish()
  end
end

local function requestLook(isAutomatic, boundary)
  if isAutomatic and not automatic then return end
  pendingAuto = isAutomatic and (not pending or pendingAuto)
  pending = true
  requiredPrompt = math.max(requiredPrompt, boundary or 0)
  lastActivity = getCurrentTime()
  schedule(); publish()
end

synchronize = function()
  if not initialized then return end
  if not connected() then
    -- Keep setup ownership through a temporary Core restart, but expose no stale room data.
    cancelWork(); snapshots, cycle, selection, previousState = {}, {}, nil, nil
    publish(); return
  end
  local base, state = client.get("char.base") or {}, (client.get("char.status") or {}).state
  local name = type(base.name) == "string" and string.match(base.name, "^%s*(.-)%s*$") or ""
  if name == "" or #name > 128 or string.find(name, "%c") then
    if character then resetSession() end
    publish(); return
  end
  name = string.lower(name)
  if character and character ~= name then resetSession() end
  character = name
  if state == 8 and previousState ~= 8 then combatPrompt = promptSerial end
  if previousState == 8 and state == 3 and automatic then
    -- The final prompt and GMCP can arrive in either order. An older combat
    -- round's prompt must not release a look before this round has finished.
    local recentPrompt = promptClosed and promptSerial > combatPrompt and getCurrentTime() - lastPrompt <= 300
    local boundary = recentPrompt and promptSerial or promptSerial + 1
    if not recentPrompt then promptClosed = false end
    requestLook(true, boundary)
  end
  previousState = state
  local room = (client.get("room.info") or {}).num
  if room and room ~= roomNumber then
    local preserve = not promptClosed or getCurrentTime() - lastPrompt <= 300
    snapshots = preserve and { chars = cycle.chars, objs = cycle.objs } or {}
    roomNumber, selection = room, nil
  end
  updateFont(); schedule(); publish()
end

function onLine(sessionId, rawLine, cleanLine)
  if not initialized or sessionId ~= getSessionId() or not connected()
    or type(rawLine) ~= "string" or type(cleanLine) ~= "string" then return end
  if promptClosed and not string.match(cleanLine, "^%[.*%]%s*>%s*$") then cycle = {}; promptClosed = false end
  lastActivity = getCurrentTime()
  updateFont()
  local prefix = stylePrefix()
  rememberStyle(rawLine)
  local kind, closing = OPEN[cleanLine], CLOSE[cleanLine]
  if capture and getCurrentTime() >= capture.expires then finishCapture("Incomplete room block: timed out") end
  if kind then
    if capture then finishCapture("Incomplete room block: unexpected opening tag") end
    capture = { kind = kind, rows = {}, bytes = 0, expires = getCurrentTime() + 5000,
      suppress = visible() and font ~= nil and type(parseAnsiText) == "function" }
    captureTimer = timer(5000, function() captureTimer = nil; finishCapture("Incomplete room block: timed out") end)
    if not captureTimer then finishCapture("Room capture timer unavailable"); return end
    if capture.suppress then return false end
    return
  end
  if not capture then return end
  if closing then
    local suppress = capture.suppress and visible()
    if closing ~= capture.kind then finishCapture("Incomplete room block: mismatched closing tag"); return end
    finishCapture()
    if suppress then return false end
    return
  end
  if string.match(cleanLine, "^%[.*%]%s*>%s*$") then finishCapture("Incomplete room block: missing closing tag"); return end
  if #capture.rows >= 500 or capture.bytes + #rawLine + 1 > 128 * 1024 then
    finishCapture("Incomplete room block: size limit reached"); return
  end
  local row = formatted(rawLine, cleanLine, prefix)
  if not row then
    table.insert(capture.rows, { text = cleanLine, runs = { { text = cleanLine } } })
    finishCapture("Room formatting unavailable; output stays in console"); return
  end
  capture.bytes = capture.bytes + #rawLine + 1
  table.insert(capture.rows, row)
  if capture.suppress and visible() then return false end
end

local function lineBoundary(event)
  if not initialized or type(event) ~= "table" or event.sessionId ~= getSessionId() or type(event.clean) ~= "string" then return end
  lastActivity = getCurrentTime()
  if string.match(event.clean, "^%[.*%]%s*>%s*$") then
    -- Provisional prompts can be delivered again when their newline arrives.
    if not event.provisional and provisionalPrompt == event.clean then provisionalPrompt = nil; return end
    if event.provisional then provisionalPrompt = event.clean end
    if not promptClosed then promptSerial = promptSerial + 1 end
    promptClosed, lastPrompt = true, getCurrentTime()
    if inFlight then stopTimer(responseTimer); responseTimer, inFlight = nil, false end
    schedule(); publish()
  end
end

function onSend(sessionId, text)
  if not initialized or ownSend or sessionId ~= getSessionId() or type(text) ~= "string" then return end
  cycle, promptClosed = {}, false
  local verb = string.match(string.lower(text), "^%s*(%a+)%s") or string.match(string.lower(text), "^%s*(%a+)%s*$")
  if ITEM_COMMANDS[verb] then requestLook(true, promptSerial + 1) end
  if string.match(string.lower(text), "^%s*look%s*$") then pending, pendingAuto, requiredPrompt = false, false, 0 end
end

function onDisconnect(sessionId)
  if initialized and sessionId == getSessionId() then resetSession() end
end

local function command(argument)
  local text = type(argument) == "string" and string.lower(argument) or ""
  if text == "show" then showWidget(widget, true); updateFont(); publish(); return "Room Details shown." end
  if text == "hide" then hideWidget(widget); return "Room Details hidden; room output stays in console." end
  if text == "refresh" then
    issue = nil
    if not configured then setupAttempted = false end
    requiredPrompt = 0; requestLook(false, 0)
    return "Room refresh requested."
  end
  if text == "auto on" or text == "auto off" then
    local enabled = text == "auto on"
    local saved, reason = client.storage.set("room-details:automatic", enabled)
    if not saved then issue = reason or "Could not save Auto preference"; publish(); return issue end
    automatic = enabled
    if not automatic and pendingAuto then pending, pendingAuto, requiredPrompt = false, false, 0 end
    publish(); return automatic and "Automatic room refresh enabled." or "Automatic room refresh disabled."
  end
  if text == "" or text == "status" then return "Room Details: " .. (statusText() ~= "" and statusText() or "Ready") end
  return "Usage: awroomdetails show|hide|refresh|status|auto on|auto off"
end

local function markup()
  return [=[<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Room Details</title><style>
:root{color-scheme:dark;color:#e6edf5;background:#131b27;font:12px system-ui,sans-serif}*{box-sizing:border-box}
body{margin:0;padding:6px}header{display:flex;align-items:center;gap:8px;margin-bottom:5px;font:12px system-ui,sans-serif}
header strong{margin-right:auto}header button{font:inherit;color:inherit;background:#233247;border:1px solid #43546b;border-radius:4px;padding:2px 6px}
label{display:flex;align-items:center;gap:3px;white-space:nowrap}input{margin:0}h2{font:600 11px system-ui,sans-serif;color:#b9c7d8;margin:6px 0 3px}
.entry{display:block;width:100%;text-align:left;color:inherit;background:transparent;border:0;border-radius:3px;padding:1px 3px;margin:0;
font:inherit;white-space:pre;overflow:hidden;text-overflow:ellipsis;user-select:text;cursor:pointer;line-height:1.2}
.entry[aria-pressed="true"]{outline:1px solid #8bc3ff;outline-offset:-1px}.entry:focus-visible{outline:2px solid #c7e2ff;outline-offset:-2px}
.blank{display:none}.empty,#status{color:#aebdcc;font:11px system-ui,sans-serif}#status:empty{display:none}
#status{margin:4px 0}.empty{padding:2px 3px}.incomplete{color:#ffd18b;font:11px system-ui,sans-serif}
</style></head><body><header><strong>Room Details</strong><label><input id="auto" type="checkbox" checked>Auto</label><button id="refresh" type="button">Refresh</button></header>
<div id="status" role="status"></div><main><section aria-labelledby="chars-title"><h2 id="chars-title">Characters <span id="chars-count">0</span></h2><div id="chars"></div></section>
<section aria-labelledby="objs-title"><h2 id="objs-title">Objects <span id="objs-count">0</span></h2><div id="objs"></div></section></main><script>
(function(){
  var current = {chars:null,objs:null}, selected = null;
  function array(value){return Array.isArray(value) ? value : [];}
  function select(kind, revision, index){mudforge.send('select',{kind:kind,revision:revision,index:index});}
  function rows(kind, snapshot){
    var root = document.getElementById(kind);
    if (current[kind] === (snapshot && snapshot.revision)) return;
    var focus = document.activeElement, restore = root.contains(focus) ? Number(focus.dataset.index) : null;
    root.replaceChildren(); current[kind] = snapshot && snapshot.revision;
    var entries = array(snapshot && snapshot.rows), count = 0;
    entries.forEach(function(row, offset){
      var nonempty = typeof row.text === 'string' && row.text.trim().length > 0;
      var entry = document.createElement(nonempty ? 'button' : 'div');
      entry.className = nonempty ? 'entry' : 'blank';
      if(nonempty){
        count++; entry.type='button'; entry.dataset.kind=kind; entry.dataset.index=String(offset+1);
        entry.title=row.text;
        entry.setAttribute('aria-pressed','false');
        entry.addEventListener('click',function(){if(!String(window.getSelection())) select(kind,snapshot.revision,offset+1);});
      }
      array(row.runs).forEach(function(run){
        var span=document.createElement('span'); span.textContent=typeof run.text==='string'?run.text:'';
        // Values originate in the native ANSI parser, never server-authored CSS.
        if(typeof run.color==='string') span.style.color=run.color;
        if(typeof run.background==='string') span.style.backgroundColor=run.background;
        if(run.italic===true) span.style.fontStyle='italic';
        if(run.underline===true) span.style.textDecoration='underline';
        entry.appendChild(span);
      });
      root.appendChild(entry);
    });
    document.getElementById(kind+'-count').textContent=String(count);
    if(!count){var empty=document.createElement('div');empty.className='empty';empty.textContent=snapshot?'None here':'Waiting for room output';root.appendChild(empty);}
    if(snapshot && snapshot.incomplete){var note=document.createElement('div');note.className='incomplete';note.textContent='Incomplete room output';root.appendChild(note);}
    if(restore!==null){var buttons=root.querySelectorAll('button');var target=Array.from(buttons).find(function(b){return Number(b.dataset.index)===restore;})||buttons[0];if(target)target.focus({preventScroll:true});}
  }
  mudforge.onProperty('roomDetails',function(encoded){
    var scroll=document.scrollingElement.scrollTop;
    var value=JSON.parse(encoded); rows('chars',value.chars);rows('objs',value.objs);
    selected=value.selection;
    document.querySelectorAll('.entry').forEach(function(b){b.setAttribute('aria-pressed',String(!!selected && selected.kind===b.dataset.kind && selected.index===Number(b.dataset.index)));});
    document.getElementById('status').textContent=value.status||'';
    document.getElementById('auto').checked=value.automatic===true;
    if(value.font){document.querySelector('main').style.fontFamily=value.font.family;document.querySelector('main').style.fontSize=value.font.size+'px';document.querySelector('main').style.fontWeight=value.font.weight;}
    document.scrollingElement.scrollTop=scroll;
  });
  document.getElementById('auto').addEventListener('change',function(e){mudforge.send('auto',{enabled:e.target.checked});});
  document.getElementById('refresh').addEventListener('click',function(){mudforge.send('refresh',{});});
  mudforge.send('ready',{});
})();
</script></body></html>]=]
end

local function widgetMessage(event)
  if not initialized or type(event) ~= "table" or (event.sessionId and event.sessionId ~= getSessionId()) then return end
  if event.event == "ready" then ready = true; updateFont(); publish()
  elseif event.event == "refresh" then command("refresh")
  elseif event.event == "auto" and type(event.data) == "table" and type(event.data.enabled) == "boolean" then
    command(event.data.enabled and "auto on" or "auto off")
  elseif event.event == "select" and type(event.data) == "table" then
    local data = event.data
    if data.kind ~= "chars" and data.kind ~= "objs" then return end
    local snapshot = snapshots[data.kind]
    local index = type(data.index) == "number" and data.index or nil
    if snapshot and index and index >= 1 and index <= 500 and index == math.floor(index) and snapshot.revision == data.revision
      and snapshot.rows[index] and string.find(snapshot.rows[index].text, "%S") then
      selection = { kind = data.kind, revision = data.revision, index = index }; publish()
    end
  end
end

function init()
  if initialized then return end
  local library = require("aardwolf-api")
  client = library.new({ findPluginByName = findPluginByName, onPluginBroadcast = onPluginBroadcast,
    broadcastToPlugin = broadcastToPlugin, on = on, off = off, loadTable = loadTable, saveTable = saveTable,
    storageStatus = storageStatus, reportError = function(message) echo(message) end
  }, { packages = { "Char", "Room" }, spells = true })
  local saved = client.storage.get("room-details:automatic", true)
  automatic = type(saved) ~= "boolean" or saved
  widget = createWidget({ type = "html", name = "room-details", title = "Room Details",
    position = { x = 50, y = 150 }, size = { width = 360, height = 240 } })
  if type(widget) ~= "string" or widget == "" then
    widget = nil; client.stop(); client = nil; echo("Room Details: panel unavailable; output stays in console"); return
  end
  initialized = true
  resetSession()
  registerWidgetEvent(widget, "luamsg", widgetMessage)
  setWidgetProperty(widget, "content", markup())
  registerCommand("awroomdetails", command)
  for _, topic in ipairs({ "session", "char.base", "char.status", "room.info" }) do
    table.insert(subscriptions, client.on(topic, synchronize))
  end
  table.insert(subscriptions, client.spells.on(function() schedule(); publish() end))
  on("line", lineBoundary)
  on("windowResize", updateFont)
  client.start(); synchronize()
end

function cleanup()
  if not initialized then return end
  initialized, ready = false, false
  cancelWork()
  off("line", lineBoundary); off("windowResize", updateFont)
  for _, unsubscribe in ipairs(subscriptions) do unsubscribe() end
  subscriptions = {}
  client.stop(); destroyWidget(widget)
  client, widget = nil, nil
  snapshots, cycle, selection, sgr, font = {}, {}, nil, {}, nil
  character, configured, setupAttempted, previousState, roomNumber = nil, false, false, nil, nil
end
