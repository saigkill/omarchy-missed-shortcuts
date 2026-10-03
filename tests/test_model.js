// Tests for Model.js: registry parsing, key formatting, and the decision
// whether an event deserves a tip.
//
// Run with: node tests/test_model.js

const assert = require("assert")
const path = require("path")
const Model = require(path.join(__dirname, "..", "Model.js"))

let passed = 0
function test(name, body) {
  try {
    body()
    passed++
  } catch (error) {
    console.error("FAIL: " + name)
    console.error("      " + error.message)
    process.exitCode = 1
  }
}

// A slice of the real registry written by hypr/missed-shortcuts.lua.
const BINDINGS = [
  { id: 1, keys: "SUPER + SPACE", description: "Omarchy menu", kind: "exec_cmd", action: 'exec_cmd("omarchy-menu toggle")', args: ["omarchy-menu toggle"] },
  { id: 2, keys: "SUPER + RETURN", description: "Terminal", kind: "exec_cmd", action: 'exec_cmd("omarchy-launch-terminal")', args: ["omarchy-launch-terminal"] },
  { id: 3, keys: "SUPER + SHIFT + RETURN", description: "Browser", kind: "exec_cmd", action: 'exec_cmd("omarchy-launch-browser")', args: ["omarchy-launch-browser"] },
  { id: 4, keys: "SUPER + SHIFT + T", description: "Typora", kind: "exec_cmd", action: 'exec_cmd("uwsm-app -- typora")', args: ["uwsm-app -- typora"] },
  { id: 5, keys: "SUPER + code:11", description: "Switch to workspace 2", kind: "focus", action: 'focus({workspace="2"})', args: [{ workspace: "2" }] },
  { id: 6, keys: "SUPER + T", description: "Toggle window floating/tiling", kind: "window.float", action: 'window.float({action="toggle"})', args: [{ action: "toggle" }] },
  { id: 7, keys: "SUPER + W", description: "Close window", kind: "window.close", action: "window.close()", args: [] },
  { id: 8, keys: "SUPER + Q", description: "omaSearch", kind: "exec_cmd", action: "exec_cmd(\"omarchy-shell shell toggle x '{}'\")", args: ["omarchy-shell shell toggle x '{}'"] }
]

function feed(state, events) {
  let last = { tip: null, learned: false }
  for (const [at, name, data] of events) last = Model.handleEvent(state, BINDINGS, name, data, at)
  return last
}

// ---- registry ---------------------------------------------------------------

test("parseBindings reads the registry and drops broken entries", () => {
  const list = Model.parseBindings(JSON.stringify([BINDINGS[0], { keys: "X" }, null]))
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].id, 1)
})

test("parseBindings survives garbage", () => {
  assert.deepStrictEqual(Model.parseBindings("{nope"), [])
  assert.deepStrictEqual(Model.parseBindings(""), [])
  assert.deepStrictEqual(Model.parseBindings('{"a":1}'), [])
})

test("formatKeys turns digit-row keycodes into digits", () => {
  assert.strictEqual(Model.formatKeys("SUPER + code:10"), "SUPER + 1")
  assert.strictEqual(Model.formatKeys("SUPER + SHIFT + code:19"), "SUPER + SHIFT + 0")
  assert.strictEqual(Model.formatKeys("super + return"), "SUPER + RETURN")
  assert.deepStrictEqual(Model.keyCaps("SUPER + code:11"), ["SUPER", "2"])
})

test("menu and shell toggles are not launches", () => {
  assert.ok(!Model.isLaunch(BINDINGS[0]))
  assert.ok(!Model.isLaunch(BINDINGS[7]))
  assert.ok(Model.isLaunch(BINDINGS[1]))
  assert.ok(!Model.isLaunch(BINDINGS[4]))
})

// ---- app starts -------------------------------------------------------------

test("a window opened right after a launch shortcut is learned, not tipped", () => {
  const s = Model.newState()
  const r = feed(s, [
    [1000, "custom", "missedshortcuts>>fired>>2"],
    [1800, "openwindow", "abc,1,Alacritty,Terminal"]
  ])
  assert.strictEqual(r.tip, null)
  assert.ok(r.learned)
  assert.strictEqual(s.learned.Alacritty, 'exec_cmd("omarchy-launch-terminal")')
})

test("the same app opened from the launcher gets the learned shortcut as tip", () => {
  const s = Model.newState({ Alacritty: 'exec_cmd("omarchy-launch-terminal")' })
  const r = feed(s, [
    [1000, "custom", "missedshortcuts>>fired>>1"],          // SUPER+SPACE opens the menu
    [3000, "closelayer", "omarchy-menu"],
    [3600, "openwindow", "abc,1,Alacritty,Terminal"]
  ])
  assert.strictEqual(r.tip.id, 2)
  assert.strictEqual(r.learned, false)
})

test("opening the menu by shortcut is not learned as the app's shortcut", () => {
  const s = Model.newState()
  feed(s, [
    [1000, "custom", "missedshortcuts>>fired>>1"],
    [3000, "closelayer", "omarchy-menu"],
    [3600, "openwindow", "abc,1,Alacritty,Terminal"]
  ])
  assert.strictEqual(s.learned.Alacritty, undefined)
})

test("without anything learned, a class named in the command still matches", () => {
  const s = Model.newState()
  const r = feed(s, [
    [3000, "closelayer", "omarchy-menu"],
    [3500, "openwindow", "abc,1,typora,Typora"]
  ])
  assert.strictEqual(r.tip.id, 4)
})

test("windows not started from the launcher never produce a tip", () => {
  const s = Model.newState({ typora: 'exec_cmd("uwsm-app -- typora")' })
  const r = feed(s, [[5000, "openwindow", "abc,1,typora,Typora"]])   // e.g. double click in Nautilus
  assert.strictEqual(r.tip, null)
})

test("a launch long after the launcher closed is not blamed on it", () => {
  const s = Model.newState({ typora: 'exec_cmd("uwsm-app -- typora")' })
  const r = feed(s, [
    [1000, "closelayer", "omarchy-menu"],
    [1000 + Model.APP_START_WINDOW + 1, "openwindow", "abc,1,typora,Typora"]
  ])
  assert.strictEqual(r.tip, null)
})

test("window titles with commas do not confuse the class", () => {
  const s = Model.newState()
  const r = feed(s, [
    [1000, "custom", "missedshortcuts>>fired>>4"],
    [1500, "openwindow", "abc,1,typora,a, b, c - Typora"]
  ])
  assert.ok(r.learned)
  assert.strictEqual(s.learned.typora, 'exec_cmd("uwsm-app -- typora")')
})

// ---- workspaces -------------------------------------------------------------

test("a workspace switch without a shortcut suggests the workspace shortcut", () => {
  const r = feed(Model.newState(), [[5000, "workspacev2", "2,2"]])
  assert.strictEqual(r.tip.id, 5)
})

test("a workspace switch by shortcut is not tipped", () => {
  const r = feed(Model.newState(), [
    [5000, "custom", "missedshortcuts>>fired>>5"],
    [5010, "workspacev2", "2,2"]
  ])
  assert.strictEqual(r.tip, null)
})

test("workspace changes caused by windows or monitor focus are ignored", () => {
  assert.strictEqual(feed(Model.newState(), [[5000, "openwindow", "a,2,x,y"], [5300, "workspacev2", "2,2"]]).tip, null)
  assert.strictEqual(feed(Model.newState(), [[5000, "closewindow", "a"], [5300, "workspacev2", "2,2"]]).tip, null)
  assert.strictEqual(feed(Model.newState(), [[5000, "focusedmon", "DP-1,2"], [5100, "workspacev2", "2,2"]]).tip, null)
})

test("workspaces without a shortcut give no tip", () => {
  assert.strictEqual(feed(Model.newState(), [[5000, "workspacev2", "11,11"]]).tip, null)
})

// ---- floating ---------------------------------------------------------------

test("toggling floating without a shortcut suggests SUPER + T", () => {
  const r = feed(Model.newState(), [[5000, "changefloatingmode", "abc,1"]])
  assert.strictEqual(r.tip.id, 6)
})

test("floating set by a window rule on open is ignored", () => {
  const r = feed(Model.newState(), [[5000, "openwindow", "abc,1,x,y"], [5050, "changefloatingmode", "abc,1"]])
  assert.strictEqual(r.tip, null)
})

// ---- close and fullscreen stay silent ----------------------------------------

test("closing a window or going fullscreen never produces a tip", () => {
  assert.strictEqual(feed(Model.newState(), [[5000, "closewindow", "abc"]]).tip, null)
  assert.strictEqual(feed(Model.newState(), [[5000, "fullscreen", "1"]]).tip, null)
})

// ---- rate limit -------------------------------------------------------------

test("tips are rate limited globally and per shortcut", () => {
  const s = Model.newState()
  assert.ok(Model.allowTip(s, BINDINGS[4], 100000))
  assert.ok(!Model.allowTip(s, BINDINGS[5], 100000 + Model.GLOBAL_COOLDOWN - 1))
  assert.ok(Model.allowTip(s, BINDINGS[5], 100000 + Model.GLOBAL_COOLDOWN))
  assert.ok(!Model.allowTip(s, BINDINGS[4], 100000 + Model.TIP_COOLDOWN - 1))
  assert.ok(Model.allowTip(s, BINDINGS[4], 100000 + Model.TIP_COOLDOWN))
  assert.ok(!Model.allowTip(s, null, 10 * Model.TIP_COOLDOWN))
})

test("old fired shortcuts are forgotten", () => {
  const s = Model.newState()
  feed(s, [[1000, "custom", "missedshortcuts>>fired>>5"], [60000, "workspacev2", "2,2"]])
  assert.strictEqual(s.fired.length, 0)
})

console.log(passed + " tests passed")
