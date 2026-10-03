-- Missed-shortcuts hook for Hyprland's Lua config.
--
-- Load it from ~/.config/hypr/hyprland.lua BEFORE require("default.hypr.omarchy"):
--
--   pcall(dofile, os.getenv("HOME") .. "/.config/omarchy/plugins/saigkill.missed-shortcuts/hypr/missed-shortcuts.lua")
--
-- It does two things and nothing else:
--   1. Records every binding (keys, description, action) and writes the list to
--      $XDG_RUNTIME_DIR/missed-shortcuts/bindings.json once the config has loaded,
--      then sends "custom>>missedshortcuts>>registry".
--   2. Wraps each binding so that, when it fires, a custom event
--      "custom>>missedshortcuts>>fired>><id>" goes out on Hyprland's event socket
--      before the original action runs.
-- No key presses are read. If anything here fails, bindings keep their
-- original behaviour.

local M = { bindings = {} }

local orig_bind = hl.bind
local orig_unbind = hl.unbind
local tags = setmetatable({}, { __mode = "k" })

-- Dispatchers that need the original key event and must not be wrapped.
local passthrough = { pass = true, send_shortcut = true, send_key_state = true, ["window.drag"] = true, ["window.resize"] = true }

local function describe(value, depth)
  depth = depth or 0
  local t = type(value)
  if t == "string" then return string.format("%q", value) end
  if t ~= "table" or depth > 2 then return tostring(value) end
  local parts = {}
  for k, v in pairs(value) do parts[#parts + 1] = tostring(k) .. "=" .. describe(v, depth + 1) end
  table.sort(parts)
  return "{" .. table.concat(parts, ",") .. "}"
end

-- Tag every dispatcher created through hl.dsp with what it does, so the
-- registry can say "exec_cmd uwsm-app -- chromium" instead of "HL.Dispatcher".
local function wrap_factory(name, fn)
  return function(...)
    local d = fn(...)
    if d ~= nil then
      local args = { ... }
      local shown = {}
      for i = 1, select("#", ...) do shown[i] = describe(args[i]) end
      tags[d] = { name = name, args = args, text = name .. "(" .. table.concat(shown, ", ") .. ")" }
    end
    return d
  end
end

for k, v in pairs(hl.dsp) do
  if type(v) == "function" then
    hl.dsp[k] = wrap_factory(k, v)
  elseif type(v) == "table" then
    for k2, v2 in pairs(v) do
      if type(v2) == "function" then v[k2] = wrap_factory(k .. "." .. k2, v2) end
    end
  end
end

local function json(value)
  local t = type(value)
  if t == "nil" then return "null" end
  if t == "boolean" or t == "number" then return tostring(value) end
  if t == "string" then
    return '"' .. value:gsub('[%c"\\]', function(c)
      if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" elseif c == "\n" then return "\\n" end
      return string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  local parts = {}
  if #value > 0 then
    for _, v in ipairs(value) do parts[#parts + 1] = json(v) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  for k, v in pairs(value) do parts[#parts + 1] = json(tostring(k)) .. ":" .. json(v) end
  return "{" .. table.concat(parts, ",") .. "}"
end

local write_scheduled = false
local function schedule_write()
  if write_scheduled then return end
  write_scheduled = true
  hl.timer(function()
    write_scheduled = false
    local dir = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/missed-shortcuts"
    os.execute("mkdir -p '" .. dir .. "'")
    local list = {}
    for id, b in ipairs(M.bindings) do
      if not b.removed then
        list[#list + 1] = { id = id, keys = b.keys, description = b.description, action = b.action, kind = b.kind, args = b.args, wrapped = b.wrapped }
      end
    end
    local f = io.open(dir .. "/bindings.json.tmp", "w")
    if f then
      f:write(json(list))
      f:close()
      os.rename(dir .. "/bindings.json.tmp", dir .. "/bindings.json")
      -- The file is replaced, not rewritten, so tell the plugin to reread it.
      pcall(hl.dispatch, hl.dsp.event("missedshortcuts>>registry"))
    end
  end, { timeout = 200, type = "oneshot" })
end

local function norm_keys(keys)
  return (tostring(keys):upper():gsub("%s+", ""))
end

hl.bind = function(keys, dispatcher, opts, ...)
  local id = #M.bindings + 1
  local tag = tags[dispatcher]
  local entry = {
    keys = tostring(keys),
    description = type(opts) == "table" and opts.description or nil,
    kind = tag and tag.name or type(dispatcher),
    action = tag and tag.text or type(dispatcher),
    args = tag and tag.args or nil,
    wrapped = false,
  }
  M.bindings[id] = entry
  schedule_write()

  local mouse = type(opts) == "table" and opts.mouse
  if mouse or (tag and passthrough[tag.name]) or (type(dispatcher) ~= "function" and type(dispatcher) ~= "userdata") then
    return orig_bind(keys, dispatcher, opts, ...)
  end

  local signal = hl.dsp.event("missedshortcuts>>fired>>" .. id)
  local wrapped = function(...)
    pcall(hl.dispatch, signal)
    if type(dispatcher) == "function" then
      return dispatcher(...)
    end
    return hl.dispatch(dispatcher)
  end

  local ok, result = pcall(orig_bind, keys, wrapped, opts, ...)
  if ok then
    entry.wrapped = true
    return result
  end
  return orig_bind(keys, dispatcher, opts, ...)
end

hl.unbind = function(keys, ...)
  local k = norm_keys(keys)
  for _, b in ipairs(M.bindings) do
    if norm_keys(b.keys) == k then b.removed = true end
  end
  schedule_write()
  return orig_unbind(keys, ...)
end

return M
