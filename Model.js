// Pure logic for the missed-shortcuts plugin: reading the binding registry
// written by hypr/missed-shortcuts.lua, deciding from Hyprland events whether
// the user just did something a shortcut would have done, and formatting the
// tip. Nothing in here touches a process, a file or a window, so all of it is
// covered by tests/test_model.js without a running shell.

var LAUNCHER_LAYER = "omarchy-menu"

// Milliseconds.
var FIRED_WINDOW = 800          // a shortcut this recent explains the event
var APP_START_WINDOW = 8000     // shortcut or launcher -> window of the app
var SETTLE_WINDOW = 1000        // window opened/closed: workspace/float changes are side effects
var MONITOR_WINDOW = 400        // focus moved to another monitor: workspace event is a side effect
var GLOBAL_COOLDOWN = 15000     // at most one tip in this time
var TIP_COOLDOWN = 30 * 60000   // the same tip again only after this time
var HISTORY = 15000             // how long fired shortcuts are remembered

function parseBindings(text) {
  var list
  try {
    list = JSON.parse(text || "[]")
  } catch (e) {
    return []
  }
  if (!Array.isArray(list)) return []
  return list.filter(function(b) {
    return b && typeof b.id === "number" && typeof b.keys === "string"
  })
}

// "SUPER + code:11" -> "SUPER + 2". X keycodes 10-19 are the digit row.
function formatKeys(keys) {
  return String(keys).split("+").map(function(part) {
    var key = part.trim()
    var m = /^code:(\d+)$/.exec(key)
    if (m) {
      var code = parseInt(m[1], 10)
      if (code >= 10 && code <= 18) return String(code - 9)
      if (code === 19) return "0"
    }
    return key.toUpperCase()
  }).join(" + ")
}

function keyCaps(keys) {
  return formatKeys(keys).split(" + ")
}

function execCommand(binding) {
  if (!binding || binding.kind !== "exec_cmd" || !binding.args) return ""
  return String(binding.args[0] || "")
}

// Shortcuts that open a menu or a shell panel rather than doing the thing.
function isUiToggle(command) {
  return /^(omarchy-menu|omarchy-shell)(\s|$)/.test(command)
}

function isLaunch(binding) {
  var command = execCommand(binding)
  return command !== "" && !isUiToggle(command)
}

function byId(bindings, id) {
  for (var i = 0; i < bindings.length; i++) if (bindings[i].id === id) return bindings[i]
  return null
}

function byAction(bindings, action) {
  for (var i = 0; i < bindings.length; i++) if (bindings[i].action === action) return bindings[i]
  return null
}

// Fallback when nothing was learned yet: the window class appears as a word in
// the command, e.g. class "typora" for "uwsm-app -- typora".
function launchBindingForClass(bindings, windowClass) {
  var cls = String(windowClass || "").toLowerCase()
  if (cls.length < 3) return null
  var last = cls.split(".").pop()
  for (var i = 0; i < bindings.length; i++) {
    if (!isLaunch(bindings[i])) continue
    var words = execCommand(bindings[i]).toLowerCase().split(/[\s'"\/=]+/)
    if (words.indexOf(cls) !== -1 || words.indexOf(last) !== -1) return bindings[i]
  }
  return null
}

function workspaceBinding(bindings, name) {
  for (var i = 0; i < bindings.length; i++) {
    var b = bindings[i]
    var arg = b.args && b.args[0]
    if (b.kind === "focus" && arg && String(arg.workspace) === String(name)) return b
  }
  return null
}

function floatBinding(bindings) {
  for (var i = 0; i < bindings.length; i++) {
    var b = bindings[i]
    var arg = b.args && b.args[0]
    if (b.kind === "window.float" && arg && arg.action === "toggle") return b
  }
  return null
}

function newState(learned) {
  return {
    fired: [],                  // [{ id, at }]
    launcherClosedAt: -Infinity,
    windowChangedAt: -Infinity,
    monitorChangedAt: -Infinity,
    learned: learned || {},     // window class -> binding action
    shown: {},                  // binding action -> ms
    lastTipAt: -Infinity
  }
}

function firedSince(state, since) {
  return state.fired.filter(function(f) { return f.at >= since })
}

// Feed one Hyprland event. Returns { tip: binding|null, learned: bool } and
// updates `state` in place.
function handleEvent(state, bindings, name, data, now) {
  var result = { tip: null, learned: false }
  var parts = String(data || "").split(",")
  state.fired = firedSince(state, now - HISTORY)

  switch (name) {
    case "custom": {
      var m = /^missedshortcuts>>fired>>(\d+)$/.exec(data)
      if (m) state.fired.push({ id: parseInt(m[1], 10), at: now })
      return result
    }
    case "closelayer":
      if (data === LAUNCHER_LAYER) state.launcherClosedAt = now
      return result
    case "focusedmon":
      state.monitorChangedAt = now
      return result
    case "closewindow":
      state.windowChangedAt = now
      return result
    case "openwindow": {
      state.windowChangedAt = now
      var windowClass = parts[2] || ""
      if (windowClass === "") return result
      // Launch shortcuts pressed after the launcher closed (or with no launcher
      // involved) started this window: remember which one, for next time.
      var since = Math.max(now - APP_START_WINDOW, state.launcherClosedAt)
      var launches = firedSince(state, since).map(function(f) { return byId(bindings, f.id) }).filter(isLaunch)
      if (launches.length > 0) {
        var action = launches[launches.length - 1].action
        if (state.learned[windowClass] !== action) {
          state.learned[windowClass] = action
          result.learned = true
        }
        return result
      }
      if (now - state.launcherClosedAt > APP_START_WINDOW) return result
      var known = state.learned[windowClass]
      result.tip = (known && byAction(bindings, known)) || launchBindingForClass(bindings, windowClass)
      return result
    }
    case "workspacev2": {
      if (firedSince(state, now - FIRED_WINDOW).length > 0) return result
      if (now - state.windowChangedAt < SETTLE_WINDOW) return result
      if (now - state.monitorChangedAt < MONITOR_WINDOW) return result
      result.tip = workspaceBinding(bindings, parts.slice(1).join(","))
      return result
    }
    case "changefloatingmode": {
      if (firedSince(state, now - FIRED_WINDOW).length > 0) return result
      if (now - state.windowChangedAt < SETTLE_WINDOW) return result
      result.tip = floatBinding(bindings)
      return result
    }
  }
  return result
}

// Rate limit: one tip per GLOBAL_COOLDOWN, the same tip once per TIP_COOLDOWN.
// Marks the tip as shown when it is allowed.
function allowTip(state, binding, now) {
  if (!binding) return false
  if (now - state.lastTipAt < GLOBAL_COOLDOWN) return false
  var last = state.shown[binding.action]
  if (last !== undefined && now - last < TIP_COOLDOWN) return false
  state.shown[binding.action] = now
  state.lastTipAt = now
  return true
}

function tipText(binding) {
  return binding.description || binding.action
}

if (typeof module !== "undefined") {
  module.exports = {
    LAUNCHER_LAYER: LAUNCHER_LAYER,
    FIRED_WINDOW: FIRED_WINDOW,
    APP_START_WINDOW: APP_START_WINDOW,
    SETTLE_WINDOW: SETTLE_WINDOW,
    GLOBAL_COOLDOWN: GLOBAL_COOLDOWN,
    TIP_COOLDOWN: TIP_COOLDOWN,
    parseBindings: parseBindings,
    formatKeys: formatKeys,
    keyCaps: keyCaps,
    execCommand: execCommand,
    isUiToggle: isUiToggle,
    isLaunch: isLaunch,
    launchBindingForClass: launchBindingForClass,
    workspaceBinding: workspaceBinding,
    floatBinding: floatBinding,
    newState: newState,
    handleEvent: handleEvent,
    allowTip: allowTip,
    tipText: tipText
  }
}
